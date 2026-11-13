import test = require("node:test");
import assert = require("node:assert/strict");
import { spawn } from "node:child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { isLoginShellCommand, resolveChildArgv0, stripNvmIncompatibleEnv } from "../../cli/processArgv";

test("keeps argv0 unchanged for login shells and labels real executables", () => {
  assert.equal(isLoginShellCommand("/bin/zsh"), true);
  assert.equal(isLoginShellCommand("/bin/bash"), true);
  assert.equal(isLoginShellCommand("/usr/local/bin/codex"), false);
  assert.equal(resolveChildArgv0("/bin/zsh", "sinitek-ai-vscode-cli-codex-app-server"), undefined);
  assert.equal(resolveChildArgv0("/bin/bash", "sinitek-ai-vscode-cli-codex-app-server"), undefined);
  assert.equal(resolveChildArgv0("/usr/local/bin/codex", "sinitek-ai-vscode-cli-codex-app-server"), "sinitek-ai-vscode-cli-codex-app-server");
  assert.equal(resolveChildArgv0("/usr/local/bin/codex"), undefined);
});

test("removes only the npm prefix variables that make nvm deactivate", () => {
  const original = { PATH: "/usr/bin", npm_config_prefix: "/tmp/prefix", NPM_CONFIG_PREFIX: "/tmp/prefix", HOME: "/tmp/home" };
  const stripped = stripNvmIncompatibleEnv(original);
  assert.equal(Object.prototype.hasOwnProperty.call(stripped, "npm_config_prefix"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stripped, "NPM_CONFIG_PREFIX"), false);
  assert.equal(stripped.PATH, "/usr/bin");
  assert.equal(stripped.HOME, "/tmp/home");
  assert.equal(Object.prototype.hasOwnProperty.call(original, "npm_config_prefix"), true);
  const unchanged = { PATH: "/usr/bin" };
  assert.equal(stripNvmIncompatibleEnv(unchanged), unchanged);
});

test("login zsh loads the selected shell profile only when argv0 stays zsh", async () => {
  if (process.platform !== "darwin") {
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-zsh-argv0-"));
  const zdot = path.join(root, "zdot");
  const bin = path.join(root, "bin");
  const tool = path.join(bin, "sinitek-shell-probe");
  try {
    await fs.mkdir(zdot);
    await fs.mkdir(bin);
    await fs.writeFile(tool, "#!/bin/sh\nexit 0\n");
    await fs.chmod(tool, 0o755);
    await fs.writeFile(path.join(zdot, ".zprofile"), [
      'if [ -z "${npm_config_prefix-}" ]; then',
      `  export PATH="${bin}:$PATH"`,
      "fi",
      "",
    ].join("\n"));
    const env: NodeJS.ProcessEnv = {
      HOME: process.env.HOME || root,
      USER: process.env.USER || "tester",
      LOGNAME: process.env.LOGNAME || process.env.USER || "tester",
      SHELL: "/bin/zsh",
      TERM: "dumb",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      ZDOTDIR: zdot,
    };
    const probe = (argv0: string | undefined, probeEnv: NodeJS.ProcessEnv): Promise<number | null> => new Promise((resolve, reject) => {
      const child = spawn("/bin/zsh", ["-lc", "command -v sinitek-shell-probe >/dev/null 2>&1"], {
        env: probeEnv,
        argv0,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });

    assert.notEqual(await probe("sinitek-ai-vscode-cli-codex-app-server", env), 0);
    assert.equal(await probe(resolveChildArgv0("/bin/zsh", "sinitek-ai-vscode-cli-codex-app-server"), env), 0);
    assert.notEqual(await probe(undefined, { ...env, npm_config_prefix: path.join(root, "prefix") }), 0);
    assert.equal(await probe(undefined, stripNvmIncompatibleEnv({ ...env, npm_config_prefix: path.join(root, "prefix") })), 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
