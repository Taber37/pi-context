import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('..', import.meta.url));
const command = 'gentle:context';
const entry = 'extensions/context.ts';
const publishedFiles = [
  'README.md', 'docs/local-install.md', entry, 'package.json',
  'src/measurement/index.mjs', 'src/pi/attribution.mjs', 'src/pi/chat-completions.mjs',
  'src/pi/controller.mjs', 'src/view/render.mjs',
].sort();

// The installed CLI owns its HTTP transport, so use an ephemeral loopback-only SSE endpoint.
async function mockProvider(exercise) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(requests, 1);
      let json = '';
      for await (const chunk of request) json += chunk;
      const body = JSON.parse(json);
      assert.equal(body.model, 'fixture-model');
      const lastUser = body.messages.findLast(({ role }) => role === 'user');
      assert.ok(lastUser, 'Expected the fixture user turn');
      const expected = 'Synthetic package smoke.';
      if (typeof lastUser.content === 'string') assert.equal(lastUser.content, expected);
      else assert.deepEqual(lastUser.content, [{ type: 'text', text: expected }]);
      const chunks = [
        { choices: [{ index: 0, delta: { content: 'Synthetic reply.' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 105, completion_tokens: 2 } },
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of chunks) response.write(`data: ${JSON.stringify({ id: 'smoke', model: 'fixture-model', ...chunk })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch {
      response.writeHead(400).end('Unexpected synthetic package smoke request');
    }
  });
  try {
    await once(server.listen(0, '127.0.0.1'), 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const fixture = `export default function (pi) {
      pi.registerProvider('package-fixture', { api: 'openai-completions', baseUrl: ${JSON.stringify(baseUrl)},
        apiKey: 'synthetic-not-a-credential', models: [{ id: 'fixture-model', name: 'Fixture', reasoning: false,
          input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 1024 }] });
    }`;
    await exercise(fixture, () => requests);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

function isolated(root) {
  const dir = (name) => join(root, name);
  return { HOME: root, USERPROFILE: root, TMPDIR: root, PI_CODING_AGENT_DIR: dir('agent'),
    XDG_CONFIG_HOME: dir('config'), XDG_CACHE_HOME: dir('cache'), XDG_DATA_HOME: dir('data'), XDG_STATE_HOME: dir('state'),
    PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    npm_config_userconfig: dir('empty-user-npmrc'), npm_config_globalconfig: dir('empty-global-npmrc'),
    npm_config_cache: dir('npm-cache'), npm_config_update_notifier: 'false', npm_config_registry: 'https://fixture.invalid' };
}

function run(binary, args, options) {
  const result = spawnSync(binary, args, { ...options, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${binary} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '');
  return result.stdout;
}

async function* jsonLines(stdout) {
  stdout.setEncoding('utf8');
  let pending = '';
  for await (const chunk of stdout) {
    pending += chunk;
    let lf;
    while ((lf = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, lf);
      pending = pending.slice(lf + 1);
      yield JSON.parse(line);
    }
  }
  assert.equal(pending, '');
}

async function rpc(pi, options, fixture, exercise) {
  const child = spawn(pi, ['--offline', '--no-approve', '--no-session', '--mode', 'rpc', '--no-tools',
    '--extension', fixture, '--provider', 'package-fixture', '--model', 'fixture-model'], { ...options, timeout: 15_000 });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (text) => { stderr += text; });
  const closed = once(child, 'close');
  // An ENOENT is reported at cleanup even if stdout reaches EOF first.
  void closed.catch(() => {});
  const records = jsonLines(child.stdout);
  let seq = 0;
  async function exchange(type, fields = {}, extra) {
    const id = `smoke-${++seq}`;
    child.stdin.write(JSON.stringify({ id, type, ...fields }) + '\n');
    let response, event;
    while (!response || (extra && !event)) {
      const { value, done } = await records.next();
      assert.ok(!done, `RPC exited waiting for ${type}: ${stderr}`);
      if (value.type === 'response' && value.id === id) {
        assert.equal(value.success, true, JSON.stringify(value));
        response = value;
      }
      if (extra?.(value)) event = value;
    }
    return { data: response.data, event };
  }
  try {
    await exercise(exchange);
  } finally {
    child.stdin.end();
    // Drain to EOF so the client never prevents an orderly shutdown via backpressure.
    for await (const event of records) assert.notEqual(event.notifyType, 'error', JSON.stringify(event));
    const [exit, signal] = await closed;
    assert.deepEqual([exit, signal], [0, null], stderr);
    assert.equal(stderr, '');
  }
}

async function smoke(t, pi, root, options, installed, mock, requests) {
  assert.ok(isAbsolute(pi), 'PI_PACKAGE_PI must be the absolute path to an installed Pi CLI');
  assert.equal(run(pi, ['--version'], options).trim(), '1.6.1');
  const fixture = join(root, 'mock.mjs');
  writeFileSync(fixture, mock);
  const matches = async (rpcExchange) => (await rpcExchange('get_commands')).data.commands
    .filter(({ name }) => name === command || name === `${command} all`);
  await rpc(pi, options, fixture, async (exchange) => assert.deepEqual(await matches(exchange), []));
  run(pi, ['install', installed], options);
  assert.ok(run(pi, ['list'], options).includes(installed));
  await rpc(pi, options, fixture, async (exchange) => {
    const commands = await matches(exchange);
    assert.equal(commands.length, 1, JSON.stringify(commands));
    assert.equal(commands[0].name, command);
    assert.equal(commands[0].source, 'extension');
    const lookup = async (suffix) => {
      const { data, event } = await exchange('prompt', { message: `/${command}${suffix}` },
        (value) => value.type === 'extension_ui_request' && value.method === 'notify');
      assert.equal(data.disposition, 'handled');
      assert.equal(event.notifyType, 'info');
      return event.message;
    };
    const history = async () => (await exchange('get_entries')).data;
    const before = await history();
    assert.match(await lookup(''), /No request measured yet\./u);
    assert.match(await lookup(' all'), /Matched provider input: unknown/u);
    assert.deepEqual(await history(), before);
    assert.equal(requests(), 0);
    await exchange('set_auto_retry', { enabled: false });
    const prompt = await exchange('prompt', { message: 'Synthetic package smoke.' }, (event) => event.type === 'agent_settled');
    assert.equal(prompt.data.disposition, 'started');
    const { messages } = (await exchange('get_messages')).data;
    assert.deepEqual((await exchange('get_last_assistant_text')).data, { text: 'Synthetic reply.' },
      messages.at(-1)?.errorMessage);
    const after = await history();
    const overview = await lookup('');
    assert.match(overview, /Observation: fragments \/ full/u);
    assert.doesNotMatch(overview, /Matched provider input/u);
    const details = await lookup(' all');
    assert.match(details, /Matched provider input: 105 tokens \(cache-inclusive\)/u);
    assert.doesNotMatch(overview + details, /Synthetic package smoke\.|Synthetic reply\./u);
    assert.deepEqual(await history(), after);
  });
  run(pi, ['remove', installed], options);
  assert.ok(!run(pi, ['list'], options).includes(installed));
  await rpc(pi, options, fixture, async (exchange) => assert.deepEqual(await matches(exchange), []));
  assert.equal(requests(), 1);
  t.diagnostic('Pi 1.6.1: clean → installed (two forms, before/after one mock reply) → removed; RPC only');
}

test('private npm artifact has only the runtime and install documentation', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pi-context-package-'));
  try {
    const options = { cwd: root, env: isolated(root) };
    const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'local-context-development');
    assert.equal(manifest.private, true);
    assert.equal(manifest.license, 'UNLICENSED');
    assert.deepEqual(manifest.pi, { extensions: [`./${entry}`] });
    assert.ok(manifest.keywords.includes('pi-package'));
    for (const key of ['scripts', 'dependencies', 'publishConfig', 'bin']) assert.equal(manifest[key], undefined);
    const pack = (...flags) => {
      const results = JSON.parse(run('npm', ['pack', '--offline', '--ignore-scripts', '--json', ...flags, repository], options));
      assert.equal(results.length, 1);
      const [artifact] = results;
      assert.equal(artifact.filename, `${manifest.name}-${manifest.version}.tgz`);
      assert.deepEqual(artifact.files.map(({ path }) => path).sort(), publishedFiles);
      return artifact;
    };
    const preview = pack('--dry-run');
    const archive = pack();
    assert.equal(archive.filename, preview.filename);
    const tarball = join(root, archive.filename);
    assert.deepEqual(run('/usr/bin/tar', ['-tzf', tarball], options).trim().split('\n').sort(),
      publishedFiles.map((path) => `package/${path}`).sort());
    t.diagnostic(`${archive.filename}: ${archive.entryCount} files; ${archive.integrity} (scratch archive removed at teardown)`);
    const pi = process.env.PI_PACKAGE_PI;
    await t.test('installed Pi CLI discovers, runs, and removes the unpacked artifact',
      { skip: !pi && 'Set PI_PACKAGE_PI to the absolute path to installed Pi 1.6.1' }, async (t) => {
        const unpacked = join(root, 'unpacked');
        mkdirSync(unpacked);
        run('/usr/bin/tar', ['-xzf', tarball, '-C', unpacked], options);
        await mockProvider((fixture, requests) => smoke(t, pi, root, options, join(unpacked, 'package'), fixture, requests));
      });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
