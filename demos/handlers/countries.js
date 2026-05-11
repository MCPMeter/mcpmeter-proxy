// Countries — restcountries.com (free, no auth).
import { request } from 'undici';

const BASE = 'https://restcountries.com/v3.1';
const FIELDS = 'name,cca2,cca3,capital,region,subregion,population,area,languages,currencies,timezones,flag,latlng';

export const tools = [
  {
    name: 'get_country',
    description: 'Look up a country by name, ISO 2-letter code, or ISO 3-letter code. Returns capital, population, area, languages, currencies, timezones.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2, description: 'Name (e.g. "Georgia") or ISO code (e.g. "GE", "GEO")' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_by_region',
    description: 'List all countries in a region. Useful for grouping queries.',
    inputSchema: {
      type: 'object', required: ['region'],
      properties: {
        region: { type: 'string', enum: ['africa', 'americas', 'asia', 'europe', 'oceania'] },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'get_country') {
    const q = String(args.query || '').trim();
    if (!q) throw new Error('query is required');
    // Try alpha (ISO code) first if 2-3 chars; fall back to name.
    let url;
    if (/^[a-z]{2,3}$/i.test(q)) {
      url = `${BASE}/alpha/${encodeURIComponent(q)}?fields=${FIELDS}`;
    } else {
      url = `${BASE}/name/${encodeURIComponent(q)}?fields=${FIELDS}`;
    }
    const r = await request(url);
    if (r.statusCode === 404) throw new Error(`Country not found: ${q}`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  if (name === 'list_by_region') {
    const region = String(args.region || '').trim().toLowerCase();
    if (!region) throw new Error('region is required');
    const r = await request(`${BASE}/region/${encodeURIComponent(region)}?fields=name,cca2,capital,population`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
