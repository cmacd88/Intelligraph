const express = require('express');
const types = require('../types');

const router = express.Router();

router.get('/', (_req, res) => res.json(types.listTypes()));

router.post('/entity', async (req, res, next) => {
  try {
    res.status(201).json(await types.addEntityType(req.body));
  } catch (e) { next(e); }
});

router.post('/rel', async (req, res, next) => {
  try {
    res.status(201).json(await types.addRelType(req.body));
  } catch (e) { next(e); }
});

router.delete('/entity/:name', async (req, res, next) => {
  try {
    await types.deleteEntityType(req.params.name);
    res.status(204).end();
  } catch (e) { next(e); }
});

router.delete('/rel/:name', async (req, res, next) => {
  try {
    await types.deleteRelType(req.params.name);
    res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
