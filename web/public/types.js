const { read, write } = require('./db');

let entityTypes = new Map();  // name -> {name, color, glyph, builtin}
let relTypes = new Map();     // name -> {name, directed, builtin}

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

async function addEntityType({
  name, color, glyph, icon,
}) {
  if (!validName(name)) {
    throw bad('Type name must start with a letter and contain only letters, digits and underscore');
  }
  await write(
    `MERGE (t:_EntityType {name: $name})
     ON CREATE SET t.color = $color, t.glyph = $glyph, t.icon = $icon, t.builtin = false
     RETURN t`,
    {
      name,
      color: cleanColor(color, '#6b7280'),
      glyph: (glyph || name.slice(0, 2)).toUpperCase().slice(0, 2),
      icon: cleanIcon(icon),
    },
  );
  await loadRegistry();
  return entityTypes.get(name);
}

async function addRelType({ name, directed = true, color }) {
  const upper = typeof name === 'string' ? name.toUpperCase() : name;
  if (!validName(upper)) throw bad('Invalid relationship type name');

  await write(
    `MERGE (t:_RelType {name: $name})
     ON CREATE SET t.directed = $directed, t.color = $color, t.builtin = false
     RETURN t`,
    { name: upper, directed: directed !== false, color: cleanColor(color, '#475569') },
  );
  await loadRegistry();
  return relTypes.get(upper);
}

/**
 * Editable on every type, builtin or not — unlike delete, changing display
 * properties can't corrupt data, so there's no reason to lock out the
 * built-in set.
 */
async function updateEntityType(name, { color, glyph, icon }) {
  const t = entityTypes.get(name);
  if (!t) throw bad('Unknown type', 404);

  const patch = {};
  if (color !== undefined) patch.color = cleanColor(color, t.color);
  if (glyph !== undefined) patch.glyph = String(glyph || t.glyph).toUpperCase().slice(0, 2);
  if (icon !== undefined) patch.icon = cleanIcon(icon);

  await write(
    'MATCH (t:_EntityType {name: $name}) SET t += $patch RETURN t',
    { name, patch },
  );
  await loadRegistry();
  return entityTypes.get(name);
}

async function updateRelType(name, { directed, color }) {
  const t = relTypes.get(name);
  if (!t) throw bad('Unknown type', 404);

  const patch = {};
  if (directed !== undefined) patch.directed = directed !== false;
  if (color !== undefined) patch.color = cleanColor(color, t.color);

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
};
