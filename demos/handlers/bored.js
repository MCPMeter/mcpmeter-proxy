// Bored — random activity suggestion. bored-api.appbrewery.com (free, no auth).
import { request } from 'undici';

const BASE = 'https://bored-api.appbrewery.com';

export const tools = [
  {
    name: 'random_activity',
    description: 'Suggests something to do. Optionally filtered by activity type or participant count.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['education', 'recreational', 'social', 'diy', 'charity', 'cooking', 'relaxation', 'music', 'busywork'],
          description: 'Activity category',
        },
        participants: { type: 'integer', minimum: 1, maximum: 8, description: 'Number of participants' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random_activity') {
    const params = new URLSearchParams();
    if (args.type)         params.set('type', String(args.type));
    if (args.participants) params.set('participants', String(args.participants));
    const url = `${BASE}/random${params.toString() ? '?' + params : ''}`;
    const r = await request(url);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
