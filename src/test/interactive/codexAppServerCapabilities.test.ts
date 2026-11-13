import { test, TestContext } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { installVscodeMock } from "../vscodeMock";
import { buildCodexAppServerArgs } from "../../interactive/codexRunnerRuntime";

installVscodeMock();
type CapabilityModule = typeof import("../../interactive/codexAppServerCapabilities");
type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; kill: () => boolean };
type Call = { command: string; args: string[]; options: { cwd: string; env: NodeJS.ProcessEnv }; child: FakeChild };

function fixture(t: TestContext) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-capability-test-"));
  const command = path.join(temp, "CLI with spaces", process.platform === "win32" ? "codex.cmd" : "codex");
  fs.mkdirSync(path.dirname(command));
  fs.writeFileSync(command, "fixture; never execute");
  const env: NodeJS.ProcessEnv = { HOME: temp, USERPROFILE: temp, PATH: path.dirname(command) };
  const calls: Call[] = [];
  const kills: unknown[] = [];
  let respond = (call: Call): void => {
    call.child.stdout.write("codex-cli 0.167.0\n"); call.child.emit("close", 0);
  };
  const crossSpawn = require("cross-spawn");
  t.mock.method(crossSpawn, "spawn", (cmd: string, args: string[], options: Call["options"]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), pid: 987654321,
      kill: () => { kills.push("child.kill"); return true; },
    });
    const call = { command: cmd, args, options, child };
    calls.push(call);
    queueMicrotask(() => respond(call));
    return child;
  });
  const processModule = require("../../interactive/codexRunnerProcess");
  t.mock.method(processModule, "killProcessTree", (child: unknown) => { kills.push(child); return true; });
  // A regression must never send a fake PID to the OS, even on a failure path.
  t.mock.method(process, "kill", () => assert.fail("OS process.kill is forbidden for fixture PIDs"));
  const modulePath = require.resolve("../../interactive/codexAppServerCapabilities");
  delete require.cache[modulePath];
  const api = require(modulePath) as CapabilityModule;
  t.after(() => {
    for (const { child } of calls) {
      child.emit("close", null);
      child.stdout.destroy(); child.stderr.destroy();
    }
    delete require.cache[modulePath]; fs.rmSync(temp, { recursive: true, force: true });
  });
  return { ...api, temp, command, env, calls, kills, respond: (fn: typeof respond) => { respond = fn; } };
}

for (const [version, reason] of [
  ["0.162.1", "supported"], ["0.167.0", "supported"], ["0.100.0", "unsupported"], ["0.145.0", "unsupported"],
  ["0.166.0", "unknown"], ["0.168.0", "unknown"], ["0.167.0-beta.1", "unknown"],
  ["0.167.0+custom", "unknown"],
] as const) {
  test(`actual CLI ${version} resolves ${reason} and only confirmed support enables the policy`, async (t) => {
    const f = fixture(t);
    f.respond(({ child }) => { child.stdout.write(`codex-cli ${version}\n`); child.emit("close", 0); });
    const capability = await f.resolveCodexThreadUnloadCapability({ command: f.command, env: f.env });
    assert.deepEqual(capability, { supported: reason === "supported", reason, version });
    const args = buildCodexAppServerArgs(["model=\"chosen\""], {
      requestUserInputEnabled: true, immediateThreadUnload: capability.supported,
    });
    assert.equal(args.includes("thread_unload_delay_secs=0"), reason === "supported");
    assert.ok(args.includes("model=\"chosen\"") && args.includes("default_mode_request_user_input"));
    assert.deepEqual(args.slice(-2), ["--listen", "stdio://"]);
  });
}

test("an adjacent npm package cannot upgrade an unsupported executable's capability", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(path.dirname(f.command), "package.json"), '{"name":"@openai/codex","version":"0.167.0"}');
  f.respond(({ child }) => { child.stdout.write("codex-cli 0.100.0\n"); child.emit("close", 0); });
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: f.command })).reason, "unsupported");
});

for (const outcome of ["spawn-throw", "spawn-error", "nonzero", "malformed", "stderr-version", "oversized", "no-response"]) {
  test(`probe ${outcome} conservatively returns unknown`, async (t) => {
    const f = fixture(t);
    const originalSetTimeout = setTimeout;
    t.mock.method(global, "setTimeout", ((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) =>
      originalSetTimeout(callback, delay === 3000 ? 5 : delay, ...args)) as typeof setTimeout);
    if (outcome === "spawn-throw") {
      t.mock.method(require("cross-spawn"), "spawn", () => { throw new Error("private details must not escape"); });
    }
    f.respond(({ child }) => {
      if (outcome === "no-response") { return; }
      if (outcome === "spawn-error") { child.emit("error", new Error("ENOENT")); return; }
      if (outcome === "oversized") { child.stdout.write("x".repeat(4097)); return; }
      if (outcome === "stderr-version") { child.stderr.write("codex-cli 0.167.0\n"); }
      else { child.stdout.write(outcome === "malformed" ? "package 0.167.0" : "codex-cli 0.167.0\n"); }
      child.emit("close", outcome === "nonzero" ? 1 : 0);
    });
    assert.deepEqual(await f.resolveCodexThreadUnloadCapability({ command: f.command }), { supported: false, reason: "unknown" });
    const awaitingClose = ["spawn-error", "oversized", "no-response"].includes(outcome);
    assert.equal(f.kills.length, awaitingClose ? 1 : 0);
    if (awaitingClose) {
      assert.equal(fs.existsSync(f.calls[0].options.cwd), true);
      assert.equal(f.calls[0].child.stdout.destroyed, false);
      f.calls[0].child.emit("close", null);
    }
    assert.equal(fs.existsSync(f.calls[0]?.options.cwd ?? path.join(f.temp, "absent")), false);
  });
}

test("probe cleanup waits for close after bounded timeout, even if termination fails", async (t) => {
  const f = fixture(t);
  const originalSetTimeout = setTimeout;
  t.mock.method(global, "setTimeout", ((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) =>
    originalSetTimeout(callback, delay === 3000 ? 5 : delay, ...args)) as typeof setTimeout);
  f.respond(() => undefined);
  t.mock.method(require("../../interactive/codexRunnerProcess"), "killProcessTree", (child: unknown) => {
    assert.equal(child, f.calls[0].child);
    throw new Error("termination request failed");
  });
  assert.deepEqual(await f.resolveCodexThreadUnloadCapability({ command: f.command }), { supported: false, reason: "unknown" });
  const { child, options } = f.calls[0];
  assert.equal(fs.existsSync(options.cwd), true);
  child.emit("exit", null, "SIGKILL");
  assert.equal(fs.existsSync(options.cwd), true, "exit alone does not prove inherited pipes closed");
  child.stdout.write("codex-cli 0.167.0\n"); // late output is drained, never upgrades the verdict
  assert.equal(child.stdout.destroyed, false);
  child.emit("close", 0);
  assert.equal(fs.existsSync(options.cwd), false);
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: f.command })).reason, "unknown");
  assert.equal(f.calls.length, 1);
});

test("probe cleanup retains live concurrency slots until timed-out children close", async (t) => {
  const f = fixture(t);
  const originalSetTimeout = setTimeout;
  t.mock.method(global, "setTimeout", ((callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) =>
    originalSetTimeout(callback, delay === 3000 ? 5 : delay, ...args)) as typeof setTimeout);
  f.respond(() => undefined);
  const resolve = (n: number) => f.resolveCodexThreadUnloadCapability({ command: f.command, env: { ...f.env, CONTEXT: String(n) } });
  assert.ok((await Promise.all([0, 1, 2, 3].map(resolve))).every((v) => v.reason === "unknown"));
  assert.equal(f.kills.length, 4);
  assert.equal((await resolve(4)).reason, "unknown");
  assert.equal(f.calls.length, 4, "returning a timeout must not free a live process slot");
  assert.ok(f.calls.every(({ options }) => fs.existsSync(options.cwd)));
  f.calls[0].child.emit("close", null);
  f.respond(({ child }) => { child.stdout.write("codex-cli 0.167.0\n"); child.emit("close", 0); });
  assert.equal((await resolve(5)).supported, true);
  assert.equal(f.calls.length, 5);
  assert.equal(fs.existsSync(f.calls[0].options.cwd), false);
  assert.equal(fs.existsSync(f.calls[4].options.cwd), false);
  assert.ok(f.calls.slice(1, 4).every(({ options }) => fs.existsSync(options.cwd)));
});

test("probe uses only isolated HOME/workspace and safe environment, without configured arguments", async (t) => {
  const f = fixture(t);
  const capability = await f.resolveCodexThreadUnloadCapability({
    command: `"${f.command}"`, cwd: f.temp,
    env: { ...f.env, CODEX_HOME: "private-config", OPENAI_API_KEY: "private-key", NODE_OPTIONS: "private-preload" },
  });
  assert.equal(capability.supported, true);
  const call = f.calls[0];
  assert.equal(call.command, f.command);
  assert.deepEqual(call.args, ["--version"]);
  assert.notEqual(call.options.cwd, f.temp);
  assert.equal(call.options.env.HOME, call.options.cwd);
  assert.equal(call.options.env.CODEX_HOME, call.options.cwd);
  assert.equal(call.options.env.USERPROFILE, call.options.cwd);
  for (const key of ["OPENAI_API_KEY", "NODE_OPTIONS"]) { assert.equal(call.options.env[key], undefined); }
  assert.equal(JSON.stringify(call).includes("private-"), false);
});

test("unquoted paths containing spaces and Node script wrappers use the existing command splitting", async (t) => {
  const f = fixture(t);
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: f.command })).supported, true);
  const script = path.join(f.temp, "wrapper with spaces.cjs");
  fs.writeFileSync(script, "never executed");
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: `"${process.execPath}" "${script}"` })).supported, true);
  assert.deepEqual(f.calls[1].args, [script, "--version"]);
  fs.appendFileSync(script, "identity changed");
  await f.resolveCodexThreadUnloadCapability({ command: `"${process.execPath}" "${script}"` });
  assert.equal(f.calls.length, 3);
});

test("unsafe wrapper/configuration arguments and empty commands do not enter a probe", async (t) => {
  const f = fixture(t);
  for (const command of ["", " \t\n ", `"${f.command}" --profile private`, "npx --yes @openai/codex", `"${process.execPath}" --require private.js wrapper.js`]) {
    assert.deepEqual(await f.resolveCodexThreadUnloadCapability({ command, env: f.env }), { supported: false, reason: "unknown" });
  }
  assert.equal(f.calls.length, 0);
});

test("cache keys observe executable, cwd, PATH/PATHEXT, and environment context changes", async (t) => {
  const f = fixture(t);
  const input = { command: f.command, env: f.env, cwd: f.temp };
  const first = await f.resolveCodexThreadUnloadCapability(input);
  first.supported = false; // callers cannot mutate the cached verdict
  assert.equal((await f.resolveCodexThreadUnloadCapability(input)).supported, true);
  assert.equal(f.calls.length, 1);
  fs.appendFileSync(f.command, "new actual command identity");
  await f.resolveCodexThreadUnloadCapability(input);
  await f.resolveCodexThreadUnloadCapability({ ...input, cwd: path.dirname(f.temp) });
  await f.resolveCodexThreadUnloadCapability({ ...input, env: { ...f.env, PATH: "different" } });
  await f.resolveCodexThreadUnloadCapability({ ...input, env: { ...f.env, PATHEXT: ".CMD" } });
  await f.resolveCodexThreadUnloadCapability({ ...input, env: { ...f.env, CODEX_HOME: "other" } });
  assert.equal(f.calls.length, 6);
});

test("resolution honors supplied cwd and PATH instead of the host environment", async (t) => {
  const f = fixture(t);
  const executableName = process.platform === "win32" ? "custom-codex.CMD" : "custom-codex";
  const executable = path.join(f.temp, executableName);
  fs.writeFileSync(executable, "not executed");
  const env = { ...f.env, PATH: ".", PATHEXT: ".CMD" };
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: "custom-codex", cwd: f.temp, env })).supported, true);
  assert.equal(f.calls[0].command, executable);
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: `./${executableName}`, cwd: f.temp, env })).supported, true);
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: `~/${executableName}`, cwd: f.temp, env })).supported, true);
  assert.equal(f.calls[0].command, executable);
  assert.equal(f.calls.length, 1); // all three spellings resolve to the same executable identity
});

test("npm shim cache observes replacement of its native payload", async (t) => {
  const f = fixture(t);
  const triples: Record<string, string> = {
    "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc",
    "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl",
  };
  const payload = path.join(path.dirname(f.command), "node_modules", "@openai", "codex", "node_modules", "@openai",
    `codex-${process.platform}-${process.arch}`, "vendor", triples[`${process.platform}-${process.arch}`], "bin",
    process.platform === "win32" ? "codex.exe" : "codex");
  fs.mkdirSync(path.dirname(payload), { recursive: true }); fs.writeFileSync(payload, "old payload");
  await f.resolveCodexThreadUnloadCapability({ command: f.command });
  await f.resolveCodexThreadUnloadCapability({ command: f.command });
  fs.appendFileSync(payload, "replacement");
  await f.resolveCodexThreadUnloadCapability({ command: f.command });
  assert.equal(f.calls.length, 2);
});

test("concurrent identical probes deduplicate and distinct probes have a concurrency bound", async (t) => {
  const f = fixture(t);
  f.respond(() => undefined);
  const first = f.resolveCodexThreadUnloadCapability({ command: f.command, env: f.env });
  const duplicate = f.resolveCodexThreadUnloadCapability({ command: f.command, env: f.env });
  const rest = [1, 2, 3].map((n) => f.resolveCodexThreadUnloadCapability({ command: f.command, env: { ...f.env, CONTEXT: String(n) } }));
  assert.equal(f.calls.length, 4);
  assert.equal((await f.resolveCodexThreadUnloadCapability({ command: f.command, env: { ...f.env, CONTEXT: "fifth" } })).reason, "unknown");
  for (const { child } of f.calls) { child.stdout.write("codex-cli 0.167.0\n"); child.emit("close", 0); }
  const values = await Promise.all([first, duplicate, ...rest]);
  assert.ok(values.every((v) => v.supported));
  assert.equal(f.calls.length, 4);
});

test("cache expires after a bounded TTL and evicts least recently used entries at 64", async (t) => {
  const f = fixture(t);
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  const resolve = (index: number) => f.resolveCodexThreadUnloadCapability({ command: f.command, env: { ...f.env, CONTEXT: String(index) } });
  await resolve(0); await resolve(0);
  now += 60_001;
  await resolve(0);
  assert.equal(f.calls.length, 2);
  for (let i = 1; i < 64; i++) { await resolve(i); }
  await resolve(0); // refresh LRU
  await resolve(64); // evicts 1
  await resolve(0);
  assert.equal(f.calls.length, 66);
  await resolve(1);
  assert.equal(f.calls.length, 67);
});

test("macOS shell fallback preserves escaping but cannot confirm an unobserved executable identity", async (t) => {
  const f = fixture(t);
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "darwin" });
  t.after(() => Object.defineProperty(process, "platform", descriptor));
  const command = "missing-codex-capability-'quoted'";
  assert.deepEqual(await f.resolveCodexThreadUnloadCapability({ command, env: { HOME: f.temp, PATH: f.temp } }), {
    supported: false, reason: "unknown", version: "0.167.0",
  });
  assert.ok(["/bin/zsh", "/bin/bash"].includes(f.calls[0].command));
  assert.equal(f.calls[0].args[0], "-lc");
  assert.ok(f.calls[0].args[1].includes("'\"'\"'"));
});
