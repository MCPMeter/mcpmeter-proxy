// Wikipedia handler — wraps the public Wikipedia REST API (free, no auth).
import { request } from 'undici';

const UA = 'mcpmeter-demo/0.1 (+https://mcpmeter.com)';

export const tools = [
  {
    name: 'search',
    description: 'Search Wikipedia article titles.',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 5 },
        language: { type: 'string', minLength: 2, maxLength: 8, default: 'en' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'summary',
    description: 'Returns a short summary + extract for a given Wikipedia article title.',
    inputSchema: {
      type: 'object', required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        language: { type: 'string', minLength: 2, maxLength: 8, default: 'en' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  const lang = String(args.language || 'en').replace(/[^a-z-]/gi, '').slice(0, 8) || 'en';

  if (name === 'search') {
    const q = String(args.query || '').slice(0, 200);
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 5));
    const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=${limit}`;
    const r = await request(url, { headers: { 'User-Agent': UA } });
    const data = await r.body.json();
    const pages = (data.pages || []).map((p) => ({
      title: p.title, key: p.key, description: p.description,
      excerpt: p.excerpt?.replace(/<[^>]+>/g, ''),
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ query: q, language: lang, pages }, null, 2) }] };
  }

  if (name === 'summary') {
    const title = String(args.title || '').slice(0, 200);
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const r = await request(url, { headers: { 'User-Agent': UA } });
    const data = await r.body.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          title:       data.title,
          description: data.description,
          extract:     data.extract,
          url:         data.content_urls?.desktop?.page,
          language:    lang,
        }, null, 2),
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}
