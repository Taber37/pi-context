import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin = 'pi-context-tax@0.2.3';
const integrity = 'Cf4IR2O1k1TrID1i1ZVwJwznLFCdp8XNttHGo23qlPkjO23dF3xSYE9ZBgR4aGtw1eppdkw+GpfL+/6nbsby2A==';
const [piDir] = process.argv.slice(2);
try {
  if (!piDir || !isAbsolute(piDir)) throw new Error('Usage: pass the absolute local Pi package directory and pipe the pinned npm tarball into stdin');
  const archive = readFileSync(0);
  if (createHash('sha512').update(archive).digest('base64') !== integrity) {
    throw new Error(`archive does not match ${pin} integrity`);
  }
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'pi-context-comparator-'));
  const env = {
    HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'), TMPDIR: root,
    XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_DATA_HOME: root, XDG_STATE_HOME: root,
    PI_OFFLINE: '1', PI_TELEMETRY: '0',
  };
  try {
    execFileSync('/usr/bin/tar', ['-xzf', '-'], { cwd: root, env, input: archive });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./observe.mjs', import.meta.url)), piDir, pin], {
      cwd: root, env, encoding: 'utf8', timeout: 45_000,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`Comparator failed: ${error.message}`);
  process.exitCode = 1;
}
