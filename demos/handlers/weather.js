// Weather handler — wraps Open-Meteo (free, no auth).
import { request } from 'undici';

export const tools = [
  {
    name: 'geocode',
    description: 'Looks up a place name and returns matching latitude/longitude pairs.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 100 },
        count: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'current_weather',
    description: 'Returns current weather conditions for a given latitude/longitude.',
    inputSchema: {
      type: 'object', required: ['latitude', 'longitude'],
      properties: {
        latitude:  { type: 'number', minimum: -90,  maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'geocode') {
    const q = String(args.query || '').slice(0, 100);
    const count = Math.max(1, Math.min(10, Number(args.count) || 5));
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
    const r = await request(url);
    const data = await r.body.json();
    const results = (data.results || []).map((x) => ({
      name: x.name, country: x.country, admin1: x.admin1,
      latitude: x.latitude, longitude: x.longitude,
      population: x.population, timezone: x.timezone,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ query: q, results }, null, 2) }] };
  }

  if (name === 'current_weather') {
    const { latitude, longitude } = args;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new Error('latitude and longitude must be numbers');
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,weather_code,relative_humidity_2m`;
    const r = await request(url);
    const data = await r.body.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          location: { latitude, longitude, timezone: data.timezone },
          current:  data.current,
          units:    data.current_units,
        }, null, 2),
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}
