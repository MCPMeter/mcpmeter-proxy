// Dictionary — api.dictionaryapi.dev (free, no auth, English).
import { request } from 'undici';

const BASE = 'https://api.dictionaryapi.dev/api/v2/entries';

export const tools = [
  {
    name: 'define',
    description: 'Look up the definition, phonetics, and example sentences of an English word.',
    inputSchema: {
      type: 'object', required: ['word'],
      properties: {
        word: { type: 'string', minLength: 1, description: 'The word to look up, e.g. "serendipity"' },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'define') {
    const word = String(args.word || '').trim();
    if (!word) throw new Error('word is required');
    const r = await request(`${BASE}/en/${encodeURIComponent(word)}`);
    const data = await r.body.json();
    if (Array.isArray(data) === false || data.length === 0) {
      throw new Error(`No definition found for "${word}"`);
    }
    // Trim payload to the essentials.
    const out = data.map(entry => ({
      word: entry.word,
      phonetic: entry.phonetic,
      meanings: (entry.meanings || []).map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions || []).slice(0, 3).map(d => ({
          definition: d.definition,
          example: d.example,
        })),
        synonyms: (m.synonyms || []).slice(0, 5),
      })),
    }));
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
