import test = require("node:test");
import assert = require("node:assert/strict");
import { createCliProcessPolicy } from "../../cli/cliProcessPolicy";

test("process policy centralizes platform spawn differences", () => {
  const input = {
    cwd: "/workspace",
    syncPwd: true,
    baseEnvironment: { PATH: "/base", VALUE: "base", PWD: "/base" },
    envOverrides: { VALUE: "task", PWD: "/task" },
    overlayEnvOverrides: { VALUE: "overlay", PWD: "/overlay" },
    processLabel: "sinitek-test",
  };
  for (const platform of ["linux", "darwin"] as const) {
    const options = createCliProcessPolicy(platform).spawnOptions("node", input);
    assert.equal(options.detached, true);
    assert.equal(options.windowsHide, true);
    assert.equal(options.argv0, "sinitek-test");
    assert.deepEqual(options.env, { PATH: "/base", VALUE: "overlay", PWD: "/workspace" });
  }
  const windows = createCliProcessPolicy("win32").spawnOptions("node", input);
  assert.equal(windows.detached, false);
  assert.equal(windows.argv0, "sinitek-test");
  assert.deepEqual(windows.env, { PATH: "/base", VALUE: "overlay", PWD: "/workspace" });
});

test("process policy preserves macOS shell selection, argument escaping, and login-shell env", () => {
  const policy = createCliProcessPolicy("darwin");
  assert.deepEqual(policy.resolve("missing cli", ["a b", "it's"], { macTaskShell: "bash" }), {
    command: "/bin/bash",
    args: ["-lc", `'missing cli' 'a b' 'it'"'"'s'`],
    usesShell: true,
    resolvedFrom: "mac-shell-fallback",
  });
  const env = policy.spawnOptions("/bin/zsh", {
    baseEnvironment: { PATH: "/bin", npm_config_prefix: "/nvm/prefix", NPM_CONFIG_PREFIX: "/nvm/upper" },
  }).env;
  assert.deepEqual(env, { PATH: "/bin" });
  assert.deepEqual(createCliProcessPolicy("linux").resolve("missing", []), null);
});
