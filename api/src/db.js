const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://neo4j:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || '',
  ),
  { maxConnectionPoolSize: 50, disableLosslessIntegers: true },
);

async function read(cypher, params = {}) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function write(cypher, params = {}) {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

// ---- serialisation ---------------------------------------------------

// Neo4j temporal values do not survive JSON.stringify as anything useful,
// so they are flattened to strings here rather than leaking
// {year:{low:2026,...}} shapes into the client.
const scalar = (v) => {
  if (v === null || v === undefined) return null;
  if (neo4j.isInt(v)) return v.toNumber();
  if (neo4j.isDateTime(v) || neo4j.isDate(v) || neo4j.isLocalDateTime(v)) {
    return v.toString();
  }
  if (Array.isArray(v)) return v.map(scalar);
  if (typeof v === 'object') return String(v);
  return v;
};

// Properties the API owns on an entity. Everything else is user data and
// is returned untouched under `props`.
const RESERVED = new Set([
  'uid', 'name', 'type', 'x', 'y', 'created', 'updated', 'confidence', 'notes',
]);

function entityToJson(node) {
  const p = node.properties;
  const props = {};
  for (const [k, v] of Object.entries(p)) {
    if (!RESERVED.has(k)) props[k] = String(scalar(v));
  }
  return {
    uid: p.uid,
    name: p.name ?? '(unnamed)',
    type: p.type ?? node.labels.find((l) => l !== 'Entity') ?? 'Unknown',
    x: scalar(p.x) ?? 0,
    y: scalar(p.y) ?? 0,
    notes: p.notes ?? '',
    created: scalar(p.created),
    updated: scalar(p.updated),
    props,
  };
}

const EDGE_RESERVED = new Set(['confidence', 'added', 'source_uid']);

function edgeToJson(rel, fromUid, toUid) {
  const p = rel.properties || {};
  const props = {};
  for (const [k, v] of Object.entries(p)) {
    if (!EDGE_RESERVED.has(k)) props[k] = String(scalar(v));
  }
  return {
    id: rel.elementId,
    from: fromUid,
    to: toUid,
    type: rel.type,
    confidence: p.confidence ?? 'unconfirmed',
    source_uid: p.source_uid ?? null,
    added: scalar(p.added),
    props,
  };
}

module.exports = { driver, read, write, entityToJson, edgeToJson, scalar };
