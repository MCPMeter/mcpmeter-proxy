// UUID — local generation, no upstream call.
import { randomUUID, randomBytes } from 'node:crypto';

export const tools = [
  {
    name: 'v4',
    description: 'Generate one or more cryptographically-random UUIDv4 values.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'random_hex',
    description: 'Generate cryptographically-random hex bytes (e.g. for tokens). Default 16 bytes / 32 hex chars.',
    inputSchema: {
      type: 'object',
      properties: {
        bytes: { type: 'integer', minimum: 1, maximum: 64, default: 16 },
        count: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
      },
    },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'v4') {
    const count = Math.min(100, Math.max(1, Number(args.count) || 1));
    const ids = Array.from({ length: count }, () => randomUUID());
    return { content: [{ type: 'text', text: count === 1 ? ids[0] : JSON.stringify(ids, null, 2) }] };
  }
  if (name === 'random_hex') {
    const bytes = Math.min(64, Math.max(1, Number(args.bytes) || 16));
    const count = Math.min(100, Math.max(1, Number(args.count) || 1));
    const out = Array.from({ length: count }, () => randomBytes(bytes).toString('hex'));
    return { content: [{ type: 'text', text: count === 1 ? out[0] : JSON.stringify(out, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
