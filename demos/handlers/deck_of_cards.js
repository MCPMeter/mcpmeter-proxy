// Deck of Cards — deckofcardsapi.com (free, no auth, stateful via deck_id).
import { request } from 'undici';

const BASE = 'https://deckofcardsapi.com/api/deck';

export const tools = [
  {
    name: 'new_deck',
    description: 'Shuffle a fresh deck. Returns a deck_id you reuse with draw().',
    inputSchema: {
      type: 'object',
      properties: {
        decks: { type: 'integer', minimum: 1, maximum: 6, default: 1, description: 'How many 52-card decks to combine' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'draw',
    description: 'Draw N cards from a deck created with new_deck. Cards are removed from that deck.',
    inputSchema: {
      type: 'object', required: ['deck_id'],
      properties: {
        deck_id: { type: 'string', description: 'Deck id from new_deck' },
        count:   { type: 'integer', minimum: 1, maximum: 52, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'new_deck') {
    const decks = Math.min(6, Math.max(1, Number(args.decks) || 1));
    const r = await request(`${BASE}/new/shuffle/?deck_count=${decks}`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  if (name === 'draw') {
    const id = String(args.deck_id || '').trim();
    const count = Math.min(52, Math.max(1, Number(args.count) || 1));
    if (!id) throw new Error('deck_id is required (call new_deck first)');
    const r = await request(`${BASE}/${encodeURIComponent(id)}/draw/?count=${count}`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
