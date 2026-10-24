const express = require('express');
const neo4j = require('neo4j-driver');
const { driver, read, scalar, entityToJson, edgeToJson } = require('../db');

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

/**
 * Query params:
 *   limit      max nodes            (default 500, max 5000)
 *   edgeLimit  max links            (default 2 x limit, max 20000)
 *   offset     nodes to skip, for paging (default 0)
 *
 * Nodes are ordered (created, uid) so paging is stable. Links are only
 * returned between nodes in the loaded page — never dangling — and
 * `total` / `truncated` tell the client what was left out.
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = clamp(req.query.limit, 500, 5000);
    const edgeLimit = clamp(req.query.edgeLimit, limit * 2, 20000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const n = await read(
      `MATCH (n:Entity)
       RETURN n ORDER BY n.created, n.uid
       SKIP toInteger($offset) LIMIT toInteger($limit)`,
      { limit, offset },
    );
    const nodes = n.records.map((rec) => entityToJson(rec.get('n')));
    const uids = nodes.map((x) => x.uid);

    // Internal provenance edges (_FROM) are structural, not part of the
    // investigative graph.
    const e = await read(
      `MATCH (a:Entity)-[r]->(b:Entity)
       WHERE a.uid IN $uids AND b.uid IN $uids
         AND NOT type(r) STARTS WITH '_'
       RETURN r, a.uid AS fromUid, b.uid AS toUid
       LIMIT toInteger($edgeLimit)`,
      { uids, edgeLimit },
    );
    const edges = e.records.map((rec) =>
      edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid')));

    // Totals let the UI say "500 of 2,340" instead of silently truncating.
    const t = await read(
      `RETURN COUNT { MATCH (n:Entity) } AS nodes,
              COUNT { MATCH (a:Entity)-[r]->(b:Entity)
                      WHERE NOT type(r) STARTS WITH '_' } AS edges`,
    );
    const total = {
      nodes: t.records[0].get('nodes'),
      edges: t.records[0].get('edges'),
    };

    res.json({
      nodes,
      edges,
      total,
      offset,
      truncated: {
        nodes: total.nodes > offset + nodes.length,
        // Edges between loaded nodes hit the cap, or exist only to
        // nodes outside this page.
        edges: edges.length >= edgeLimit,
      },
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- full

/**
 * The entire graph in one response. The client decides how much of it to
 * draw, so it always knows each node's true degree and can mark nodes
 * that have links it chose not to render. Safety caps only; override with
 * FULL_NODE_CAP / FULL_EDGE_CAP. `truncated` is set if either was hit.
 */
const FULL_NODE_CAP = parseInt(process.env.FULL_NODE_CAP, 10) || 500000;
const FULL_EDGE_CAP = parseInt(process.env.FULL_EDGE_CAP, 10) || 2000000;

router.get('/full', async (_req, res, next) => {
  try {
    const n = await read(
      'MATCH (n:Entity) RETURN n LIMIT toInteger($cap)',
      { cap: FULL_NODE_CAP + 1 },
    );
    const e = await read(
      `MATCH (a:Entity)-[r]->(b:Entity)
       WHERE NOT type(r) STARTS WITH '_'
       RETURN r, a.uid AS fromUid, b.uid AS toUid
       LIMIT toInteger($cap)`,
      { cap: FULL_EDGE_CAP + 1 },
    );

    const nodeCut = n.records.length > FULL_NODE_CAP;
    const edgeCut = e.records.length > FULL_EDGE_CAP;

    res.json({
      nodes: n.records.slice(0, FULL_NODE_CAP)
        .map((rec) => entityToJson(rec.get('n'))),
      edges: e.records.slice(0, FULL_EDGE_CAP)
        .map((rec) =>
          edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid'))),
      truncated: { nodes: nodeCut, edges: edgeCut },
      caps: { nodes: FULL_NODE_CAP, edges: FULL_EDGE_CAP },
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- query

const QUERY_ROW_CAP = 2000;
const QUERY_TIMEOUT_MS = 15000;

/**
 * Run a user-supplied Cypher query, read-only.
 *
 * Community Edition has no roles, and a READ session on a single instance
 * does not stop writes, so safety comes from asking the planner instead:
 * EXPLAIN compiles the query without running it, and its queryType is 'r'
 * only for pure reads. Anything else (w, rw, s) is refused.
 *
 * Results are split into graph parts (nodes/relationships found anywhere
 * in the returned values, including paths and lists) and a flat table of
 * the rest. Entities are only included if they carry :Entity.
 */
router.post('/query', async (req, res, next) => {
  try {
    const cypher = String(req.body?.cypher ?? '').trim().replace(/;+\s*$/, '');
    if (!cypher) {
      throw Object.assign(new Error('cypher is required'), { status: 400 });
    }
    const params = req.body?.params && typeof req.body.params === 'object'
      ? req.body.params : {};
    const rowCap = clamp(req.body?.rowCap, QUERY_ROW_CAP, QUERY_ROW_CAP);

    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    let result;
    try {
      let plan;
      try {
        plan = await session.run(`EXPLAIN ${cypher}`, params);
      } catch (e) {
        throw Object.assign(new Error(e.message), { status: 400 });
      }
      const qt = plan.summary.queryType;
      if (qt !== 'r') {
        throw Object.assign(
          new Error('Only read-only queries are allowed '
            + `(this one plans as "${qt}").`),
          { status: 403 },
        );
      }

      result = await session.run(cypher, params, { timeout: QUERY_TIMEOUT_MS });
    } catch (e) {
      if (!e.status) e.status = 400; // syntax / runtime errors are the caller's
      throw e;
    } finally {
      await session.close();
    }

    const nodes = new Map();
    const edges = new Map();
    const columns = result.records.length ? result.records[0].keys : [];
    const rows = [];
    let truncated = false;

    const addNode = (n) => {
      if (!n.labels.includes('Entity')) return;
      const j = entityToJson(n);
      nodes.set(j.uid, j);
    };
    const pendingRels = [];
    // Relationships carry only internal ids; resolve endpoints afterwards
    // through the nodes seen, or fetch the missing ones.
    const walk = (v) => {
      if (v === null || v === undefined) return;
      if (neo4j.isNode(v)) { addNode(v); return; }
      if (neo4j.isRelationship(v)) {
        if (!v.type.startsWith('_')) pendingRels.push(v);
        return;
      }
      if (neo4j.isPath(v)) {
        walk(v.start);
        for (const s of v.segments) {
          walk(s.start); walk(s.relationship); walk(s.end);
        }
        return;
      }
      if (Array.isArray(v)) v.forEach(walk);
    };

    // Internal ids of nodes seen, to map relationship endpoints to uids.
    const idToUid = new Map();
    const noteIds = (v) => {
      if (v === null || v === undefined) return;
      if (neo4j.isNode(v)) { idToUid.set(v.elementId, v.properties.uid); return; }
      if (neo4j.isPath(v)) {
        noteIds(v.start);
        v.segments.forEach((s) => { noteIds(s.start); noteIds(s.end); });
        return;
      }
      if (Array.isArray(v)) v.forEach(noteIds);
    };

    for (const rec of result.records) {
      if (rows.length >= rowCap) { truncated = true; break; }
      const row = {};
      for (const k of rec.keys) {
        const v = rec.get(k);
        walk(v);
        noteIds(v);
        row[k] = neo4j.isNode(v) || neo4j.isRelationship(v) || neo4j.isPath(v)
          ? undefined : scalar(v);
      }
      rows.push(row);
    }

    // Endpoints of returned relationships that the query did not itself
    // return as nodes: fetch them so edges are never dangling.
    const missing = new Set();
    for (const r of pendingRels) {
      for (const id of [r.startNodeElementId, r.endNodeElementId]) {
        if (!idToUid.has(id)) missing.add(id);
      }
    }
    if (missing.size) {
      const m = await read(
        `MATCH (n:Entity) WHERE elementId(n) IN $ids RETURN n`,
        { ids: [...missing] },
      );
      for (const rec of m.records) {
        const n = rec.get('n');
        idToUid.set(n.elementId, n.properties.uid);
        addNode(n);
      }
    }
    for (const r of pendingRels) {
      const from = idToUid.get(r.startNodeElementId);
      const to = idToUid.get(r.endNodeElementId);
      if (from && to) edges.set(r.elementId, edgeToJson(r, from, to));
    }

    res.json({
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      columns,
      rows: rows.filter((r) => Object.values(r).some((v) => v !== undefined)),
      truncated,
    });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- search

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json([]);
    const limit = clamp(req.query.limit, 25, 200);

    // Escape Lucene operators so a stray quote or colon cannot error out
    // the whole query.
    const escaped = q.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, '\\$1');

    try {
      const r = await read(
        `CALL db.index.fulltext.queryNodes('entity_search', $q)
         YIELD node, score
         RETURN node, score
         ORDER BY score DESC
         LIMIT toInteger($limit)`,
        { q: `${escaped}*`, limit },
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
         RETURN n LIMIT toInteger($limit)`,
        { q, limit },
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

const PATH_CAP = 500;          // most shortest paths returned
const PATH_TIMEOUT_MS = 15000;

/**
 * Every shortest path between two entities (all of the minimum length, not
 * just one), merged into a single node/edge set for display.
 *
 * Returns { nodes, edges, length, paths, truncated }: `length` is the hop
 * count, `paths` how many distinct shortest paths there are, `truncated`
 * true if PATH_CAP was hit (the set is then a subset of them).
 * Empty nodes/edges means no path within `depth` hops.
 */
router.get('/path', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      throw Object.assign(new Error('from and to are required'), { status: 400 });
    }

    // Variable-length bounds cannot be parameterised. depth is an integer
    // from clamp(), never user text.
    const depth = clamp(req.query.depth, 6, 10);

    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    let r;
    try {
      r = await session.run(
        `MATCH (a:Entity {uid: $from}), (b:Entity {uid: $to})
         MATCH p = allShortestPaths((a)-[*..${depth}]-(b))
         WHERE none(rel IN relationships(p) WHERE type(rel) STARTS WITH '_')
         RETURN p LIMIT toInteger($cap)`,
        { from, to, cap: PATH_CAP + 1 },
        { timeout: PATH_TIMEOUT_MS },
      );
    } finally {
      await session.close();
    }

    const empty = { nodes: [], edges: [], length: 0, paths: 0, truncated: false };
    if (!r.records.length) return res.json(empty);

    const truncated = r.records.length > PATH_CAP;
    const paths = r.records.slice(0, PATH_CAP).map((rec) => rec.get('p'));

    const nodes = new Map();       // uid -> node json
    const edges = new Map();       // elementId -> edge json
    for (const path of paths) {
      // Relationship direction is the stored one, not the walking one, so
      // resolve its endpoints through the path's own nodes.
      const uidOf = new Map();
      const all = [path.start, ...path.segments.map((s) => s.end)];
      for (const n of all) {
        uidOf.set(n.elementId, n.properties.uid);
        if (!nodes.has(n.properties.uid)) nodes.set(n.properties.uid, entityToJson(n));
      }
      for (const s of path.segments) {
        const rel = s.relationship;
        if (edges.has(rel.elementId)) continue;
        edges.set(rel.elementId, edgeToJson(
          rel,
          uidOf.get(rel.startNodeElementId),
          uidOf.get(rel.endNodeElementId),
        ));
      }
    }

    res.json({
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      length: paths[0].segments.length,
      paths: paths.length,
      truncated,
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
