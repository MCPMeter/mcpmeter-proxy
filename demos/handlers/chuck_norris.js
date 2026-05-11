// Chuck Norris jokes — api.chucknorris.io (free, no auth).
import { request } from 'undici';

const BASE = 'https://api.chucknorris.io/jokes';

export const tools = [
  {
    name: 'random_fact',
    description: 'Returns a random Chuck Norris fact. Optionally restricted to a category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category, e.g. "dev", "fashion", "movie"' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_categories',
    description: 'Returns the list of categories supported by the API.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random_fact') {
    const cat = String(args.category || '').trim();
    const url = cat ? `${BASE}/random?category=${encodeURIComponent(cat)}` : `${BASE}/random`;
    const r = await request(url);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: data.value }] };
  }
  if (name === 'list_categories') {
    const r = await request(`${BASE}/categories`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
