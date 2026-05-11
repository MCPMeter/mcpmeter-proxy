// Cat facts — catfact.ninja (free, no auth).
import { request } from 'undici';

const BASE = 'https://catfact.ninja';

export const tools = [
  {
    name: 'random_fact',
    description: 'Returns one random cat fact.',
    inputSchema: {
      type: 'object',
      properties: {
        max_length: { type: 'integer', minimum: 1, maximum: 500, description: 'Cap fact length in chars' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_breeds',
    description: 'Returns a paginated list of cat breeds with country/origin/coat info.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        page:  { type: 'integer', minimum: 1, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random_fact') {
    const len = Number(args.max_length);
    const url = `${BASE}/fact${Number.isFinite(len) ? '?max_length=' + len : ''}`;
    const r = await request(url);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: data.fact }] };
  }
  if (name === 'list_breeds') {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
    const page  = Math.max(1, Number(args.page) || 1);
    const r = await request(`${BASE}/breeds?limit=${limit}&page=${page}`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
