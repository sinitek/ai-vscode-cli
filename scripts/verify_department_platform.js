#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const OWNER_TESTS = [
  "departmentexecutionowner.test.js",
  "departmentexecutionownerclient.test.js",
  "departmentprocessexecutionlauncher.test.js",
];
const SOURCE_DIST_PAIRS = [
  ["src/runtime/departmentexecutionowner.ts", "dist/runtime/departmentexecutionowner.js"],
  ["src/runtime/departmentexecutionownerclient.ts", "dist/runtime/departmentexecutionownerclient.js"],
  ["src/runtime/departmentprocessexecutionlauncher.ts", "dist/runtime/departmentprocessexecutionlauncher.js"],
  ...OWNER_TESTS.map((name) => [`src/test/runtime/${name.replace(/\.js$/, ".ts")}`, `dist/test/runtime/${name}`]),
];
const MAX_DIAGNOSTIC = 24 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const PUBLIC_CODEX_SCENARIO = "loop-plus";

function parseArgs(argv) {
  const values = {};
  const accepted = new Set(["--product", "--report", "--scope"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!accepted.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (Object.hasOwn(values, flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${flag}`);
    values[flag] = value;
    index += 1;
  }
  for (const flag of accepted) if (!values[flag]) throw new Error(`Missing required argument: ${flag}`);
  if (!new Set(["owner-core", "public-codex"]).has(values["--scope"])) throw new Error("Unknown scope");
  for (const flag of ["--product", "--report"]) {
    if (!path.isAbsolute(values[flag])) throw new Error(`${flag} must be an absolute path on this platform`);
  }
  return { product: path.normalize(values["--product"]), report: path.normalize(values["--report"]), scope: values["--scope"] };
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function requirePhysicalDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a physical directory`);
  return fs.realpathSync(directory);
}

function validateProduct(productPath, repoRoot = path.resolve(__dirname, "..")) {
  if (!path.isAbsolute(productPath)) throw new Error("Product path must be absolute");
  const product = requirePhysicalDirectory(productPath, "Product");
  const repository = fs.realpathSync(repoRoot);
  if (isWithin(repository, product) || isWithin(product, repository)) throw new Error("Product must be a physically isolated copy outside the shared repository");
  for (const name of ["src", "dist"]) {
    const real = requirePhysicalDirectory(path.join(product, name), `Product ${name}`);
    if (!isWithin(product, real)) throw new Error(`Product ${name} escapes product root`);
  }
  const packagePath = path.join(product, "package.json");
  if (!fs.statSync(packagePath).isFile() || !isWithin(product, fs.realpathSync(packagePath))) throw new Error("Product package.json is missing or escapes product root");
  const sourceDist = SOURCE_DIST_PAIRS.map(([sourceName, compiledName]) => {
    const source = path.join(product, sourceName);
    const compiled = path.join(product, compiledName);
    for (const [file, label] of [[source, "source file"], [compiled, "compiled artifact"]]) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !isWithin(product, fs.realpathSync(file))) {
        throw new Error(`Missing or escaping ${label}: ${path.relative(product, file)}`);
      }
    }
    return { source: path.relative(product, source), sourceSha256: hashFile(source), compiled: path.relative(product, compiled), compiledSha256: hashFile(compiled) };
  });
  const publicDriver = path.join(product, "scripts/verify_department_full_eh_integration.js");
  if (!fs.existsSync(publicDriver) || !fs.statSync(publicDriver).isFile() || !isWithin(product, fs.realpathSync(publicDriver))) {
    throw new Error("Product public Codex EH driver is missing or escapes product root");
  }
  return { product, sourceDist, publicDriver: { path: fs.realpathSync(publicDriver), sha256: hashFile(publicDriver) } };
}

function addBounded(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length <= MAX_DIAGNOSTIC ? next : next.slice(next.length - MAX_DIAGNOSTIC);
}

function createSpawnTracker() {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "department-platform-spawn-"));
  const eventFile = path.join(directory, "events.jsonl");
  const errorFile = path.join(directory, "events.error");
  const preload = path.join(directory, "track-spawns.cjs");
  fs.writeFileSync(preload, [
    "const fs=require('node:fs');const cp=require('node:child_process');",
    "const parent=Number(process.env.DEPARTMENT_PLATFORM_TRACKER_PARENT_PID);const file=process.env.DEPARTMENT_PLATFORM_TRACKER_FILE;const errorFile=process.env.DEPARTMENT_PLATFORM_TRACKER_ERROR_FILE;",
    "if(parent&&file){",
    "const append=(event)=>{try{const stat=fs.existsSync(file)?fs.statSync(file):null;if((stat?.size||0)>=262144){if(!globalThis.__departmentTrackerOverflow){globalThis.__departmentTrackerOverflow=true;fs.appendFileSync(file,JSON.stringify({type:'overflow'})+'\\n');}return;}fs.appendFileSync(file,JSON.stringify(event)+'\\n');}catch(error){try{fs.writeFileSync(errorFile,String(error.code||'write-failed'));}catch{try{fs.writeSync(2,'DEPARTMENT_PLATFORM_TRACKER_WRITE_FAILED\\n');}finally{process.exit(74);}}}};",
    "append(process.ppid===parent?{type:'tracker-ready',pid:process.pid}:{type:'tracker-attached',pid:process.pid,ppid:process.ppid});",
    "const originalSpawn=cp.spawn;const originalFork=cp.fork;let forkDepth=0;const watch=(child,options,source)=>{const base={pid:child.pid||null,detached:options?.detached===true,source};append({type:'spawn-request',...base});child.once('spawn',()=>append({type:'spawn',pid:child.pid,detached:base.detached,source}));child.once('error',error=>append({type:'error',pid:child.pid||null,detached:base.detached,source,error:error.code||'spawn-error'}));child.once('close',(code,signal)=>append({type:'close',pid:child.pid||null,detached:base.detached,source,code,signal}));return child;};",
    "cp.spawn=function(){const argv=Array.from(arguments);const options=Array.isArray(argv[1])?argv[2]:argv[1];const child=Reflect.apply(originalSpawn,this,argv);return forkDepth?child:watch(child,options,'spawn');};",
    "cp.fork=function(){const argv=Array.from(arguments);const options=Array.isArray(argv[1])?argv[2]:argv[1];let child;forkDepth++;try{child=Reflect.apply(originalFork,this,argv);}finally{forkDepth--;}return watch(child,options,'fork');};}",
  ].join("\n"));
  return { directory, eventFile, errorFile, preload };
}

function validSpawnEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") return false;
  if (event.type === "tracker-ready") return Number.isInteger(event.pid) && event.pid > 0;
  if (event.type === "tracker-attached") return Number.isInteger(event.pid) && event.pid > 0 && Number.isInteger(event.ppid) && event.ppid > 0;
  if (event.type === "overflow") return true;
  if (event.type === "spawn-request") return (event.pid === null || (Number.isInteger(event.pid) && event.pid > 0))
    && (event.source === undefined || event.source === "spawn" || event.source === "fork");
  if (event.type === "spawn") return Number.isInteger(event.pid) && event.pid > 0 && typeof event.detached === "boolean"
    && (event.source === undefined || event.source === "spawn" || event.source === "fork");
  if (event.type === "close") return (event.pid === null || (Number.isInteger(event.pid) && event.pid > 0))
    && (event.code === null || Number.isInteger(event.code)) && (event.signal === null || typeof event.signal === "string")
    && (event.source === undefined || event.source === "spawn" || event.source === "fork");
  if (event.type === "error") return (event.pid === null || (Number.isInteger(event.pid) && event.pid > 0)) && typeof event.error === "string"
    && (event.source === undefined || event.source === "spawn" || event.source === "fork");
  if (event.type === "process-observed") return Number.isInteger(event.pid) && event.pid > 0
    && Number.isInteger(event.ppid) && event.ppid > 0 && typeof event.started === "string" && event.started.length > 0;
  return false;
}

function trackerWriteFailed(errorFile) {
  try { return Boolean(errorFile && fs.existsSync(errorFile)); } catch { return true; }
}

function markTrackerWriteFailure(errorFile) {
  try { fs.writeFileSync(errorFile, "write-failed", { flag: "wx" }); } catch { /* preserve the existing marker or report unconfirmed */ }
}

function readSpawnEvents(file, errorFile = path.join(path.dirname(file), "events.error")) {
  if (!file || !fs.existsSync(file)) return { events: [], integrity: "missing" };
  let contents;
  try {
    if (fs.statSync(file).size > 262144) return { events: [], integrity: "overflow" };
    contents = fs.readFileSync(file, "utf8");
  } catch { return { events: [], integrity: "unreadable" }; }
  if (contents.length > 262144) return { events: [], integrity: "overflow" };
  const events = [];
  let invalid = false;
  for (const line of contents.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (!validSpawnEvent(event)) invalid = true;
      else events.push(event);
    } catch { invalid = true; }
  }
  if (trackerWriteFailed(errorFile)) return { events, integrity: "write-failed" };
  if (events.some((event) => event.type === "overflow")) return { events, integrity: "overflow" };
  if (invalid || !contents.endsWith("\n")) return { events, integrity: "invalid" };
  if (!events.some((event) => event.type === "tracker-ready")) return { events, integrity: "not-ready" };
  if (events[0]?.type !== "tracker-ready" || events.filter((event) => event.type === "tracker-ready").length !== 1) return { events, integrity: "invalid" };
  if (events.filter((event) => event.type === "spawn-request").length > events.filter((event) => ["spawn", "error"].includes(event.type)).length)
    return { events, integrity: "incomplete" };
  if (events.some((event) => event.type === "error")) return { events, integrity: "spawn-error" };
  return { events, integrity: "complete" };
}

function snapshotProcesses() {
  if (process.platform === "win32") return null;
  const result = cp.spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,lstart=,stat="], { encoding: "utf8", timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  const processes = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+(\S+)\s*$/);
    if (match) processes.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), started: match[4], stat: match[5] });
  }
  return processes;
}

function descendantProcesses(roots, processes) {
  const selected = new Map();
  const frontier = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes.values()) {
      if ((frontier.has(process.ppid) || roots.has(process.pid)) && !selected.has(process.pid)) {
        selected.set(process.pid, process);
        frontier.add(process.pid);
        changed = true;
      }
    }
  }
  return selected;
}

function sameLiveProcess(processes, pid, identity) {
  const current = processes.get(pid);
  return current?.started === identity.started && !/^Z/.test(current.stat || "");
}

function trackedChildren(events) {
  const children = new Map();
  for (const event of events) {
    if (!["spawn-request", "spawn", "close", "error"].includes(event.type)) continue;
    if (!Number.isInteger(event.pid)) continue;
    const current = children.get(event.pid) || { pid: event.pid, detached: event.detached === true, source: event.source || "spawn",
      spawnObserved: false, closeObserved: false, closeBySnapshotObserved: false };
    current.detached ||= event.detached === true;
    if (event.type === "spawn") current.spawnObserved = true;
    if (event.type === "close") { current.closeObserved = true; current.exitCode = event.code; current.signal = event.signal; }
    if (event.type === "error") current.spawnError = event.error;
    children.set(event.pid, current);
  }
  return [...children.values()];
}

function processObservations(events) {
  const processes = new Map();
  for (const event of events) if (event.type === "process-observed" && Number.isInteger(event.pid) && event.started) {
    processes.set(event.pid, { pid: event.pid, ppid: event.ppid, started: event.started });
  }
  return processes;
}

function observeSpawnedProcessTree(eventFile, errorFile = path.join(path.dirname(eventFile), "events.error"), ports = {}) {
  const { events, integrity } = readSpawnEvents(eventFile, errorFile);
  if (integrity !== "complete") return { available: false, count: 0, integrity };
  const processes = (ports.snapshotProcesses || snapshotProcesses)();
  if (!processes) return { available: false, count: 0, integrity: "snapshot-unavailable" };
  const known = processObservations(events);
  const trackerParentPid = events.find((event) => event.type === "tracker-ready")?.pid;
  const roots = new Set(trackedChildren(events).filter((child) => {
    if (!child.spawnObserved || child.closeObserved) return false;
    if (known.has(child.pid)) return sameLiveProcess(processes, child.pid, known.get(child.pid));
    return Number.isInteger(trackerParentPid) && processes.has(trackerParentPid) && processes.get(child.pid)?.ppid === trackerParentPid;
  }).map((child) => child.pid));
  if (!roots.size) return { available: true, count: processObservations(events).size, integrity };
  const observed = descendantProcesses(roots, processes);
  for (const [pid, identity] of observed) if (!known.has(pid)) {
    known.set(pid, identity);
    try {
      if (fs.statSync(eventFile).size < 262144) fs.appendFileSync(eventFile, JSON.stringify({ type: "process-observed", pid, ppid: identity.ppid, started: identity.started }) + "\n");
      else { markTrackerWriteFailure(errorFile); return { available: false, count: known.size, integrity: "overflow" }; }
    } catch { markTrackerWriteFailure(errorFile); return { available: false, count: known.size, integrity: "write-failed" }; }
  }
  return { available: true, count: known.size, integrity: trackerWriteFailed(errorFile) ? "write-failed" : integrity };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function recoverTrackedChildren(eventFile, settings = {}) {
  const platform = settings.platform || process.platform;
  const snapshot = settings.snapshotProcesses || snapshotProcesses;
  const terminate = settings.terminateProcess || ((pid, signal) => process.kill(pid, signal));
  const errorFile = settings.errorFile || path.join(path.dirname(eventFile), "events.error");
  let integrityFailure = settings.integrityFailure || null;
  const readTracker = () => {
    const parsed = readSpawnEvents(eventFile, errorFile);
    if (parsed.integrity !== "complete") integrityFailure ||= parsed.integrity;
    return { events: parsed.events, integrity: integrityFailure || parsed.integrity };
  };
  const { events, integrity } = readTracker();
  const children = trackedChildren(events);
  const active = children.filter((child) => child.spawnObserved && !child.closeObserved);
  const trackerReady = integrity === "complete";
  if (!trackerReady) return { children, recoveryAttempted: false, forcedActions: [], trackerIntegrity: integrity,
    trackedProcessesCloseConfirmed: "unconfirmed", treeCloseConfirmed: "unconfirmed" };
  if (platform === "win32") return { children, recoveryAttempted: false, forcedActions: [], trackerIntegrity: integrity,
    trackedProcessesCloseConfirmed: children.every((child) => child.closeObserved || child.spawnError) ? true : "unconfirmed",
    treeCloseConfirmed: "unconfirmed", recoveryUnconfirmedReason: active.length ? "Windows process identity is unavailable; termination was not attempted" : "Windows tracker does not prove detached descendants closed" };
  if (!children.length) return { children, recoveryAttempted: false, forcedActions: [], trackerIntegrity: integrity,
    trackedProcessesCloseConfirmed: true, treeCloseConfirmed: "unconfirmed",
    recoveryUnconfirmedReason: "no direct child events do not prove Node test-runner workers or arbitrary descendants were absent", observedProcessCount: 0 };
  const forcedActions = [];
  let processes = snapshot();
  if (!processes) return { children, recoveryAttempted: false, forcedActions, trackerIntegrity: integrity,
    trackedProcessesCloseConfirmed: "unconfirmed", treeCloseConfirmed: "unconfirmed", processSnapshot: "unavailable" };
  const known = processObservations(events);
  for (const child of children) if (child.closeObserved) known.delete(child.pid);
  // Never discover descendants by reusing a root PID after its original process has exited.
  for (const child of active) {
    if (!processes.has(child.pid)) {
      child.closeBySnapshotObserved = true;
      continue;
    }
    if (!known.has(child.pid) || !sameLiveProcess(processes, child.pid, known.get(child.pid)))
      return { children, recoveryAttempted: false, forcedActions, trackerIntegrity: integrity, trackedProcessesCloseConfirmed: "unconfirmed",
        treeCloseConfirmed: "unconfirmed", recoveryUnconfirmedReason: "active child identity unavailable or changed" };
  }
  const signalKnown = (signal) => {
    const latest = readTracker();
    if (latest.integrity !== "complete") return false;
    const closedPids = new Set(trackedChildren(latest.events).filter((child) => child.closeObserved).map((child) => child.pid));
    const current = snapshot();
    if (!current) return false;
    for (const [pid, identity] of known) {
      if (closedPids.has(pid) || !sameLiveProcess(current, pid, identity)) continue;
      try {
        terminate(pid, signal);
        if (signal === "SIGKILL") forcedActions.push({ pid, action: "kill-process" });
      } catch (error) { if (error.code !== "ESRCH") return false; }
    }
    return true;
  };
  const initiallyAlive = [...known].some(([pid, identity]) => sameLiveProcess(processes, pid, identity));
  if (!initiallyAlive) return { children, recoveryAttempted: false, forcedActions, trackerIntegrity: integrity,
    trackedProcessesCloseConfirmed: children.every((child) => child.closeObserved || child.spawnError || child.closeBySnapshotObserved),
    treeCloseConfirmed: "unconfirmed", recoveryUnconfirmedReason: "direct children were closed or absent at the final snapshot; arbitrary descendants may not be completely observable",
    observedProcessCount: known.size };
  signalKnown("SIGTERM");
  const waitUntil = async (deadline) => {
    while (Date.now() < deadline) {
      processes = snapshot();
      if (!processes) return false;
      let activeKnown = false;
      for (const [pid, identity] of known) if (sameLiveProcess(processes, pid, identity)) activeKnown = true;
      if (!activeKnown) return true;
      await sleep(100);
    }
    processes = snapshot();
    if (!processes) return false;
    return ![...known].some(([pid, identity]) => sameLiveProcess(processes, pid, identity));
  };
  let closed = await waitUntil(Date.now() + 3000);
  if (!closed) {
    signalKnown("SIGKILL");
    closed = await waitUntil(Date.now() + 3000);
  }
  const finalEvents = readTracker();
  const finalChildren = trackedChildren(finalEvents.events);
  const finalProcesses = snapshot();
  if (!finalProcesses) closed = false;
  if (finalProcesses) for (const child of finalChildren) if (child.spawnObserved && !child.closeObserved && !finalProcesses.has(child.pid)) child.closeBySnapshotObserved = true;
  const knownAlive = finalProcesses && [...known].some(([pid, identity]) => sameLiveProcess(finalProcesses, pid, identity));
  const trackedProcessesCloseConfirmed = closed && !knownAlive && finalEvents.integrity === "complete"
    && finalChildren.every((child) => child.closeObserved || child.spawnError || child.closeBySnapshotObserved) ? true : "unconfirmed";
  return { children: finalChildren, recoveryAttempted: initiallyAlive, forcedActions, trackerIntegrity: finalEvents.integrity,
    trackedProcessesCloseConfirmed, treeCloseConfirmed: "unconfirmed", recoveryUnconfirmedReason: "spawn preload tracks direct child processes only; complete descendant closure is not provable",
    observedProcessCount: known.size };
}

function redactDiagnostic(value) {
  return value
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[redacted-token]");
}

function waitForChildClose(child, timeoutMs, state = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onClose = () => finish(true);
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(closed);
    };
    child.once("close", onClose);
    if (state.closeObserved) finish(true);
  });
}

function driverEnded(child, state) {
  return !child || state.exitObserved || state.closeObserved || child.exitCode != null || child.signalCode != null;
}

async function terminateChild(child, state = {}, ports = {}) {
  const result = { attempted: false, forced: false, status: "unconfirmed", reason: null };
  if (driverEnded(child, state)) return { ...result, status: "not-attempted", reason: "driver exit or close already observed" };
  if ((ports.platform || process.platform) === "win32") return { ...result, reason: "Windows process identity is unavailable; termination was not attempted" };
  const snapshot = ports.snapshotProcesses || snapshotProcesses;
  const signal = ports.signalProcessGroup || ((pid, name) => process.kill(-pid, name));
  const wait = ports.waitForChildClose || waitForChildClose;
  const verified = () => {
    if (driverEnded(child, state)) { result.reason = "driver exit or close already observed"; return false; }
    const identity = state.identity;
    if (!identity || identity.pid !== child.pid || identity.ppid !== process.pid || identity.pgid !== child.pid) {
      result.reason = "driver launch identity unavailable"; return false;
    }
    let processes;
    try { processes = snapshot(); } catch { /* remain unconfirmed */ }
    if (driverEnded(child, state)) { result.reason = "driver exit or close already observed"; return false; }
    if (!processes || !sameLiveProcess(processes, child.pid, identity) || processes.get(child.pid)?.pgid !== identity.pgid
      || processes.get(child.pid)?.ppid !== identity.ppid) {
      result.reason = "driver launch identity unavailable or changed"; return false;
    }
    return true;
  };
  if (!verified()) return result;
  try { signal(child.pid, "SIGTERM"); result.attempted = true; }
  catch (error) { result.reason = `driver signal failed: ${error.code || "unknown"}`; return result; }
  const closed = await wait(child, 3000, state);
  if (!closed && verified()) {
    try { signal(child.pid, "SIGKILL"); result.forced = true; }
    catch (error) { result.reason = `driver force signal failed: ${error.code || "unknown"}`; return result; }
    await wait(child, 3000, state);
  }
  result.status = state.closeObserved ? "close-observed" : "unconfirmed";
  return result;
}

// These resources belong to this spawn only. A local pipe close caused by destroy()
// is not evidence that the driver or its descendants have closed.
function releaseOwnedChildHandles(child, closeObserved) {
  const result = { status: closeObserved ? "not-needed-after-close" : "released", driverUnreferenced: false,
    stdoutDestroyed: false, stderrDestroyed: false, errors: [] };
  if (closeObserved) return result;
  const guardErrorsUntilClose = (emitter) => {
    const ignoreLateError = () => {};
    emitter.on("error", ignoreLateError);
    emitter.once("close", () => emitter.removeListener("error", ignoreLateError));
  };
  // Keep only small, resource-local error guards while late native events drain.
  // They do not retain the tracker, diagnostics, or execution state.
  guardErrorsUntilClose(child);
  try { child.unref(); result.driverUnreferenced = true; }
  catch (error) { result.errors.push(`driver unref: ${error.code || "unavailable"}`); }
  for (const name of ["stdout", "stderr"]) {
    const stream = child[name];
    if (!stream) continue;
    if (!stream.closed) guardErrorsUntilClose(stream);
    try { stream.destroy(); result[`${name}Destroyed`] = stream.destroyed === true; }
    catch (error) { result.errors.push(`${name} destroy: ${error.code || "unavailable"}`); }
  }
  if (result.errors.length) result.status = "failed";
  return result;
}

function spawnBounded(args, timeoutMs, settings = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const tracker = settings.trackSpawnedChildren ? (settings.createSpawnTracker || createSpawnTracker)() : null;
    if (tracker) {
      env.DEPARTMENT_PLATFORM_TRACKER_PARENT_PID = String(process.pid);
      env.DEPARTMENT_PLATFORM_TRACKER_FILE = tracker.eventFile;
      env.DEPARTMENT_PLATFORM_TRACKER_ERROR_FILE = tracker.errorFile;
      env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require ${JSON.stringify(tracker.preload)}`].filter(Boolean).join(" ");
    }
    let child;
    try { child = (settings.spawn || cp.spawn)(process.execPath, args, { cwd: args.cwd, detached: process.platform !== "win32", shell: false, env,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); }
    catch (error) {
      if (tracker) { try { fs.rmSync(tracker.directory, { recursive: true, force: true }); } catch { /* report failure below */ } }
      resolve({ code: null, signal: null, error: error.message, stdout: "", stderr: "", timedOut: false, forcedCleanup: false,
        cleanup: { driverCloseObserved: false, detachedChildren: [], recoveryAttempted: false, forcedActions: [], detachedTreeCloseConfirmed: "unconfirmed", trackerIntegrity: "spawn-error" } });
      return;
    }
    let stdout = "", stderr = "", settled = false, timedOut = false, forcedCleanup = false, closeObserved = false, spawnError = null, cleanupTask = null;
    const driverState = { identity: null, exitObserved: false, closeObserved: false };
    let trackerFailure = null;
    let observeTimer = null;
    const cleanup = { driverCloseObserved: false, driverExitObserved: false, driverTermination: null, detachedChildren: [], recoveryAttempted: false, forcedActions: [], detachedTreeCloseConfirmed: null,
      trackedProcessesCloseConfirmed: null, trackerIntegrity: tracker ? "pending" : "not-enabled", recoveryUnconfirmedReason: null };
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (observeTimer) clearInterval(observeTimer);
      child.removeListener("spawn", onSpawn);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
      child.stdout.removeListener("error", onStdoutError);
      child.stderr.removeListener("error", onStderrError);
      // Snapshot observed process facts before releasing pipes: destroy() may
      // itself cause ChildProcess's late close event without proving tree exit.
      cleanup.localHandleRelease = releaseOwnedChildHandles(child, closeObserved);
      if (!closeObserved) cleanup.detachedTreeCloseConfirmed = "unconfirmed";
      if (cleanup.localHandleRelease.status === "failed") result.error ||= "local child handle release failed";
      if (tracker) { try { fs.rmSync(tracker.directory, { recursive: true, force: true }); } catch (error) { cleanup.trackerIntegrity = "cleanup-failed"; cleanup.recoveryUnconfirmedReason = `tracker cleanup failed: ${error.message}`; cleanup.detachedTreeCloseConfirmed = "unconfirmed"; } }
      resolve({ ...result, stdout, stderr, timedOut, forcedCleanup, cleanup });
    };
    const recover = async () => {
      if (!tracker) return;
      try {
        const recovered = await (settings.recoverTrackedChildren || recoverTrackedChildren)(tracker.eventFile,
          { ...settings.recoveryPorts, errorFile: tracker.errorFile, integrityFailure: trackerFailure });
        cleanup.detachedChildren = recovered.children;
        cleanup.recoveryAttempted = recovered.recoveryAttempted;
        cleanup.forcedActions.push(...recovered.forcedActions);
        if (recovered.trackerIntegrity !== "complete") trackerFailure ||= recovered.trackerIntegrity || "unconfirmed";
        cleanup.detachedTreeCloseConfirmed = trackerFailure ? "unconfirmed" : recovered.treeCloseConfirmed;
        cleanup.trackedProcessesCloseConfirmed = trackerFailure ? "unconfirmed" : recovered.trackedProcessesCloseConfirmed ?? "unconfirmed";
        cleanup.trackerIntegrity = trackerFailure || recovered.trackerIntegrity || "unconfirmed";
        cleanup.recoveryUnconfirmedReason = recovered.recoveryUnconfirmedReason || null;
        forcedCleanup ||= recovered.forcedActions.length > 0;
      } catch (error) {
        cleanup.trackerIntegrity = "recovery-failed";
        cleanup.detachedTreeCloseConfirmed = "unconfirmed";
        cleanup.recoveryUnconfirmedReason = `recovery failed: ${error.message}`;
      }
    };
    const finalizeAfterClose = (code, signal) => {
      if (cleanupTask) return cleanupTask;
      clearTimeout(timer);
      if (observeTimer) clearInterval(observeTimer);
      cleanupTask = (async () => { await recover(); finish({ code, signal, error: spawnError }); })();
      return cleanupTask;
    };
    const onStdout = (chunk) => { stdout = addBounded(stdout, chunk); };
    const onStderr = (chunk) => {
      stderr = addBounded(stderr, chunk);
      if (tracker && stderr.includes("DEPARTMENT_PLATFORM_TRACKER_WRITE_FAILED")) trackerFailure ||= "write-failed";
    };
    const onError = (error) => { spawnError = error.message; };
    const onStdoutError = (error) => { spawnError ||= `stdout stream error: ${redactDiagnostic(error.message).slice(0, 1024)}`; };
    const onStderrError = (error) => { spawnError ||= `stderr stream error: ${redactDiagnostic(error.message).slice(0, 1024)}`; };
    const onSpawn = () => {
      if (process.platform === "win32" || driverEnded(child, driverState)) return;
      try {
        const identity = (settings.terminationPorts?.snapshotProcesses || snapshotProcesses)()?.get(child.pid);
        if (identity?.ppid === process.pid && identity.pgid === child.pid && !/^Z/.test(identity.stat || "")) driverState.identity = { ...identity };
      } catch { /* absence of launch identity prohibits later termination */ }
    };
    const onExit = () => { driverState.exitObserved = true; cleanup.driverExitObserved = true; };
    const onClose = (code, signal) => {
      closeObserved = true;
      driverState.closeObserved = true;
      cleanup.driverCloseObserved = true;
      if (!timedOut) { clearTimeout(timer); void finalizeAfterClose(code, signal); }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.stdout.on("error", onStdoutError);
    child.stderr.on("error", onStderrError);
    child.on("error", onError);
    child.once("spawn", onSpawn);
    child.once("exit", onExit);
    child.once("close", onClose);
    const observe = () => {
      try {
        const result = (settings.observeSpawnedProcessTree || observeSpawnedProcessTree)(tracker.eventFile, tracker.errorFile);
        if (result.integrity !== "complete") trackerFailure ||= result.integrity || "observation-failed";
      } catch { trackerFailure ||= "observation-failed"; markTrackerWriteFailure(tracker.errorFile); }
    };
    if (tracker) observeTimer = setInterval(observe, 500);
    timer = setTimeout(() => {
      if (cleanupTask || settled) return;
      timedOut = true;
      if (observeTimer) clearInterval(observeTimer);
      cleanupTask = (async () => {
        try {
          if (tracker) observe();
          const termination = await (settings.terminateChild || terminateChild)(child, driverState, settings.terminationPorts);
          cleanup.driverTermination = typeof termination === "boolean" ? { forced: termination, status: "injected" } : termination;
          forcedCleanup = cleanup.driverTermination.forced;
          if (forcedCleanup) cleanup.forcedActions.push({ pid: child.pid, action: "kill-driver-process-group-force" });
        } catch (error) { cleanup.recoveryUnconfirmedReason = `driver termination failed: ${error.message}`; }
        cleanup.driverCloseObserved = closeObserved;
        await recover();
        if (!closeObserved) await waitForChildClose(child, 3000, driverState);
        cleanup.driverCloseObserved = closeObserved;
        finish({ code: child.exitCode, signal: child.signalCode, error: spawnError });
      })();
    }, timeoutMs);
  });
}

function parseTapSummary(output, file) {
  const count = (name) => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, "gm"))];
    return { value: matches.length === 1 ? Number(matches[0][1]) : null, occurrences: matches.length };
  };
  const entries = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [name, count(name)]));
  const subtests = [...output.matchAll(/^# Subtest: .+$/gm)].length;
  const fileSubtest = file ? [...output.matchAll(new RegExp(`^# Subtest: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "gm"))].length : 0;
  return { ...Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, entry.value])),
    registeredTests: entries.tests.value === null ? null : Math.max(0, subtests - fileSubtest),
    reportedSubtests: subtests,
    fileSubtestOccurrences: fileSubtest,
    complete: Object.values(entries).every((entry) => entry.occurrences === 1) && entries.tests.value === subtests,
    unique: Object.values(entries).every((entry) => entry.occurrences === 1) };
}

function validatePublicReport(file, productDriver) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("Public EH child report is missing");
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  if (result.result !== "passed" || result.forcedTeardown !== false || !Array.isArray(result.failures) || result.failures.length !== 0) {
    throw new Error("Public EH child report does not record an unforced successful result");
  }
  if (!result.roles || ["director", "leader", "employee"].some((role) => result.roles[role] !== "codex")) {
    throw new Error("Public EH child report is not the all-Codex scope");
  }
  if (result.scenarioName !== PUBLIC_CODEX_SCENARIO) {
    throw new Error(`Public EH child report is not the ${PUBLIC_CODEX_SCENARIO} scenario`);
  }
  if (result.driverExecution?.executedPath !== productDriver.path
    || result.driverExecution?.executedSha256 !== productDriver.sha256
    || result.driverExecution?.productPath !== productDriver.path || result.driverExecution?.productSha256 !== productDriver.sha256) {
    throw new Error("Public EH child report does not identify the expected product driver path and hash");
  }
  const requiredStages = { prerequisites: "passed", emptyStore: "passed", extensionHost: "passed", publicUi: "passed",
    rootCreation: "observed", directorExecution: "completed", leaderExecution: "observed", ownerReceipts: "not-applicable",
    capacityReturn: "passed", eventAcceptance: "passed", unifiedAcceptancePlan: "passed", directorReport: "passed" };
  for (const [gate, expected] of Object.entries(requiredStages)) {
    if (result.stages?.[gate] !== expected) throw new Error(`Public EH child report has invalid ${gate} status`);
  }
  if (Object.keys(result.stages).some((gate) => !Object.hasOwn(requiredStages, gate))) {
    throw new Error("Public EH child report has an unknown or missing stage");
  }
  return result;
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
}

async function run(options, settings = {}) {
  const startedAt = new Date().toISOString();
  const report = { schemaVersion: 1, startedAt, platform: process.platform, arch: process.arch, node: process.version,
    scope: options.scope, product: options.product, result: "failed", sourceDistEvidence: null,
    coverageGates: { ownerCore: "not-run", publicEh: "not-run", realTabAndRootCleanup: "not-covered", coldRecovery: "not-covered" },
    execution: { argv: [], exitCode: null, signal: null, timedOut: false, forcedCleanup: false,
      cleanup: { driverCloseObserved: false, detachedChildren: [], recoveryAttempted: false, forcedActions: [], detachedTreeCloseConfirmed: null },
      diagnostics: { stdoutTail: "", stderrTail: "" } } };
  const product = validateProduct(options.product, settings.repoRoot);
  report.product = product.product;
  report.sourceDistEvidence = product.sourceDist;
  report.entry = options.scope === "owner-core"
    ? { realpath: fs.realpathSync(__filename), sha256: hashFile(__filename) }
    : product.publicDriver;
  const childReport = path.join(path.dirname(options.report), `${path.basename(options.report, path.extname(options.report))}.public-eh-child.json`);
  if (options.scope === "public-codex" && fs.existsSync(childReport)) throw new Error("Dedicated public EH child report already exists");
  const testPaths = OWNER_TESTS.map((name) => path.join(product.product, "dist/test/runtime", name));
  report.execution.argv = options.scope === "owner-core"
    ? testPaths.map((file) => [process.execPath, "--test", "--test-reporter=tap", file])
    : [process.execPath, product.publicDriver.path, "--product", product.product, "--report", childReport, "--scenario", PUBLIC_CODEX_SCENARIO];
  if (options.scope === "owner-core") report.coverageGates.ownerCore = "running";
  else report.coverageGates.publicEh = "running";
  const timeoutMs = settings.timeoutMs ?? Number(process.env.SINITEK_DEPARTMENT_PLATFORM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (options.scope === "owner-core") {
    const deadline = Date.now() + timeoutMs;
    const runs = [];
    let stdout = "", stderr = "";
    for (const file of testPaths) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        runs.push({ file: path.relative(product.product, file), result: "not-run", exitCode: null, signal: null, timedOut: false, tests: null });
        continue;
      }
      const child = await spawnBounded(["--test", "--test-reporter=tap", file], remaining,
        { ...(settings.spawnBoundedSettings || {}), trackSpawnedChildren: true });
      const summary = parseTapSummary(`${child.stdout}\n${child.stderr}`, file);
      const entry = { file: path.relative(product.product, file), result: "failed", exitCode: child.code,
        signal: child.signal, timedOut: child.timedOut, forcedCleanup: child.forcedCleanup,
        processCloseObserved: child.cleanup.driverCloseObserved, processExitObserved: child.cleanup.driverExitObserved,
        localHandleRelease: child.cleanup.localHandleRelease, trackerIntegrity: child.cleanup.trackerIntegrity,
        trackedChildren: child.cleanup.detachedChildren, trackedProcessesCloseConfirmed: child.cleanup.trackedProcessesCloseConfirmed,
        detachedTreeCloseConfirmed: child.cleanup.detachedTreeCloseConfirmed, recoveryAttempted: child.cleanup.recoveryAttempted,
        driverTermination: child.cleanup.driverTermination, forcedActions: child.cleanup.forcedActions,
        recoveryUnconfirmedReason: child.cleanup.recoveryUnconfirmedReason, error: child.error || null, tests: summary };
      if (child.code === 0 && !child.error && child.cleanup.driverCloseObserved && !child.signal && !child.timedOut && !child.forcedCleanup && summary.complete && summary.unique
        && summary.registeredTests > 0 && summary.pass === summary.tests && summary.fail === 0 && summary.cancelled === 0
        && summary.skipped === 0 && summary.todo === 0 && child.cleanup.trackerIntegrity === "complete"
        && child.cleanup.trackedProcessesCloseConfirmed === true && child.cleanup.forcedActions.length === 0) entry.result = "passed";
      runs.push(entry);
      stdout = addBounded(stdout, child.stdout);
      stderr = addBounded(stderr, child.stderr);
      if (child.code !== null) report.execution.exitCode = child.code;
      if (child.signal) report.execution.signal = child.signal;
      if (child.timedOut) report.execution.timedOut = true;
      if (child.forcedCleanup) report.execution.forcedCleanup = true;
      if (child.timedOut || child.error) report.execution.error = child.error || null;
    }
    report.tests = runs;
    report.execution.cleanup.ownerTestProcesses = runs.map(({ file, processCloseObserved, processExitObserved, localHandleRelease,
      timedOut, forcedCleanup, trackerIntegrity, trackedChildren, trackedProcessesCloseConfirmed, detachedTreeCloseConfirmed,
      recoveryAttempted, driverTermination, forcedActions, recoveryUnconfirmedReason }) => ({ file,
      closeObserved: processCloseObserved === true, exitObserved: processExitObserved === true,
      localHandleRelease, trackerIntegrity, trackedChildren, trackedProcessesCloseConfirmed: trackedProcessesCloseConfirmed ?? "unconfirmed",
      detachedTreeCloseConfirmed: detachedTreeCloseConfirmed ?? "unconfirmed", recoveryAttempted: recoveryAttempted === true,
      driverTermination: driverTermination || null, forcedActions: forcedActions || [], recoveryUnconfirmedReason: recoveryUnconfirmedReason || null,
      timedOut: timedOut === true, forcedTermination: forcedCleanup === true }));
    const cleanupRecords = report.execution.cleanup.ownerTestProcesses;
    report.execution.cleanup.driverExitObserved = runs.length === testPaths.length && runs.every((entry) => entry.processExitObserved === true);
    report.execution.cleanup.driverCloseObserved = runs.length === testPaths.length && runs.every((entry) => entry.processCloseObserved === true);
    report.execution.cleanup.trackerIntegrity = cleanupRecords.length === testPaths.length && cleanupRecords.every((entry) => entry.trackerIntegrity === "complete")
      ? "complete" : cleanupRecords.find((entry) => entry.trackerIntegrity !== "complete")?.trackerIntegrity || "not-run";
    report.execution.cleanup.detachedChildren = cleanupRecords.flatMap((entry) => (entry.trackedChildren || []).map((child) => ({ file: entry.file, ...child })));
    report.execution.cleanup.trackedProcessesCloseConfirmed = cleanupRecords.length === testPaths.length
      && cleanupRecords.every((entry) => entry.trackedProcessesCloseConfirmed === true) ? true : "unconfirmed";
    report.execution.cleanup.detachedTreeCloseConfirmed = cleanupRecords.length === testPaths.length
      && cleanupRecords.every((entry) => entry.detachedTreeCloseConfirmed === true) ? true : "unconfirmed";
    report.execution.cleanup.recoveryAttempted = cleanupRecords.some((entry) => entry.recoveryAttempted);
    report.execution.cleanup.forcedActions = cleanupRecords.flatMap((entry) => entry.forcedActions.map((action) => ({ file: entry.file, ...action })));
    report.execution.cleanup.recoveryUnconfirmedReason = cleanupRecords.find((entry) => entry.recoveryUnconfirmedReason)?.recoveryUnconfirmedReason || null;
    report.execution.diagnostics.stdoutTail = redactDiagnostic(stdout);
    report.execution.diagnostics.stderrTail = redactDiagnostic(stderr);
    if (runs.length === testPaths.length && runs.every((entry) => entry.result === "passed")) {
      report.coverageGates.ownerCore = "passed";
      report.result = "passed";
    }
  } else {
    fs.mkdirSync(path.dirname(childReport), { recursive: true });
    const child = await spawnBounded(report.execution.argv.slice(1), timeoutMs, { trackSpawnedChildren: true });
    report.execution.exitCode = child.code;
    report.execution.signal = child.signal;
    report.execution.timedOut = child.timedOut;
    report.execution.forcedCleanup = child.forcedCleanup;
    report.execution.cleanup = child.cleanup;
    report.execution.error = child.error || null;
    report.execution.diagnostics.stdoutTail = redactDiagnostic(child.stdout);
    report.execution.diagnostics.stderrTail = redactDiagnostic(child.stderr);
    if (child.code === 0 && !child.error && !child.signal && !child.timedOut && !child.forcedCleanup
      && child.cleanup.trackerIntegrity === "complete" && child.cleanup.trackedProcessesCloseConfirmed === true) {
      try {
        const result = validatePublicReport(childReport, product.publicDriver);
        report.publicEhSummary = { result: result.result, forcedTeardown: result.forcedTeardown, scenarioName: result.scenarioName,
          roles: result.roles, stages: result.stages, failureCount: result.failures.length };
        if (child.cleanup.detachedTreeCloseConfirmed === true && !child.cleanup.recoveryAttempted) {
          report.coverageGates.publicEh = "passed";
          report.result = "passed";
        } else {
          report.coverageGates.publicEh = "unconfirmed";
          report.childReportError = "tracked process closure was observed, but complete detached tree closure is unconfirmed";
        }
      } catch (error) { report.childReportError = error.message; }
    }
    report.childReportPath = childReport;
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (fs.existsSync(options.report)) { console.error("Report path already exists"); process.exitCode = 2; return; }
  try {
    const report = await run(options);
    writeReport(options.report, report);
    console.log(JSON.stringify({ report: options.report, result: report.result, scope: report.scope,
      exitCode: report.execution.exitCode, signal: report.execution.signal, tests: report.tests || null,
      coverageGates: report.coverageGates }, null, 2));
    if (report.result !== "passed") process.exitCode = 1;
  } catch (error) {
    const failure = { schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      platform: process.platform, arch: process.arch, node: process.version, scope: options.scope,
      product: options.product, result: "failed", error: error.message,
      coverageGates: { ownerCore: "not-run", publicEh: "not-run", realTabAndRootCleanup: "not-covered", coldRecovery: "not-covered" } };
    try { writeReport(options.report, failure); } catch (writeError) { console.error(`Could not write report: ${writeError.message}`); }
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { OWNER_TESTS, parseArgs, validateProduct, parseTapSummary, validatePublicReport, redactDiagnostic,
  createSpawnTracker, observeSpawnedProcessTree, recoverTrackedChildren, terminateChild, spawnBounded, run };
if (require.main === module) main();
