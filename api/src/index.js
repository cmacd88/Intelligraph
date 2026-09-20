const express = require('express');
const cors = require('cors');
const { driver, read } = require('./db');
const { loadRegistry } = require('./types');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try {
    await read('RETURN 1');
    res.json({ status: 'ok', neo4j: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

app.use('/types', require('./routes/registry'));
app.use('/entities', require('./routes/entities'));
app.use('/edges', require('./routes/edges'));
app.use('/sources', require('./routes/sources'));
app.use('/graph', require('./routes/graph'));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

const port = process.env.PORT || 4000;

// The registry must be in memory before the first request, because every
// write validates against it. Failing to load is fatal — starting with an
// empty registry would reject every create as "unknown type".
(async () => {
  try {
    const { entityTypes, relTypes } = await loadRegistry();
    console.log(
      `registry loaded: ${entityTypes.size} entity types, ` +
      `${relTypes.size} relationship types`,
    );
  } catch (e) {
    console.error('failed to load type registry:', e.message);
    process.exit(1);
  }

  const server = app.listen(port, () => console.log(`API on :${port}`));

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      server.close();
      await driver.close();
      process.exit(0);
    });
  }
})();
