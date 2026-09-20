const express = require('express');
const { read, write, edgeToJson } = require('../db');
const { isRelType } = require('../types');

const router = express.Router();

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Properties the API owns on a relationship.
const RESERVED = ['confidence', 'added', 'source_uid'];

// ---------------------------------------------------------------- create

router.post('/', async (req, res, next) => {
  try {
    const {
      from, to, type, props = {},
      confidence = 'unconfirmed', source_uid = null,
    } = req.body;

    if (!from || !to) throw bad('from and to are required');
    if (from === to) throw bad('Cannot link an entity to itself');
    // Registry membership is the injection guard — see types.js.
    if (!isRelType(type)) throw bad(`Unknown relationship type: ${type}`);

    const extra = {};
    for (const [k, v] of Object.entries(props)) {
      if (!RESERVED.includes(k)) extra[k] = String(v);
    }

    const r = await write(
      `MATCH (a:Entity {uid: $from}), (b:Entity {uid: $to})
       CREATE (a)-[r:${type}]->(b)
       SET r = $extra
       SET r.confidence = $confidence,
           r.source_uid = $source_uid,
           r.added      = datetime()
       RETURN r, a.uid AS fromUid, b.uid AS toUid`,
      { from, to, extra, confidence: String(confidence), source_uid },
    );

    if (!r.records.length) throw bad('One or both entities not found', 404);

    const rec = r.records[0];
    res.status(201).json(
      edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid')),
    );
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- read

router.get('/:id', async (req, res, next) => {
  try {
    const r = await read(
      `MATCH (a)-[r]->(b)
       WHERE elementId(r) = $id AND NOT type(r) STARTS WITH '_'
       RETURN r, a.uid AS fromUid, b.uid AS toUid`,
      { id: req.params.id },
    );
    if (!r.records.length) throw bad('Not found', 404);
    const rec = r.records[0];
    res.json(edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid')));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- update

router.patch('/:id', async (req, res, next) => {
  try {
    const { props = {}, confidence, source_uid } = req.body;

    const patch = {};
    for (const [k, v] of Object.entries(props)) {
      if (!['added', 'source_uid'].includes(k)) patch[k] = String(v);
    }
    if (confidence !== undefined) patch.confidence = String(confidence);
    if (source_uid !== undefined) patch.source_uid = source_uid;

    const r = await write(
      `MATCH (a)-[r]->(b)
       WHERE elementId(r) = $id AND NOT type(r) STARTS WITH '_'
       SET r += $patch
       RETURN r, a.uid AS fromUid, b.uid AS toUid`,
      { id: req.params.id, patch },
    );

    if (!r.records.length) throw bad('Not found', 404);
    const rec = r.records[0];
    res.json(edgeToJson(rec.get('r'), rec.get('fromUid'), rec.get('toUid')));
  } catch (e) { next(e); }
});

/**
 * Cypher cannot rewrite a relationship type in place, so this deletes and
 * recreates. Properties are carried across; the elementId changes.
 */
router.put('/:id/type', async (req, res, next) => {
  try {
    const { type } = req.body;
    if (!isRelType(type)) throw bad(`Unknown relationship type: ${type}`);

    const cur = await read(
      `MATCH (a)-[r]->(b)
       WHERE elementId(r) = $id AND NOT type(r) STARTS WITH '_'
       RETURN properties(r) AS props, a.uid AS fromUid, b.uid AS toUid,
              type(r) AS t`,
      { id: req.params.id },
    );
    if (!cur.records.length) throw bad('Not found', 404);

    const rec = cur.records[0];
    if (rec.get('t') === type) {
      const same = await read(
        `MATCH (a)-[r]->(b) WHERE elementId(r) = $id
         RETURN r, a.uid AS fromUid, b.uid AS toUid`,
        { id: req.params.id },
      );
      const s = same.records[0];
      return res.json(edgeToJson(s.get('r'), s.get('fromUid'), s.get('toUid')));
    }

    const r = await write(
      `MATCH (a:Entity {uid: $from}), (b:Entity {uid: $to})
       MATCH (a)-[old]->(b) WHERE elementId(old) = $id
       DELETE old
       CREATE (a)-[r:${type}]->(b)
       SET r = $props
       RETURN r, a.uid AS fromUid, b.uid AS toUid`,
      {
        id: req.params.id,
        from: rec.get('fromUid'),
        to: rec.get('toUid'),
        props: rec.get('props'),
      },
    );

    const out = r.records[0];
    res.json(edgeToJson(out.get('r'), out.get('fromUid'), out.get('toUid')));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- delete

router.delete('/:id', async (req, res, next) => {
  try {
    // The _ guard stops a client deleting provenance links through here.
    await write(
      `MATCH ()-[r]->()
       WHERE elementId(r) = $id AND NOT type(r) STARTS WITH '_'
       DELETE r`,
      { id: req.params.id },
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
