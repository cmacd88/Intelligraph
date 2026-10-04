import axios from 'axios';

// HTTP client for IntelliGraph REST API
// Defaults to localhost:4000 (docker-compose service name 'api')
// Can be overridden with API_URL env var

const API_URL = process.env.API_URL || 'http://localhost:4000';

const client = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

export const graphApi = {
  // Query endpoints
  async search(q, limit = 50) {
    const res = await client.get('/graph/search', { params: { q, limit } });
    return res.data;
  },

  async neighbors(uid, depth = 1) {
    const res = await client.get(`/graph/neighbors/${uid}`, { params: { depth } });
    return res.data;
  },

  async path(from, to, via = null) {
    const params = { from, to };
    if (via) params.via = via;
    const res = await client.get('/graph/path', { params });
    return res.data;
  },

  async stats() {
    const res = await client.get('/graph/stats');
    return res.data;
  },

  async orphans() {
    const res = await client.get('/graph/orphans');
    return res.data;
  },

  async all(limit = 500, offset = 0) {
    const res = await client.get('/graph', { params: { limit, offset } });
    return res.data;
  },

  // Entity endpoints
  async getEntity(uid) {
    const res = await client.get(`/entities/${uid}`);
    return res.data;
  },

  async createEntity(type, name, props = {}, notes = '') {
    const res = await client.post('/entities', { type, name, props, notes });
    return res.data;
  },

  async updateEntity(uid, updates) {
    const res = await client.patch(`/entities/${uid}`, updates);
    return res.data;
  },

  async deleteEntity(uid) {
    await client.delete(`/entities/${uid}`);
    return { deleted: true };
  },

  // Relationship endpoints
  async getEdge(id) {
    const res = await client.get(`/edges/${id}`);
    return res.data;
  },

  async createEdge(fromUid, type, toUid, props = {}, sourceUid = null, confidence = 'unconfirmed') {
    const res = await client.post('/edges', { from: fromUid, type, to: toUid, props, source_uid: sourceUid, confidence });
    return res.data;
  },

  async updateEdge(id, updates) {
    const res = await client.patch(`/edges/${id}`, updates);
    return res.data;
  },

  async deleteEdge(id) {
    await client.delete(`/edges/${id}`);
    return { deleted: true };
  },

  // Type endpoints
  async getTypes() {
    const res = await client.get('/types');
    return res.data;
  },

  async getEntityTypes() {
    const res = await client.get('/types');
    return res.data.entities || [];
  },

  async getRelationshipTypes() {
    const res = await client.get('/types');
    return res.data.relationships || [];
  },

  // Source endpoints
  async getSources() {
    const res = await client.get('/sources');
    return res.data;
  },

  async createSource(label, url, kind = 'web', notes = '') {
    const res = await client.post('/sources', { label, url, kind, notes });
    return res.data;
  },

  async deleteSource(uid) {
    await client.delete(`/sources/${uid}`);
    return { deleted: true };
  },

  async getSourceEntities(uid) {
    const res = await client.get(`/sources/${uid}/entities`);
    return res.data;
  },

  async health() {
    const res = await client.get('/health');
    return res.data;
  },

  async readPdf(url) {
    // Fetch PDF from URL
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(response.data);
    
    // Parse PDF (requires pdf-parse library)
    const pdf = await pdfParse(pdfBuffer);
    return { text: pdf.text, pages: pdf.numpages };
  },

};

export default graphApi;
