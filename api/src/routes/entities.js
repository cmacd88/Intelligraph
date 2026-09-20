const express = require('express');
const crypto = require('crypto');
const { read, write, entityToJson } = require('../db');
const { isEntityType } = require('../types');

const router = express.Router();

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Keys the API owns. User props are stripped of these so a stray key
// cannot overwrite uid, type or the timestamps.
const RESERVED = [
  'uid', 'name', 'type', 'x', 'y', 'created', 'updated', 'confidence', 'notes',
];

// ---------------------------------------------------------------- create

router.post('/', async (req, res, next) => {
  try {
    const {
      name, type, props = {}, x = 0, y = 0,
      notes = '', confidence = 'unconfirmed', source_uid = null,
    } = req.body;

    if (!name || !String(name).trim()) throw bad('name is required');
    // Registry membership is the injection guard — see types.js.
    if (!isEntityType(type)) throw bad(`Unknown entity type: ${type}`);

    const extra = {};
    for (const [k, v] of Object.entries(props)) {
      if (!RESERVED.includes(k)) extra[k] = String(v);
    }

    // Every parameter referenced inside the CALL subquery must be passed
    // at the top level of the params object, not nested inside another
    // parameter — otherwise Neo4j reports "Expected parameter(s)".
    const r = await write(
      `CREATE (n:Entity:${type})
       SET n = $extra
       SET n.uid        = $uid,
           n.name       = $name,
           n.type       = $type,
           n.x          = $x,
           n.y          = $y,
           n.notes      = $notes,
           n.confidence = $confidence,
           n.created    = datetime(),
           n.updated    = datetime()
       WITH n
       CALL {
         WITH n
         WITH n WHERE $source_uid IS NOT NULL
         MATCH (s:_Source {uid: $source_uid})
         CREATE (n)-[:_FROM {confidence: $confidence, added: datetime()}]->(s)
       }
       RETURN n`,
      {
        extra,
        uid: crypto.randomUUID(),
        name: String(name).trim(),
        type,
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        notes: String(notes),
        confidence: String(confidence),
        source_uid,
      },
    );

    res.status(201).json(entityToJson(r.records[0].get('n')));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- read

router.get('/:uid', async (req, res, next) => {
  try {
    const r = await read('MATCH (n:Entity {uid: $uid}) RETURN n', req.params);
    if (!r.records.length) throw bad('Not found', 404);
    res.json(entityToJson(r.records[0].get('n')));
  } catch (e) { next(e); }
});

/** Sources attributed to this entity. */
router.get('/:uid/sources', async (req, res, next) => {
  try {
    const r = await read(
      `MATCH (n:Entity {uid: $uid})-[f:_FROM]->(s:_Source)
       RETURN s, f.confidence AS confidence`,
      req.params,
    );
    res.json(r.records.map((rec) => {
      const p = rec.get('s').properties;
      return {
        uid: p.uid,
        label: p.label,
        url: p.url ?? null,
        kind: p.kind ?? 'manual',
        confidence: rec.get('confidence') ?? 'unconfirmed',
      };
    }));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- update

router.patch('/:uid', async (req, res, next) => {
  try {
    const { name, props, x, y, notes, confidence } = req.body;

    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (x !== undefined) patch.x = Math.round(Number(x) || 0);
    if (y !== undefined) patch.y = Math.round(Number(y) || 0);
    if (notes !== undefined) patch.notes = String(notes);
    if (confidence !== undefined) patch.confidence = String(confidence);

    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        if (!['uid', 'type', 'created', 'updated'].includes(k)) {
          patch[k] = String(v);
        }
      }
    }

    const r = await write(
      `MATCH (n:Entity {uid: $uid})
       SET n += $patch, n.updated = datetime()
       RETURN n`,
      { uid: req.params.uid, patch },
    );
    if (!r.records.length) throw bad('Not found', 404);
    res.json(entityToJson(r.records[0].get('n')));
  } catch (e) { next(e); }
});

/**
 * Changing type rewrites the label, which SET cannot express — it needs
 * REMOVE n:Old SET n:New. Kept as its own endpoint because clients should
 * treat it as a distinct operation from editing properties.
 */
router.put('/:uid/type', async (req, res, next) => {
  try {
    const { type } = req.body;
    if (!isEntityType(type)) throw bad(`Unknown entity type: ${type}`);

    const cur = await read(
      'MATCH (n:Entity {uid: $uid}) RETURN n.type AS t',
      req.params,
    );
    if (!cur.records.length) throw bad('Not found', 404);
    const old = cur.records[0].get('t');

    if (old === type) {
      const r = await read('MATCH (n:Entity {uid: $uid}) RETURN n', req.params);
      return res.json(entityToJson(r.records[0].get('n')));
    }
    // The old label is interpolated too, so it must also be a known type.
    if (!isEntityType(old)) throw bad('Current type is not in the registry', 409);

    const r = await write(
      `MATCH (n:Entity {uid: $uid})
       REMOVE n:${old}
       SET n:${type}, n.type = $type, n.updated = datetime()
       RETURN n`,
      { uid: req.params.uid, type },
    );
    res.json(entityToJson(r.records[0].get('n')));
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------- delete

router.delete('/:uid', async (req, res, next) => {
  try {
    await write('MATCH (n:Entity {uid: $uid}) DETACH DELETE n', req.params);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
