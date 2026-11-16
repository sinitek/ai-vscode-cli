import test = require("node:test");
import assert = require("node:assert/strict");
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as path from "path";
import * as fs from "fs";
import { observeChildProcessLifecycle } from "../../cli/processLifecycle";
import { installVscodeMock } from "../vscodeMock";

const fixture = path.join(__dirname, "fixtures", "processLifecycleWorker.js");

test("process facts wait beyond exit for real inherited stdout/stderr tails", { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [fixture, "parent"], { stdio: ["pipe", "pipe", "pipe"] });
  const facts = observeChildProcessLifecycle(child);
  child.stdin.end();
  const stdout: string[] = [], stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  let settled = false;
  void facts.then(() => { settled = true; });
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  assert.equal(settled, false);
  const result = await facts;
  assert.equal(result.processTerminal.status, "confirmed");
  assert.equal(result.streams.status, "confirmed");
  assert.deepEqual(stdout, ["late-stdout\n"]);
  assert.deepEqual(stderr, ["late-stderr\n"]);
});

test("process facts never use error or exit alone and reject truncated owned streams", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const facts = observeChildProcessLifecycle(child as unknown as ChildProcess);
  child.emit("spawn");
  child.emit("error", new Error("signal request failed"));
  child.emit("exit", 0, null);
  let settled = false;
  void facts.then(() => { settled = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
  await new Promise<void>((resolve) => setImmediate(resolve));
  child.emit("close", 0, null);
  const result = await facts;
  assert.equal(result.processTerminal.status, "confirmed");
  assert.equal(result.streams.status, "unobservable");
});

test("process facts do not claim spawn failures are observed terminal executions", { timeout: 5000 }, async () => {
  const child = spawn(path.join(__dirname, "does-not-exist", "fixture"));
  const facts = await observeChildProcessLifecycle(child);
  assert.equal(facts.processTerminal.status, "unobservable");
});

for (const mode of ["normal", "failure"]) {
  test(`production commandRunner exposes actual close/drain for ${mode} Node fixture`, { timeout: 5000 }, async () => {
    installVscodeMock();
    const { runCliStream } = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");
    const output: string[] = [];
    const errors: Error[] = [];
    let code: number | null | undefined;
    const handle = runCliStream("codex", "", { onStdout: (chunk) => output.push(chunk), onStderr: () => {},
      onExit: (value) => { code = value; }, onError: (error) => errors.push(error) },
    { commandOverride: process.execPath, argsOverride: [fixture, mode] });
    assert.ok(handle.lifecycle);
    const facts = await handle.lifecycle;
    assert.deepEqual(errors, []);
    assert.equal(code, mode === "failure" ? 7 : 0);
    assert.equal(facts.processTerminal.status, "confirmed");
    assert.equal(facts.streams.status, "confirmed");
    assert.equal(facts.temp.status, "not-applicable");
    assert.deepEqual(output, ["fixture-stdout\n"]);
  });
}

for (const mode of ["overlay", "overlay-block"]) {
  test(`production commandRunner retains the actual ${mode} cleanup result`, { timeout: 5000 }, async (t) => {
    installVscodeMock();
    const { runCliStream } = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");
    let output = "";
    const handle = runCliStream("opencode", "", { onStdout: (chunk) => { output += chunk; }, onStderr: () => {},
      onExit: () => {}, onError: (error) => { throw error; } }, { commandOverride: process.execPath,
      argsOverride: [fixture, mode], model: "fixture/model", openCodeConfigContent: JSON.stringify({
        model: "fixture/model", provider: { fixture: { models: { model: {} } } },
      }) });
    const facts = await handle.lifecycle!;
    const root = (JSON.parse(output) as { root: string }).root;
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(facts.processTerminal.status, "confirmed");
    assert.equal(facts.streams.status, "confirmed");
    assert.equal(facts.temp.status, mode === "overlay" ? "confirmed" : "failed");
    assert.equal(fs.existsSync(root), mode !== "overlay");
  });
}
