export const namespace = 'mcp__fixture__';
export const oldResult = 'Synthetic retained result: café 🧪. '.repeat(8).trimEnd();
export const tools = [
  {
    name: 'small', description: 'Read a synthetic label.',
    inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
  },
  {
    name: 'large', description: 'Read a synthetic constellation catalog.',
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`field_${i}`, {
        type: 'string', description: `Synthetic catalog field ${i}; pick a display style.`,
        enum: ['compact', 'verbose', 'diagnostic'],
      }])),
      additionalProperties: false,
    },
  },
];
