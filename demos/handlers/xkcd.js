// xkcd — fetches the official xkcd JSON API (free, no auth).
import { request } from 'undici';

const BASE = 'https://xkcd.com';

export const tools = [
  {
    name: 'latest',
    description: 'Get the latest xkcd comic (title, image URL, alt text).',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get',
    description: 'Get a specific xkcd comic by number.',
    inputSchema: {
      type: 'object', required: ['num'],
      properties: { num: { type: 'integer', minimum: 1 } },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'latest') {
    const r = await request(`${BASE}/info.0.json`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  if (name === 'get') {
    const n = Number(args.num);
    if (!Number.isFinite(n) || n < 1) throw new Error('num must be a positive integer');
    const r = await request(`${BASE}/${n}/info.0.json`);
    if (r.statusCode === 404) throw new Error(`xkcd #${n} not found`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
