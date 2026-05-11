// Image generation — Pollinations.ai (free, no auth, sub-10s typical).
// Returns a deterministic URL the client can fetch the image from.
// Demonstrates the "premium MCP" pricing tier ($0.10/call).

const BASE = 'https://image.pollinations.ai/prompt';

export const tools = [
  {
    name: 'generate',
    description: 'Generate an image from a text prompt. Returns a URL the client can fetch directly. Sub-10s typical, but allow up to 60s for the first render of a complex prompt.',
    inputSchema: {
      type: 'object', required: ['prompt'],
      properties: {
        prompt:     { type: 'string',  minLength: 5, maxLength: 500, description: 'What to draw. Be specific.' },
        width:      { type: 'integer', enum: [512, 768, 1024, 1536, 2048], default: 1024 },
        height:     { type: 'integer', enum: [512, 768, 1024, 1536, 2048], default: 1024 },
        model:      { type: 'string',  enum: ['flux', 'turbo'], default: 'flux', description: 'flux = quality, turbo = speed' },
        seed:       { type: 'integer', description: 'Optional seed for reproducible output' },
        nologo:     { type: 'boolean', default: true, description: 'Hide the Pollinations watermark' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_models',
    description: 'List the image generation models available — currently flux (quality) and turbo (speed).',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'generate') {
    const prompt = String(args.prompt || '').trim();
    if (prompt.length < 5) throw new Error('prompt must be at least 5 characters');

    const params = new URLSearchParams();
    params.set('width',  String(args.width  || 1024));
    params.set('height', String(args.height || 1024));
    if (args.model) params.set('model', String(args.model));
    if (args.seed !== undefined) params.set('seed', String(args.seed));
    if (args.nologo !== false) params.set('nologo', 'true');

    const url = `${BASE}/${encodeURIComponent(prompt)}?${params}`;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          image_url: url,
          prompt,
          width:  args.width  || 1024,
          height: args.height || 1024,
          model:  args.model  || 'flux',
          seed:   args.seed   ?? null,
          note:   'Fetch the image_url directly. Pollinations renders on first request; subsequent fetches hit their CDN.',
        }, null, 2),
      }],
    };
  }

  if (name === 'list_models') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify([
          { id: 'flux',  description: 'High-quality default — slower, more accurate' },
          { id: 'turbo', description: 'Fast generation — lower quality, useful for previews' },
        ], null, 2),
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}
