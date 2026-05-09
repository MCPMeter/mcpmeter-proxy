// Currency handler — wraps Frankfurter (free, no auth, ECB reference rates).
import { request } from 'undici';

const BASE = 'https://api.frankfurter.dev/v1';

export const tools = [
  {
    name: 'convert',
    description: 'Convert an amount from one currency to another at the latest reference rate.',
    inputSchema: {
      type: 'object', required: ['from', 'to', 'amount'],
      properties: {
        from:   { type: 'string', minLength: 3, maxLength: 3, description: 'ISO-4217 currency code' },
        to:     { type: 'string', minLength: 3, maxLength: 3, description: 'ISO-4217 currency code' },
        amount: { type: 'number', minimum: 0 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_currencies',
    description: 'Returns the list of supported currencies (~40, ECB-tracked).',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'convert') {
    const from = String(args.from || '').toUpperCase().slice(0, 3);
    const to   = String(args.to   || '').toUpperCase().slice(0, 3);
    const amt  = Number(args.amount);
    if (!from || !to || !Number.isFinite(amt)) throw new Error('from, to, amount required');

    const url = `${BASE}/latest?base=${from}&symbols=${to}&amount=${amt}`;
    const r = await request(url);
    const data = await r.body.json();
    const converted = data.rates?.[to];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          from, to, amount: amt,
          converted, rate_date: data.date,
        }, null, 2),
      }],
    };
  }

  if (name === 'list_currencies') {
    const r = await request(`${BASE}/currencies`);
    const data = await r.body.json();
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}
