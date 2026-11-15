"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { OWNER_TESTS, parseArgs, parseTapSummary, createSpawnTracker, observeSpawnedProcessTree, recoverTrackedChildren,
  terminateChild, run, spawnBounded, validateProduct } = require("./verify_department_platform");
const SOURCE_DIST_PAIRS = [
  ["src/runtime/departmentexecutionowner.ts", "dist/runtime/departmentexecutionowner.js"],
  ["src/runtime/departmentexecutionownerclient.ts", "dist/runtime/departmentexecutionownerclient.js"],
  ["src/runtime/departmentprocessexecutionlauncher.ts", "dist/runtime/departmentprocessexecutionlauncher.js"],
  ...OWNER_TESTS.map((name) => [`src/test/runtime/${name.replace(/\.js$/, ".ts")}`, `dist/test/runtime/${name}`]),
];

function fixture(t, label = "department product with spaces ") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const product = path.join(root, "isolated product");
  for (const [source, compiled] of SOURCE_DIST_PAIRS) {
    fs.mkdirSync(path.dirname(path.join(product, source)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(product, compiled)), { recursive: true });
  }
  fs.mkdirSync(path.join(product, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(product, "package.json"), "{}\n");
  for (const [source, compiled] of SOURCE_DIST_PAIRS) {
    fs.writeFileSync(path.join(product, source), `// ${source}\n`);
    if (compiled.startsWith("dist/test/")) fs.writeFileSync(path.join(product, compiled), "require('node:test').test('placeholder', () => {});\n");
    else fs.writeFileSync(path.join(product, compiled), "module.exports = {};\n");
  }
  const driver = path.join(product, "scripts/verify_department_full_eh_integration.js");
  fs.writeFileSync(driver, "process.exit(0);\n");
  return { root, product, driver, report: path.join(root, "report with spaces.json") };
}

function publicReport(overrides = {}) {
  return {
    result: "passed", forcedTeardown: false, failures: [],
    roles: { director: "codex", leader: "codex", employee: "codex" },
    stages: { prerequisites: "passed", emptyStore: "passed", extensionHost: "passed", publicUi: "passed", rootCreation: "observed",
      directorExecution: "completed", leaderExecution: "observed", ownerReceipts: "passed",
      capacityReturn: "passed", eventAcceptance: "passed", unifiedAcceptancePlan: "passed", directorReport: "passed" },
    ...overrides,
  };
}

function publicDriver(contents) {
  return `const fs=require('node:fs');const a=process.argv;const i=a.indexOf('--report');${contents}`;
}

function trackerFile(t, events) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-tracker-"));
  const file = path.join(directory, "events.jsonl");
  fs.writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return file;
}

test("strict CLI accepts only the three required explicit arguments", () => {
  const product = path.resolve(os.tmpdir(), "product with spaces"), report = path.resolve(os.tmpdir(), "new report.json");
  assert.deepEqual(parseArgs(["--product", product, "--report", report, "--scope", "owner-core"]), { product, report, scope: "owner-core" });
  for (const argv of [[], ["--product", product], ["--product", product, "--product", product, "--report", report, "--scope", "owner-core"],
    ["--product", product, "--report", report, "--scope", "owner-core", "--platform", "win32"],
    ["--product", "relative", "--report", report, "--scope", "owner-core"],
    ["--product", product, "--report", report, "--scope", "windows"]]) assert.throws(() => parseArgs(argv));
});

test("TAP summaries reject missing and duplicate counts", () => {
  const summary = ["# Subtest: one test", "# tests 1", "# pass 1", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"].join("\n");
  assert.equal(parseTapSummary(summary).complete, true);
  assert.equal(parseTapSummary(summary).unique, true);
  assert.equal(parseTapSummary(summary.replace("# todo 0", "")).complete, false);
  assert.equal(parseTapSummary(`${summary}\n# pass 1`).unique, false);
  const empty = summary.replace("# Subtest: one test", "# Subtest: /tmp/empty.test.js");
  assert.equal(parseTapSummary(empty, "/tmp/empty.test.js").registeredTests, 0);
  assert.equal(parseTapSummary(summary, "/tmp/truncated.test.js").fileSubtestOccurrences, 0);
  assert.equal(parseTapSummary(summary, "/tmp/real.test.js").registeredTests, 1);
});

test("process recovery requires an intact prepared tracker and never signals closed or changed identities", async (t) => {
  const root = trackerFile(t, [{ type: "tracker-ready", pid: 5 }, { type: "spawn", pid: 42, detached: true },
    { type: "process-observed", pid: 42, ppid: 5, started: "original" }]);
  let terminated = [];
  const result = await recoverTrackedChildren(root, { platform: "linux",
    snapshotProcesses: () => new Map([[42, { pid: 42, ppid: 1, started: "reused", stat: "S" }]]),
    terminateProcess: (pid) => terminated.push(pid) });
  assert.equal(result.treeCloseConfirmed, "unconfirmed");
  assert.deepEqual(terminated, []);

  fs.writeFileSync(root, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n{bad json}\n`);
  const corrupt = await recoverTrackedChildren(root, { platform: "linux", snapshotProcesses: () => new Map(), terminateProcess: (pid) => terminated.push(pid) });
  assert.equal(corrupt.trackerIntegrity, "invalid");
  assert.equal(corrupt.treeCloseConfirmed, "unconfirmed");

  fs.writeFileSync(root, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n${JSON.stringify({ type: "overflow" })}\n`);
  const overflow = await recoverTrackedChildren(root, { platform: "linux", snapshotProcesses: () => new Map(), terminateProcess: (pid) => terminated.push(pid) });
  assert.equal(overflow.trackerIntegrity, "overflow");
  assert.equal(overflow.treeCloseConfirmed, "unconfirmed");
  const errorFile = path.join(path.dirname(root), "events.error");
  fs.writeFileSync(errorFile, "EIO");
  const writeFailed = await recoverTrackedChildren(root, { platform: "linux", snapshotProcesses: () => new Map(), terminateProcess: (pid) => terminated.push(pid) });
  assert.equal(writeFailed.trackerIntegrity, "write-failed");
  assert.equal(writeFailed.treeCloseConfirmed, "unconfirmed");
  fs.rmSync(errorFile, { force: true });

  fs.writeFileSync(root, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n${JSON.stringify({ type: "spawn", pid: 42, detached: false })}\n${JSON.stringify({ type: "close", pid: 42, code: 0, signal: null })}\n${JSON.stringify({ type: "process-observed", pid: 42, ppid: 5, started: "original" })}\n`);
  const closed = await recoverTrackedChildren(root, { platform: "linux",
    snapshotProcesses: () => new Map([[42, { pid: 42, ppid: 5, started: "original", stat: "S" }]]),
    terminateProcess: (pid) => terminated.push(pid) });
  assert.deepEqual(terminated, []);
  assert.equal(closed.treeCloseConfirmed, "unconfirmed");
});

test("Windows recovery never upgrades an unverified PID and direct close does not prove the tree", async (t) => {
  const file = trackerFile(t, [{ type: "tracker-ready", pid: 5 }, { type: "spawn", pid: 42, detached: true },
    { type: "close", pid: 42, code: 0, signal: null }]);
  const result = await recoverTrackedChildren(file, { platform: "win32", terminateProcess: () => assert.fail("must not terminate PID") });
  assert.equal(result.trackedProcessesCloseConfirmed, true);
  assert.equal(result.treeCloseConfirmed, "unconfirmed");
  assert.match(result.recoveryUnconfirmedReason, /does not prove/);
  const missing = path.join(os.tmpdir(), `department-tracker-missing-${process.pid}-${Math.random()}`);
  const noTracker = await recoverTrackedChildren(missing, { platform: "win32", terminateProcess: () => assert.fail("must not terminate PID") });
  assert.equal(noTracker.trackerIntegrity, "missing");
  assert.equal(noTracker.treeCloseConfirmed, "unconfirmed");
  fs.writeFileSync(file, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n${JSON.stringify({ type: "spawn", pid: 42, detached: true })}\n`);
  const active = await recoverTrackedChildren(file, { platform: "win32", terminateProcess: () => assert.fail("must not terminate PID") });
  assert.equal(active.recoveryAttempted, false);
  assert.equal(active.treeCloseConfirmed, "unconfirmed");
});

test("real preload sidecar write failure remains unconfirmed after later complete parsing", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.driver, `const fs=require('node:fs');const cp=require('node:child_process');
const first=cp.spawn(process.execPath,['-e','']);
first.once('close',()=>{
  const original=fs.appendFileSync;
  fs.appendFileSync=function(file,...args){if(String(file).endsWith('events.jsonl'))throw Object.assign(new Error('controlled write failure'),{code:'EIO'});return original.call(this,file,...args);};
  const second=cp.spawn(process.execPath,['-e','']);
  second.once('close',()=>{fs.appendFileSync=original;setTimeout(()=>{},1100);});
});\n`);
  let tracker, observedFailure = false, finalParsedIntegrity, sidecarRecovery;
  const result = await spawnBounded([f.driver], 5000, { trackSpawnedChildren: true,
    createSpawnTracker: () => { tracker = createSpawnTracker(); return tracker; },
    observeSpawnedProcessTree: (eventFile, errorFile) => {
      assert.equal(errorFile, tracker.errorFile);
      const observed = observeSpawnedProcessTree(eventFile, errorFile);
      if (fs.existsSync(errorFile)) {
        assert.equal(path.basename(errorFile), "events.error");
        assert.equal(fs.existsSync(`${eventFile}.error`), false);
        assert.equal(fs.readFileSync(errorFile, "utf8"), "EIO");
        assert.equal(observed.integrity, "write-failed");
        sidecarRecovery = recoverTrackedChildren(eventFile, { errorFile });
        observedFailure = true;
        fs.rmSync(errorFile); // Repair the file to prove the earlier observation stays latched.
      }
      return observed;
    },
    recoverTrackedChildren: async (eventFile, settings) => {
      assert.equal(settings.errorFile, tracker.errorFile);
      const finalParsed = await recoverTrackedChildren(eventFile, { errorFile: settings.errorFile });
      finalParsedIntegrity = finalParsed.trackerIntegrity;
      return recoverTrackedChildren(eventFile, settings);
    } });
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(observedFailure, true);
  assert.equal((await sidecarRecovery).trackerIntegrity, "write-failed");
  assert.equal((await sidecarRecovery).treeCloseConfirmed, "unconfirmed");
  assert.equal(finalParsedIntegrity, "complete");
  assert.equal(result.cleanup.trackerIntegrity, "write-failed");
  assert.equal(result.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
  assert.equal(result.cleanup.trackedProcessesCloseConfirmed, "unconfirmed");
  assert.equal(fs.existsSync(tracker.directory), false);
});

test("preload fails closed when both the record and its actual sidecar cannot be written", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.driver, `const fs=require('node:fs');const cp=require('node:child_process');
const append=fs.appendFileSync;const write=fs.writeFileSync;
fs.appendFileSync=function(file,...args){if(String(file).endsWith('events.jsonl'))throw Object.assign(new Error('controlled'),{code:'EIO'});return append.call(this,file,...args);};
fs.writeFileSync=function(file,...args){if(String(file).endsWith('events.error'))throw Object.assign(new Error('controlled'),{code:'EIO'});return write.call(this,file,...args);};
cp.spawn(process.execPath,['-e','']);\n`);
  const result = await spawnBounded([f.driver], 5000, { trackSpawnedChildren: true });
  assert.equal(result.code, 74);
  assert.equal(result.cleanup.trackerIntegrity, "write-failed");
  assert.equal(result.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
  assert.match(result.stderr, /DEPARTMENT_PLATFORM_TRACKER_WRITE_FAILED/);
});

test("structurally invalid or incomplete records cannot prove zero spawn; prepared zero spawn can", async (t) => {
  const file = trackerFile(t, [{ type: "tracker-ready", pid: 5 }]);
  const ports = { snapshotProcesses: () => new Map(), terminateProcess: () => assert.fail("must not signal") };
  const zero = await recoverTrackedChildren(file, ports);
  assert.equal(zero.treeCloseConfirmed, process.platform === "win32" ? "unconfirmed" : true);
  for (const bad of [null, {}, [], { type: "unknown" }, { type: "spawn", pid: "42", detached: false },
    { type: "process-observed", pid: 42 }, { type: "tracker-ready", pid: "invalid" }]) {
    fs.writeFileSync(file, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n${JSON.stringify(bad)}\n`);
    const invalid = await recoverTrackedChildren(file, ports);
    assert.equal(invalid.trackerIntegrity, "invalid", JSON.stringify(bad));
    assert.equal(invalid.treeCloseConfirmed, "unconfirmed");
  }
  fs.writeFileSync(file, `${JSON.stringify({ type: "tracker-ready", pid: 5 })}\n${JSON.stringify({ type: "spawn-request", pid: 42, detached: false })}\n`);
  const incomplete = await recoverTrackedChildren(file, ports);
  assert.equal(incomplete.trackerIntegrity, "incomplete");
  assert.equal(incomplete.treeCloseConfirmed, "unconfirmed");
  fs.writeFileSync(file, JSON.stringify({ type: "tracker-ready", pid: 5 }));
  assert.equal((await recoverTrackedChildren(file, ports)).trackerIntegrity, "invalid");
});

test("driver termination rechecks launch identity and exit/close before each signal", async () => {
  const child = { pid: 42, exitCode: null, signalCode: null };
  const identity = { pid: 42, ppid: process.pid, pgid: 42, started: "original", stat: "S" };
  const freshState = () => ({ identity: { ...identity }, exitObserved: false, closeObserved: false });
  let signals = [], waits = 0, current = { ...identity };
  const ports = { platform: "linux", snapshotProcesses: () => new Map([[42, current]]),
    signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    waitForChildClose: async () => { waits += 1; current = { ...identity, started: "reused" }; return false; } };
  for (const state of [{ ...freshState(), exitObserved: true }, { ...freshState(), closeObserved: true },
    { ...freshState(), identity: null }]) {
    await terminateChild(child, state, ports);
    assert.deepEqual(signals, []);
  }
  await terminateChild({ ...child, exitCode: 0 }, freshState(), ports);
  await terminateChild({ ...child, signalCode: "SIGTERM" }, freshState(), ports);
  await terminateChild(child, freshState(), { ...ports, platform: "win32" });
  assert.deepEqual(signals, []);
  const changed = await terminateChild(child, freshState(), ports);
  assert.deepEqual(signals, [[42, "SIGTERM"]]);
  assert.equal(waits, 1);
  assert.equal(changed.forced, false);
  assert.equal(changed.status, "unconfirmed");
  assert.match(changed.reason, /changed/);

  for (const flag of ["exitObserved", "closeObserved"]) {
    const state = freshState();
    signals = []; current = { ...identity };
    await terminateChild(child, state, { ...ports, waitForChildClose: async () => { state[flag] = true; return false; } });
    assert.deepEqual(signals, [[42, "SIGTERM"]]);
  }
  const closing = freshState();
  signals = [];
  await terminateChild(child, closing, { ...ports, snapshotProcesses: () => { closing.closeObserved = true; return new Map([[42, identity]]); } });
  assert.deepEqual(signals, []);
  const normal = freshState();
  waits = 0; current = { ...identity };
  const completed = await terminateChild(child, normal, { ...ports, waitForChildClose: async () => {
    waits += 1; if (waits === 2) normal.closeObserved = true; return normal.closeObserved;
  } });
  assert.deepEqual(signals, [[42, "SIGTERM"], [42, "SIGKILL"]]);
  assert.equal(completed.forced, true);
  assert.equal(completed.status, "close-observed");
  assert.equal(waits, 2);
});

test("spawn wrapper passes its observed exit state to timeout termination before delayed close", async () => {
  const { EventEmitter } = require("node:events");
  const child = new EventEmitter();
  child.pid = 42; child.exitCode = null; child.signalCode = null;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const identity = { pid: 42, ppid: process.pid, pgid: 42, started: "original", stat: "S" };
  const result = await spawnBounded([], 20, { spawn: () => {
    queueMicrotask(() => { child.emit("spawn"); child.emit("exit", 0, null); });
    setTimeout(() => { child.exitCode = 0; child.emit("close", 0, null); }, 60);
    return child;
  }, terminationPorts: { snapshotProcesses: () => new Map([[42, identity]]),
    signalProcessGroup: () => assert.fail("must not signal an exited driver") } });
  assert.equal(result.timedOut, true);
  assert.equal(result.cleanup.driverExitObserved, true);
  assert.equal(result.cleanup.driverCloseObserved, true);
  assert.equal(result.cleanup.driverTermination.status, "not-attempted");
  assert.equal(result.forcedCleanup, false);
  for (const event of ["spawn", "exit", "error", "close"]) assert.equal(child.listenerCount(event), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
});

test("timeout and late close share one bounded cleanup; synchronous spawn failure resolves as failure", async (t) => {
  const script = path.join(os.tmpdir(), `department-platform-close-race-${process.pid}.js`);
  fs.writeFileSync(script, "setTimeout(() => process.exit(0), 80);\n");
  t.after(() => fs.rmSync(script, { force: true }));
  let recoveries = 0;
  const result = await spawnBounded([script], 10, { trackSpawnedChildren: true,
    terminateChild: async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return false; },
    recoverTrackedChildren: async () => { recoveries += 1; return { children: [], recoveryAttempted: false, forcedActions: [],
      trackerIntegrity: "complete", trackedProcessesCloseConfirmed: true, treeCloseConfirmed: true }; } });
  assert.equal(result.timedOut, true);
  assert.equal(result.cleanup.driverCloseObserved, true);
  assert.equal(recoveries, 1);

  const failed = await spawnBounded([script], 100, { spawn: () => { throw new Error("controlled spawn failure"); } });
  assert.match(failed.error, /controlled spawn failure/);
  assert.equal(failed.cleanup.driverCloseObserved, false);
  assert.equal(failed.cleanup.trackerIntegrity, "spawn-error");
});

test("owned handle release tolerates late errors and local close without changing process facts", async () => {
  const { EventEmitter } = require("node:events");
  const child = new EventEmitter();
  child.pid = 42; child.exitCode = null; child.signalCode = null;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  let unreferenced = false, callerErrors = 0;
  const callerListener = () => { callerErrors += 1; };
  child.on("error", callerListener);
  child.unref = () => { unreferenced = true; child.emit("error", new Error("late child error")); };
  for (const stream of [child.stdout, child.stderr]) stream.destroy = () => {
    stream.destroyed = true;
    stream.emit("error", new Error("late stream error"));
    stream.emit("close");
  };
  child.stderr.once("close", () => child.emit("close", null, null));
  const result = await spawnBounded([], 1, { spawn: () => child,
    terminationPorts: { snapshotProcesses: () => new Map(), signalProcessGroup: () => assert.fail("unverified PID") } });
  assert.equal(unreferenced, true);
  assert.equal(callerErrors, 1);
  assert.ok(child.listeners("error").includes(callerListener));
  assert.equal(result.timedOut, true);
  assert.equal(result.cleanup.driverExitObserved, false);
  assert.equal(result.cleanup.driverCloseObserved, false);
  assert.equal(result.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
  assert.deepEqual(result.cleanup.localHandleRelease, { status: "released", driverUnreferenced: true,
    stdoutDestroyed: true, stderrDestroyed: true, errors: [] });
  assert.equal(child.stdout.listenerCount("error"), 0);
  assert.equal(child.stderr.listenerCount("error"), 0);
  assert.equal(child.listenerCount("error"), 1);
});

test("stream errors before close are consumed and remain failures", async () => {
  const { EventEmitter } = require("node:events");
  const child = new EventEmitter();
  child.pid = 42; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const result = await spawnBounded([], 100, { spawn: () => {
    queueMicrotask(() => {
      child.stdout.emit("error", new Error("controlled read error"));
      child.stderr.emit("error", new Error("second read error"));
      child.emit("error", new Error("controlled child error"));
      child.emit("error", new Error("repeated child error"));
      child.emit("close", 0, null);
    });
    return child;
  } });
  assert.equal(result.code, 0);
  assert.equal(result.error, "repeated child error");
  assert.equal(result.cleanup.driverCloseObserved, true);
  assert.equal(result.cleanup.localHandleRelease.status, "not-needed-after-close");
  for (const emitter of [child, child.stdout, child.stderr]) assert.equal(emitter.listenerCount("error"), 0);
});

test("outer Node exits naturally when termination is refused or an exited driver leaves inherited pipes", { timeout: 18000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department natural exit with spaces "));
  const leases = [];
  const waitForLeases = async () => {
    const deadline = Date.now() + 8500;
    while (leases.some((file) => !fs.existsSync(file)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(leases.every((file) => fs.existsSync(file)), "self-expiring owned programs must exit");
  };
  t.after(async () => { await waitForLeases(); fs.rmSync(directory, { recursive: true, force: true }); });
  await Promise.all([false, true].map(async (inheritedPipes) => {
    const label = inheritedPipes ? "exited driver" : "live driver";
    const driver = path.join(directory, `${label}.js`);
    const done = path.join(directory, `${label}.lease-done`);
    const naturalExit = path.join(directory, `${label}.outer-exit`);
    leases.push(done);
    // Every owned program has its own finite lease even if the outer watchdog fails.
    const lease = `const fs=require('node:fs');process.on('exit',()=>fs.writeFileSync(${JSON.stringify(done)},'expired'));setTimeout(()=>{},6000);`;
    fs.writeFileSync(driver, inheritedPipes
      ? `const cp=require('node:child_process');const c=cp.spawn(process.execPath,['-e',${JSON.stringify(lease)}],{detached:process.platform!=='win32',stdio:['ignore','inherit','inherit']});c.unref();\n`
      : `${lease}\n`);
    const outer = path.join(directory, `${label}.outer.js`);
    fs.writeFileSync(outer, `const fs=require('node:fs');const {spawnBounded}=require(${JSON.stringify(path.join(__dirname, "verify_department_platform.js"))});
process.on('exit',()=>fs.writeFileSync(${JSON.stringify(naturalExit)},'natural'));
spawnBounded([${JSON.stringify(driver)}],150,{terminationPorts:{snapshotProcesses:()=>new Map(),signalProcessGroup:()=>{throw new Error('must not signal');}}})
 .then(result=>process.stdout.write(JSON.stringify(result)+'\\n'));\n`);
    const started = Date.now();
    const output = await new Promise((resolve, reject) => {
      cp.execFile(process.execPath, [outer], { timeout: 7000, maxBuffer: 64 * 1024, encoding: "utf8", windowsHide: true },
        (error, stdout, stderr) => error ? reject(new Error(`${label}: outer watchdog/error: ${error.message}; ${stderr}`)) : resolve({ stdout, stderr }));
    });
    const result = JSON.parse(output.stdout);
    assert.equal(output.stderr, "");
    assert.ok(Date.now() - started < 5500, "outer must exit before the owned lease expires");
    assert.equal(fs.readFileSync(naturalExit, "utf8"), "natural");
    assert.equal(fs.existsSync(done), false, "live child/pipe holder must still outlive outer exit");
    assert.equal(result.timedOut, true);
    assert.equal(result.forcedCleanup, false);
    assert.equal(result.cleanup.driverExitObserved, inheritedPipes);
    assert.equal(result.cleanup.driverCloseObserved, false);
    assert.equal(result.cleanup.driverTermination.attempted, false);
    assert.equal(result.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
    assert.deepEqual(result.cleanup.localHandleRelease, { status: "released", driverUnreferenced: true,
      stdoutDestroyed: true, stderrDestroyed: true, errors: [] });
  }));
  await waitForLeases();
});

test("product validation rejects shared, linked, escaping, incomplete, and stale paths", (t) => {
  const f = fixture(t);
  assert.throws(() => validateProduct(path.resolve(__dirname, "..")), /isolated copy/);
  const linkedSrc = path.join(f.root, "linked-src-product");
  fs.mkdirSync(linkedSrc);
  fs.symlinkSync(path.join(f.product, "src"), path.join(linkedSrc, "src"), process.platform === "win32" ? "junction" : "dir");
  fs.mkdirSync(path.join(linkedSrc, "dist"));
  assert.throws(() => validateProduct(linkedSrc), /physical directory/);
  fs.rmSync(path.join(f.product, "dist/test/runtime", OWNER_TESTS[0]));
  assert.throws(() => validateProduct(f.product), /compiled artifact/);
  assert.ok(fs.existsSync(f.report) === false);
});

test("owner-core spawns argv directly with a whitespace path and consumes a non-empty passing TAP suite", async (t) => {
  const f = fixture(t);
  for (const name of OWNER_TESTS) fs.writeFileSync(path.join(f.product, "dist/test/runtime", name),
    "const test=require('node:test');test('one controlled test',()=>{});\n");
  const result = await run({ product: f.product, report: f.report, scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "passed", JSON.stringify(result));
  assert.equal(result.tests.length, OWNER_TESTS.length);
  assert.ok(result.tests.every((entry) => entry.tests.tests === 1 && entry.result === "passed"));
  assert.ok(result.execution.cleanup.ownerTestProcesses.every((entry) => entry.closeObserved));
  assert.deepEqual(result.execution.argv[0].slice(1, 3), ["--test", "--test-reporter=tap"]);
  assert.ok(result.entry.realpath.endsWith("verify_department_platform.js"));
  assert.equal(result.sourceDistEvidence.length, SOURCE_DIST_PAIRS.length);
});

test("owner-core rejects nonzero, zero-test, and skipped subprocess results", async (t) => {
  const f = fixture(t);
  const files = OWNER_TESTS.map((name) => path.join(f.product, "dist/test/runtime", name));
  fs.writeFileSync(files[0], "require('node:test').test('intentional failure',()=>require('node:assert/strict').fail('fixture'));\n");
  let result = await run({ product: f.product, report: f.report, scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed", JSON.stringify(result));
  assert.ok(result.tests.some((entry) => entry.exitCode === 1));

  for (const file of files) fs.writeFileSync(file, "// no tests\n");
  result = await run({ product: f.product, report: path.join(f.root, "zero.json"), scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.ok(result.tests.every((entry) => entry.tests.registeredTests === 0));

  fs.writeFileSync(files[0], "require('node:test').test('one controlled test',()=>{});\n");
  result = await run({ product: f.product, report: path.join(f.root, "mixed.json"), scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.deepEqual(result.tests.map((entry) => entry.tests.registeredTests), [1, 0, 0]);

  fs.writeFileSync(files[0], "require('node:test').test('skip', {skip:true}, () => {});\n");
  result = await run({ product: f.product, report: path.join(f.root, "skip.json"), scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.ok(result.tests[0].tests.skipped > 0);

  fs.writeFileSync(files[0], "const test=require('node:test');test('parent',{timeout:50},async t=>{await t.test('hanging child',async()=>new Promise(()=>{}));});\n");
  result = await run({ product: f.product, report: path.join(f.root, "cancelled.json"), scope: "owner-core" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.ok(result.tests[0].tests.cancelled > 0, JSON.stringify(result.tests[0]));
});

test("public-codex consumes only a complete all-Codex child report", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.driver, publicDriver(`const r=JSON.parse(process.env.FIXTURE_REPORT);const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');const driver=fs.realpathSync(__filename);r.scenarioName='new-root';r.driverExecution={executedPath:driver,executedSha256:hash,productPath:driver,productSha256:hash};fs.writeFileSync(a[i+1],JSON.stringify(r));`));
  const previous = process.env.FIXTURE_REPORT;
  process.env.FIXTURE_REPORT = JSON.stringify(publicReport());
  t.after(() => { if (previous === undefined) delete process.env.FIXTURE_REPORT; else process.env.FIXTURE_REPORT = previous; });
  const result = await run({ product: f.product, report: f.report, scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "passed");
  assert.equal(result.execution.argv[1], fs.realpathSync(f.driver));
  assert.equal(result.coverageGates.publicEh, "passed");
  assert.equal(result.coverageGates.realTabAndRootCleanup, "not-covered");
  assert.equal(result.execution.cleanup.detachedTreeCloseConfirmed, true);
  assert.equal(result.publicEhSummary.stages.directorExecution, "completed");
});

test("public-codex rejects missing, failed, or incomplete reports even after exit zero", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.driver, "process.exit(7);\n");
  let result = await run({ product: f.product, report: f.report, scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.equal(result.execution.exitCode, 7);

  fs.writeFileSync(f.driver, "process.kill(process.pid, 'SIGTERM');\n");
  result = await run({ product: f.product, report: path.join(f.root, "signal.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.ok(result.execution.signal || result.execution.error);

  fs.writeFileSync(f.driver, "process.exit(0);\n");
  result = await run({ product: f.product, report: path.join(f.root, "missing.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.match(result.childReportError, /missing/);

  fs.writeFileSync(f.driver, publicDriver(`fs.writeFileSync(a[i+1],JSON.stringify(${JSON.stringify(publicReport({ result: "failed" }))}));`));
  result = await run({ product: f.product, report: path.join(f.root, "failed.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.match(result.childReportError, /successful result/);

  const wrongStage = publicReport();
  wrongStage.stages.directorExecution = "passed";
  fs.writeFileSync(f.driver, publicDriver(`const r=${JSON.stringify(wrongStage)};const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');const driver=fs.realpathSync(__filename);r.scenarioName='new-root';r.driverExecution={executedPath:driver,executedSha256:hash,productPath:driver,productSha256:hash};fs.writeFileSync(a[i+1],JSON.stringify(r));`));
  result = await run({ product: f.product, report: path.join(f.root, "wrong-stage.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.match(result.childReportError, /directorExecution/);

  const missingStage = publicReport();
  delete missingStage.stages.ownerReceipts;
  fs.writeFileSync(f.driver, publicDriver(`const r=${JSON.stringify(missingStage)};const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');const driver=fs.realpathSync(__filename);r.scenarioName='new-root';r.driverExecution={executedPath:driver,executedSha256:hash,productPath:driver,productSha256:hash};fs.writeFileSync(a[i+1],JSON.stringify(r));`));
  result = await run({ product: f.product, report: path.join(f.root, "missing-stage.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.match(result.childReportError, /ownerReceipts/);

  const wrongHash = publicReport();
  fs.writeFileSync(f.driver, publicDriver(`const r=${JSON.stringify(wrongHash)};r.scenarioName='new-root';r.driverExecution={executedPath:__filename,executedSha256:'wrong',productPath:__filename,productSha256:'wrong'};fs.writeFileSync(a[i+1],JSON.stringify(r));`));
  result = await run({ product: f.product, report: path.join(f.root, "wrong-hash.json"), scope: "public-codex" }, { timeoutMs: 5000 });
  assert.equal(result.result, "failed");
  assert.match(result.childReportError, /identify the default/);
});

test("timed out child is terminated and cannot be promoted to a pass", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.driver, "setInterval(() => {}, 1000);\n");
  const result = await run({ product: f.product, report: f.report, scope: "public-codex" }, { timeoutMs: 100 });
  assert.equal(result.result, "failed");
  assert.equal(result.execution.timedOut, true);
  assert.equal(result.execution.cleanup.driverCloseObserved, true);
  assert.notEqual(result.execution.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
  assert.notEqual(result.coverageGates.publicEh, "passed");
  if (process.platform !== "win32") {
    fs.writeFileSync(f.driver, "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n");
    const forced = await run({ product: f.product, report: path.join(f.root, "forced.json"), scope: "public-codex" }, { timeoutMs: 100 });
    assert.equal(forced.result, "failed");
    assert.equal(forced.execution.forcedCleanup, true);
    assert.ok(forced.execution.cleanup.forcedActions.some((entry) => entry.action.includes("force")));
  }
});

test("timeout observes and recovers only a recorded detached descendant", { skip: process.platform === "win32" }, async (t) => {
  const f = fixture(t);
  const marker = path.join(f.root, "descendant.pid");
  fs.writeFileSync(f.driver, `const cp=require('node:child_process');const fs=require('node:fs');const child=cp.spawn(process.execPath,['-e',\"setInterval(()=>{},1000)\"],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));setInterval(()=>{},1000);\n`);
  const result = await run({ product: f.product, report: f.report, scope: "public-codex" }, { timeoutMs: 350 });
  assert.equal(result.result, "failed");
  assert.equal(result.execution.timedOut, true);
  assert.equal(result.execution.cleanup.driverCloseObserved, true);
  assert.equal(result.execution.cleanup.recoveryAttempted, true, JSON.stringify(result.execution.cleanup));
  assert.equal(result.execution.cleanup.trackedProcessesCloseConfirmed, true, JSON.stringify(result.execution.cleanup));
  assert.equal(result.execution.cleanup.detachedTreeCloseConfirmed, "unconfirmed");
  const descendantPid = Number(fs.readFileSync(marker, "utf8"));
  assert.ok(result.execution.cleanup.detachedChildren.some((entry) => entry.pid === descendantPid && entry.detached));
  assert.ok(result.execution.cleanup.detachedChildren.find((entry) => entry.pid === descendantPid)?.closeObserved === false);
  assert.ok(result.execution.cleanup.forcedActions.every((entry) => Number.isInteger(entry.pid) && entry.action.startsWith("kill-")));
});

test("an existing public child report is rejected", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "report with spaces.public-eh-child.json"), "{}\n");
  await assert.rejects(run({ product: f.product, report: f.report, scope: "public-codex" }, { timeoutMs: 5000 }), /already exists/);
});

test("CLI refuses to overwrite an existing primary report", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.report, "keep-existing\n");
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, "verify_department_platform.js"), "--product", f.product,
    "--report", f.report, "--scope", "owner-core"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(fs.readFileSync(f.report, "utf8"), "keep-existing\n");
});
