import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin = '@earendil-works/pi-coding-agent@1.6.1';
const candidate = process.env.PI_BASELINE_PACKAGE;
if (!candidate) {
  console.error(`Set PI_BASELINE_PACKAGE to the local ${pin} package directory.`);
  process.exitCode = 1;
} else if (!isAbsolute(candidate)) {
  console.error('PI_BASELINE_PACKAGE must be an absolute path to a local package directory.');
  process.exitCode = 1;
} else {
  const root = mkdtempSync(join(tmpdir(), 'pi-context-baseline-'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./pi-experiment.mjs', import.meta.url)),
      resolve(candidate), pin], {
      cwd: root,
      env: {
        HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'), TMPDIR: root,
        XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_DATA_HOME: root, XDG_STATE_HOME: root,
        PI_OFFLINE: '1', PI_TELEMETRY: '0',
      },
      encoding: 'utf8', timeout: 45_000,
    });
    if (child.error) throw child.error;
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    process.exitCode = child.status ?? 1;
  } catch (error) {
    console.error(`Baseline failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
