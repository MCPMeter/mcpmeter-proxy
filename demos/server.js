// mcpmeter platform-hosted demo MCPs — single Node process, dispatches by slug.
// One PM2 entry hosts all demo listings; we don't spawn a service per MCP.
//
// Routes:
//   POST /:slug/mcp  → JSON-RPC dispatch into handlers[slug]
//   GET  /health
//
// Each handler exposes { tools: [...], call(name, args) -> { content } }.

import 'dotenv/config';
import Fastify from 'fastify';

import * as echo       from './handlers/echo.js';
import * as weather    from './handlers/weather.js';
import * as currency   from './handlers/currency.js';
import * as wikipedia  from './handlers/wikipedia.js';
import * as github     from './handlers/github_public.js';

const handlers = {
  'echo-test':     echo,
  'weather':       weather,
  'currency':      currency,
  'wikipedia':     wikipedia,
  'github-public': github,
};

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

fastify.get('/health', async () => ({
  ok: true,
  service: 'mcpmeter-demos',
  hosted: Object.keys(handlers),
}));

fastify.post('/:slug/mcp', async (req, reply) => {
  const { slug } = req.params;
  const handler = handlers[slug];

  const body   = req.body || {};
  const id     = body.id ?? null;
  const method = body.method;

  if (!handler) return jsonRpcError(id, -32601, `Unknown MCP slug: ${slug}`);

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: `mcpmeter-demo:${slug}`, version: '0.1.0' },
    });
  }

  if (method === 'notifications/initialized') {
    reply.code(202).send();
    return;
  }

  if (method === 'tools/list') {
    return ok(id, { tools: handler.tools });
  }

  if (method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    try {
      const result = await handler.call(name, args);
      return ok(id, result);
    } catch (err) {
      fastify.log.warn({ err: err.message, slug, name }, 'tool_failed');
      return jsonRpcError(id, -32000, err.message);
    }
  }

  return jsonRpcError(id, -32601, `Unknown method: ${method}`);
});

function ok(id, result)         { return { jsonrpc: '2.0', id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

const PORT = Number(process.env.DEMOS_PORT) || 3022;
fastify.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  fastify.log.info(`mcpmeter-demos listening on 127.0.0.1:${PORT} · hosting ${Object.keys(handlers).length} MCPs`);
});
