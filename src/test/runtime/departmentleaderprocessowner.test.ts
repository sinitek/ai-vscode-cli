import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DepartmentLeaderProcessOwner } from "../../runtime/departmentleaderprocessowner";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
import type { DepartmentLeaderProcessPreparation } from "../../runtime/departmentleaderprocesscontract";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("fixture-gate-timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-leader-process-owner-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const argsFile = path.join(directory, "args.jsonl"), scriptFile = path.join(directory, "opencode-fixture.cjs");
  fs.writeFileSync(scriptFile, `const fs=require('fs'),path=require('path');const args=process.argv.slice(2),prompt=args.at(-1);\n`
    + `fs.appendFileSync(${JSON.stringify(argsFile)},JSON.stringify(args)+'\\n');\n`
    + `if(prompt==='hold'){fs.writeFileSync(${JSON.stringify(path.join(directory, "started"))},'1');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(path.join(directory, "release"))})){clearInterval(timer);finish();}},5);}else finish();\n`
    + `function finish(){process.stdout.write('answer:'+prompt+'\\n');process.stderr.write('trace:'+prompt+'\\n');process.exitCode=prompt==='fail'?7:0;}\n`);
  const command = process.platform === "win32" ? path.join(directory, "opencode-fixture.cmd") : path.join(directory, "opencode-fixture");
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${scriptFile}" %*\r\n`
    : `#!/usr/bin/env node\n${fs.readFileSync(scriptFile, "utf8")}`);
  fs.chmodSync(command, 0o755);
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: "rev1",
    model: "provider/model", thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: directory, rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "owner", executionId: "execution", session: { state: "bound", id: "ses_fixture123" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const preparation: DepartmentLeaderProcessPreparation = { version: 1, token: "a".repeat(64), identity, selection,
    ownerDirectory: path.join(directory, "owner"), configurationDirectory: path.join(directory, "configuration"),
    launch: { command, baseArgs: ["run", "--format", "json"], cwd: directory, sessionId: "ses_fixture123",
      baseEnvironment: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT }, envOverrides: { LEADER_FIXTURE: "yes" } } };
  const output: string[] = [];
  let released = 0;
  const owner = new DepartmentLeaderProcessOwner(preparation, async () => {
    released++;
    return { runner: { status: "confirmed", evidence: "lease-released" }, executionRoot: { status: "confirmed", evidence: "root-removed" },
      links: { status: "confirmed", evidence: "links-removed" }, temp: { status: "not-applicable", reason: "no-owner-temp-overlay" },
      tab: { status: "confirmed", evidence: "tab-closed-readback" } };
  }, { onStdout: (chunk) => { output.push(chunk); }, onStderr: (chunk) => { output.push(chunk); } });
  return { owner, identity, preparation, argsFile, output, directory, get released() { return released; } };
}
const invocation = (invocationId: string, prompt: string) => ({ invocationId, prompt });
const gates = { authorize: async () => undefined, drainConsumers: async () => true };

test("OpenCode leader Owner serializes immutable invocations on one native session and closes the generation after drain", async (t) => {
  const h = fixture(t);
  const handle = await h.owner.launcher.launch(h.identity, async () => undefined);
  assert.equal(handle.kind, "process");
  const first = h.owner.invoke(invocation("main-1", "first"), undefined, gates);
  assert.equal(h.owner.invoke(invocation("main-1", "first"), undefined, gates), first);
  await assert.rejects(h.owner.invoke(invocation("main-1", "changed"), undefined, gates), /conflict/);
  assert.equal((await first).turnTerminal.status, "confirmed");
  const second = h.owner.invoke(invocation("main-2", "second"), undefined, gates);
  assert.equal((await second).streams.status, "confirmed");
  const lines = fs.readFileSync(h.argsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((args) => args.includes("--session") && args[args.indexOf("--session") + 1] === "ses_fixture123"));
  assert.match(h.output.join(""), /answer:first/); assert.match(h.output.join(""), /answer:second/);
  const cleanup = await h.owner.seal();
  assert.equal(cleanup.runner.status, "confirmed"); assert.equal(cleanup.tab.status, "confirmed");
  await assert.rejects(h.owner.invoke(invocation("main-3", "late"), undefined, gates), /closed/);
});

test("pre-grant cancellation prevents a child; a post-grant late abort does not revoke Owner execution", async (t) => {
  const h = fixture(t); const entered = deferred<void>(), grant = deferred<void>();
  const abort = new AbortController();
  const run = h.owner.invoke(invocation("main-cancel", "first"), abort.signal, { authorize: async () => { entered.resolve(); await grant.promise; }, drainConsumers: async () => true });
  await entered.promise; abort.abort(); grant.resolve();
  const cancelled = await run; assert.notEqual(cancelled.processTerminal.status, "confirmed");
  assert.equal(fs.existsSync(h.argsFile), false);
  await h.owner.seal();

  const second = fixture(t); const lateAbort = new AbortController();
  const started = second.owner.invoke(invocation("main-late", "hold"), lateAbort.signal, gates);
  await until(() => fs.existsSync(path.join(second.directory, "started")));
  lateAbort.abort();
  const closing = second.owner.seal();
  await assert.rejects(second.owner.invoke(invocation("main-next", "never"), undefined, gates), /closed/);
  fs.writeFileSync(path.join(second.directory, "release"), "1");
  assert.equal((await started).turnTerminal.status, "confirmed");
  assert.equal((await closing).runner.status, "confirmed");
});

test("nonzero and spawn failures preserve unknown generation cleanup", async (t) => {
  const h = fixture(t);
  const failed = await h.owner.invoke(invocation("main-failed", "fail"), undefined, gates);
  assert.equal(failed.processTerminal.status, "confirmed"); assert.notEqual(failed.turnTerminal.status, "confirmed");
  const cleanup = await h.owner.seal(); assert.notEqual(cleanup.runner.status, "confirmed"); assert.equal(h.released, 0);

  const broken = fixture(t);
  // A nonexistent launch command is a real spawn failure, not a fabricated successful terminal.
  const prep = broken.preparation;
  const failedOwner = new DepartmentLeaderProcessOwner({ ...prep, launch: { ...prep.launch, command: path.join(broken.directory, "missing-cli") } },
    async () => ({ runner: { status: "confirmed", evidence: "released" }, executionRoot: { status: "confirmed", evidence: "removed" },
      links: { status: "confirmed", evidence: "removed" }, temp: { status: "not-applicable", reason: "no-owner-temp-overlay" },
      tab: { status: "confirmed", evidence: "closed" } }), { onStdout() {}, onStderr() {} });
  const terminal = await failedOwner.invoke(invocation("main-spawn-failed", "run"), undefined, gates);
  assert.notEqual(terminal.turnTerminal.status, "confirmed");
  assert.notEqual((await failedOwner.seal()).runner.status, "confirmed");
});

test("preparation rejects every prebound session override form before the shared builder can preserve it", (t) => {
  const h = fixture(t);
  const forms = [
    ["--session", "ses_fixture123"], ["--session=ses_fixture123"], ["-s", "ses_fixture123"], ["-s=ses_fixture123"],
    ["--session", "ses_other123"], ["-s", "ses_other123"], ["--session=ses_fixture123", "-s", "ses_fixture123"],
  ];
  for (const baseArgs of forms) {
    assert.throws(() => new DepartmentLeaderProcessOwner({ ...h.preparation, launch: { ...h.preparation.launch, baseArgs } },
      async () => ({ runner: { status: "confirmed", evidence: "released" }, executionRoot: { status: "confirmed", evidence: "removed" },
        links: { status: "confirmed", evidence: "removed" }, temp: { status: "not-applicable", reason: "none" },
        tab: { status: "confirmed", evidence: "closed" } }), { onStdout() {}, onStderr() {} }), /preparation-invalid/);
  }
});
