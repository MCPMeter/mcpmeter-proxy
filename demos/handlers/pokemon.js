// Pokemon — pokeapi.co (free, no auth).
import { request } from 'undici';

const BASE = 'https://pokeapi.co/api/v2';

export const tools = [
  {
    name: 'get',
    description: 'Look up a Pokémon by name or id. Returns types, stats, abilities, sprite URL.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: { query: { type: 'string', description: 'Name (e.g., "pikachu") or id (e.g., "25")' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_types',
    description: 'List the 18 Pokémon damage types (fire, water, electric, etc.).',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'by_type',
    description: 'List Pokémon of a given type.',
    inputSchema: {
      type: 'object', required: ['type'],
      properties: { type: { type: 'string', description: 'e.g., "fire", "water"' } },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'get') {
    const q = String(args.query || '').trim().toLowerCase();
    if (!q) throw new Error('query is required');
    const r = await request(`${BASE}/pokemon/${encodeURIComponent(q)}`);
    if (r.statusCode === 404) throw new Error(`Pokémon "${q}" not found`);
    const p = await r.body.json();
    const out = {
      id: p.id, name: p.name, height_dm: p.height, weight_hg: p.weight,
      types: p.types.map(t => t.type.name),
      abilities: p.abilities.map(a => a.ability.name),
      stats: Object.fromEntries(p.stats.map(s => [s.stat.name, s.base_stat])),
      sprite: p.sprites?.front_default,
    };
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'list_types') {
    const r = await request(`${BASE}/type`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data.results.map(t => t.name), null, 2) }] };
  }
  if (name === 'by_type') {
    const t = String(args.type || '').trim().toLowerCase();
    if (!t) throw new Error('type is required');
    const r = await request(`${BASE}/type/${encodeURIComponent(t)}`);
    if (r.statusCode === 404) throw new Error(`Type "${t}" not found`);
    const data = await r.body.json();
    const out = data.pokemon.map(p => p.pokemon.name);
    return { content: [{ type: 'text', text: JSON.stringify({ type: t, count: out.length, pokemon: out }, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
