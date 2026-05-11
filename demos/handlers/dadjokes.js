// Dad Jokes — wraps icanhazdadjoke.com (free, no auth).
import { request } from 'undici';

const BASE = 'https://icanhazdadjoke.com';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'mcpmeter (https://mcpmeter.com)' };

export const tools = [
  {
    name: 'random_joke',
    description: 'Returns a random dad joke. Plain text. Family-friendly.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_jokes',
    description: 'Search dad jokes by term. Returns up to 30 matching jokes per page.',
    inputSchema: {
      type: 'object', required: ['term'],
      properties: {
        term: { type: 'string', minLength: 1, description: 'Search term, e.g. "dog"' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random_joke') {
    const r = await request(BASE + '/', { headers: HEADERS });
    const data = await r.body.json();
    return { content: [{ type: 'text', text: data.joke }] };
  }
  if (name === 'search_jokes') {
    const term = String(args.term || '').trim();
    if (!term) throw new Error('term is required');
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const url = `${BASE}/search?term=${encodeURIComponent(term)}&limit=${limit}`;
    const r = await request(url, { headers: HEADERS });
    const data = await r.body.json();
    const jokes = (data.results || []).map(j => j.joke);
    return { content: [{ type: 'text', text: JSON.stringify({ count: data.total_jokes, jokes }, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
