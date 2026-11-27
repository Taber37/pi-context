import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { namespace, oldResult, tools } from './fixture.mjs';

const [packageDir, pin] = process.argv.slice(2);
const manifestPath = join(packageDir, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (`${manifest.name}@${manifest.version}` !== pin) throw new Error(`Expected ${pin}`);
const {
  createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension,
  DefaultResourceLoader, SessionManager, SettingsManager,
} = await import(pathToFileURL(join(packageDir, 'dist/index.js')));
const aiManifest = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(manifestPath));
const { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } =
  await import(pathToFileURL(join(dirname(aiManifest), 'dist/index.js')));

const provider = 'fixture-mock';
const api = 'fixture-stream';
const baseUrl = 'http://127.0.0.1.invalid';
const model = {
  id: 'fixture-chat', name: 'Fixture Chat', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024,
};
const timestamp = 1_700_000_000_000;
const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { ...model.cost, total: 0 },
};
const text = (value) => [{ type: 'text', text: value }];
const assistant = (content, stopReason) => ({
  role: 'assistant', content, stopReason, timestamp, usage, api, provider, model: model.id,
});
const toolCall = (id, name, args) => [{ type: 'toolCall', id, name, arguments: args }];
const resultId = 'fixture-retained-call';
const retainedMessages = [
  { role: 'user', content: text('Read a synthetic label.'), timestamp },
  assistant(toolCall(resultId, `${namespace}small`, { label: 'example' }), 'toolUse'),
  { role: 'toolResult', toolCallId: resultId, toolName: `${namespace}small`, content: text(oldResult), isError: false, timestamp },
  assistant(text('The synthetic label was read.'), 'stop'),
];
const appendPrompt = 'Record the synthetic baseline request.';
const discoveryPrompt = 'Discover the large catalog tool.';
const cwd = process.cwd();

async function observe(label, config, entries, discover = false) {
  const agentDir = join(cwd, 'agent', label);
  await mkdir(agentDir, { recursive: true });
  const server = {
    command: process.execPath, args: [fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))],
    description: 'Synthetic catalog and labels — café.', timeout: 3, ...config,
  };
  const sessionManager = SessionManager.inMemory(cwd, undefined, structuredClone(entries));
  if (!entries) for (const message of retainedMessages) sessionManager.appendMessage(structuredClone(message));
  const requests = [];
  let extension;
  const mock = (pi) => {
    extension = pi;
    pi.registerMcpServer('fixture', server);
    pi.registerProvider(provider, {
      api, baseUrl, apiKey: 'fixture-only', models: [model],
      streamSimple(_model, context, options) {
        const stream = createAssistantMessageEventStream();
        const payload = structuredClone(context);
        const response = discover && requests.length === 0
          ? assistant(toolCall('fixture-search-call', 'tool_search', { query: `${namespace}large`, limit: 1 }), 'toolUse')
          : assistant(text('Fixture reply.'), 'stop');
        void (async () => {
          try {
            requests.push(await options?.onPayload?.(payload, _model) ?? payload);
            stream.push({ type: 'start', partial: { ...response, content: [] } });
            stream.push({ type: 'done', reason: response.stopReason, message: response });
          } catch (error) {
            stream.push({ type: 'error', reason: 'error', error: { ...response, stopReason: 'error', errorMessage: String(error) } });
          }
        })();
        return stream;
      },
    });
  };
  const settingsManager = SettingsManager.inMemory({
    defaultTools: ['-read', '-bash', '-edit', '-write'], compaction: { enabled: false }, retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noPromptTemplates: true,
    extensionFactories: [createMcpExtension(), createToolSearchExtension(), createCodemodeExtension({ mode: 'on' }), mock],
  });
  await resourceLoader.reload();
  // The SDK selects an initial model before extension bindings register the mock provider.
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader, settingsManager, sessionManager,
    model: { ...model, provider, api, baseUrl },
  });
  try {
    await session.bindExtensions({});
    if (config.enabled) {
      // Indirect servers connect in the background. Measure the connected state, not a startup race.
      const deadline = Date.now() + 5_000;
      while (extension.getAllTools().filter(({ name }) => name.startsWith(namespace)).length !== tools.length) {
        if (Date.now() >= deadline) throw new Error(`Fixture did not register both tools in ${label}`);
        await sleep(20);
      }
    }
    assert.equal(session.model?.provider, provider, 'Refusing to call a non-fixture provider');
    assert.equal(session.model.api, api);
    assert.equal(session.model.id, model.id);
    await session.prompt(discover ? discoveryPrompt : appendPrompt);
    const last = session.messages.at(-1);
    if (last?.stopReason !== 'stop' || last.content?.[0]?.text !== 'Fixture reply.') {
      throw new Error(`${label} did not complete the fixture turn: ${last?.errorMessage ?? last?.stopReason}`);
    }
    assert.equal(requests.length, discover ? 2 : 1, `Unexpected request count for ${label}`);
    return { requests, entries: sessionManager.getEntries() };
  } finally {
    try {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } finally {
      session.dispose();
    }
  }
}

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sections = (prompt) => [...prompt.matchAll(/<mcp_servers>\s*([\s\S]*?)\s*<\/mcp_servers>/gu)].map(([, body]) => body);
function summarize({ messages }) {
  const declarations = getCurrentTools(messages) ?? [];
  const announcements = sections(getCurrentSystemPrompt(messages));
  const systemDeltas = messages.filter(({ role }) => role === 'system').flatMap((message) => {
    const fixtureTools = (items) => items?.map(({ name }) => name).filter((name) => name.startsWith(namespace)) ?? [];
    const added = fixtureTools(message.toolsAdded);
    const removed = fixtureTools(message.toolsRemoved);
    const announcement = message.sections?.mcp_servers;
    if (!added.length && !removed.length && announcement === undefined) return [];
    return [{ added, removed, announcement }];
  });
  const conversation = messages.filter(({ role }) => role !== 'system');
  assert.deepEqual(conversation.at(-1)?.content, text(appendPrompt));
  const history = conversation.slice(0, -1);
  const retainedResult = history.find(({ role, toolCallId }) => role === 'toolResult' && toolCallId === resultId);
  assert.deepEqual(retainedResult?.content, text(oldResult), 'Original tool result was not retained');
  // Exclude local timestamps/usage from the published fingerprint, not from paired equality checks.
  const stableHistory = history.map(({ role, content, toolCallId, toolName, isError }) =>
    ({ role, content, toolCallId, toolName, isError }));
  return {
    history,
    metrics: {
      mcpTools: declarations.map(({ name }) => name).filter((name) => name.startsWith(namespace)).sort(),
      sharedTools: declarations.map(({ name }) => name).filter((name) => ['codemode', 'tool_search'].includes(name)).sort(),
      declarationBytes: bytes(declarations),
      announcementBytes: announcements.reduce((sum, body) => sum + Buffer.byteLength(body), 0),
      announcements,
      systemDeltas,
      retained: {
        messages: history.length, sha256: hash(stableHistory), resultBytes: Buffer.byteLength(oldResult),
        searchResults: history.filter(({ role, toolName }) => role === 'toolResult' && toolName === 'tool_search').length,
      },
    },
  };
}

const pairs = [];
for (const [mode, exposure, toolExposure] of [
  ['direct', 'direct'], ['deferred-before', 'deferred'], ['deferred-after', 'deferred'],
  ['codemode', 'codemode'], ['override', 'deferred', { small: 'direct' }],
]) {
  const config = { exposure, toolExposure, enabled: true };
  let entries;
  if (mode === 'deferred-after') {
    const discovery = await observe('discovery', config, undefined, true);
    const [before, after] = discovery.requests.map(({ messages }) => getCurrentTools(messages) ?? []);
    assert.ok(!before.some(({ name }) => name.startsWith(namespace)), 'Discovery already had an MCP declaration');
    assert.deepEqual(after.map(({ name }) => name).filter((name) => name.startsWith(namespace)), [`${namespace}large`]);
    entries = discovery.entries;
  }
  const on = summarize((await observe(`${mode}-on`, config, entries)).requests[0]);
  const off = summarize((await observe(`${mode}-off`, { ...config, enabled: false }, entries)).requests[0]);
  assert.deepEqual(on.history, off.history, `Retained provider history differs for ${mode}`);
  pairs.push({ mode, on: on.metrics, off: off.metrics, retainedIdentical: true });
}
console.log(JSON.stringify({
  evidence: 'observed', pi: pin, observation: 'mock provider normalized transcript', providerTokens: null,
  comparator: { package: 'pi-context-tax', command: '/ctx', pin: null, evidence: 'unknown', reason: 'No local pinned comparator supplied.' },
  schemaBytes: Object.fromEntries(tools.map(({ name, inputSchema }) => [name, bytes(inputSchema)])), pairs,
}, null, 2));
