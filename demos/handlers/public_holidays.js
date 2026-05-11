// Public Holidays — date.nager.at (free, no auth).
import { request } from 'undici';

const BASE = 'https://date.nager.at/api/v3';

export const tools = [
  {
    name: 'by_country',
    description: 'List all public holidays for a country in a given year. Country is ISO-3166-1 alpha-2 (e.g., "US", "GE", "JP", "DE").',
    inputSchema: {
      type: 'object', required: ['country', 'year'],
      properties: {
        country: { type: 'string', minLength: 2, maxLength: 2 },
        year:    { type: 'integer', minimum: 1975, maximum: 2099 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'next_in_country',
    description: 'Next upcoming public holiday in the given country, anywhere in the next year.',
    inputSchema: {
      type: 'object', required: ['country'],
      properties: { country: { type: 'string', minLength: 2, maxLength: 2 } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_countries',
    description: 'List the ~110 countries supported by the API.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'by_country') {
    const country = String(args.country || '').toUpperCase().slice(0, 2);
    const year    = Number(args.year);
    if (!/^[A-Z]{2}$/.test(country) || !Number.isFinite(year)) throw new Error('country (ISO-2) and year required');
    const r = await request(`${BASE}/PublicHolidays/${year}/${country}`);
    if (r.statusCode === 404) throw new Error(`No holidays found for ${country} ${year}`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  if (name === 'next_in_country') {
    const country = String(args.country || '').toUpperCase().slice(0, 2);
    if (!/^[A-Z]{2}$/.test(country)) throw new Error('country (ISO-2) required');
    const r = await request(`${BASE}/NextPublicHolidays/${country}`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  if (name === 'list_countries') {
    const r = await request(`${BASE}/AvailableCountries`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
