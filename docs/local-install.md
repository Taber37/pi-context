# Install pi-context locally

Install from a checked-out copy for everyday use, or use a disposable profile to try the packed artifact without touching your normal Pi configuration.

## Quick start: one project

With Git and Pi installed, clone the repository to a stable location:

```sh
git clone https://github.com/Taber37/pi-context.git
```

From the project where you want to use the dashboard, replace the example path with the absolute path to the clone:

```sh
pi install -l /absolute/path/to/pi-context
```

`-l` registers the directory in the project's `.pi/settings.json`, not in your personal settings. There is no build or npm install step. Review the extension and the project configuration before granting project trust; Pi loads project packages only in trusted projects. Start Pi from that project. If Pi is already open, try `/reload`; if the command is still missing, restart from the project and use `pi --resume` to reopen your session.

- **See what's in context now:** `/gentle:context` shows projected occupancy, free space, and observed category estimates. `/gentle:context all` adds each MCP server's observed footprint, including attributable retained history.
- **See what disabling a server could save:** In `/gentle:context all`, **If disabled · next full request** shows conditional estimates and any known removable components. Shared overhead and retained history are not counted as savings. Unknown is not zero, and disabling alone does not delete past calls or results.

The reports run locally without calling a model or changing MCP settings or history. The extension retains aggregate counts and bounded labels in memory, not raw request or result contents, and writes no extension state or telemetry. Estimates are not billed tokens. Before a request is observed, Pi's projection may be available while the measured breakdown is not.

To uninstall, run from the same project with the same absolute path, then reload or restart Pi:

```sh
pi remove -l /absolute/path/to/pi-context
```

Pi loads the directory in place, so keep it there while registered. Removing it from the project does not delete the clone. Avoid registering two copies in a profile. Both report forms use the one command registration, `gentle:context`; `all` is an argument.

## Tested scope

| Runtime | What was checked |
| --- | --- |
| Pi 1.7.0 | Interactive overview confirmed after restart and resume; detail scrolling and closing exercised in a synthetic terminal session. Hot reload was not verified. |
| Pi 1.6.1 | Isolated install and removal of the extracted package and both report forms in RPC mode. |
| Gentle Shell 4.9.0 with Pi 1.6.1 | Isolated launcher and extracted-package lifecycle in RPC mode, with automatic provisioning disabled. |

Other versions and collisions with other installed extensions were not tested. The interactive terminal shows a scrollable report; RPC receives a plain notification. Print and JSON modes have no report UI.

## Try the packed artifact in an isolated Pi profile

The public source repository is not an npm release or a license grant. `local-context-development` is a local build identifier; the manifest is `private: true` and `UNLICENSED`. The npm name `pi-context` is unrelated to this project.

Build the local archive from the source checkout with Node/npm and Pi already installed. No registry install, package scripts, provider credentials, or changes to your normal profile are needed. Pi loads the **extracted local directory**, not the tarball directly. From the checkout root, start a disposable shell using trusted binaries:

```sh
repo="$PWD"
pi_bin="$(command -v pi)"
node_bin="$(command -v node)"
scratch="$(mktemp -d)"
env -i HOME="$scratch" USERPROFILE="$scratch" TMPDIR="$scratch" \
  PATH="$(dirname "$node_bin"):/usr/bin:/bin" PI_CODING_AGENT_DIR="$scratch/agent" \
  XDG_CONFIG_HOME="$scratch/config" XDG_CACHE_HOME="$scratch/cache" \
  XDG_DATA_HOME="$scratch/data" XDG_STATE_HOME="$scratch/state" \
  PI_OFFLINE=1 PI_TELEMETRY=0 npm_config_cache="$scratch/npm-cache" \
  npm_config_userconfig="$scratch/empty-user-npmrc" \
  npm_config_globalconfig="$scratch/empty-global-npmrc" \
  npm_config_update_notifier=false npm_config_registry=https://fixture.invalid \
  REPO="$repo" PI_BIN="$pi_bin" /bin/sh
```

Inside that shell:

```sh
cd "$HOME"
npm pack --offline --ignore-scripts --json --dry-run "$REPO"
npm pack --offline --ignore-scripts --json "$REPO"
mkdir unpacked
/usr/bin/tar -xzf local-context-development-0.0.0.tgz -C unpacked
package="$HOME/unpacked/package"
"$PI_BIN" install "$package"
"$PI_BIN" list
# Start Pi with --offline --no-approve --no-session to try the commands without sending a prompt.
# To uninstall after exiting Pi:
"$PI_BIN" remove "$package"
"$PI_BIN" list
exit
```

Remove the disposable directory when finished. `pi remove` removes the disposable profile's registration but **does not delete the extracted files**. Do not move the directory while it is registered. These commands omit `-l` because the entire profile is disposable; use the `-l` commands above for an everyday project-local install.

The regression test checks the dry-run and actual tarball contents, then uses Pi 1.6.1's RPC mode against that installed directory. It checks command discovery before install and after removal, runs both forms before and after one mocked Chat Completions reply, and verifies that the reports leave history unchanged. This is not an interactive terminal test.

## Try the packed artifact in an isolated Gentle Shell profile

Verified separately with the real Gentle Shell 4.9.0 launcher and an installed Pi 1.6.1. Keep the disposable shell and extracted `package` directory from the Pi example. Use the absolute path to your installed `gentle-pi/bin/gentle-shell.mjs` (the launcher need not be on `PATH`). Do not point `--home` at a live profile.

```sh
shell_bin=/absolute/path/to/gentle-pi/bin/gentle-shell.mjs
shell_home="$HOME/gentle/agent"
export GENTLE_SHELL_PI="$PI_BIN" GENTLE_SHELL_NO_AUTO_SETUP=1
export GENTLE_SHELL_SKIP_STARTUP_UPDATE=1 GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1
node "$shell_bin" --home "$shell_home" --version
node "$shell_bin" --home "$shell_home" install "$package"
node "$shell_bin" --home "$shell_home" list
# After trying /gentle:context and /gentle:context all, unregister the package:
node "$shell_bin" --home "$shell_home" remove "$package"
node "$shell_bin" --home "$shell_home" list
```

The compatibility check used `--offline --no-approve --no-session --mode rpc --no-tools --extension "$FIXTURE" --provider probe --model probe-model` with a synthetic fixture, an isolated home, automatic provisioning disabled, and a provider on loopback. The command catalog included Shell’s `gentle:customize` as well as the installed extension. Both report forms ran before and after one synthetic reply. Removal restored the clean command catalog without deleting the extracted package. This does not test interactive terminal rendering, automatic provisioning, or a bundled Pi runtime.

## Reproduce the automated checks

From the source checkout (tests are not included in the extracted archive), with npm beside the selected Node binary and the pinned Pi 1.6.1 package already installed locally:

```sh
PI_PACKAGE_PI="$(command -v pi)" node --test test/package.test.mjs
PI_PACKAGE_PI="$(command -v pi)" PI_BASELINE_PACKAGE=/absolute/path/to/@earendil-works/pi-coding-agent node --test
```

Without `PI_PACKAGE_PI`, the package checks run and the Pi CLI smoke is explicitly skipped. The full suite uses `PI_BASELINE_PACKAGE` for its existing Pi SDK checks. Both pack runs, the archive, and the test's profile are confined to system scratch and do not need a network or a real model.
