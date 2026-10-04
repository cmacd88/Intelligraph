#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import graphApi from './client.js';

const server = new Server({
  name: 'intelligraph-mcp',
  version: '0.1.0',
},
{
  capatilities: {
    tools: {},
    resources: {}
  },
});

// ============================================================================
// RESOURCES — read-only data exposed by the server
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'intelligraph://graph/types',
        name: 'Entity & Relationship Types',
        description: 'Registry of all entity and relationship types',
        mimeType: 'application/json',
      },
      {
        uri: 'intelligraph://graph/stats',
        name: 'Graph Statistics',
        description: 'Global graph stats: node/edge counts, top hubs, type breakdown',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'intelligraph://graph/types') {
    try {
      const types = await graphApi.getTypes();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(types, null, 2) }],
      };
    } catch (err) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: `Error fetching types: ${err.message}` }],
        isError: true,
      };
    }
  }

  if (uri === 'intelligraph://graph/stats') {
    try {
      const stats = await graphApi.stats();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
      };
    } catch (err) {
      return {
        contents: [{ uri, mimeType: 'text/plain', text: `Error fetching stats: ${err.message}` }],
        isError: true,
      };
    }
  }

  return {
    contents: [{ uri, mimeType: 'text/plain', text: 'Resource not found' }],
    isError: true,
  };
});

// ============================================================================
// TOOLS — callable procedures
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'relationship.create',
        description: 'Create a relationship between two entities',
        inputSchema: {
          type: 'object',
          properties: {
            fromUid: { type: 'string', description: 'Source entity UID' },
            type: { type: 'string', description: 'Relationship type' },
            toUid: { type: 'string', description: 'Target entity UID' },
            props: { type: 'object', description: 'Custom properties (optional)' },
            sourceUid: { type: 'string', description: 'Source UID if attributed (optional)' },
            confidence: { type: 'string', description: 'confirmed | probable | unconfirmed', default: 'unconfirmed' },
          },
          required: ['fromUid', 'type', 'toUid'],
        },
      },
      {
        name: 'source.create',
        description: 'Create a new source (provenance record)',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Source label' },
            url: { type: 'string', description: 'Source URL' },
            kind: { type: 'string', description: 'Kind of source (e.g. web, document)', default: 'web' },
            notes: { type: 'string', description: 'Free-text notes (optional)' },
          },
          required: ['label', 'url'],
        },
      },
      {
        name: 'graph.search',
        description: 'Full-text search for entities by name or notes',
        inputSchema: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 50)', default: 50 },
          },
          required: ['q'],
        },
      },
      {
        name: 'graph.neighbors',
        description: 'N-hop expansion from an entity (discover related entities)',
        inputSchema: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'Entity UID' },
            depth: { type: 'number', description: 'Hops (default 1)', default: 1 },
          },
          required: ['uid'],
        },
      },
      {
        name: 'graph.path',
        description: 'Find shortest path between two entities',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Starting entity UID' },
            to: { type: 'string', description: 'Ending entity UID' },
            via: { type: 'array', items: { type: 'string' }, description: 'Optional relationship types to filter by' },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'graph.all',
        description: 'Get a paginated slice of the entire graph (default 500 nodes, max 5000)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Nodes to return (default 500, max 5000)', default: 500 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
          },
        },
      },
      {
        name: 'graph.orphans',
        description: 'Find entities with no relationships',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'entity.create',
        description: 'Create a new entity',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Entity type (must be in registry)' },
            name: { type: 'string', description: 'Entity name' },
            props: { type: 'object', description: 'Custom properties (optional)' },
            notes: { type: 'string', description: 'Free-text notes (optional)' },
          },
          required: ['type', 'name'],
        },
      },
      {
        name: 'entity.get',
        description: 'Get full entity profile by UID',
        inputSchema: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'Entity UID' },
          },
          required: ['uid'],
        },
      },
      {
        name: 'types.listEntity',
        description: 'List all entity types',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'types.listRelationship',
        description: 'List all relationship types',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'source.list',
        description: 'List all sources (provenance records)',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'graph.search': {
        const result = await graphApi.search(args.q, args.limit);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'graph.neighbors': {
        const result = await graphApi.neighbors(args.uid, args.depth);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'relationship.create': {
        const result = await graphApi.createEdge(args.fromUid, args.type, args.toUid, args.props, args.sourceUid, args.confidence);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'source.create': {
        const result = await graphApi.createSource(args.label, args.url, args.kind, args.notes);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'graph.path': {
        const result = await graphApi.path(args.from, args.to, args.via);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'graph.all': {
        const result = await graphApi.all(args.limit, args.offset);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'graph.orphans': {
        const result = await graphApi.orphans();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'entity.create': {
        const result = await graphApi.createEntity(args.type, args.name, args.props, args.notes);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'entity.get': {
        const result = await graphApi.getEntity(args.uid);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'types.listEntity': {
        const result = await graphApi.getEntityTypes();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'types.listRelationship': {
        const result = await graphApi.getRelationshipTypes();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'source.list': {
        const result = await graphApi.getSources();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error calling tool ${name}: ${err.message}` }],
      isError: true,
    };
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IntelliGraph MCP server listening on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
