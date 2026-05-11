// IP info — ip-api.com (free, no auth, 45 req/min).
import { request } from 'undici';

const BASE = 'http://ip-api.com/json';

export const tools = [
  {
    name: 'lookup_ip',
    description: 'Look up geolocation, ASN, and ISP for an IPv4 or IPv6 address. Returns city, region, country, timezone, lat/lon, ISP.',
    inputSchema: {
      type: 'object', required: ['ip'],
      properties: {
        ip: { type: 'string', minLength: 4, description: 'IPv4 or IPv6 address' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'lookup_ip') {
    const ip = String(args.ip || '').trim();
    if (!ip) throw new Error('ip is required');
    const r = await request(`${BASE}/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
    const data = await r.body.json();
    if (data.status !== 'success') throw new Error(data.message || 'Lookup failed');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
