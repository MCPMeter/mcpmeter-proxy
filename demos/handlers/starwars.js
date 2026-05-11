// Star Wars — swapi.tech (the actively-maintained fork; swapi.dev's cert has expired).
import { request } from 'undici';

const BASE = 'https://www.swapi.tech/api';

export const tools = [
  {
    name: 'people',
    description: 'List or search people from the Star Wars universe.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name search, e.g. "Yoda"' },
        page:   { type: 'integer', minimum: 1, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'planets',
    description: 'List or search planets.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        page:   { type: 'integer', minimum: 1, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'films',
    description: 'List all 7 Star Wars films with episode, director, release date, opening crawl.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

async function fetchPaged(path, args) {
  const params = new URLSearchParams();
  if (args?.search) params.set('name', String(args.search));
  if (args?.page)   params.set('page', String(Math.max(1, Number(args.page))));
  const q = params.toString();
  const r = await request(`${BASE}/${path}${q ? '?' + q : ''}`);
  return r.body.text();
}

export async function call(name, args) {
  if (name === 'people')  return { content: [{ type: 'text', text: await fetchPaged('people', args) }] };
  if (name === 'planets') return { content: [{ type: 'text', text: await fetchPaged('planets', args) }] };
  if (name === 'films')   return { content: [{ type: 'text', text: await fetchPaged('films', {}) }] };
  throw new Error(`Unknown tool: ${name}`);
}
