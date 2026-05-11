// Hacker News — Algolia HN search API + Firebase HN API (both free, no auth).
import { request } from 'undici';

const ALGOLIA = 'https://hn.algolia.com/api/v1';
const FIREBASE = 'https://hacker-news.firebaseio.com/v0';

export const tools = [
  {
    name: 'search',
    description: 'Full-text search HN stories by query. Returns title, URL, points, comments, author, date.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'top_stories',
    description: 'Current top stories on the HN front page.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'item',
    description: 'Look up a single HN item (story or comment) by id.',
    inputSchema: {
      type: 'object', required: ['id'],
      properties: { id: { type: 'integer', minimum: 1 } },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'search') {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query is required');
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const r = await request(`${ALGOLIA}/search?query=${encodeURIComponent(q)}&hitsPerPage=${limit}&tags=story`);
    const data = await r.body.json();
    const out = (data.hits || []).map(h => ({
      id: h.objectID, title: h.title, url: h.url,
      points: h.points, comments: h.num_comments,
      author: h.author, created: h.created_at,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ count: out.length, results: out }, null, 2) }] };
  }
  if (name === 'top_stories') {
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const idsRes = await request(`${FIREBASE}/topstories.json`);
    const ids = (await idsRes.body.json()).slice(0, limit);
    const items = await Promise.all(ids.map(async id => {
      const r = await request(`${FIREBASE}/item/${id}.json`);
      return r.body.json();
    }));
    const out = items.filter(Boolean).map(s => ({
      id: s.id, title: s.title, url: s.url,
      points: s.score, comments: s.descendants,
      author: s.by, created_unix: s.time,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'item') {
    const id = Number(args.id);
    if (!Number.isFinite(id) || id < 1) throw new Error('id is required');
    const r = await request(`${FIREBASE}/item/${id}.json`);
    const data = await r.body.json();
    if (!data) throw new Error(`Item ${id} not found`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
