// Crypto — coingecko.com (free, no auth, generous rate limit).
import { request } from 'undici';

const BASE = 'https://api.coingecko.com/api/v3';
// CG returns 403 to clients that don't send a User-Agent. Their free tier is
// still no-auth but you must identify yourself.
const HEADERS = { 'User-Agent': 'mcpmeter (https://mcpmeter.com)', 'Accept': 'application/json' };

export const tools = [
  {
    name: 'price',
    description: 'Get the current USD price of one or more cryptocurrencies by coingecko id (e.g., bitcoin, ethereum, solana).',
    inputSchema: {
      type: 'object', required: ['ids'],
      properties: {
        ids: { type: 'string', description: 'Comma-separated coingecko ids, e.g. "bitcoin,ethereum,solana"' },
        vs:  { type: 'string', description: 'Quote currency (default usd)', default: 'usd' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'top',
    description: 'Top N coins by market cap, with current price + 24h change.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        vs:    { type: 'string', default: 'usd' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search',
    description: 'Search coins by name or symbol. Returns up to 25 matches with their coingecko ids.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'price') {
    const ids = String(args.ids || '').toLowerCase();
    const vs  = String(args.vs || 'usd').toLowerCase();
    if (!ids) throw new Error('ids is required');
    const r = await request(`${BASE}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`, { headers: HEADERS });
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  if (name === 'top') {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
    const vs = String(args.vs || 'usd').toLowerCase();
    const r = await request(`${BASE}/coins/markets?vs_currency=${encodeURIComponent(vs)}&order=market_cap_desc&per_page=${limit}&page=1`, { headers: HEADERS });
    const data = await r.body.json();
    const out = (Array.isArray(data) ? data : []).map(c => ({
      id: c.id, symbol: c.symbol, name: c.name,
      price: c.current_price, market_cap: c.market_cap,
      change_24h_pct: c.price_change_percentage_24h,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'search') {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query is required');
    const r = await request(`${BASE}/search?query=${encodeURIComponent(q)}`, { headers: HEADERS });
    const data = await r.body.json();
    const out = (data.coins || []).slice(0, 25).map(c => ({
      id: c.id, symbol: c.symbol, name: c.name, market_cap_rank: c.market_cap_rank,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
