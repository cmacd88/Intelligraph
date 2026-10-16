const express = require('express');
const crypto = require('crypto');
const { read, write, scalar } = require('../db');

const router = express.Router();

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const queryToJson = (node) => {
  const p = node.properties;
  return {
    uid: p.uid,
    name: p.name,
    cypher: p.cypher,
    notes: p.notes ?? '',
    created: scalar(p.created),
    updated: scalar(p.updated),
  };
};

function clean(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) throw bad('name is required');
    if (name.length > 120) throw bad('name too long (max 120)');
    out.name = name;
  }
  if (!partial || body.cypher !== undefined) {
    const cypher = String(body.cypher ?? '').trim();
    if (!cypher) throw bad('cypher is required');
    if (cypher.length > 20000) throw bad('cypher too long (max 20000)');
    out.cypher = cypher;
  }
  if (body.notes !== undefined) out.notes = String(body.notes).slice(0, 2000);
  return out;
}

router.get('/', async (_req, res, next) => {
  try {
    const r = await read('MATCH (q:_Query) RETURN q ORDER BY toLower(q.name)');
    res.json(r.records.map((rec) => queryToJson(rec.get('q'))));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const f = clean(req.body ?? {});
    const uid = crypto.randomUUID();
    const r = await write(
      `CREATE (q:_Query {uid: $uid, name: $name, cypher: $cypher,
                         notes: $notes, created: datetime(), updated: datetime()})
       RETURN q`,
      { uid, name: f.name, cypher: f.cypher, notes: f.notes ?? '' },
    );
    res.status(201).json(queryToJson(r.records[0].get('q')));
  } catch (e) { next(e); }
});

router.patch('/:uid', async (req, res, next) => {
  try {
    const f = clean(req.body ?? {}, { partial: true });
    const r = await write(
      `MATCH (q:_Query {uid: $uid})
       SET q += $f, q.updated = datetime()
       RETURN q`,
      { uid: req.params.uid, f },
    );
    if (!r.records.length) throw bad('query not found', 404);
    res.json(queryToJson(r.records[0].get('q')));
  } catch (e) { next(e); }
});

router.delete('/:uid', async (req, res, next) => {
  try {
    const r = await write(
      'MATCH (q:_Query {uid: $uid}) DELETE q RETURN count(q) AS n',
      { uid: req.params.uid },
    );
    if (!r.records[0].get('n')) throw bad('query not found', 404);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
