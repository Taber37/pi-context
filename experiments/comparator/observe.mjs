import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { namespace, oldResult, tools } from '../../baseline/fixture.mjs';
import { comparePair } from './evidence.mjs';

const [piDir, comparatorPin] = process.argv.slice(2);
const piPin = '@earendil-works/pi-coding-agent@1.6.1';
const cwd = process.cwd();
const manifest = join(piDir, 'package.json');
const comparatorDir = join(cwd, 'package');
async function checkPin(manifestPath, pin) {
  const { name, version } = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(`${name}@${version}`, pin);
}
assert.equal(process.env.HOME, cwd, 'Run via the disposable-profile launcher');
await checkPin(manifest, piPin);
await checkPin(join(comparatorDir, 'package.json'), comparatorPin);
const {
  createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension,
  DefaultResourceLoader, SessionManager, SettingsManager,
} = await import(pathToFileURL(join(piDir, 'dist/index.js')));
const aiManifest = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(manifest));
const { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools } =
  await import(pathToFileURL(join(dirname(aiManifest), 'dist/index.js')));

const provider = 'fixture-mock';
const api = 'fixture-stream';
const baseUrl = 'http://127.0.0.1.invalid';
const timestamp = 1_700_000_000_000;
const model = {
  id: 'fixture-chat', name: 'Fixture Chat', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024,
};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } };
const text = (value) => [{ type: 'text', text: value }];
const toolCall = (id, name, args) => [{ type: 'toolCall', id, name, arguments: args }];
const assistant = (content, stopReason) => ({ role: 'assistant', content, stopReason, timestamp, usage, api, provider, model: model.id });
const resultId = 'fixture-retained-call';
const originalHistory = [
  { role: 'user', content: text('Read a synthetic label.'), timestamp },
  assistant(toolCall(resultId, `${namespace}small`, { label: 'example' }), 'toolUse'),
  { role: 'toolResult', toolCallId: resultId, toolName: `${namespace}small`, content: text(oldResult), isError: false, timestamp },
  assistant(text('The synthetic label was read.'), 'stop'),
];
const nextPrompt = 'Record the synthetic baseline request.';
const mcpNames = (declarations) => declarations.map(({ name }) => name).filter((name) => name.startsWith(namespace)).sort();

async function observe(label, config, { discover = false, seedEntries } = {}) {
  const agentDir = join(cwd, 'agent', label);
  await mkdir(agentDir, { recursive: true });
  const sessionManager = SessionManager.inMemory(cwd, undefined, structuredClone(seedEntries));
  if (!seedEntries) for (const message of originalHistory) sessionManager.appendMessage(structuredClone(message));
  const requests = [];
  let extension;
  const mock = (pi) => {
    extension = pi;
    pi.registerMcpServer('fixture', {
      command: process.execPath, args: [fileURLToPath(new URL('../../baseline/mcp-server.mjs', import.meta.url))],
      description: 'Synthetic catalog and labels — café.', timeout: 3, ...config,
    });
    pi.registerProvider(provider, {
      api, baseUrl, apiKey: 'fixture-only', models: [model],
      streamSimple(currentModel, context, options) {
        const stream = createAssistantMessageEventStream();
        const payload = structuredClone(context);
        const response = discover && requests.length === 0
          ? assistant(toolCall('fixture-search-call', 'tool_search', { query: `${namespace}large`, limit: 1 }), 'toolUse')
          : assistant(text('Fixture reply.'), 'stop');
        void (async () => {
          try {
            requests.push(await options?.onPayload?.(payload, currentModel) ?? payload);
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
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noPromptTemplates: true, noExtensions: true,
    additionalExtensionPaths: [join(comparatorDir, 'extensions/context-tax.ts')],
    extensionFactories: [createMcpExtension(), createToolSearchExtension(), createCodemodeExtension({ mode: 'on' }), mock],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, [], 'Comparator extension failed to load');
  // Pi chooses its initial model before it binds the extension's provider registration.
  const { session } = await createAgentSession({
    cwd, agentDir, resourceLoader: loader, settingsManager, sessionManager,
    model: { ...model, provider, api, baseUrl },
  });
  try {
    const extensionErrors = [];
    await session.bindExtensions({ mode: 'print', onError: (error) => extensionErrors.push(error) });
    if (config.enabled) {
      const deadline = Date.now() + 5_000;
      while (mcpNames(extension.getAllTools()).length !== tools.length) {
        if (Date.now() >= deadline) throw new Error(`Fixture did not expose both tools for ${label}`);
        await sleep(20);
      }
    }
    assert.equal(session.model?.provider, provider, 'Refusing to call a non-fixture provider');
    assert.equal(session.model.api, api);
    assert.equal(session.model.id, model.id);
    await session.prompt(discover ? 'Discover the large catalog tool.' : nextPrompt);
    assert.equal(session.messages.at(-1)?.content?.[0]?.text, 'Fixture reply.');
    assert.equal(requests.length, discover ? 2 : 1);
    assert.deepEqual(extensionErrors, []);
    if (discover) {
      const lists = requests.map(({ messages }) => mcpNames(getCurrentTools(messages) ?? []));
      assert.deepEqual(lists, [[], [`${namespace}large`]], 'Expected one discovery activation');
      return { seedEntries: sessionManager.getEntries() };
    }

    const entries = structuredClone(sessionManager.getEntries());
    const reportLines = [];
    const originalError = console.error;
    let preflight;
    try {
      console.error = (...lines) => reportLines.push(...lines.map(String));
      await session.prompt('/ctx', { preflightResult: (result) => { preflight = result; } });
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(extensionErrors, [], `/ctx failed for ${label}`);
    assert.equal(preflight, 'handled', '/ctx did not dispatch as a command');
    assert.equal(requests.length, 1, '/ctx unexpectedly called the mock provider');
    assert.deepEqual(sessionManager.getEntries(), entries, '/ctx changed the session entries');
    const report = reportLines.join('\n');
    assert.match(report, /^Current context: /u, 'Missing /ctx print report');

    const { messages } = requests[0];
    const history = messages.filter(({ role }) => role !== 'system');
    assert.deepEqual(history.pop()?.content, text(nextPrompt));
    assert.deepEqual(history.find(({ toolCallId }) => toolCallId === resultId)?.content, text(oldResult));
    return {
      history, report, declarations: getCurrentTools(messages) ?? [],
      announcements: [...getCurrentSystemPrompt(messages).matchAll(/<mcp_servers>\s*([\s\S]*?)\s*<\/mcp_servers>/gu)]
        .map(([, body]) => body),
    };
  } finally {
    try {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } finally {
      session.dispose();
    }
  }
}

const pairs = [];
for (const [mode, exposure, toolExposure, expected] of [
  ['direct', 'direct', undefined, ['large', 'small']],
  ['deferred-before', 'deferred', undefined, []],
  ['deferred-after', 'deferred', undefined, ['large']],
  ['codemode', 'codemode', undefined, []],
  ['override', 'deferred', { small: 'direct' }, ['small']],
]) {
  const onConfig = { exposure, toolExposure, enabled: true };
  const seed = mode === 'deferred-after' ? await observe('discovery', onConfig, { discover: true }) : {};
  const on = await observe(`${mode}-on`, onConfig, seed);
  const off = await observe(`${mode}-off`, { ...onConfig, enabled: false }, seed);
  const names = { on: mcpNames(on.declarations), off: mcpNames(off.declarations) };
  assert.deepEqual(names, { on: expected.map((name) => `${namespace}${name}`), off: [] }, mode);
  const sharedNames = ({ declarations }) => declarations.map(({ name }) => name)
    .filter((name) => ['codemode', 'tool_search'].includes(name)).sort();
  pairs.push({ mode, names, shared: { on: sharedNames(on), off: sharedNames(off) }, ...comparePair(on, off, resultId) });
}
console.log(JSON.stringify({
  pi: piPin, comparator: comparatorPin, command: '/ctx', mode: 'print', observation: 'mock provider normalized transcript',
  providerTokens: null, pairs,
}, null, 2));
