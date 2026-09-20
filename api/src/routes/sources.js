const express = require('express');
const crypto = require('crypto');
const { read, write, scalar, entityToJson } = require('../db');

const router = express.Router();

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const sourceToJson = (node) => {
  const p = node.properties;
  return {
    uid: p.uid,
    label: p.label,
    url: p.url ?? null,
    kind: p.kind ?? 'manual',
    notes: p.notes ?? '',
    accessed: scalar(p.accessed),
  };
};

router.get('/', async (_req, res, next) => {
  try {
    const r = await read('MATCH (s:_Source) RETURN s ORDER BY s.accessed DESC');
    res.json(r.records.map((rec) => sourceToJson(rec.get('s'))));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { label, url = null, kind = 'manual', notes = '' } = req.body;
    if (!label || !String(label).trim()) throw bad('label is required');

    const r = await write(
      `CREATE (s:_Source {
         uid: $uid, label: $label, url: $url,
         kind: $kind, notes: $notes, accessed: datetime()
       }) RETURN s`,
      {
        uid: crypto.randomUUID(),
        label: String(label).trim(),
        url,
        kind: String(kind),
        notes: String(notes),
      },
    );
    res.status(201).json(sourceToJson(r.records[0].get('s')));
  } catch (e) { next(e); }
});

router.get('/:uid', async (req, res, next) => {
  try {
    const r = await read('MATCH (s:_Source {uid: $uid}) RETURN s', req.params);
    if (!r.records.length) throw bad('Not found', 404);
    res.json(sourceToJson(r.records[0].get('s')));
  } catch (e) { next(e); }
});

/** Everything attributed to a source — the "what if this is wrong" query. */
router.get('/:uid/entities', async (req, res, next) => {
  try {
    const r = await read(
      'MATCH (n:Entity)-[:_FROM]->(s:_Source {uid: $uid}) RETURN n',
      req.params,
    );
    res.json(r.records.map((rec) => entityToJson(rec.get('n'))));
  } catch (e) { next(e); }
});

router.patch('/:uid', async (req, res, next) => {
  try {
    const { label, url, kind, notes } = req.body;
    const patch = {};
    if (label !== undefined) patch.label = String(label).trim();
    if (url !== undefined) patch.url = url;
    if (kind !== undefined) patch.kind = String(kind);
    if (notes !== undefined) patch.notes = String(notes);

    const r = await write(
      'MATCH (s:_Source {uid: $uid}) SET s += $patch RETURN s',
      { uid: req.params.uid, patch },
    );
    if (!r.records.length) throw bad('Not found', 404);
    res.json(sourceToJson(r.records[0].get('s')));
  } catch (e) { next(e); }
});

/** Removes the source; entities attributed to it survive, minus the link. */
router.delete('/:uid', async (req, res, next) => {
  try {
    await write('MATCH (s:_Source {uid: $uid}) DETACH DELETE s', req.params);
    await write(
      'MATCH ()-[r]->() WHERE r.source_uid = $uid REMOVE r.source_uid',
      req.params,
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
