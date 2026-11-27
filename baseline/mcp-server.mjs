import { createInterface } from 'node:readline';
import { oldResult, tools } from './fixture.mjs';

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  const response = { jsonrpc: '2.0', id };
  switch (method) {
    case 'initialize':
      response.result = {
        protocolVersion: params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'baseline-fixture', version: '1.0.0' },
      };
      break;
    case 'ping': response.result = {}; break;
    case 'tools/list': response.result = { tools }; break;
    case 'tools/call':
      if (tools.some(({ name }) => name === params.name)) {
        response.result = { content: [{ type: 'text', text: oldResult }] };
        break;
      }
      // Fall through: the fixture exposes only its two named tools.
    default: response.error = { code: -32601, message: 'Method not found in baseline fixture' };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
