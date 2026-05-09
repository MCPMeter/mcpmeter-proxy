// GitHub public API handler — read-only, no auth (60 req/hr per IP).
import { request } from 'undici';

const UA = 'mcpmeter-demo/0.1 (+https://mcpmeter.com)';
const BASE = 'https://api.github.com';

export const tools = [
  {
    name: 'get_repo',
    description: 'Returns the public GitHub repository\'s metadata (stars, forks, license, language, description).',
    inputSchema: {
      type: 'object', required: ['owner', 'repo'],
      properties: {
        owner: { type: 'string', minLength: 1, maxLength: 80 },
        repo:  { type: 'string', minLength: 1, maxLength: 100 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_open_issues',
    description: 'Returns the most recent open issues for a repo.',
    inputSchema: {
      type: 'object', required: ['owner', 'repo'],
      properties: {
        owner: { type: 'string', minLength: 1, maxLength: 80 },
        repo:  { type: 'string', minLength: 1, maxLength: 100 },
        per_page: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  const headers = { 'User-Agent': UA, 'Accept': 'application/vnd.github+json' };

  if (name === 'get_repo') {
    const url = `${BASE}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;
    const r = await request(url, { headers });
    const d = await r.body.json();
    if (r.statusCode !== 200) {
      throw new Error(d.message || `GitHub returned ${r.statusCode}`);
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          full_name:       d.full_name,
          description:     d.description,
          stargazers:      d.stargazers_count,
          forks:           d.forks_count,
          open_issues:     d.open_issues_count,
          language:        d.language,
          license:         d.license?.spdx_id,
          default_branch:  d.default_branch,
          html_url:        d.html_url,
          archived:        d.archived,
          pushed_at:       d.pushed_at,
        }, null, 2),
      }],
    };
  }

  if (name === 'list_open_issues') {
    const per = Math.max(1, Math.min(30, Number(args.per_page) || 10));
    const url = `${BASE}/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/issues?state=open&per_page=${per}`;
    const r = await request(url, { headers });
    const d = await r.body.json();
    if (!Array.isArray(d)) throw new Error(d.message || `GitHub returned ${r.statusCode}`);
    const issues = d.filter(i => !i.pull_request).map((i) => ({
      number: i.number, title: i.title, comments: i.comments,
      labels: i.labels.map(l => l.name), html_url: i.html_url,
      created_at: i.created_at,
    }));
    return { content: [{ type: 'text', text: JSON.stringify({ issues }, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}
