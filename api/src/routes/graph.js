const express = require('express');
const { read, entityToJson, edgeToJson } = require('../db');

const router = express.Router();

/** Parse and bound a query-string integer. */
const clamp = (v, def, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : def;
};

/**
 * Note on LIMIT: JS numbers arrive at Neo4j as floats, and LIMIT rejects
 * anything that is not an integer — hence toInteger() around every
 * parameterised limit.
 */

// ---------------------------------------------------------------- load

router.get('/', async (req, res, next) => {
  try {
    const limit = clamp(req.query.limit, 500, 5000);

    const n = await read(
      'MATCH (n:Entity) RETURN n LIMIT toInteger($limit)',
      { limit },
    );

    // Internal provenance edges (_FROM) are structural, not part of the
    // investigative graph.
    const e = await read(
      `MATCH (a:Entity)-[r]->(b:Entity)
       WHERE NOT type(r) STARTS WITH '_'
       RETURN r, a.uid AS fromUid, b.uid AS toUid
       LIMIT toInteger($limit)`,
      { limit: limit * 2 },
    );

    res.json({
      nodes: n.records.map((rec) => entityToJson(rec.get('n'))),
      edges: e.records.map((rec) =>
        edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid'))),
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- search

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json([]);

    // Escape Lucene operators so a stray quote or colon cannot error out
    // the whole query.
    const escaped = q.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, '\\$1');

    try {
      const r = await read(
        `CALL db.index.fulltext.queryNodes('entity_search', $q)
         YIELD node, score
         RETURN node, score
         ORDER BY score DESC
         LIMIT 25`,
        { q: `${escaped}*` },
      );
      return res.json(r.records.map((rec) => ({
        ...entityToJson(rec.get('node')),
        score: rec.get('score'),
      })));
    } catch {
      // The fulltext index rejects input with no usable tokens. Fall back
      // to a scan rather than failing a valid search.
      const r = await read(
        `MATCH (n:Entity)
         WHERE toLower(n.name) CONTAINS toLower($q)
         RETURN n LIMIT 25`,
        { q },
      );
      return res.json(r.records.map((rec) => entityToJson(rec.get('n'))));
    }
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- expand

router.get('/neighbors/:uid', async (req, res, next) => {
  try {
    const limit = clamp(req.query.limit, 60, 500);

    const r = await read(
      `MATCH (n:Entity {uid: $uid})-[r]-(m:Entity)
       WHERE NOT type(r) STARTS WITH '_'
       RETURN r, m, startNode(r).uid AS fromUid, endNode(r).uid AS toUid
       LIMIT toInteger($limit)`,
      { uid: req.params.uid, limit },
    );

    // A neighbour reachable by several relationships appears once per
    // edge, so both sides are deduped by id.
    const nodes = new Map();
    const edges = new Map();

    for (const rec of r.records) {
      const m = entityToJson(rec.get('m'));
      const e = edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid'));
      nodes.set(m.uid, m);
      edges.set(e.id, e);
    }

    res.json({ nodes: [...nodes.values()], edges: [...edges.values()] });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- path

router.get('/path', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      throw Object.assign(new Error('from and to are required'), { status: 400 });
    }

    // Variable-length bounds cannot be parameterised. depth is an integer
    // from clamp(), never user text.
    const depth = clamp(req.query.depth, 6, 10);

    const r = await read(
      `MATCH (a:Entity {uid: $from}), (b:Entity {uid: $to})
       MATCH p = shortestPath((a)-[*..${depth}]-(b))
       WHERE none(rel IN relationships(p) WHERE type(rel) STARTS WITH '_')
       RETURN p`,
      { from, to },
    );

    if (!r.records.length) return res.json({ nodes: [], edges: [] });

    const path = r.records[0].get('p');
    const nodes = path.segments.length
      ? [path.start, ...path.segments.map((s) => s.end)]
      : [path.start];

    res.json({
      nodes: nodes.map(entityToJson),
      edges: path.segments.map((s) =>
        edgeToJson(
          s.relationship,
          s.start.properties.uid,
          s.end.properties.uid,
        )),
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- stats

router.get('/stats', async (_req, res, next) => {
  try {
    // COUNT{} subqueries evaluate independently, so an empty graph still
    // returns a row — chained MATCH clauses would return nothing at all.
    const counts = await read(`
      RETURN
        COUNT { MATCH (n:Entity) } AS entities,
        COUNT { MATCH ()-[r]->() WHERE NOT type(r) STARTS WITH '_' } AS rels,
        COUNT { MATCH (s:_Source) } AS sources`);

    const byType = await read(`
      MATCH (n:Entity)
      RETURN n.type AS type, count(n) AS count
      ORDER BY count DESC`);

    const hubs = await read(`
      MATCH (n:Entity)-[r]-(:Entity)
      WHERE NOT type(r) STARTS WITH '_'
      RETURN n.uid AS uid, n.name AS name, n.type AS type, count(r) AS degree
      ORDER BY degree DESC
      LIMIT 10`);

    const c = counts.records[0];

    res.json({
      entities: c.get('entities'),
      relationships: c.get('rels'),
      sources: c.get('sources'),
      byType: byType.records.map((r) => ({
        type: r.get('type'),
        count: r.get('count'),
      })),
      hubs: hubs.records.map((r) => ({
        uid: r.get('uid'),
        name: r.get('name'),
        type: r.get('type'),
        degree: r.get('degree'),
      })),
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- orphans

/** Entities with no relationships — usually import artefacts or dead ends. */
router.get('/orphans', async (req, res, next) => {
  try {
    const limit = clamp(req.query.limit, 100, 1000);
    const r = await read(
      `MATCH (n:Entity)
       WHERE NOT (n)-[]-(:Entity)
       RETURN n LIMIT toInteger($limit)`,
      { limit },
    );
    res.json(r.records.map((rec) => entityToJson(rec.get('n'))));
  } catch (e) { next(e); }
});

module.exports = router;
