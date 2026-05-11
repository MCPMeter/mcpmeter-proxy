// Trivia — opentdb.com (free, no auth).
import { request } from 'undici';

const BASE = 'https://opentdb.com';

export const tools = [
  {
    name: 'random',
    description: 'Get random trivia questions. Optionally filter by category and difficulty.',
    inputSchema: {
      type: 'object',
      properties: {
        amount:     { type: 'integer', minimum: 1, maximum: 50, default: 5 },
        category:   { type: 'integer', description: 'Category id (use list_categories first)' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        type:       { type: 'string', enum: ['multiple', 'boolean'] },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_categories',
    description: 'List the 24 trivia categories available (with their numeric ids).',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'random') {
    const params = new URLSearchParams();
    params.set('amount', String(Math.min(50, Math.max(1, Number(args.amount) || 5))));
    if (args.category)   params.set('category', String(Number(args.category)));
    if (args.difficulty) params.set('difficulty', String(args.difficulty));
    if (args.type)       params.set('type', String(args.type));
    const r = await request(`${BASE}/api.php?${params}`);
    const data = await r.body.json();
    if (data.response_code !== 0) throw new Error('opentdb error: code ' + data.response_code);
    // Decode HTML entities for cleaner output (opentdb encodes question text).
    const decode = s => String(s).replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const out = data.results.map(q => ({
      category: q.category, difficulty: q.difficulty, type: q.type,
      question: decode(q.question),
      correct_answer: decode(q.correct_answer),
      incorrect_answers: q.incorrect_answers.map(decode),
    }));
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  if (name === 'list_categories') {
    const r = await request(`${BASE}/api_category.php`);
    return { content: [{ type: 'text', text: await r.body.text() }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
