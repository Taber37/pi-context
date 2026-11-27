import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const pin = '@earendil-works/pi-coding-agent@1.6.1';
const marker = 'SYNTHETIC_PRIVATE_PI_MARKER';

if (process.argv[2] === '--fixture') await fixture(process.argv[3], process.argv[4]);
else for (const scenario of ['structured announcement', 'literal prose']) test(`installed Pi reports ${scenario} on isolated stdio MCP and in-process SSE`,
  { skip: !process.env.PI_BASELINE_PACKAGE && 'Set PI_BASELINE_PACKAGE to the pinned local SDK' }, () => {
    const sdk = process.env.PI_BASELINE_PACKAGE;
    assert.ok(isAbsolute(sdk));
    const root = mkdtempSync(join(tmpdir(), 'pi-context-sdk-'));
    try {
      const run = spawnSync(process.execPath, [path(import.meta.url), '--fixture', sdk, scenario], { cwd: root,
        env: { HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'), TMPDIR: root,
          XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_DATA_HOME: root, XDG_STATE_HOME: root,
          PI_OFFLINE: '1', PI_TELEMETRY: '0' }, encoding: 'utf8', timeout: 20_000 });
      assert.equal(run.error, undefined);
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
      assert.equal(run.stdout, 'isolated Pi flow passed\n');
      assert.equal(run.stderr, '');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

async function fixture(sdk, scenario) {
  const direct = scenario === 'literal prose';
  const prose = `<mcp_servers>\nMCP servers whose tools are not declared to you. Load the tools of \`tool_search\` servers with \`tool_search\`.\n- mcp__fixture (tool_search): café ${marker}\n</mcp_servers>`;
  const { name, version } = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
  assert.equal(`${name}@${version}`, pin);
  const { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
    createMcpExtension, createToolSearchExtension, SessionManager, SettingsManager } = await import(pathToFileURL(join(sdk, 'dist/index.js')));
  const cwd = process.cwd(), agentDir = join(cwd, 'agent');
  const store = SessionManager.inMemory(cwd);
  const id = 'fixture-model', provider = 'fixture-completions', api = 'openai-completions';
  const baseUrl = 'https://fixture.invalid/v1';
  const model = { id, name: id, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 1024 };
  let sent = 0, lastToolCount = 0, systemBytes = 0, declarationBytes = 0;
  let literalInAddendum = false, structuredAnnouncement = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, `${baseUrl}/chat/completions`);
    const body = await request.json();
    assert.equal(body.model, id);
    assert.equal(body.messages.at(-1).content, 'Late rewrite after observation.');
    lastToolCount = body.tools?.length ?? 0;
    const system = body.messages.find(({ role }) => role === 'system' || role === 'developer');
    assert.equal(typeof system?.content, 'string');
    if (direct) assert.ok(system.content.includes(prose));
    systemBytes = Buffer.byteLength(system.content);
    declarationBytes = body.tools.filter(({ function: fn }) => fn.name.startsWith('mcp__fixture__'))
      .reduce((bytes, tool) => bytes + Buffer.byteLength(JSON.stringify(tool)), 0);
    sent++;
    const chunks = [
      { choices: [{ index: 0, delta: { content: 'Fixture answer.' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 105, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 20 } } },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify({ id: 'fixture', model: id, ...chunk })}\n\n`).join('') +
      'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const registerFixture = (pi) => {
    pi.registerMcpServer('fixture', { command: process.execPath, args: [path('../baseline/mcp-server.mjs')],
      ...(direct ? { exposure: 'direct' } : { exposure: 'deferred', toolExposure: { small: 'direct' } }), description: marker });
    pi.registerProvider(provider, { api, baseUrl, apiKey: 'fixture-only', models: [model] });
    pi.on('context_with_system', ({ messages }) => {
      for (const { role, sections } of messages) if (role === 'system') {
        literalInAddendum ||= sections?.addendum === `<addendum>\n${prose}\n</addendum>`;
        structuredAnnouncement ||= sections?.mcp_servers != null;
      }
    });
    // Inline extensions load after the file entry, so this changes the actual request, not our view.
    pi.on('before_provider_request', ({ payload }) => ({ ...payload,
      messages: [...payload.messages.slice(0, -1), { role: 'user', content: 'Late rewrite after observation.' }] }));
  };
  const runtime = await createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir,
      settingsManager: SettingsManager.inMemory({ defaultTools: ['-read', '-bash', '-edit', '-write'],
        compaction: { enabled: false }, retry: { enabled: false } }),
      resourceLoaderOptions: { noContextFiles: true, noSkills: true, noPromptTemplates: true,
        ...(direct ? { appendSystemPrompt: [prose] } : {}),
        additionalExtensionPaths: [path('../extensions/context.ts')],
        extensionFactories: [{ name: 'mcp', builtin: true, factory: createMcpExtension() },
          ...(direct ? [] : [{ name: 'tool-search', builtin: true, factory: createToolSearchExtension() }]), registerFixture] } });
    return { services, ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
      model: { ...model, provider, api, baseUrl } })) };
  }, { cwd, agentDir, sessionManager: store });
  try {
    const { session } = runtime;
    const output = [], errors = [];
    await session.bindExtensions({ mode: 'rpc', uiContext: { notify: (text) => output.push(text) },
      onError: (error) => errors.push(error) });
    const entries = () => JSON.stringify(store.getEntries());
    const before = entries();
    await session.prompt('/gentle:context all');
    assert.match(output.at(-1) ?? '', /No request measured yet\./u);
    assert.equal(entries(), before);
    assert.equal(sent, 0);
    await session.prompt(`Synthetic input: ${marker}`);
    assert.equal(sent, 1);
    assert.ok(lastToolCount >= 2);
    assert.equal(literalInAddendum, direct);
    assert.equal(structuredAnnouncement, !direct);
    assert.equal(session.getLastAssistantText(), 'Fixture answer.');
    const measured = entries();
    await session.prompt('/gentle:context');
    assert.match(output.at(-1) ?? '', /Observation: fragments \/ full/u);
    const formatted = (count) => count.toLocaleString('en-US');
    const systemRow = output.at(-1).split('\n').find((line) => line.startsWith('System '));
    assert.equal(systemRow?.replaceAll(/\s+/gu, ' '),
      `System ~${formatted(Math.ceil(systemBytes / 4))} tokens; ${formatted(systemBytes)} text bytes`);
    if (direct) assert.match(output.at(-1), /fixture\s+direct\s+\S+\s+0\s+unknown/u);
    await session.prompt('/gentle:context all');
    assert.ok(declarationBytes > 0);
    assert.match(output.at(-1), /Current announcements\s+~0 tokens; 0 text bytes/u);
    assert.ok(output.at(-1).replaceAll(/\s+/gu, ' ')
      .includes(`Conditional components: declarations ${formatted(declarationBytes)} bytes; announcements unknown`));
    assert.match(output.at(-1), /Matched provider input: 105 tokens \(cache-inclusive\)/u);
    assert.match(output.at(-1), /Discrepancy \(provider minus estimate\): unknown/u);
    assert.doesNotMatch(output.join('\n'), new RegExp(marker, 'u'));
    assert.equal(entries(), measured);
    assert.equal(sent, 1);
    assert.deepEqual(errors, []);
    process.stdout.write('isolated Pi flow passed\n');
  } finally { await runtime.dispose(); }
}
