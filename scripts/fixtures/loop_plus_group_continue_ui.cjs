"use strict";

/*
 * 可复用的 Loop+ 群聊续跑页面操作。
 * 确定性 resume-idempotent 直接调用 resume，不经过 Webview。
 * 本夹具把当前候选复制到独立目录，在隔离的 macOS Extension Development Host 里
 * 打开合成可继续任务的真实群聊页，点击继续执行，并在同一次请求仍活跃时重复操作。
 * CLI 是只说 stdio JSON-RPC 的本地替身，不访问网络，也不是真实模型。
 */

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const CONTINUE_MARKER = "SYNTHETIC_GROUP_CONTINUE_PANEL";
const ROOT_PROMPT = "合成可继续的 Loop+ 任务。请只返回决策 JSON。不要访问网络。";
const CODE_CANDIDATES = ["/Applications/Visual Studio Code.app/Contents/MacOS/Code"];

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshotStat(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function copyCandidateExtension(product, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const extensionSource = path.join(product, "dist/extension.js");
  let fingerprint;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = snapshotStat(extensionSource);
    for (const name of ["package.json", "media", "dist"]) {
      const from = path.join(product, name);
      if (!fs.existsSync(from)) throw new Error(`候选缺少 ${name}`);
      fs.cpSync(from, path.join(destination, name), { recursive: true, force: true });
    }
    const after = snapshotStat(extensionSource);
    const copied = path.join(destination, "dist/extension.js");
    const copiedStat = snapshotStat(copied);
    if (before.size === after.size && before.mtimeMs === after.mtimeMs && copiedStat.size === after.size && copiedStat.size > 0) {
      fingerprint = {
        extensionJs: "dist/extension.js",
        bytes: copiedStat.size,
        sha256: sha256File(copied),
        copiedAt: new Date().toISOString(),
      };
      break;
    }
  }
  if (!fingerprint) throw new Error("复制候选时 dist/extension.js 仍在变化，已停止以避免与诊断返工共用一份半写入产物。");
  const modules = path.join(product, "node_modules");
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(destination, "node_modules"));
  return fingerprint;
}

function vscodeExecutable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  return CODE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || CODE_CANDIDATES[0];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function sampleProcesses() {
  const result = cp.spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat="], { encoding: "utf8" });
  if (result.status !== 0) return { ok: false, error: result.stderr || "ps failed", rows: [] };
  const rows = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
    if (!match || match[4].includes("Z")) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), stat: match[4] });
  }
  return { ok: true, rows };
}

function ownedRows(sample, launchPid) {
  if (!sample.ok) return [];
  return sample.rows.filter((row) => row.pid === launchPid || row.pgid === launchPid || row.ppid === launchPid);
}

function debugAllowOrigin(port) {
  return `http://127.0.0.1:${port}`;
}

function aggregateFixtureLedger(text) {
  if (text == null) return { continueCalls: 0, pids: [], phase: "missing", missing: true, corrupt: false };
  const held = [];
  const setupSessions = new Set();
  let corrupt = false;
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { corrupt = true; continue; }
    if (!row || typeof row.kind !== "string" || typeof row.interval !== "string") { corrupt = true; continue; }
    if (row.kind === "setup" && row.interval === "open") setupSessions.add(row.sessionId);
    if (row.kind === "continue" && row.interval === "held") {
      if (!Number.isInteger(row.pid)) corrupt = true;
      else held.push(row);
    }
  }
  return {
    continueCalls: held.length,
    setupSessions: [...setupSessions],
    continueSessions: held.map((row) => row.sessionId),
    pids: [...new Set(held.map((row) => row.pid))],
    phase: held.length ? "continue-held" : "idle",
    missing: false,
    corrupt,
  };
}

function allLedgerPids(text) {
  const pids = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (Number.isInteger(row?.pid)) pids.push(row.pid);
    } catch { /* corrupt lines are reported by the ledger aggregate */ }
  }
  return pids;
}

function readFixtureLedger(root) {
  const file = path.join(root, "fixture-events.jsonl");
  if (!fs.existsSync(file)) return aggregateFixtureLedger(null);
  return aggregateFixtureLedger(fs.readFileSync(file, "utf8"));
}

function assessGroupContinuePass(input) {
  const problems = [];
  const repeat = input.repeat || {};
  if (input.sampleFailed === true) problems.push("process sample failed");
  if (input.ledgerMissing === true || input.ledgerCorrupt === true) problems.push("continue ledger is missing or corrupt");
  if (repeat.before?.disabled !== true) problems.push("repeat click left the continue button enabled");
  if (repeat.openedAfterRepeat !== false || repeat.dialogStillOpen !== false) problems.push("repeat click reopened the continue dialog");
  if (input.continueCalls !== 1) problems.push(`main continue calls across stub processes were ${input.continueCalls}`);
  if (input.checkExit !== false) {
    const exit = input.exit || {};
    const cleanup = input.cleanup || {};
    if (exit.exitCode !== 0 || exit.signal) problems.push("host did not exit 0 without a signal");
    if (cleanup.result !== "drained" || cleanup.signaled !== false) problems.push("cleanup was not a natural drain without a signal");
  }
  return { passed: problems.length === 0, problems };
}

function planCleanupAction(input) {
  if (input.blockSignal) return { signal: null, retain: true, result: "retained", reason: "identity changed" };
  if (!input.sampleOk) return { signal: null, retain: true, result: "unverified", reason: "ps sample failed" };
  if (!input.stable) return { signal: null, retain: true, result: "unverified", reason: "ownership changed before signal" };
  if (input.escalate) {
    if (!input.escalateSampleOk || !input.escalateStable) {
      return { signal: null, retain: true, result: "unverified", reason: "ownership changed before SIGKILL" };
    }
    if (input.ownedCount === 0) return { signal: null, retain: true, result: "drained", reason: "exited before SIGKILL" };
    return { signal: "SIGKILL", retain: true, result: "signaled", reason: "SIGKILL" };
  }
  if (input.exited && input.ownedCount === 0) return { signal: null, retain: false, result: "drained", reason: "natural-exit" };
  if (input.ownedCount === 0) return { signal: null, retain: false, result: "drained", reason: "group-empty" };
  return { signal: "SIGTERM", retain: true, result: "signaled", reason: "SIGTERM" };
}

function runRound747SyntheticChecks() {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const repeat = { before: { disabled: true }, openedAfterRepeat: false, dialogStillOpen: false };
  const firstHeld = `${JSON.stringify({ pid: 41, kind: "continue", interval: "held" })}\n`;
  const afterUi = aggregateFixtureLedger(firstHeld);
  const late = aggregateFixtureLedger(`${firstHeld}${JSON.stringify({ pid: 42, kind: "continue", interval: "held" })}\n`);
  check(afterUi.continueCalls === 1 && late.continueCalls === 2, "a held line appended after the UI sample must be counted");
  check(assessGroupContinuePass({ checkExit: false, repeat, continueCalls: late.continueCalls, ledgerMissing: late.missing, ledgerCorrupt: late.corrupt }).passed === false, "a second held line after the last UI sample must fail");
  const corrupt = aggregateFixtureLedger(`${firstHeld}{not-json\n`);
  check(corrupt.corrupt === true && assessGroupContinuePass({ checkExit: false, repeat, continueCalls: corrupt.continueCalls, ledgerCorrupt: true }).passed === false, "a corrupt ledger line must fail");
  const missing = aggregateFixtureLedger(null);
  check(missing.missing === true && assessGroupContinuePass({ checkExit: false, repeat, continueCalls: missing.continueCalls, ledgerMissing: true }).passed === false, "a missing ledger must fail");
  const log = createCdpLog("group-session");
  for (let index = 0; index < CDP_EVENT_LIMIT; index += 1) {
    rememberCdpEvent(log, { method: "Runtime.executionContextCreated", sessionId: "group-session", params: { context: { id: index } } });
  }
  for (let index = 0; index < 5; index += 1) {
    rememberCdpEvent(log, { method: "Runtime.exceptionThrown", sessionId: "group-session", params: { text: `webview error ${index} ${"x".repeat(40)}` } });
  }
  const retainedDetails = log.events.filter((event) => event.method === "Runtime.exceptionThrown");
  check(log.events.length <= CDP_EVENT_LIMIT && retainedDetails.length === 0 && log.bySession["group-session"].errorCount === 5, "evicted error details keep the group-session count");
  const summary = pageErrors({
    events: () => log.events.filter((event) => event.sessionId === "group-session"),
    errorCount: () => sessionErrorCount(log, "group-session"),
  });
  check(summary.length > 0, "evicted webview errors still fail the page check");
  const confirmed = [{ pid: 1, ppid: 10, pgid: 70 }];
  const replaced = [{ pid: 2, ppid: 10, pgid: 70 }];
  const escalation = planEscalationFromConfirmed(confirmed, { ok: true, rows: replaced }, { ok: true, rows: replaced }, 70);
  check(ownershipStable(replaced, replaced, 70) === true && escalation.signal === null && escalation.retain === true, "a replaced member must not be signaled when later snapshots agree");
  if (errors.length) throw new Error(errors.join("; "));
  return { ok: true, checks: 7 };
}

function runSyntheticGateSelfCheck() {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const ledger = [
    { pid: 11, kind: "continue", interval: "held" },
    { pid: 22, kind: "continue", interval: "held" },
    { pid: 11, kind: "continue", interval: "echo" },
  ].map((row) => JSON.stringify(row)).join("\n");
  const summed = aggregateFixtureLedger(ledger);
  check(summed.continueCalls === 2 && summed.pids.length === 2, "held continues from two stub processes must add");
  const overwritten = aggregateFixtureLedger(`${JSON.stringify({ pid: 22, kind: "continue", interval: "held", continueCalls: 1 })}\n`);
  check(overwritten.continueCalls === 1, "a process-local continueCalls field must not replace the ledger");
  const clean = {
    repeat: { before: { disabled: true }, openedAfterRepeat: false, dialogStillOpen: false },
    continueCalls: 1,
    exit: { exitCode: 0, signal: null },
    cleanup: { result: "drained", signaled: false },
    sampleFailed: false,
  };
  check(assessGroupContinuePass(clean).passed === true, "clean gate should pass");
  check(assessGroupContinuePass({ ...clean, repeat: { before: { disabled: true }, openedAfterRepeat: true, dialogStillOpen: true } }).passed === false, "reopened dialog must fail");
  check(assessGroupContinuePass({ ...clean, continueCalls: summed.continueCalls }).passed === false, "two held calls must fail");
  check(assessGroupContinuePass({ ...clean, exit: { exitCode: null, signal: "SIGTERM" }, cleanup: { result: "drained", signaled: true } }).passed === false, "signaled exit must fail");
  check(assessGroupContinuePass({ ...clean, sampleFailed: true, cleanup: { result: "unverified", signaled: false } }).passed === false, "sample failure must fail");
  const samplePlan = planCleanupAction({ blockSignal: false, sampleOk: false, stable: false, ownedCount: 1, exited: false, escalate: false });
  check(samplePlan.signal === null && samplePlan.retain === true, "sample failure must not signal");
  const identityPlan = planCleanupAction({ blockSignal: true, sampleOk: true, stable: true, ownedCount: 1, exited: false, escalate: false });
  check(identityPlan.signal === null && identityPlan.retain === true, "identity change must not signal");
  const escalate = planCleanupAction({
    blockSignal: false, sampleOk: true, stable: true, ownedCount: 1, exited: false, escalate: true, escalateSampleOk: false, escalateStable: false,
  });
  check(escalate.signal === null && escalate.retain === true, "SIGKILL must wait for a fresh ownership sample");
  const origin = debugAllowOrigin(9);
  check(origin === "http://127.0.0.1:9" && !origin.includes("*"), "debug origin is loopback only");
  if (errors.length) throw new Error(errors.join("; "));
  return { ok: true, checks: 10 };
}

function listTasks(home) {
  const root = path.join(home, ".sinitek_cli");
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".json")) files.push(full);
    }
  };
  visit(path.join(root, "loop-tasks"));
  const flat = path.join(root, "loop-tasks.json");
  if (fs.existsSync(flat)) files.push(flat);
  const tasks = [];
  for (const file of files) {
    const parsed = readJson(file);
    if (!parsed || !Array.isArray(parsed.tasks)) continue;
    for (const task of parsed.tasks) {
      if (task && typeof task.id === "string") {
        tasks.push({
          id: task.id,
          status: task.status,
          schedulingMode: task.schedulingMode,
          workspaceKey: task.workspaceKey,
          cli: task.cli,
          sessionId: task.sessionId,
          mainAiFailureCount: task.mainAiFailureCount ?? 0,
          mainAiFailureLimitReached: task.mainAiFailureLimitReached === true,
          summary: typeof task.finalSummary === "string" ? task.finalSummary.slice(0, 180) : "",
          rootPrompt: typeof task.rootPrompt === "string" ? task.rootPrompt.slice(0, 180) : "",
          file: path.relative(root, file),
        });
      }
    }
  }
  return tasks;
}

function taskMessageIds(home, task, sessionId) {
  const file = path.join(home, ".sinitek_cli", "messages", task.workspaceKey, task.cli, `${sessionId}.json`);
  return (readJson(file)?.messages || []).filter((message) => message.id === task.id
    || (message.loopTaskId === task.id && message.taskRole === "main")).map((message) => message.id);
}

function boundedLines(text, pattern, limit = 20) {
  return text.split("\n").filter((line) => pattern.test(line)).slice(-limit);
}

function collectHostNotes(home, userData) {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".log")) files.push(full);
    }
  };
  visit(path.join(home, ".sinitek_cli", "logs"));
  visit(path.join(userData, "logs"));
  const notes = [];
  const pluginErrors = [];
  for (const file of files) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (text.length > 2_000_000) text = text.slice(-2_000_000);
    for (const line of boundedLines(text, /loop-group-chat-continue-|ERROR|Unhandled|EADDR|EINVAL|pageerror/i, 40)) {
      const compact = line.replace(/\/Users\/[^ "']+/g, "<path>").slice(0, 400);
      if (/loop-group-chat-continue-failed|Unhandled|Extension host.*error/i.test(compact)) pluginErrors.push(compact);
      else notes.push(compact);
    }
  }
  return {
    notes: notes.slice(-30),
    pluginErrors: pluginErrors.slice(-20),
  };
}

function cliFixtureSource(root) {
  return `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = ${JSON.stringify(root)};
const marker = ${JSON.stringify(CONTINUE_MARKER)};
const eventsFile = path.join(root, "fixture-events.jsonl");
const releaseFile = path.join(root, "release-continue");
let sessionId;
let modelCurrent = "[\\"sinitek-custom\\",\\"deepseek-v4.1-flash\\"]";
let reasoningCurrent = "low";
function publish(kind, interval) {
  fs.appendFileSync(eventsFile, JSON.stringify({ pid: process.pid, kind, interval, sessionId, at: new Date().toISOString() }) + "\\n");
}
function send(message) { fs.writeSync(1, JSON.stringify(message) + "\\n"); }
function configOptions() {
  return [
    { id: "model", name: "Model", category: "model", type: "select", currentValue: modelCurrent, options: [{ group: "local-fixture", name: "Local", options: [{ value: modelCurrent, name: "local" }] }] },
    { id: "reasoning_effort", name: "Reasoning effort", category: "thought_level", type: "select", currentValue: reasoningCurrent, options: [{ value: reasoningCurrent, name: reasoningCurrent }] },
  ];
}
function promptText(params) {
  const prompt = params && params.prompt;
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) return prompt.map((item) => item && item.text || "").join("\\n");
  return "";
}
function reply(id, params, text) {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId || sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "msg-1", content: { type: "text", text } } } });
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
}
let holds = 0;
function armExit() {
  if (holds === 0 && fs.existsSync(releaseFile)) setTimeout(() => process.exit(0), 20);
}
function holdThenReply(id, params, releaseSetup = false) {
  holds += 1;
  const started = Date.now();
  const timer = setInterval(() => {
    if (fs.existsSync(releaseFile) || (releaseSetup && fs.existsSync(path.join(root, "release-setup"))) || Date.now() - started > 120000) {
      clearInterval(timer);
      reply(id, params, "SYNTHETIC_INVALID_DECISION");
      holds -= 1;
      armExit();
    }
  }, 40);
}
const buffer = { text: "" };
function handle(message) {
  const method = message.method;
  const id = message.id;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentInfo: { name: "local-group-continue-fixture", version: "0" }, authMethods: [] } });
    return;
  }
  if (method === "session/new" || method === "session/resume") {
    sessionId = method === "session/new" ? require("node:crypto").randomUUID() : message.params.sessionId;
    send({ jsonrpc: "2.0", id, result: { sessionId, configOptions: configOptions() } });
    return;
  }
  if (method === "session/set_config_option") {
    const params = message.params || {};
    if (params.configId === "model" && typeof params.value === "string" && params.value) modelCurrent = params.value;
    if (params.configId === "reasoning_effort" && typeof params.value === "string" && params.value) reasoningCurrent = params.value;
    send({ jsonrpc: "2.0", id, result: { configOptions: configOptions() } });
    return;
  }
  if (method === "session/close") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "session/prompt") {
    if (!sessionId || message.params.sessionId !== sessionId) throw new Error("prompt targeted an unopened session");
    const text = promptText(message.params);
    const decision = text.includes("You are the Loop+") || text.includes("上一次决策被拒绝") || text.includes("Loop+ 继续执行");
    if (text.includes(marker)) {
      if (fs.existsSync(releaseFile)) {
        publish("continue", "echo");
        reply(id, message.params, "SYNTHETIC_INVALID_DECISION");
        return;
      }
      publish("continue", "held");
      holdThenReply(id, message.params);
      return;
    }
    if (!decision) {
      publish("side", "open");
      reply(id, message.params, "本地夹具已结束。");
      return;
    }
    publish("setup", "open");
    holdThenReply(id, message.params, true);
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
}
process.stdin.setEncoding("utf8");
process.stdin.once("end", () => process.exit(0));
process.stdin.on("data", (chunk) => {
  buffer.text += chunk;
  const lines = buffer.text.split("\\n");
  buffer.text = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch (error) { publish("protocol-error", "open"); }
  }
});
publish("ready", "open");
setInterval(() => {
  if (holds === 0 && fs.existsSync(releaseFile)) process.exit(0);
}, 50);
`;
}

function testEntrySource({ root, home, candidate, extensionId, timeoutMs, restartApplication }) {
  return `"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
exports.run = async () => {
  const root = ${JSON.stringify(root)};
  const expectedHome = fs.realpathSync(${JSON.stringify(home)});
  const candidate = fs.realpathSync(${JSON.stringify(candidate)});
  if (fs.realpathSync(os.homedir()) !== expectedHome) throw new Error("Extension Host HOME is not isolated");
  let extension;
  const activationDeadline = Date.now() + 60000;
  while (Date.now() < activationDeadline) {
    extension = vscode.extensions.getExtension(${JSON.stringify(extensionId)});
    if (extension && extension.isActive) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!extension || !extension.isActive) throw new Error("Product was not automatically activated");
  if (fs.realpathSync(extension.extensionPath) !== candidate) throw new Error("Activated extensionPath is not the independent candidate copy");
  const workspaceFile = ${JSON.stringify(path.join(root, "workspace", "unrelated.txt"))};
  const restored = fs.existsSync(path.join(root, "reload-started"));
  if (!restored) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(workspaceFile));
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand("sinitek-cli-tools.openPanel");
  }
  const crashTaskFile = path.join(root, "crash-task.json");
  if (restored && fs.existsSync(crashTaskFile)) {
    await vscode.commands.executeCommand("sinitek-cli-tools.openPanel");
    const taskId = JSON.parse(fs.readFileSync(crashTaskFile, "utf8")).taskId;
    await vscode.commands.executeCommand("sinitek-cli-tools.openLoopGroupChat", taskId);
  }
  const writeFocus = () => {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => ({
      label: tab.label, isActive: tab.isActive,
    })));
    const latest = { at: Date.now(), tabs, count: tabs.length, groupChat: tabs.filter((tab) => String(tab.label || "").startsWith("Loop+ 群聊")) };
    fs.writeFileSync(path.join(root, "workbench-focus.json"), JSON.stringify({ latest }, null, 2));
  };
  writeFocus();
  const timer = setInterval(writeFocus, 200);
  let opened = restored;
  fs.writeFileSync(path.join(root, "host-ready.json"), JSON.stringify({
    vscode: vscode.version, extensionId: extension.id, extensionPath: extension.extensionPath, isActive: extension.isActive, home: expectedHome, pid: process.pid,
  }));
  const until = Date.now() + ${Math.max(30000, timeoutMs - 20000)};
  while (Date.now() < until && !fs.existsSync(path.join(root, "host-finish.signal"))) {
    if (!restored && fs.existsSync(path.join(root, "reload-request")) && !fs.existsSync(path.join(root, "reload-started"))) {
      fs.writeFileSync(path.join(root, "reload-started"), String(process.pid));
      await vscode.commands.executeCommand(${JSON.stringify(restartApplication ? "workbench.action.quit" : "workbench.action.reloadWindow")});
    }
    if (!opened && fs.existsSync(path.join(root, "open-group.json"))) {
      const request = JSON.parse(fs.readFileSync(path.join(root, "open-group.json"), "utf8"));
      await vscode.commands.executeCommand("sinitek-cli-tools.openLoopGroupChat", request.taskId);
      opened = true;
      fs.writeFileSync(path.join(root, "group-opened.json"), JSON.stringify({ ok: true, taskId: request.taskId }));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  clearInterval(timer);
  writeFocus();
  if (!fs.existsSync(path.join(root, "host-finish.signal"))) throw new Error("Observation driver did not finish");
  await vscode.commands.executeCommand("workbench.action.quit");
};
`;
}

async function waitUntil(fn, label, ms) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await pause(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function listTargets(port) {
  return fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
}

async function waitForJson(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch { /* starting */ }
    await pause(200);
  }
  throw new Error("DevTools endpoint did not open");
}

async function waitForTarget(port, predicate, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const targets = await listTargets(port);
    const found = targets.find(predicate);
    if (found) return found;
  await pause(200);
  }
  throw new Error("CDP target did not appear");
}

const CDP_EVENT_LIMIT = 32;

function createCdpLog(sessionId) {
  return { sessionId, events: [], errorCount: 0, errorSeen: false, bySession: {} };
}

function cdpEventIsError(message) {
  return message.method === "Runtime.exceptionThrown"
    || (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error");
}

function rememberCdpEvent(log, message) {
  const useful = message.method === "Runtime.executionContextCreated" || cdpEventIsError(message);
  if (!useful) return;
  const key = message.sessionId || log.sessionId || "browser";
  if (cdpEventIsError(message)) {
    log.errorSeen = true;
    log.errorCount += 1;
    const bucket = log.bySession[key] || { errorCount: 0, errorSeen: false };
    bucket.errorSeen = true;
    bucket.errorCount += 1;
    log.bySession[key] = bucket;
  }
  log.events.push(message);
  while (log.events.length > CDP_EVENT_LIMIT) {
    const disposable = log.events.findIndex((event) => event.method !== "Runtime.executionContextCreated");
    if (disposable >= 0) log.events.splice(disposable, 1);
    else log.events.shift();
  }
}

function sessionErrorCount(log, sessionId) {
  if (!log) return 0;
  if (sessionId && log.bySession?.[sessionId]) return log.bySession[sessionId].errorCount;
  return log.errorCount || 0;
}

function encodeMaskedFrame(opcode, payload) {
  if (payload.length >= 65536) throw new Error("CDP payload is too large");
  const mask = crypto.randomBytes(4);
  const extended = payload.length > 125 ? 2 : 0;
  const frame = Buffer.alloc(2 + extended + 4 + payload.length);
  frame[0] = opcode;
  if (extended) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
  } else frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2 + extended);
  for (let index = 0; index < payload.length; index += 1) frame[2 + extended + 4 + index] = payload[index] ^ mask[index % 4];
  return frame;
}

function openLoopbackDebugSocket(port, requestPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const origin = debugAllowOrigin(port);
    const request = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Origin: ${origin}`,
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n");
    let buffer = Buffer.alloc(0);
    let opened = false;
    const cdpLog = createCdpLog("browser");
    const listeners = [];
    const queued = [];
    const api = {
      events: cdpLog.events,
      cdpLog,
      send(data) { socket.write(encodeMaskedFrame(0x81, Buffer.from(data))); },
      close() { socket.end(); },
      addEventListener(type, fn) {
        if (type !== "message") return;
        listeners.push(fn);
        while (queued.length) fn({ data: queued.shift() });
      },
    };
    const fail = (error) => {
      if (!opened) reject(error);
      socket.destroy();
    };
    socket.on("error", () => fail(new Error("DevTools socket failed")));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!opened) {
        const marker = buffer.indexOf("\r\n\r\n");
        if (marker < 0) return;
        const header = buffer.slice(0, marker).toString("utf8");
        if (!header.startsWith("HTTP/1.1 101")) {
          fail(new Error("DevTools upgrade rejected"));
          return;
        }
        buffer = buffer.slice(marker + 4);
        opened = true;
        resolve(api);
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        const lengthByte = buffer[1] & 0x7f;
        let offset = 2;
        let length = lengthByte;
        if (lengthByte === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (lengthByte === 127) {
          fail(new Error("CDP frame is too large"));
          return;
        }
        if (buffer.length < offset + length) return;
        const payload = buffer.slice(offset, offset + length);
        buffer = buffer.slice(offset + length);
        if (opcode === 0x9) {
          socket.write(encodeMaskedFrame(0x8a, payload.length > 125 ? payload.slice(0, 125) : payload));
          continue;
        }
        if (opcode === 0x8) { socket.end(); return; }
        if (opcode !== 0x1) continue;
        const text = payload.toString("utf8");
        if (!listeners.length) queued.push(text);
        else for (const listener of listeners) listener({ data: text });
      }
    });
    socket.once("connect", () => socket.write(request));
  });
}

function connect(port) {
  return fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()).then(async (version) => {
    const debuggerUrl = new URL(version.webSocketDebuggerUrl);
    if (debuggerUrl.hostname !== "127.0.0.1" && debuggerUrl.hostname !== "localhost") {
      throw new Error("DevTools endpoint is not loopback");
    }
    const socket = await openLoopbackDebugSocket(port, `${debuggerUrl.pathname}${debuggerUrl.search}`);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result || {});
      } else if (message.method) rememberCdpEvent(socket.cdpLog, message);
    });
    return {
      socket,
      send(method, params = {}, sessionId) {
        return new Promise((resolveSend, rejectSend) => {
          const id = nextId++;
          pending.set(id, { resolve: resolveSend, reject: rejectSend });
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          setTimeout(() => { if (pending.delete(id)) rejectSend(new Error(`CDP timeout ${method}`)); }, 10000).unref?.();
        });
      },
      close() { socket.close(); },
    };
  });
}

async function attach(browser, target) {
  const attached = await browser.send("Target.attachToTarget", { targetId: target.id, flatten: true });
  await browser.send("Runtime.enable", {}, attached.sessionId);
  await browser.send("Page.enable", {}, attached.sessionId);
  return {
    sessionId: attached.sessionId,
    events: () => (browser.socket.cdpLog?.events || []).filter((event) => !event.sessionId || event.sessionId === attached.sessionId),
    errorCount: () => sessionErrorCount(browser.socket.cdpLog, attached.sessionId),
  };
}

async function bindFrame(browser, session) {
  const frameDeadline = Date.now() + 15000;
  let frameId;
  let tree;
  while (Date.now() < frameDeadline && !frameId) {
    tree = await browser.send("Page.getFrameTree", {}, session.sessionId);
    frameId = tree.frameTree.childFrames?.find((item) => item.frame.name === "active-frame")?.frame.id;
    if (!frameId) await pause(100);
  }
  if (!frameId) throw new Error(`Webview active-frame is missing: ${JSON.stringify(tree).slice(0, 800)}`);
  const deadline = Date.now() + 10000;
  const matchingContext = () => session.events().filter((event) => event.method === "Runtime.executionContextCreated"
    && event.sessionId === session.sessionId
    && event.params.context.auxData?.isDefault === true
    && event.params.context.auxData?.frameId === frameId).at(-1)?.params.context.id;
  let contextId;
  while (Date.now() < deadline && !contextId) {
    contextId = matchingContext();
    if (!contextId) await pause(50);
  }
  if (!contextId) throw new Error("Webview active-frame execution context was not created");
  const contextForFrame = (activeFrameId) => session.events().filter((event) => event.method === "Runtime.executionContextCreated"
    && event.sessionId === session.sessionId
    && event.params.context.auxData?.isDefault === true
    && event.params.context.auxData?.frameId === activeFrameId).at(-1)?.params.context.id;
  return async (expression) => {
    const failed = new Set();
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const treeNow = await browser.send("Page.getFrameTree", {}, session.sessionId);
      const activeFrameId = treeNow.frameTree.childFrames?.find((item) => item.frame.name === "active-frame")?.frame.id || frameId;
      const id = contextForFrame(activeFrameId);
      if (!id || failed.has(id)) {
        await pause(250);
        continue;
      }
      try {
        const result = await browser.send("Runtime.evaluate", {
          expression, contextId: id, returnByValue: true, awaitPromise: true,
        }, session.sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails).slice(0, 500));
        return result.result?.value;
      } catch (error) {
        lastError = error;
        if (!String(error.message || error).includes("Cannot find context")) throw error;
        failed.add(id);
        await pause(250);
      }
    }
    throw lastError || new Error("Cannot find context with specified id");
  };
}

function pageErrors(session) {
  const details = session.events()
    .filter((event) => cdpEventIsError(event))
    .map((event) => JSON.stringify(event.params).slice(0, 300));
  const seen = session.errorCount?.() ?? details.length;
  if (seen > details.length) details.push(`evicted ${seen - details.length} webview error detail(s); session error count ${seen}`);
  return details;
}

async function prepareComposer(evaluate) {
  return evaluate(`(() => {
    const cli = document.querySelector("#currentCli");
    if (cli && cli.value !== "dsh") { cli.value = "dsh"; cli.dispatchEvent(new Event("change", { bubbles: true })); }
    const mode = document.querySelector("#interactiveModeSelect");
    if (!mode) return { missingMode: true, cli: cli ? cli.value : null };
    mode.value = "loop_plus";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    const fullstack = document.querySelector("#loopPlusFullstackToggle");
    if (fullstack && !fullstack.checked) { fullstack.click(); }
    return { cli: document.querySelector("#currentCli")?.value || null, mode: mode.value, fullstack: Boolean(document.querySelector("#loopPlusFullstackToggle")?.checked) };
  })()`);
}

async function confirmAcceptancePlan(evaluate) {
  const deadline = Date.now() + 4000;
  let seen = { shown: false, nameShown: false };
  while (Date.now() < deadline) {
    seen = await evaluate(`(() => {
      const overlay = document.querySelector("#acceptancePlanOverlay");
      const shown = Boolean(overlay && overlay.classList.contains("visible"));
      if (shown) document.querySelector("#confirmAcceptancePlan")?.click();
      const nameOverlay = document.querySelector("#acceptancePlanNameOverlay");
      const nameShown = Boolean(nameOverlay && nameOverlay.classList.contains("visible"));
      if (nameShown) {
        const input = document.querySelector("#acceptancePlanNewName");
        if (input && !input.value.trim()) input.value = "合成续跑验收";
        document.querySelector("#confirmAcceptancePlanName")?.click();
      }
      return { shown, nameShown };
    })()`);
    if (seen.shown || seen.nameShown) break;
    await pause(100);
  }
  return seen;
}

async function waitForLedgerWriters(root) {
  const deadline = Date.now() + 8000;
  let previous = null;
  while (Date.now() < deadline) {
    const ledger = readFixtureLedger(root);
    if (ledger.missing) return { ok: false, ledger, reason: "continue ledger is missing" };
    if (ledger.corrupt) return { ok: false, ledger, reason: "continue ledger is corrupt" };
    const sample = sampleProcesses();
    if (!sample.ok) return { ok: false, ledger, reason: "ps sample failed while waiting for ledger writers" };
    const text = fs.readFileSync(path.join(root, "fixture-events.jsonl"), "utf8");
    const alive = [...new Set([...ledger.pids, ...allLedgerPids(text)])].filter((pid) => sample.rows.some((row) => row.pid === pid));
    if (!alive.length && previous === text) return { ok: true, ledger };
    previous = text;
    await pause(100);
  }
  return { ok: false, ledger: readFixtureLedger(root), reason: "ledger writers still running" };
}

async function drive({ root, port, home, candidate, extensionId, report, restoreEditor, relaunch, dropMainTab, crashApplication }) {
  const readyDeadline = Date.now() + 70000;
  while (Date.now() < readyDeadline && !fs.existsSync(path.join(root, "host-ready.json"))) {
    if (report.exit) throw new Error(`VS Code exited before ready: ${JSON.stringify(report.exit)}`);
    await pause(200);
  }
  const activation = readJson(path.join(root, "host-ready.json"));
  if (!activation) throw new Error("Extension host ready marker was not written");
  report.activation = {
    vscode: activation.vscode,
    extensionId: activation.extensionId,
    isActive: activation.isActive,
    extensionPathMatchesCopy: fs.realpathSync(activation.extensionPath) === fs.realpathSync(candidate),
    homeIsolated: fs.realpathSync(activation.home) === fs.realpathSync(home),
  };
  assert.equal(report.activation.extensionPathMatchesCopy, true);
  assert.equal(report.activation.homeIsolated, true);
  assert.equal(activation.isActive, true);
  assert.equal(activation.extensionId, extensionId);
  await waitForJson(port, readyDeadline);
  let browser = await connect(port);
  try {
    const panel = await waitForTarget(port, (item) => item.type === "iframe" && item.url.includes("purpose=webviewView") && item.url.includes(extensionId), 30000);
    const panelEvaluate = await bindFrame(browser, await attach(browser, panel));
    await waitUntil(async () => (await panelEvaluate("document.querySelectorAll('.conversation-tab').length")) > 0, "conversation tabs", 30000);
    report.composer = await prepareComposer(panelEvaluate);
    await pause(300);
    report.sentPrompt = await panelEvaluate(`(() => {
      const input = document.querySelector("#promptInput");
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(ROOT_PROMPT)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const sent = input.value;
      document.querySelector("#sendPrompt")?.click();
      return { sent, length: sent.length };
    })()`);
    report.acceptancePlan = await confirmAcceptancePlan(panelEvaluate);
    const task = await waitUntil(async () => {
      const found = listTasks(home).find((item) => item.schedulingMode === "event_driven" && item.rootPrompt.includes("合成可继续"));
      return found || null;
    }, "synthetic Loop+ task", 30000);
    report.task = task;
    const openedFromPanel = await panelEvaluate(`(() => {
      const button = document.querySelector("#openCurrentLoopGroupChat");
      const visible = Boolean(button && button.style.display !== "none" && !button.disabled);
      if (visible) button.click();
      return { visible, label: button ? (button.getAttribute("aria-label") || button.textContent || "") : "" };
    })()`);
    report.groupChatButton = openedFromPanel;
    if (!openedFromPanel.visible) {
      fs.writeFileSync(path.join(root, "open-group.json"), JSON.stringify({ taskId: task.id }));
      await waitUntil(async () => fs.existsSync(path.join(root, "group-opened.json")), "group chat command", 15000);
      report.groupOpen = readJson(path.join(root, "group-opened.json"));
    }
    const isGroupEditor = (item) => item.type === "iframe" && item.url.includes(extensionId) && !item.url.includes("purpose=webviewView");
    const groupTarget = await waitForTarget(port, isGroupEditor, 20000);
    let groupSession = await attach(browser, groupTarget);
    let groupEvaluate = await bindFrame(browser, groupSession);
    await waitUntil(async () => groupEvaluate(`(() => {
      const loading = document.querySelector("#groupChatLoading");
      return Boolean(loading && loading.hidden) || Boolean(document.querySelector("#panelActions"));
    })()`), "group chat rendered", 20000);
    await waitUntil(async () => groupEvaluate(`Boolean(document.querySelector('[data-action="stopTask"]:not(:disabled)'))`), "running task stop button", 20000);
    report.beforeContinue = await groupEvaluate(`(() => ({
      taskId: document.body?.getAttribute("data-task-id") || "",
      continueDisabled: document.querySelector('[data-action="continueTask"]')?.disabled ?? null,
      hasContinue: Boolean(document.querySelector('[data-action="continueTask"]')),
      hasStop: Boolean(document.querySelector('[data-action="stopTask"]')),
      statusText: (document.querySelector("#panelSubtitle")?.textContent || "").slice(0, 160),
    }))()`);
    assert.equal(report.beforeContinue.hasContinue, false);
    if (restoreEditor && (!relaunch || dropMainTab || crashApplication)) {
      await waitUntil(() => readFixtureLedger(root).setupSessions?.length, "original main CLI session", 20000);
    }
    if (crashApplication) {
      report.task = listTasks(home).find((item) => item.id === task.id);
      assert.equal(report.task?.status, "running");
      assert.deepEqual(readFixtureLedger(root).setupSessions, [report.task.sessionId]);
    } else {
      report.stopClick = await groupEvaluate(`(() => {
        const button = document.querySelector('[data-action="stopTask"]');
        if (!button || button.disabled) return { clicked: false };
        button.click();
        return { clicked: true, text: button.textContent || "" };
      })()`);
      await waitUntil(async () => {
        const current = listTasks(home).find((item) => item.id === task.id);
        return current?.status === "stopped" ? current : null;
      }, "stopped synthetic task", 20000).then((current) => { report.task = current; });
      fs.writeFileSync(path.join(root, "release-setup"), "stopped\n");
    }
    if (!crashApplication) await waitUntil(async () => groupEvaluate(`(() => {
      const button = document.querySelector('[data-action="continueTask"]');
      return Boolean(button && !button.disabled);
    })()`), "enabled continue button", 20000);
    let restartSettingsFile;
    if (restoreEditor) {
      const settingsDir = path.join(home, ".sinitek_cli", "workspace-settings");
      restartSettingsFile = path.join(settingsDir, fs.readdirSync(settingsDir).find((name) => name.endsWith(".json")));
      const tabs = readJson(restartSettingsFile).conversationTabs;
      const mainTabId = tabs.activeTabId;
      assert.ok(mainTabId);
      const sessionId = tabs.tabs.find((tab) => tab.id === mainTabId).sessionId;
      assert.ok(sessionId, "synthetic main session was not recorded before restart");
      const originalMessageIds = taskMessageIds(home, task, sessionId);
      assert.ok(originalMessageIds.length, "original session must contain the synthetic task");
      const setupSessions = readFixtureLedger(root).setupSessions || [];
      if (dropMainTab) assert.deepEqual(setupSessions, [report.task.sessionId], "saved task must identify the native main session");
      await panelEvaluate(`document.querySelector('#newSession').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      const otherTabId = await waitUntil(() => {
        const current = readJson(restartSettingsFile)?.conversationTabs;
        return current?.tabs.length === 2 && current.activeTabId !== mainTabId && current.activeTabId;
      }, "unrelated conversation tab selected", 10000);
      if (crashApplication) {
        fs.writeFileSync(path.join(root, "crash-task.json"), JSON.stringify({ taskId: task.id }));
        fs.writeFileSync(path.join(root, "reload-started"), String(activation.pid));
      } else fs.writeFileSync(path.join(root, "reload-request"), "reload");
      if (relaunch) {
        browser.close();
        await relaunch(() => {
          if (!dropMainTab) return;
          const settings = readJson(restartSettingsFile);
          settings.conversationTabs.tabs = settings.conversationTabs.tabs.filter((tab) => tab.id !== mainTabId);
          assert.deepEqual(settings.conversationTabs.tabs.map((tab) => tab.id), [otherTabId]);
          fs.writeFileSync(restartSettingsFile, JSON.stringify(settings));
        });
        await waitForJson(port, Date.now() + 30000);
        browser = await connect(port);
      }
      const after = await waitUntil(() => {
        const next = readJson(path.join(root, "host-ready.json"));
        return next && next.pid !== activation.pid && next;
      }, "new extension host for the same workspace", 40000);
      assert.equal(after.extensionPath, activation.extensionPath);
      const revived = await waitForTarget(port, (item) => item.id !== groupTarget.id && isGroupEditor(item), 25000);
      groupSession = await attach(browser, revived);
      groupEvaluate = await bindFrame(browser, groupSession);
      await waitUntil(() => groupEvaluate(`document.body?.dataset.taskId === ${JSON.stringify(task.id)} && !!document.querySelector('[data-action="continueTask"]:not(:disabled)')`), "restored original group chat", 20000);
      assert.equal(readFixtureLedger(root).continueCalls, 0);
      await groupEvaluate('document.body.dataset.restartSmoke = "restored"');
      assert.equal(readJson(restartSettingsFile).conversationTabs.activeTabId, otherTabId);
      report.restart = { mainTabId, sessionId, originalMessageIds, setupSessions, otherTabId, beforePid: activation.pid, afterPid: after.pid };
    }
    const identity = await groupEvaluate(`(() => ({
      taskId: document.body?.getAttribute("data-task-id") || "",
      title: document.title || "",
      heading: document.querySelector("#panelHeading")?.textContent || "",
      subtitle: document.querySelector("#panelSubtitle")?.textContent || "",
      continueText: (document.querySelector('[data-action="continueTask"]')?.innerText || "").replace(/\\s+/g, " ").trim(),
    }))()`);
    report.identity = identity;
    const pagesBefore = readJson(path.join(root, "workbench-focus.json"))?.latest || null;
    const targetsBefore = (await listTargets(port)).filter((item) => item.type === "iframe" && /webview/i.test(item.url) && !String(item.url).includes("purpose=webviewView"));
    report.pagesBefore = {
      editorTabs: pagesBefore?.count ?? null,
      groupChatTabs: pagesBefore?.groupChat || [],
      groupWebviewTargets: targetsBefore.length,
    };
    const first = await groupEvaluate(`(() => {
      const button = document.querySelector('[data-action="continueTask"]');
      if (!button || button.disabled) return { ok: false, reason: "continue-unavailable" };
      button.click();
      const backdrop = document.querySelector("#continueDialogBackdrop");
      const visible = Boolean(backdrop && backdrop.classList.contains("visible"));
      const input = document.querySelector("#continueDialogInput");
      if (input) {
        input.focus();
        input.value = ${JSON.stringify(CONTINUE_MARKER)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const confirm = document.querySelector("#continueDialogConfirm");
      confirm?.click();
      confirm?.click();
      const live = document.querySelector('[data-action="continueTask"]');
      live?.click();
      return {
        ok: true,
        dialogOpened: visible,
        dialogTitle: document.querySelector("#continueDialogTitle")?.textContent || "",
        afterBusy: live?.getAttribute("aria-busy") || "",
        afterDisabled: Boolean(live?.disabled),
        afterLabel: live?.getAttribute("aria-label") || "",
        dialogStillOpen: Boolean(document.querySelector("#continueDialogBackdrop")?.classList.contains("visible")),
      };
    })()`);
    report.firstRequest = first;
    await waitUntil(async () => {
      const state = readFixtureLedger(root);
      return state.continueCalls >= 1 ? state : null;
    }, "first continue main call", 30000);
    await pause(500);
    const during = readFixtureLedger(root);
    const repeat = await groupEvaluate(`(() => {
      const button = document.querySelector('[data-action="continueTask"]');
      const before = {
        disabled: Boolean(button?.disabled),
        busy: button?.getAttribute("aria-busy") || "",
        label: button?.getAttribute("aria-label") || "",
        text: (button?.innerText || "").replace(/\\s+/g, " ").trim(),
      };
      button?.click();
      const backdrop = document.querySelector("#continueDialogBackdrop");
      const opened = Boolean(backdrop && backdrop.classList.contains("visible"));
      if (opened) {
        const input = document.querySelector("#continueDialogInput");
        if (input) input.value = ${JSON.stringify(CONTINUE_MARKER)};
        const confirm = document.querySelector("#continueDialogConfirm");
        confirm?.click();
        confirm?.click();
      }
      return { before, openedAfterRepeat: opened, dialogStillOpen: Boolean(document.querySelector("#continueDialogBackdrop")?.classList.contains("visible")) };
    })()`);
    await pause(700);
    const afterRepeat = readFixtureLedger(root);
    if (restoreEditor) {
      const current = readJson(restartSettingsFile).conversationTabs;
      if (dropMainTab) {
        assert.ok(current.tabs.every((tab) => tab.id !== report.restart.mainTabId));
        assert.ok(current.tabs.some((tab) => tab.id === report.restart.otherTabId));
        assert.notEqual(current.activeTabId, report.restart.otherTabId);
      } else assert.equal(current.activeTabId, report.restart.mainTabId);
      assert.equal(current.tabs.length, 2);
      const sessionId = current.tabs.find((tab) => tab.id === current.activeTabId).sessionId;
      assert.deepEqual(afterRepeat.continueSessions, [sessionId], "CLI must receive the request in the restored main tab's session");
      if (!report.restart.sessionId.startsWith("local_")) assert.equal(sessionId, report.restart.sessionId);
      for (const originalSession of report.restart.setupSessions) assert.equal(sessionId, originalSession);
      const messageIds = taskMessageIds(home, task, sessionId);
      assert.ok(report.restart.originalMessageIds.every((id) => messageIds.includes(id)), "restored session must retain the original main messages");
      report.restart.resumedSessionId = sessionId;
      const sidebar = await waitForTarget(port, (item) => item.type === "iframe" && item.url.includes("purpose=webviewView") && item.url.includes(extensionId), 15000);
      const evaluate = await bindFrame(browser, await attach(browser, sidebar));
      assert.equal(await evaluate(`(() => { const button = document.querySelector('#openCurrentLoopGroupChat'); if (!button || button.disabled || !button.getClientRects().length) return false; button.click(); return true; })()`), true);
      await waitUntil(() => groupEvaluate('document.body.dataset.restartSmoke === "restored"'), "same editor after task tab click", 10000);
    }
    if (afterRepeat.missing || afterRepeat.corrupt) {
      throw new Error("continue ledger is missing or corrupt before the final sample");
    }
    const identityAfter = await groupEvaluate(`(() => ({
      taskId: document.body?.getAttribute("data-task-id") || "",
      title: document.title || "",
      continueText: (document.querySelector('[data-action="continueTask"]')?.innerText || "").replace(/\\s+/g, " ").trim(),
      busy: document.querySelector('[data-action="continueTask"]')?.getAttribute("aria-busy") || "",
      disabled: Boolean(document.querySelector('[data-action="continueTask"]')?.disabled),
    }))()`);
    const pagesAfterRaw = readJson(path.join(root, "workbench-focus.json"))?.latest || null;
    const targetsAfter = (await listTargets(port)).filter((item) => item.type === "iframe" && /webview/i.test(item.url) && !String(item.url).includes("purpose=webviewView"));
    report.repeat = repeat;
    report.identityAfter = identityAfter;
    report.pagesAfter = {
      editorTabs: pagesAfterRaw?.count ?? null,
      groupChatTabs: pagesAfterRaw?.groupChat || [],
      groupWebviewTargets: targetsAfter.length,
    };
    report.webviewErrors = pageErrors(groupSession);
    fs.writeFileSync(path.join(root, "release-continue"), "release\n");
    const settled = await waitForLedgerWriters(root);
    const finalLedger = settled.ledger || readFixtureLedger(root);
    report.mainCalls = { during, afterRepeat, final: finalLedger };
    const sameGroup = report.pagesBefore.groupChatTabs.length === 1
      && report.pagesAfter.groupChatTabs.length === 1
      && report.pagesBefore.groupChatTabs[0].label === report.pagesAfter.groupChatTabs[0].label;
    report.blockSignal = identity.taskId !== task.id || identityAfter.taskId !== task.id || !sameGroup;
    const repeatGate = assessGroupContinuePass({
      checkExit: false,
      repeat,
      continueCalls: finalLedger.continueCalls,
      ledgerMissing: finalLedger.missing === true,
      ledgerCorrupt: finalLedger.corrupt === true,
      sampleFailed: false,
    });
    const problems = [...repeatGate.problems];
    if (!settled.ok) problems.push(settled.reason || "ledger writers did not exit");
    if (!first.ok || !first.dialogOpened) problems.push("first continue dialog did not open from the group chat button");
    if (first.afterBusy !== "true" || first.afterDisabled !== true) problems.push(`first request feedback was ${JSON.stringify({ busy: first.afterBusy, disabled: first.afterDisabled, label: first.afterLabel })}`);
    if (!String(first.afterLabel).includes("正在启动续跑")) problems.push("first request did not show 正在启动续跑");
    if (identity.taskId !== task.id || identityAfter.taskId !== task.id) problems.push("group chat task identity changed or did not match the synthetic task");
    if (!sameGroup || report.pagesBefore.groupWebviewTargets !== 1 || report.pagesAfter.groupWebviewTargets !== 1) problems.push("group chat page count did not stay on the original page");
    if (report.pagesBefore.editorTabs !== report.pagesAfter.editorTabs) problems.push("editor page count changed during the repeated continue");
    if (report.webviewErrors.length) problems.push(`webview errors: ${report.webviewErrors.slice(0, 3).join(" | ")}`);
    report.problems = problems;
    report.assertions = {
      passed: problems.length === 0,
      originalTaskId: task.id,
      originalGroupTitle: identity.title,
      groupChatPages: report.pagesAfter.groupChatTabs.length,
      editorPages: report.pagesAfter.editorTabs,
      firstFeedback: { busy: first.afterBusy, disabled: first.afterDisabled, label: first.afterLabel, dialogOpened: first.dialogOpened },
      repeatFeedback: repeat,
      mainContinueCalls: finalLedger.continueCalls,
      continuePids: finalLedger.pids,
      ledgerMissing: finalLedger.missing === true,
      ledgerCorrupt: finalLedger.corrupt === true,
    };
    if (problems.length) throw new Error(problems.join("; "));
  } finally {
    browser.close();
  }
}

function membersMatchConfirmed(confirmed, nextRows, launchPid) {
  if (!nextRows.length) return true;
  const confirmedByPid = new Map(confirmed.map((row) => [row.pid, row]));
  return nextRows.every((row) => {
    const prior = confirmedByPid.get(row.pid);
    return prior && prior.ppid === row.ppid && prior.pgid === row.pgid && row.pgid === launchPid;
  });
}

function planEscalationFromConfirmed(confirmed, firstSample, secondSample, launchPid) {
  if (!firstSample?.ok || !secondSample?.ok) {
    return { signal: null, retain: true, result: "unverified", reason: "ps sample failed" };
  }
  const firstRows = firstSample.rows || [];
  const secondRows = secondSample.rows || [];
  const agrees = ownershipStable(firstRows, secondRows, launchPid);
  const matches = membersMatchConfirmed(confirmed, secondRows, launchPid);
  if (!agrees || !matches) {
    return { signal: null, retain: true, result: "unverified", reason: "ownership no longer matches the pre-SIGTERM set" };
  }
  if (!secondRows.length) return { signal: null, retain: true, result: "drained", reason: "exited before SIGKILL" };
  return { signal: "SIGKILL", retain: true, result: "signaled", reason: "SIGKILL" };
}

function ownershipStable(previousRows, nextRows, launchPid) {
  if (!nextRows.length) return true;
  const previous = new Map(previousRows.map((row) => [row.pid, row]));
  return nextRows.every((row) => {
    const prior = previous.get(row.pid);
    return prior && prior.ppid === row.ppid && prior.pgid === row.pgid && row.pgid === launchPid;
  });
}

async function cleanupLaunch(child, report) {
  if (!child?.pid) {
    report.cleanup = { result: "unverified", reason: "missing launch pid", signaled: false, retain: true };
    report.sampleFailed = true;
    return;
  }
  const launchPid = child.pid;
  const deadline = Date.now() + 20000;
  while (!report.exit && Date.now() < deadline) await pause(200);
  if (report.blockSignal) {
    report.cleanup = { result: "retained", reason: "identity changed; no signal", signaled: false, retain: true };
    return;
  }
  if (report.exit?.exitCode === 0 && !report.exit.signal) {
    const grace = Date.now() + 5000;
    while (Date.now() < grace) {
      const sample = sampleProcesses();
      if (!sample.ok) {
        report.sampleFailed = true;
        report.cleanup = { result: "unverified", reason: "ps sample failed", signaled: false, retain: true };
        return;
      }
      if (!ownedRows(sample, launchPid).length) {
        report.cleanup = { result: "drained", signaled: false, retain: false };
        return;
      }
      await pause(200);
    }
  }
  const first = sampleProcesses();
  await pause(150);
  const second = sampleProcesses();
  const sampleOk = first.ok && second.ok;
  const firstRows = sampleOk ? ownedRows(first, launchPid) : [];
  const secondRows = sampleOk ? ownedRows(second, launchPid) : [];
  const stable = sampleOk && ownershipStable(firstRows, secondRows, launchPid);
  const action = planCleanupAction({
    blockSignal: false,
    sampleOk,
    stable,
    ownedCount: secondRows.length,
    exited: Boolean(report.exit),
    escalate: false,
  });
  if (!sampleOk) report.sampleFailed = true;
  if (action.signal !== "SIGTERM") {
    report.cleanup = { result: action.result, reason: action.reason, signaled: false, retain: action.retain === true };
    return;
  }
  try { process.kill(-launchPid, "SIGTERM"); }
  catch (error) {
    report.cleanup = { result: "unverified", reason: String(error), signaled: false, retain: true };
    return;
  }
  const killDeadline = Date.now() + 5000;
  const confirmed = secondRows.map((row) => ({ ...row }));
  let remaining = confirmed;
  let previousRemaining = confirmed;
  while (Date.now() < killDeadline) {
    const sample = sampleProcesses();
    if (!sample.ok) {
      report.sampleFailed = true;
      report.cleanup = { result: "unverified", reason: "ps sample failed after SIGTERM", signaled: "SIGTERM", retain: true };
      return;
    }
    remaining = ownedRows(sample, launchPid);
    if (remaining.length && !membersMatchConfirmed(confirmed, remaining, launchPid)) {
      report.cleanup = { result: "unverified", reason: "ownership no longer matches the pre-SIGTERM set", signaled: "SIGTERM", retain: true };
      return;
    }
    previousRemaining = remaining;
    if (!remaining.length) break;
    await pause(100);
  }
  if (!remaining.length) {
    report.cleanup = { result: "drained", signaled: true, retain: true };
    return;
  }
  const beforeKill = { ok: true, rows: previousRemaining };
  await pause(100);
  const afterSample = sampleProcesses();
  const afterKill = { ok: afterSample.ok, rows: afterSample.ok ? ownedRows(afterSample, launchPid) : [] };
  const escalate = planEscalationFromConfirmed(confirmed, beforeKill, afterKill, launchPid);
  if (escalate.signal !== "SIGKILL") {
    report.sampleFailed = !beforeKill.ok || !afterKill.ok;
    report.cleanup = { result: "unverified", reason: escalate.reason, signaled: "SIGTERM", retain: true };
    return;
  }
  try { process.kill(-launchPid, "SIGKILL"); } catch { /* the group already exited */ }
  await pause(200);
  const last = sampleProcesses();
  if (!last.ok) {
    report.sampleFailed = true;
    report.cleanup = { result: "unverified", reason: "ps sample failed after SIGKILL", signaled: "SIGKILL", retain: true };
    return;
  }
  const leftover = ownedRows(last, launchPid);
  report.cleanup = leftover.length
    ? { result: "unverified", reason: "owned processes remained", signaled: "SIGKILL", retain: true }
    : { result: "drained", signaled: true, retain: true };
}

function productLoopLines(home) {
  const dir = path.join(home, ".sinitek_cli", "logs");
  if (!fs.existsSync(dir)) return [];
  const lines = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".log")) continue;
    let text = "";
    try { text = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    if (text.length > 1_500_000) text = text.slice(-1_500_000);
    for (const line of text.split("\n")) {
      if (/^\[/.test(line) && /loop-plus-(started|protocol|main-terminal|main-interrupted|invocation)|loop-group-chat-continue|hiddenRetry|main-ai/i.test(line)) {
        lines.push(line.replace(/\/Users\/[^ "']+/g, "<path>").slice(0, 360));
      }
    }
  }
  return lines.slice(-40);
}

async function runGroupContinueHost(options) {
  assert.equal(process.platform, "darwin", "group-continue-panel is macOS Extension Development Host evidence");
  const product = options.product;
  const restoreEditor = options.reloadWindow || options.restartApplication;
  const timeoutMs = options.timeoutMs || 210000;
  const code = vscodeExecutable();
  assert.ok(fs.existsSync(code), `未找到 VS Code：${code}`);
  runRound747SyntheticChecks();
  const root = fs.mkdtempSync(path.join("/tmp", "lp747gc-"));
  const candidate = path.join(root, "candidate");
  const fingerprint = copyCandidateExtension(product, candidate);
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
  const extensionId = `${manifest.publisher}.${manifest.name}`;
  const tmp = path.join(root, "t");
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const extensions = path.join(root, "extensions");
  const workspace = path.join(root, "workspace");
  for (const dir of [tmp, path.join(home, ".sinitek_cli"), path.join(userData, "User"), extensions, workspace]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, "unrelated.txt"), "unrelated editor tab\n");
  const fixturePath = path.join(root, "dsh-fixture.cjs");
  fs.writeFileSync(fixturePath, cliFixtureSource(root));
  fs.chmodSync(fixturePath, 0o755);
  const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
  fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({
    humanInteractionEnabled: false,
    autoCompactContextAfterRun: false,
    autoCompactContextBeforeRun: false,
    memoryAutoExtractAfterCompact: false,
    memoryAutoExtractAfterLoopTask: false,
    currentCli: "dsh",
    cliEnabledByName: Object.fromEntries(clis.map((cli) => [cli, cli === "dsh"])),
  }));
  fs.writeFileSync(path.join(userData, "User/settings.json"), JSON.stringify({
    "window.title": "Sinitek isolated Loop+ group continue",
    "window.confirmBeforeClose": "never",
    "workbench.startupEditor": "none",
    "security.workspace.trust.enabled": false,
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "update.mode": "none",
    "telemetry.telemetryLevel": "off",
    "window.restoreWindows": options.restartApplication ? "all" : "none",
    "sinitek-cli-tools.autoOpenPanel": false,
    "sinitek-cli-tools.defaultCli": "dsh",
    "sinitek-cli-tools.humanInteractionNotifications": false,
    "sinitek-cli-tools.thinkingMode": "low",
    "sinitek-cli-tools.thinkingModeDsh": "low",
    "sinitek-cli-tools.args.dsh": [],
    ...Object.fromEntries(clis.map((cli) => [`sinitek-cli-tools.commands.${cli}`, cli === "dsh" ? fixturePath : "/usr/bin/true"])),
  }, null, 2));
  const dshModels = require(path.join(candidate, "dist/cli/dshConfigModels.js"));
  const dshConfig = require(path.join(candidate, "dist/config/dshConfig.js"));
  const profile = JSON.parse(dshModels.createDshExampleProfileText());
  profile.apiKey = "";
  profile.baseURL = "http://127.0.0.1:9/v1";
  const dshPaths = dshConfig.resolveDshConfigPaths({ HOME: home, USERPROFILE: home }, home);
  const activated = await dshConfig.activateDshProfile({ profileId: "group-continue-local", content: JSON.stringify(profile), paths: dshPaths });
  if (!activated.ok) throw new Error(activated.error || "DSH profile was not activated");
  const appliedProfile = fs.readFileSync(dshPaths.appliedProfilePath, "utf8");
  const now = Date.now();
  fs.writeFileSync(path.join(dshPaths.configDir, `${activated.profileId}.json`), JSON.stringify({
    id: activated.profileId, name: "group continue local", platform: "dsh", content: appliedProfile, configContent: appliedProfile, createdAt: now, updatedAt: now,
  }, null, 2));
  const workspaceBase = path.basename(workspace).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 32) || "workspace";
  const workspaceKey = `${workspaceBase}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
  const workspaceSettingsDir = path.join(home, ".sinitek_cli", "workspace-settings");
  fs.mkdirSync(workspaceSettingsDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceSettingsDir, `${workspaceKey}.json`), JSON.stringify({
    currentCli: "dsh",
    activeConfigIdByCli: { dsh: activated.profileId },
    interactiveModeByCli: { dsh: "loop_plus" },
  }, null, 2));
  const port = await freePort();
  const testEntry = path.join(root, "extension-host-test.js");
  const entrySource = testEntrySource({ root, home, candidate, extensionId, timeoutMs, restartApplication: options.restartApplication });
  if (restoreEditor) {
    const driver = path.join(extensions, "fixture.loop-reload-driver-1.0.0");
    fs.mkdirSync(driver, { recursive: true });
    fs.writeFileSync(path.join(driver, "package.json"), JSON.stringify({ name: "loop-reload-driver", publisher: "fixture", version: "1.0.0",
      engines: { vscode: "^1.104.0" }, main: "./driver.js", activationEvents: ["onStartupFinished"] }));
    fs.writeFileSync(path.join(driver, "driver.js"), entrySource + `\nexports.activate = () => { void exports.run().catch(error => fs.writeFileSync(${JSON.stringify(path.join(root, "driver-error"))}, String(error))); };`);
  } else {
    fs.writeFileSync(testEntry, entrySource);
  }
  const env = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "SHELL"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    APPDATA: path.join(home, "AppData/Roaming"),
    LOCALAPPDATA: path.join(home, "AppData/Local"),
    CODEX_HOME: path.join(home, ".codex"),
  });
  const args = [
    "--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry",
    "--disable-workspace-trust", "--use-inmemory-secretstorage", "--log=trace", "--enable-logging=stderr",
    `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--remote-allow-origins=${debugAllowOrigin(port)}`,
    `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`,
    `--extensionDevelopmentPath=${candidate}`, ...(restoreEditor ? [] : [`--extensionTestsPath=${testEntry}`]), workspace,
  ];
  const report = {
    ok: false,
    root,
    candidateCopied: true,
    fingerprint,
    extensionId,
    host: "real-extension-development-host",
    cli: "local-dsh-jsonrpc-stub",
    command: code,
    args: args.map((arg) => arg.replace(root, "<run-root>")),
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  };
  const launch = () => {
    const logFd = fs.openSync(path.join(root, "vscode.log"), "a");
    const instance = cp.spawn(code, args, { env, detached: true, stdio: ["ignore", logFd, logFd] });
    fs.closeSync(logFd);
    report.pid = instance.pid;
    instance.once("exit", (exitCode, signal) => { report.exit = { exitCode, signal }; });
    instance.once("error", (error) => { report.exit = { exitCode: null, signal: null, spawnError: error.message }; });
    instance.unref();
    return instance;
  };
  let child = launch();
  const relaunch = async (whileStopped) => {
    if (options.crashApplication) {
      const owned = ownedRows(sampleProcesses(), child.pid);
      const hostPid = readJson(path.join(root, "host-ready.json"))?.pid;
      assert.ok(owned.some((row) => row.pid === child.pid && row.ppid === process.pid && row.pgid === child.pid));
      assert.ok(owned.some((row) => row.pid === hostPid && row.pgid === child.pid));
      assert.equal(child.kill("SIGKILL"), true);
    }
    const exit = await waitUntil(() => report.exit, "first VS Code process to exit", 30000);
    const firstLaunch = { pid: child.pid, exit };
    report.firstLaunch = firstLaunch;
    if (options.crashApplication) {
      assert.equal(exit.signal, "SIGKILL");
      await waitUntil(() => {
        const sample = sampleProcesses();
        return sample.ok && !ownedRows(sample, child.pid).length;
      }, "crashed instance and its child processes drained", 20000);
    } else assert.equal(exit.exitCode, 0);
    await cleanupLaunch(child, firstLaunch);
    assert.equal(firstLaunch.cleanup.result, "drained");
    assert.equal(firstLaunch.cleanup.signaled, false);
    whileStopped();
    delete report.exit;
    child = launch();
    assert.notEqual(child.pid, firstLaunch.pid);
  };
  try {
    await drive({ root, port, home, candidate, extensionId, report, restoreEditor, relaunch: options.restartApplication ? relaunch : undefined, dropMainTab: options.dropMainTab, crashApplication: options.crashApplication });
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error && error.stack ? error.stack : String(error);
    report.fixture = readFixtureLedger(root);
    report.tasks = listTasks(home);
    report.productLoopLines = productLoopLines(home);
    const logPath = path.join(root, "vscode.log");
    if (fs.existsSync(logPath)) {
      const text = fs.readFileSync(logPath, "utf8");
      report.vscodeLogExcerpt = boundedLines(text, /error|Error|EINVAL|extensionHost|activate/i, 25)
        .map((line) => line.replace(/\/Users\/[^ "']+/g, "<path>").slice(0, 400));
    }
  } finally {
    try { fs.writeFileSync(path.join(root, "host-finish.signal"), "finish\n"); } catch { /* host already gone */ }
    await cleanupLaunch(child, report);
    report.hostNotes = collectHostNotes(home, userData);
    const knownWarnings = (report.hostNotes.notes || []).filter((line) => /EINVAL|AgentHost/i.test(line));
    report.knownHostWarnings = knownWarnings.slice(-5);
    if ((report.hostNotes.pluginErrors || []).length) {
      report.ok = false;
      report.pluginError = report.hostNotes.pluginErrors;
    }
    const exitGate = assessGroupContinuePass({
      repeat: report.repeat,
      continueCalls: report.mainCalls?.final?.continueCalls,
      ledgerMissing: report.mainCalls?.final?.missing === true,
      ledgerCorrupt: report.mainCalls?.final?.corrupt === true,
      exit: report.exit,
      cleanup: report.cleanup,
      sampleFailed: report.sampleFailed === true,
    });
    if (!exitGate.passed) {
      report.ok = false;
      report.gateProblems = exitGate.problems;
    }
    const retain = report.blockSignal === true || report.sampleFailed === true || report.cleanup?.retain === true
      || report.cleanup?.result !== "drained" || report.cleanup?.signaled !== false;
    const evidenceDir = options.evidenceDir || path.join(product, ".tmp/loop-plus-protocol-regression");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const portable = { ...report, root: retain ? "<retained>" : "removed" };
    const scenario = options.crashApplication ? "group-continue-crash" : options.dropMainTab ? "group-continue-restart-missing-main" : options.restartApplication ? "group-continue-restart" : options.reloadWindow ? "group-continue-reload" : "group-continue";
    fs.writeFileSync(path.join(evidenceDir, `${scenario}-last.json`), `${JSON.stringify(portable, null, 2)}\n`);
    if (!retain) fs.rmSync(root, { recursive: true, force: true });
    report.rootRemoved = !fs.existsSync(root);
  }
  return report;
}

module.exports = {
  CONTINUE_MARKER,
  ROOT_PROMPT,
  aggregateFixtureLedger,
  assessGroupContinuePass,
  planCleanupAction,
  planEscalationFromConfirmed,
  copyCandidateExtension,
  runSyntheticGateSelfCheck,
  runRound747SyntheticChecks,
  runGroupContinueHost,
};

if (require.main === module) {
  try {
    console.log(JSON.stringify(runRound747SyntheticChecks()));
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
