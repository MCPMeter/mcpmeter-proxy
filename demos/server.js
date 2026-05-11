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

import * as echo         from './handlers/echo.js';
import * as weather      from './handlers/weather.js';
import * as currency     from './handlers/currency.js';
import * as wikipedia    from './handlers/wikipedia.js';
import * as github       from './handlers/github_public.js';
import * as dadjokes     from './handlers/dadjokes.js';
import * as chuckNorris  from './handlers/chuck_norris.js';
import * as catFacts     from './handlers/cat_facts.js';
import * as dogImages    from './handlers/dog_images.js';
import * as bored        from './handlers/bored.js';
import * as dictionary   from './handlers/dictionary.js';
import * as countries    from './handlers/countries.js';
import * as ipInfo       from './handlers/ip_info.js';
import * as timeHandler  from './handlers/time.js';
import * as uuid         from './handlers/uuid.js';
import * as crypto       from './handlers/crypto.js';
import * as hackernews   from './handlers/hackernews.js';
import * as xkcd         from './handlers/xkcd.js';
import * as holidays     from './handlers/public_holidays.js';
import * as trivia       from './handlers/trivia.js';
import * as pokemon      from './handlers/pokemon.js';
import * as starwars     from './handlers/starwars.js';
import * as deck         from './handlers/deck_of_cards.js';
import * as imageGen     from './handlers/image_gen.js';

const handlers = {
  'echo-test':       echo,
  'weather':         weather,
  'currency':        currency,
  'wikipedia':       wikipedia,
  'github-public':   github,
  'dad-jokes':       dadjokes,
  'chuck-norris':    chuckNorris,
  'cat-facts':       catFacts,
  'dog-images':      dogImages,
  'bored':           bored,
  'dictionary':      dictionary,
  'countries':       countries,
  'ip-info':         ipInfo,
  'time':            timeHandler,
  'uuid':            uuid,
  'crypto':          crypto,
  'hackernews':      hackernews,
  'xkcd':            xkcd,
  'public-holidays': holidays,
  'trivia':          trivia,
  'pokemon':         pokemon,
  'starwars':        starwars,
  'deck-of-cards':   deck,
  'image-gen':       imageGen,
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
      // Pass req as a third arg so handlers that need headers (e.g., echo's
      // `headers` debug tool, or future handlers that forward upstream auth)
      // can opt into reading it. Most handlers ignore it.
      const result = await handler.call(name, args, req);
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
