// Dog images — dog.ceo (free, no auth).
import { request } from 'undici';

const BASE = 'https://dog.ceo/api';

export const tools = [
  {
    name: 'random_image',
    description: 'Returns the URL of a random dog image. Optionally filtered by breed.',
    inputSchema: {
      type: 'object',
      properties: {
        breed: { type: 'string', description: 'Optional breed filter, e.g. "husky", "shiba"' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_breeds',
    description: 'Returns the full list of supported breeds and their sub-breeds.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random_image') {
    const breed = String(args.breed || '').trim().toLowerCase();
    const url = breed ? `${BASE}/breed/${encodeURIComponent(breed)}/images/random` : `${BASE}/breeds/image/random`;
    const r = await request(url);
    const data = await r.body.json();
    if (data.status !== 'success') throw new Error(data.message || 'Upstream error');
    return { content: [{ type: 'text', text: data.message }] };
  }
  if (name === 'list_breeds') {
    const r = await request(`${BASE}/breeds/list/all`);
    const data = await r.body.json();
    if (data.status !== 'success') throw new Error('Upstream error');
    return { content: [{ type: 'text', text: JSON.stringify(data.message, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
