// Tiny echo handler — used to prove the meter end-to-end.
export const tools = [
  {
    name: 'echo',
    description: 'Returns whatever you pass in. Useful for testing the meter.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time',
    description: 'Returns the current ISO-8601 timestamp on the server.',
    inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
  },
];

export async function call(name, args) {
  if (name === 'echo') {
    return { content: [{ type: 'text', text: 'echo: ' + JSON.stringify(args ?? {}) }] };
  }
  if (name === 'time') {
    return { content: [{ type: 'text', text: new Date().toISOString() }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}
