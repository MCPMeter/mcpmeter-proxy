// Time — local computation, no upstream call. Uses Intl.DateTimeFormat for timezones.
export const tools = [
  {
    name: 'now',
    description: 'Returns the current UTC and local time. Optionally in a specific IANA timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        tz: { type: 'string', description: 'IANA timezone, e.g. "Europe/Tbilisi"' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'convert',
    description: 'Convert a UTC ISO timestamp into a target IANA timezone, returning the wall-clock time.',
    inputSchema: {
      type: 'object', required: ['utc', 'tz'],
      properties: {
        utc: { type: 'string', description: 'ISO-8601 UTC timestamp, e.g. "2026-05-10T12:00:00Z"' },
        tz:  { type: 'string', description: 'IANA timezone, e.g. "Asia/Tokyo"' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'now') {
    const tz = String(args.tz || 'UTC');
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const local = fmt.format(now);
    return { content: [{ type: 'text', text: JSON.stringify({
      utc: now.toISOString(),
      timezone: tz,
      local,
      epoch_ms: now.getTime(),
    }, null, 2) }] };
  }
  if (name === 'convert') {
    const utc = String(args.utc || '');
    const tz  = String(args.tz || '');
    if (!utc || !tz) throw new Error('utc and tz are required');
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid utc timestamp');
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    return { content: [{ type: 'text', text: JSON.stringify({
      utc, timezone: tz, local: fmt.format(d),
    }, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
