const { read, write } = require('./db');

let entityTypes = new Map();  // name -> {name, color, glyph, icon, parent, builtin}
let relTypes = new Map();     // name -> {name, directed, color, validPairs, builtin}

/**
 * Cypher cannot parameterise labels or relationship types, so they must be
 * interpolated into the query string. Two guards make that safe:
 *
 *   1. A name must match NAME_RE to enter the registry.
 *   2. Only names already in the registry are ever interpolated.
 *
 * Because every registry entry passed check 1 on the way in, membership is
 * sufficient on the way out. NEVER interpolate a name that has not been
 * through isEntityType() or isRelType().
 */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const validName = (s) => typeof s === 'string' && NAME_RE.test(s);

// validPairs is stored on the node as a JSON string (Neo4j properties can't
// hold arrays of maps), parsed back into an array of {from, to[]} on load.
function parseValidPairs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadRegistry() {
  const e = await read('MATCH (t:_EntityType) RETURN t ORDER BY t.name');
  const r = await read('MATCH (t:_RelType) RETURN t ORDER BY t.name');

  entityTypes = new Map(
    e.records.map((rec) => {
      const p = rec.get('t').properties;
      return [p.name, {
        name: p.name,
        color: p.color || '#6b7280',
        glyph: p.glyph || '??',
        // Optional emoji/unicode icon shown instead of the two-letter
        // glyph on nodes. Empty string, not null, so JSON round-trips
        // predictably and the client can just check truthiness.
        icon: p.icon || '',
        // Single ancestor type name, or null for a root type. Soft "is-a"
        // hierarchy — see isDescendantOf() below. Absent/null means this
        // type has no ancestor.
        parent: p.parent || null,
        builtin: p.builtin === true,
      }];
    }),
  );

  relTypes = new Map(
    r.records.map((rec) => {
      const p = rec.get('t').properties;
      return [p.name, {
        name: p.name,
        directed: p.directed !== false,
        color: p.color || '#475569',
        // Soft (UI-only) source/target constraint: a list of
        // {from: <entity type>, to: [<entity types>]} entries. A type
        // named here also matches any of its descendants (via `parent`).
        // Empty list = unrestricted, same as the field being absent.
        validPairs: parseValidPairs(p.validPairs),
        builtin: p.builtin === true,
      }];
    }),
  );

  return { entityTypes, relTypes };
}

const isEntityType = (n) => entityTypes.has(n);
const isRelType = (n) => relTypes.has(n);

const listTypes = () => ({
  entities: [...entityTypes.values()],
  relationships: [...relTypes.values()],
});

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Icons are free-form (emoji/unicode), capped well short of anything that
// could be mistaken for a payload — this is display text, not data.
const cleanIcon = (icon) => (typeof icon === 'string' ? icon.trim().slice(0, 8) : '');
const cleanColor = (color, fallback) => (
  typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
);

/**
 * Walks a type's `parent` chain looking for `ancestorName`. A type is
 * always its own descendant (typeName === ancestorName matches
 * immediately), so callers don't need to special-case the non-hierarchical
 * case separately.
 *
 * Cycle-safe: bounded by the number of registered entity types, so a bad
 * parent chain (which addEntityType/updateEntityType should already
 * prevent) can't loop forever.
 */
function isDescendantOf(typeName, ancestorName) {
  if (typeName === ancestorName) return true;
  let current = entityTypes.get(typeName);
  let hops = 0;
  while (current && current.parent && hops < entityTypes.size) {
    if (current.parent === ancestorName) return true;
    current = entityTypes.get(current.parent);
    hops += 1;
  }
  return false;
}

/** True if `typeName` is `ancestorName` or descends from it, per parent chain. */
const matchesTypeOrAncestor = (typeName, ancestorName) => isDescendantOf(typeName, ancestorName);

/**
 * Detects whether setting `child`'s parent to `parentName` would create a
 * cycle (parentName already descends from child, directly or indirectly).
 * Called before the write, against the in-memory registry as it stands
 * before the change.
 */
function wouldCycle(child, parentName) {
  if (!parentName) return false;
  if (parentName === child) return true;
  let current = entityTypes.get(parentName);
  let hops = 0;
  while (current && hops < entityTypes.size) {
    if (current.name === child) return true;
    if (!current.parent) return false;
    current = entityTypes.get(current.parent);
    hops += 1;
  }
  return false;
}

/**
 * Soft (UI-only) check of whether `fromType`/`toType` is a valid pair for
 * relationship type `relName`. Not enforced server-side on write — see
 * ROADMAP for why hard validation is deferred — this exists so the API can
 * expose the same answer the client computes, for anything that wants to
 * ask rather than duplicate the walk (e.g. a future bulk-import dry run).
 *
 * An empty/absent validPairs list means unrestricted: everything matches.
 * For an undirected relationship type, the pair is checked both ways,
 * since the stored (a)-[]->(b) direction carries no meaning for those.
 */
function isValidPair(relName, fromType, toType) {
  const rel = relTypes.get(relName);
  if (!rel || !rel.validPairs || rel.validPairs.length === 0) return true;

  const oneWayMatches = (from, to) => rel.validPairs.some((entry) => (
    entry && entry.from
      && matchesTypeOrAncestor(from, entry.from)
      && Array.isArray(entry.to)
      && entry.to.some((t) => matchesTypeOrAncestor(to, t))
  ));

  if (oneWayMatches(fromType, toType)) return true;
  if (!rel.directed && oneWayMatches(toType, fromType)) return true;
  return false;
}

// Accepts an array of {from, to} where `from` is a string and `to` is a
// string or array of strings; normalises to {from, to: string[]}, drops
// malformed/unreferenced entries. Silently permissive rather than
// throwing, since this is UI guidance, not an enforced schema — a bad
// entry just fails to constrain anything rather than blocking the save.
function cleanValidPairs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry.from !== 'string') return null;
      const to = Array.isArray(entry.to) ? entry.to : [entry.to];
      const cleanTo = to.filter((t) => typeof t === 'string' && entityTypes.has(t));
      if (!entityTypes.has(entry.from) || cleanTo.length === 0) return null;
      return { from: entry.from, to: cleanTo };
    })
    .filter(Boolean);
}

async function addEntityType({
  name, color, glyph, icon, parent,
}) {
  if (!validName(name)) {
    throw bad('Type name must start with a letter and contain only letters, digits and underscore');
  }
  if (parent !== undefined && parent !== null) {
    if (!entityTypes.has(parent)) throw bad(`Unknown parent type: ${parent}`);
  }
  await write(
    `MERGE (t:_EntityType {name: $name})
     ON CREATE SET t.color = $color, t.glyph = $glyph, t.icon = $icon,
                    t.parent = $parent, t.builtin = false
     RETURN t`,
    {
      name,
      color: cleanColor(color, '#6b7280'),
      glyph: (glyph || name.slice(0, 2)).toUpperCase().slice(0, 2),
      icon: cleanIcon(icon),
      parent: parent || null,
    },
  );
  await loadRegistry();
  return entityTypes.get(name);
}

async function addRelType({
  name, directed = true, color, validPairs,
}) {
  const upper = typeof name === 'string' ? name.toUpperCase() : name;
  if (!validName(upper)) throw bad('Invalid relationship type name');

  await write(
    `MERGE (t:_RelType {name: $name})
     ON CREATE SET t.directed = $directed, t.color = $color,
                    t.validPairs = $validPairs, t.builtin = false
     RETURN t`,
    {
      name: upper,
      directed: directed !== false,
      color: cleanColor(color, '#475569'),
      validPairs: JSON.stringify(cleanValidPairs(validPairs)),
    },
  );
  await loadRegistry();
  return relTypes.get(upper);
}

/**
 * Editable on every type, builtin or not — unlike delete, changing display
 * properties can't corrupt data, so there's no reason to lock out the
 * built-in set.
 */
async function updateEntityType(name, {
  color, glyph, icon, parent,
}) {
  const t = entityTypes.get(name);
  if (!t) throw bad('Unknown type', 404);

  const patch = {};
  if (color !== undefined) patch.color = cleanColor(color, t.color);
  if (glyph !== undefined) patch.glyph = String(glyph || t.glyph).toUpperCase().slice(0, 2);
  if (icon !== undefined) patch.icon = cleanIcon(icon);
  if (parent !== undefined) {
    const nextParent = parent || null;
    if (nextParent !== null) {
      if (!entityTypes.has(nextParent)) throw bad(`Unknown parent type: ${nextParent}`);
      if (wouldCycle(name, nextParent)) throw bad('That parent would create a cycle');
    }
    patch.parent = nextParent;
  }

  await write(
    'MATCH (t:_EntityType {name: $name}) SET t += $patch RETURN t',
    { name, patch },
  );
  await loadRegistry();
  return entityTypes.get(name);
}

async function updateRelType(name, { directed, color, validPairs }) {
  const t = relTypes.get(name);
  if (!t) throw bad('Unknown type', 404);

  const patch = {};
  if (directed !== undefined) patch.directed = directed !== false;
  if (color !== undefined) patch.color = cleanColor(color, t.color);
  if (validPairs !== undefined) patch.validPairs = JSON.stringify(cleanValidPairs(validPairs));

  await write(
    'MATCH (t:_RelType {name: $name}) SET t += $patch RETURN t',
    { name, patch },
  );
  await loadRegistry();
  return relTypes.get(name);
}

async function deleteEntityType(name) {
  const t = entityTypes.get(name);
  if (!t) throw bad('Unknown type', 404);
  if (t.builtin) throw bad('Cannot delete a built-in type');

  const children = [...entityTypes.values()].filter((c) => c.parent === name);
  if (children.length) {
    throw bad(`Type is the parent of ${children.length} other type(s)`, 409);
  }

  const uses = await read(
    'MATCH (n:Entity {type: $name}) RETURN count(n) AS c',
    { name },
  );
  const c = uses.records[0].get('c');
  if (c > 0) throw bad(`Type is in use by ${c} entities`, 409);

  await write('MATCH (t:_EntityType {name: $name}) DELETE t', { name });
  await loadRegistry();
}

async function deleteRelType(name) {
  const t = relTypes.get(name);
  if (!t) throw bad('Unknown type', 404);
  if (t.builtin) throw bad('Cannot delete a built-in type');

  // Relationship type names cannot be parameterised in a type predicate
  // either, hence the interpolation — safe because `name` came from the
  // registry above.
  const uses = await read(
    `MATCH ()-[r:${name}]->() RETURN count(r) AS c`,
  );
  const c = uses.records[0].get('c');
  if (c > 0) throw bad(`Type is in use by ${c} relationships`, 409);

  await write('MATCH (t:_RelType {name: $name}) DELETE t', { name });
  await loadRegistry();
}

module.exports = {
  loadRegistry, isEntityType, isRelType, listTypes,
  addEntityType, addRelType, deleteEntityType, deleteRelType,
  updateEntityType, updateRelType, validName,
  isDescendantOf, isValidPair,
};
