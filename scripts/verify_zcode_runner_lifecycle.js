"use strict";

// No model calls: exercise the public runner and observe its unmodified native wire.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { trackChild } = require("./verify_codex_thread_handoff");

async function within(promise, milliseconds, phase) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase}超时`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function createProtocolObserver({ role, record, errors, readZcodeSnapshot, readZcodeSessionId }) {
  const pending = new Map();
  const serverRequests = new Map();
  const observe = (line, direction) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      assert.ok(message && typeof message === "object" && !Array.isArray(message) && !("jsonrpc" in message), "invalid-wire");
      const isRequest = typeof message.method === "string" && !("result" in message) && !("error" in message);
      const validId = typeof message.id === "string" || typeof message.id === "number";
      if (direction === "outgoing" && isRequest) {
        assert.ok(validId && !pending.has(message.id), "invalid-request-id");
        assert.ok(["session/create", "session/resume", "session/subscribe", "session/read", "session/close", "session/setMode"].includes(message.method), "禁止可能调用模型的操作");
        pending.set(message.id, message.method);
        record({ role, kind: "request", id: message.id, method: message.method, sessionId: message.params?.sessionId,
          ...(message.method === "session/create" ? { titleGenerationEnabled: message.params?.titleGenerationEnabled } : {}) });
      } else if (direction === "incoming" && isRequest && validId) {
        assert.ok(message.method === "session/requestRuntimePreferences" && !serverRequests.has(message.id), "unexpected-server-request");
        serverRequests.set(message.id, message.method);
        record({ role, kind: "server_request", id: message.id, method: message.method });
      } else if (validId && ("result" in message || "error" in message)) {
        const requests = direction === "outgoing" ? serverRequests : pending;
        const method = requests.get(message.id);
        assert.ok(method, "unknown-response-id");
        requests.delete(message.id);
        const event = { role, kind: direction === "outgoing" ? "client_response" : "response", id: message.id,
          method, failed: Boolean(message.error), rpcCode: message.error?.code };
        if (!message.error && direction === "incoming" && ["session/create", "session/resume", "session/read"].includes(method)) {
          event.sessionId = readZcodeSessionId(readZcodeSnapshot(message.result));
          event.protocolConfirmed = true;
        }
        record(event);
      } else assert.ok(direction === "incoming" && isRequest && message.id === undefined, "invalid-notification");
    } catch (error) { errors.push(`${role}:${direction}:${error instanceof SyntaxError ? "invalid-json" : error.code || error.message}`); }
  };
  const tap = (direction) => {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    return (chunk, end = false) => {
      buffer += end ? decoder.end() : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (buffer.length > 8 * 1024 * 1024) { errors.push(`${role}:${direction}:line-limit`); buffer = ""; return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) { observe(buffer.slice(0, newline), direction); buffer = buffer.slice(newline + 1); }
      if (end && buffer.trim()) { observe(buffer, direction); buffer = ""; }
    };
  };
  return { outgoing: tap("outgoing"), incoming: tap("incoming") };
}

function verifyLifecycleEvidence(value) {
  const { events, processes, sessionA, sessionB } = value;
  assert.match(value.version, /^zcode-app-cli \S+\r?\nzcode-runtime \S+$/);
  assert.ok(sessionA?.startsWith("sess_") && sessionB?.startsWith("sess_") && sessionA !== sessionB);
  assert.deepEqual(processes.map((entry) => entry.role), ["version", "doctor", "A", "B", "resumeA"]);
  assert.notEqual(processes.find((entry) => entry.role === "A").pid, processes.find((entry) => entry.role === "B").pid);
  assert.ok(processes.every((entry) => Number.isInteger(entry.pid) && entry.pid > 0));
  assert.ok(!events.some((event) => event.kind === "signal" || event.kind === "forced_cleanup"), "强制回收不能算正常通过");
  const find = (role, kind, method, after = 0) => events.find((event) => event.role === role && event.kind === kind
    && (!method || event.method === method) && event.seq > after);
  for (const kind of ["exit", "close", "stdout_end", "stderr_end"]) assert.ok(find("version", kind), "版本探测必须正常收尾");
  assert.equal(find("version", "exit").code, 0);
  for (const [role, sessionId] of [["A", sessionA], ["B", sessionB], ["resumeA", sessionA]]) {
    const method = role === "resumeA" ? "session/resume" : "session/create";
    const request = find(role, "request", method);
    const response = find(role, "response", method, request?.seq);
    assert.ok(request && response?.sessionId === sessionId && !response.failed && response.protocolConfirmed, "必须取得原生有效会话快照");
    if (role === "resumeA") {
      assert.equal(request.sessionId, sessionA);
      assert.equal(value.resumed, true);
      assert.ok(find("A", "dispose_complete").seq < request.seq, "恢复必须在旧 runner 完整退出后");
    } else assert.equal(request.titleGenerationEnabled, false, "禁止标题模型调用");
    assert.equal(events.filter((event) => event.role === role && event.kind === "request" && event.method === method).length, 1);
    const subscribe = find(role, "request", "session/subscribe", response.seq);
    const subscribed = find(role, "response", "session/subscribe", subscribe?.seq);
    assert.ok(subscribe?.sessionId === sessionId && subscribed && !subscribed.failed);
    const begin = find(role, "dispose_begin");
    const close = find(role, "request", "session/close", begin?.seq);
    const ack = find(role, "response", "session/close", close?.seq);
    const eof = find(role, "stdin_end");
    const complete = find(role, "dispose_complete");
    assert.ok(begin && close?.sessionId === sessionId && eof && complete, "native close and complete resource barrier required");
    assert.ok(!ack || (!ack.failed && ack.seq < complete.seq), "explicit close ACK failure must fail");
    assert.ok(close.seq < eof.seq && eof.seq < complete.seq);
    assert.equal(events.filter((event) => event.role === role && event.kind === "request" && event.method === "session/close").length, 1);
    for (const kind of ["exit", "close", "stdout_end", "stderr_end"]) {
      assert.ok(find(role, kind)?.seq < complete.seq, "dispose 必须等待真实 exit、close 和正常 EOF");
    }
    assert.ok(find(role, "exit").code === 0 && !find(role, "exit").signal, "非正常退出不能算通过");
  }
  assert.equal(value.sameDisposeBarrier, true);
  const beginA = find("A", "dispose_begin");
  const completeA = find("A", "dispose_complete");
  const readBegin = find("B", "read_begin", undefined, beginA.seq);
  const readComplete = find("B", "read_complete", undefined, readBegin?.seq);
  const read = find("B", "request", "session/read", readBegin?.seq);
  const readResponse = find("B", "response", "session/read", read?.seq);
  assert.ok(readBegin?.sessionId === sessionB && readBegin.seq < completeA.seq && readComplete?.sessionId === sessionB
    && read?.sessionId === sessionB && readResponse?.seq < readComplete.seq
    && readResponse.sessionId === sessionB && readResponse.protocolConfirmed && !readResponse.failed,
  "B read must begin during A disposal and finish with a real successful snapshot");
  assert.ok(find("B", "dispose_begin").seq > Math.max(completeA.seq, readComplete.seq)
    && find("B", "exit").seq > Math.max(completeA.seq, readComplete.seq), "B must remain alive through A disposal and its own read");
  assert.ok(events.filter((event) => event.kind === "request").every((event) =>
    ["session/create", "session/resume", "session/subscribe", "session/read", "session/close", "session/setMode"].includes(event.method)), "禁止模型与其它操作");
  assert.ok(!events.some((event) => event.kind === "response" && event.failed), "不得吞掉协议错误");
  for (const request of events.filter((event) => event.kind === "server_request")) {
    assert.ok(events.some((event) => event.kind === "client_response" && event.role === request.role && event.id === request.id
      && event.method === request.method && !event.failed && event.seq > request.seq), "原生客户端请求必须按原 ID 回复");
  }
  assert.ok(value.cleanup?.processesExited && value.cleanup.stdioClosed && value.cleanup.temporaryDirectoryRemoved);
  assert.equal(value.observationErrors.length, 0);
  return { sameSessionResumed: true, peerReadDuringDispose: true, normalDisposal: true };
}

function installedIsolationContract(command) {
  const actual = fs.realpathSync(command);
  const candidates = [path.resolve(path.dirname(actual), ".."), path.join(path.dirname(actual), "node_modules/zcode-app-cli")];
  for (const root of candidates) {
    const manifest = path.join(root, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (pkg.name !== "zcode-app-cli") continue;
    const contract = fs.readFileSync(path.join(root, "docs/HOST_INTEGRATION.md"), "utf8");
    const config = fs.readFileSync(path.join(root, "docs/CONFIGURATION.md"), "utf8");
    for (const key of ["ZCODE_CLI_SETTINGS_FILE", "ZCODE_SESSION_DB_PATH", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE", "ZCODE_CLI_CREDENTIALS_FILE", "storage.dir"]) {
      assert.ok(contract.includes(key), `已安装 CLI 未提供隔离契约 ${key}`);
    }
    assert.ok(config.includes("ZCODE_DATA_BASE_DIR"));
    return { packageVersion: pkg.version, packageRoot: root, source: "installed docs/HOST_INTEGRATION.md + docs/CONFIGURATION.md" };
  }
  throw new Error("未找到已安装 CLI 的隔离配置依据；停止，不使用真实用户配置");
}

function isolatedEnvironment(root) {
  const home = path.join(root, "home");
  const temp = path.join(root, "tmp");
  const env = {};
  // Deliberate allowlist: no authentication, proxy, NODE_OPTIONS or parent task state.
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
  env.PATH = [path.dirname(process.execPath), ...(process.platform === "win32"
    ? [path.join(env.SystemRoot || "C:/Windows", "System32")] : ["/usr/bin", "/bin"])].join(path.delimiter);
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local/share"), XDG_CACHE_HOME: path.join(home, ".cache"),
    TMP: temp, TEMP: temp, TMPDIR: temp, ZCODE_NODE: process.execPath,
    ZCODE_DATA_BASE_DIR: home, ZCODE_CLI_SETTINGS_FILE: path.join(home, ".zcode/cli/setting.json"),
    ZCODE_SESSION_DB_PATH: path.join(home, ".zcode/cli/db/db.sqlite"),
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(home, ".zcode/v2/provider_config.json"),
    ZCODE_CLI_CREDENTIALS_FILE: path.join(home, ".zcode/v2/credentials.json"),
    ZCODE_BASE_URL: "http://127.0.0.1:9", ZCODE_MODEL_RETRY_MAX_RETRIES: "0",
  });
  for (const directory of [home, temp, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME,
    path.dirname(env.ZCODE_CLI_SETTINGS_FILE), path.dirname(env.ZCODE_SESSION_DB_PATH), path.dirname(env.ZCODE_CLI_CREDENTIALS_FILE)]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(env.ZCODE_CLI_SETTINGS_FILE, JSON.stringify({
    storage: { dir: path.join(home, ".zcode"), sessionDbPath: env.ZCODE_SESSION_DB_PATH },
    features: { mcp: false }, hooks: { enabled: false, events: {} }, plugins: { enabled: false, dirs: [] },
    skills: { enabled: false, roots: [] }, memory: { autoConsolidate: false },
  }));
  return env;
}

// Diagnostic-only schema pinned by read-only inspection of 3.16.3-41's
// NodeFileLogger/createEntry and StartupTimer. Never import package internals.
const diagnosticEvents = new Set([
  "config.file.invalid", "config.mcp_server.invalid",
  ...["started", "completed", "failed", "config.completed", "storage.completed", "storage_state",
    "sqlite_migration.started", "sqlite_migration.completed", "plugins.completed", "mcp.completed",
    "runtime.completed", "runtime_config.completed"].map((part) => `bootstrap.app.startup.${part}`),
  ...["startup.started", "startup.completed", "startup.failed", "startup.storage_state", "startup.late_cleanup.failed",
    "provider_registry.ready", "session_create.started", "session_create.completed", "session_create.failed",
    "create_record.mcp_config", "runtime_preferences.request_started", "runtime_preferences.response_received",
    "runtime_preferences.request_failed", "parse.failed", "shutdown.completed"].map((part) => `zcode_protocol.${part}`),
  "mcp.configured_servers.connect.started", "mcp.configured_servers.connect.completed",
  "session.persistence.started", "session.persistence.completed", "session.persistence.failed", "session.persisted",
]);
const diagnosticModules = new Set(["bootstrap", "bootstrap.app", "bootstrap.zcode_protocol", "bootstrap.zcode_protocol.mcp",
  "adapters.config", "adapters.logging", "adapters.mcp", "core.session"]);
const diagnosticStages = new Set(["start", "total", "load_config", "initialize_storage", "resolve_plugins", "initialize_mcp", "create_runtime"]);
const diagnosticCodes = new Set(["EEXIST", "ENOENT", "EACCES", "EPERM", "ECONNREFUSED", "MODULE_NOT_FOUND", "ERR_DLOPEN_FAILED",
  "config_file_invalid", "config_mcp_server_invalid", "config_project_hooks_pending_trust",
  "ZCODE_MIGRATION_BACKUP_SKIPPED", "ZCODE_PLUGIN_SEED_INCOMPLETE"]);
// Fixed libuv source names only: an absolute build path is never exported.
const nativeSources = new Set(["src/win/core.c", "src/win/async.c", "src/win/handle.c", "src/win/pipe.c",
  "src/win/stream.c", "src/win/tcp.c", "src/win/tty.c", "src/win/process.c", "src/win/thread.c"]);

function summarizeAssertions(text) {
  const assertions = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/assertion (?:failed|failure)|Check failed:/i.test(line)) continue;
    const entry = { category: "unknown" };
    // Match the CRT assertion format; the expression and absolute prefix remain private.
    const location = /, file [^\r\n]*?\b(src[\\/]win[\\/][a-z_]+\.c), line ([0-9]{1,6})\s*$/.exec(line);
    const source = location?.[1].replace(/\\/g, "/");
    if (nativeSources.has(source)) {
      Object.assign(entry, { library: "libuv", source, line: Number(location[2]) });
      if (/^Assertion failed: new_time >= loop->time, file /.test(line) && source === "src/win/core.c") entry.category = "loop-time-monotonicity";
      if (/^Assertion failed: !\(handle->flags & UV_HANDLE_CLOSING\), file /.test(line) && source === "src/win/handle.c") entry.category = "handle-already-closing";
    }
    if (assertions.length < 16) assertions.push(entry);
  }
  return assertions;
}

// Persist only exact allowlisted identifiers and counts, never diagnostic payloads.
function summarizeDiagnostics(text) {
  const categories = [];
  for (const [category, pattern] of [
    ["authentication-required", /authentication required|not authenticated|login required|please (?:log|sign) in|unauthorized|\b401\b/i],
    ["connection-refused", /ECONNREFUSED|connection refused/i],
    ["configuration-invalid", /config(?:uration)?[^\n]{0,80}(?:invalid|rejected)|invalid[^\n]{0,80}config/i],
    ["native-assertion", /assertion (?:failed|failure)|Check failed:|Assertion failed/i],
    ["out-of-memory", /out of memory|heap limit|allocation failed/i],
    ["stack-overflow", /stack overflow|maximum call stack/i],
    ["fatal-runtime-error", /FATAL ERROR|fatal runtime error|fatal error/i],
    ["uncaught-exception", /uncaught(?: exception)?|unhandled rejection/i],
    ["permission-denied", /EACCES|EPERM|permission denied/i],
    ["module-load-failure", /MODULE_NOT_FOUND|ERR_DLOPEN_FAILED|cannot find module/i],
  ]) if (pattern.test(text)) categories.push(category);
  const events = new Set();
  const rejectedFields = new Set();
  const structured = [];
  const errorCodes = new Set();
  const format = { jsonRecords: 0, malformedLines: 0, unknownEvents: 0, errorRecords: 0 };
  const fields = new Set(["features.mcp", "hooks.enabled", "plugins.enabled", "skills.enabled", "skills.roots",
    "memory.autoConsolidate", "storage.dir", "storage.sessionDbPath", "mcp.servers"]);
  for (const line of text.split(/\r?\n/).slice(-512)) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (!item || typeof item !== "object" || Array.isArray(item)) { format.malformedLines++; continue; }
      format.jsonRecords++;
      const event = item.event;
      if (diagnosticEvents.has(event)) {
        events.add(event);
        const entry = { event };
        if (diagnosticModules.has(item.module)) entry.module = item.module;
        if (["started", "waiting", "completed", "failed", "cancelled"].includes(item.status)) entry.status = item.status;
        if (diagnosticStages.has(item.context?.stage)) entry.stage = item.context.stage;
        if (structured.length < 64) structured.push(entry);
      } else if (event !== undefined) format.unknownEvents++;
      if (item.error !== undefined) format.errorRecords++;
      // NodeFileLogger serializes error.code and nested error.cause; never copy errors.
      let error = item.error;
      for (let depth = 0; error && typeof error === "object" && depth < 8; depth++, error = error.cause) {
        if (diagnosticCodes.has(error.code)) errorCodes.add(error.code);
      }
      if (diagnosticCodes.has(item.code)) errorCodes.add(item.code);
      const diagnosticPath = item.context?.diagnosticPath ?? item.diagnosticPath;
      if (fields.has(diagnosticPath)) rejectedFields.add(diagnosticPath);
    } catch { format.malformedLines++; }
  }
  return { categories, assertions: summarizeAssertions(text), events: [...events].slice(0, 32), structured,
    errorCodes: [...errorCodes], rejectedFields: [...rejectedFields], format };
}

function createDiagnosticCollector(limit = 64 * 1024) {
  let tail = Buffer.alloc(0);
  let bytes = 0;
  return {
    write(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      tail = Buffer.concat([tail, buffer]).subarray(-limit);
    },
    summary() { return { bytes, truncated: bytes > limit, ...summarizeDiagnostics(tail.toString("utf8")) }; },
  };
}

function collectIsolatedLogs(root) {
  const directory = path.join(root, "home/.zcode/cli/log");
  const summaries = [];
  let remaining = 512 * 1024;
  // Reject links in EVERY ancestor, including home/.zcode/cli, not just log.
  for (const relative of ["", "home", "home/.zcode", "home/.zcode/cli", "home/.zcode/cli/log"]) {
    const candidate = path.join(root, relative);
    if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink()) return summaries;
  }
  const visit = (folder, depth) => {
    if (depth > 2 || !remaining || !fs.existsSync(folder) || fs.lstatSync(folder).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (summaries.length >= 16 || !remaining) break;
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(file, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(file).size;
      const length = Math.min(size, 64 * 1024, remaining);
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(file, "r");
      try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
      remaining -= length;
      summaries.push({ source: "isolated-runtime-log", bytes: size, sampledBytes: length, ...summarizeDiagnostics(buffer.toString("utf8")) });
    }
  };
  visit(directory, 0);
  return summaries;
}

async function withValidatedIsolation({ probe, run, root, settingsPath, record }) {
  const { output, exitCode } = await probe();
  let doctor;
  try { doctor = JSON.parse(output); } catch { throw new Error("doctor output is not valid bounded JSON"); }
  const config = doctor?.configuration;
  const user = config?.user;
  const relative = typeof user?.path === "string" ? path.relative(root, path.resolve(user.path)) : "..";
  const inside = Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  record({ exitCode, user: { path: inside ? user.path : "outside-isolation", status: ["loaded", "invalid", "missing"].includes(user?.status) ? user.status : "unknown" },
    mcpEnabled: typeof config?.mcp?.enabled === "boolean" ? config.mcp.enabled : "unknown",
    diagnosticCount: Array.isArray(config?.diagnostics) ? config.diagnostics.length : null,
    diagnostics: summarizeDiagnostics((Array.isArray(config?.diagnostics) ? config.diagnostics : []).map((item) => JSON.stringify(item)).join("\n")) });
  assert.ok(exitCode === 0 && inside && path.resolve(user.path) === path.resolve(settingsPath)
    && user.status === "loaded" && config?.mcp?.enabled === false && Array.isArray(config?.diagnostics)
    && config.diagnostics.length === 0, "doctor isolation preflight failed; app-server forbidden");
  return run();
}

async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes("--live"), "显式使用 --live；仅验证无模型的隔离生命周期");
  assert.ok(args.every((arg, index) => arg === "--live" || arg === "--report" || args[index - 1] === "--report"), "未知参数");
  const index = args.indexOf("--report");
  assert.ok(index < 0 || (args[index + 1] && !args[index + 1].startsWith("--")), "缺少报告路径");
  const reportPath = path.resolve(index < 0 ? path.join(os.tmpdir(), `sinitek-zcode-lifecycle-${Date.now()}-${process.pid}.json`) : args[index + 1]);
  assert.ok(!fs.existsSync(reportPath), "不能覆盖已有报告");
  const moduleRoot = path.resolve("dist");
  const load = createRequire(path.join(moduleRoot, "interactive/zcodeRunner.js"));
  require(path.join(moduleRoot, "test/vscodeMock")).installVscodeMock();
  const { ZcodeInteractiveRunner } = require(path.join(moduleRoot, "interactive/zcodeRunner"));
  const { resolveSpawnCommand } = require(path.join(moduleRoot, "interactive/codexRunnerProcess"));
  const { readZcodeSnapshot, readZcodeSessionId } = require(path.join(moduleRoot, "interactive/zcodeAppServerProtocol"));
  const { spawn } = load("cross-spawn");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-lifecycle-"));
  const evidence = { environment: { platform: process.platform, arch: process.arch, node: process.version }, root,
    processes: [], events: [], observationErrors: [], passed: false };
  const tracked = [];
  const diagnostics = [];
  const runners = [];
  const killers = [];
  let sequence = 0;
  let failure;
  const record = (event) => {
    if (evidence.events.length >= 4000) throw new Error("协议证据超过限额");
    evidence.events.push({ ...event, seq: ++sequence });
  };
  const watch = (child, role, resolved) => {
    const entry = trackChild(child, resolved.command);
    tracked.push({ ...entry, child, role });
    const processEvidence = { role, pid: child.pid, command: resolved.command, args: resolved.args, stderrBytes: 0 };
    evidence.processes.push(processEvidence);
    child.once("error", (error) => { evidence.observationErrors.push(`${role}:spawn:${error.code || error.name}`); });
    child.once("exit", (code, signal) => record({ role, kind: "exit", code, signal }));
    child.once("close", () => record({ role, kind: "close" }));
    for (const name of ["stdin", "stdout", "stderr"]) {
      child[name].on("error", (error) => { evidence.observationErrors.push(`${role}:${name}:${error.code || error.name}`); });
    }
    child.stdout.once("end", () => record({ role, kind: "stdout_end" }));
    child.stderr.once("end", () => record({ role, kind: "stderr_end" }));
    const stderrHash = createHash("sha256");
    const diagnostic = createDiagnosticCollector();
    diagnostics.push({ processEvidence, diagnostic });
    child.stderr.on("data", (chunk) => {
      processEvidence.stderrBytes += Buffer.byteLength(chunk);
      stderrHash.update(chunk);
      diagnostic.write(chunk);
    });
    child.stderr.once("end", () => { processEvidence.stderrSha256 = stderrHash.digest("hex"); });
    return child;
  };
  const observeSpawn = (role) => (command, launchArgs, options) => {
    const resolved = resolveSpawnCommand(command, [...launchArgs]);
    const child = watch(spawn(resolved.command, resolved.args, { ...options, windowsHide: true, stdio: "pipe" }), role, resolved);
    const { outgoing, incoming } = createProtocolObserver({ role, record, errors: evidence.observationErrors, readZcodeSnapshot, readZcodeSessionId });
    const write = child.stdin.write;
    child.stdin.write = function (chunk, ...rest) { outgoing(chunk); return write.call(this, chunk, ...rest); };
    const end = child.stdin.end;
    child.stdin.end = function (...rest) { record({ role, kind: "stdin_end" }); return end.apply(this, rest); };
    child.stdout.on("data", incoming);
    child.stdout.once("end", () => incoming(undefined, true));
    return child;
  };
  const terminate = (child, role, signal) => {
    const owned = tracked.find((entry) => entry.child === child);
    assert.ok(owned && Number.isInteger(child.pid) && child.pid > 0, "仅可终止本次持有句柄的进程");
    if (owned.state.exited || child.exitCode !== null || child.signalCode != null) return;
    record({ role, kind: "signal", signal });
    if (process.platform === "win32") {
      const killer = spawn(path.join(process.env.SystemRoot || "C:/Windows", "System32/taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const done = new Promise((resolve) => { killer.once("error", () => resolve()); killer.once("close", () => resolve()); });
      killers.push(done);
    } else child.kill(signal);
  };
  try {
    const resolved = resolveSpawnCommand("zcode", ["--version"]);
    evidence.isolationContract = installedIsolationContract(resolved.command);
    const env = isolatedEnvironment(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const version = watch(spawn(resolved.command, resolved.args, { cwd: workspace, env, windowsHide: true, stdio: "pipe" }), "version", resolved);
    let output = "";
    const versionDecoder = new StringDecoder("utf8");
    version.stdout.on("data", (chunk) => { output = `${output}${versionDecoder.write(chunk)}`.slice(-4096); });
    version.stdin.end();
    await within(tracked[0].done, 15000, "版本确认");
    assert.equal(version.exitCode, 0, "真实 CLI 版本检查失败");
    evidence.version = `${output}${versionDecoder.end()}`.trim();
    assert.match(evidence.version, /^zcode-app-cli \S+\r?\nzcode-runtime \S+$/);
    await withValidatedIsolation({ root, settingsPath: env.ZCODE_CLI_SETTINGS_FILE,
      record: (doctor) => { evidence.doctor = doctor; },
      probe: async () => {
        const command = resolveSpawnCommand("zcode", ["doctor", "--json"]);
        const child = watch(spawn(command.command, command.args, { cwd: workspace, env, windowsHide: true, stdio: "pipe" }), "doctor", command);
        const entry = tracked[tracked.length - 1];
        const chunks = [];
        let bytes = 0;
        child.stdout.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes <= 128 * 1024) chunks.push(chunk);
        });
        child.stdin.end();
        await within(entry.done, 15000, "doctor preflight");
        assert.ok(bytes <= 128 * 1024, "doctor output exceeds limit");
        assert.ok(entry.state.exited && entry.state.closed && entry.state.streams.stdout.ended && entry.state.streams.stderr.ended,
          "doctor requires real exit, close and EOF");
        return { output: Buffer.concat(chunks).toString("utf8"), exitCode: child.exitCode };
      },
      run: async () => {
        const make = (role, sessionId) => {
          const runner = new ZcodeInteractiveRunner({ cwd: workspace, env, localSessionId: sessionId,
            spawnImpl: observeSpawn(role), killTreeImpl: (child, signal) => terminate(child, role, signal) });
          runners.push({ role, runner });
          return runner;
        };
        const dispose = (role, runner) => {
          record({ role, kind: "dispose_begin" });
          const barrier = runner.dispose();
          if (role === "A") evidence.sameDisposeBarrier = runner.dispose() === barrier;
          return barrier.then(() => record({ role, kind: "dispose_complete" }));
        };
        const a = make("A");
        evidence.sessionA = (await within(a.start(), 15000, "创建 A")).sessionId;
        const b = make("B");
        evidence.sessionB = (await within(b.start(), 15000, "创建 B")).sessionId;
        const closingA = dispose("A", a);
        record({ role: "B", kind: "read_begin", sessionId: evidence.sessionB });
        const readingB = b.start().then((result) => {
          record({ role: "B", kind: "read_complete", sessionId: result.sessionId });
        });
        await within(Promise.all([closingA, readingB]), 15000, "关闭 A 同时读取 B");
        const resumed = make("resumeA", evidence.sessionA);
        const result = await within(resumed.start(), 15000, "恢复原 A");
        evidence.resumed = result.resumed && result.sessionId === evidence.sessionA;
        await within(Promise.all([dispose("resumeA", resumed), dispose("B", b)]), 15000, "关闭所有 runner");
      },
    });
  } catch (error) {
    failure = error;
    evidence.error = { name: error.name, code: error.code, rpcCode: error.rpcCode,
      // No raw native messages, configurations, answers, or stderr in the report.
      summary: error.name === "ZcodeProtocolError" ? "原生协议或启动失败；保持隔离，未使用用户认证" : String(error.message).slice(0, 400) };
  } finally {
    try {
      await within(Promise.all(runners.map(({ runner }) => runner.dispose())), 2000, "正常失败收尾");
    } catch { /* Escalate only children created and held by this invocation. */ }
    for (const entry of tracked) {
      if (!entry.state.exited && entry.child.pid) {
        record({ role: entry.role, kind: "forced_cleanup" });
        terminate(entry.child, entry.role, "SIGKILL");
      }
    }
    try {
      await within(Promise.all([...tracked.map((entry) => entry.done), ...killers]), 10000, "真实资源收尾");
      assert.ok(tracked.every((entry) => entry.state.exited && entry.state.closed
        && entry.state.streams.stdout.ended && entry.state.streams.stderr.ended));
      for (const { processEvidence, diagnostic } of diagnostics) processEvidence.stderrDiagnostic = diagnostic.summary();
      evidence.isolatedLogDiagnostics = collectIsolatedLogs(root);
      // Only this freshly created root, never a caller-supplied or historical directory.
      fs.rmSync(root, { recursive: true });
      evidence.cleanup = { processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: !fs.existsSync(root) };
    } catch (error) { evidence.cleanup = { error: error.message, children: tracked.map((entry) => entry.state) }; failure ||= error; }
    if (!failure) {
      try { evidence.result = verifyLifecycleEvidence(evidence); evidence.passed = true; }
      catch (error) { evidence.error = { name: error.name, summary: error.message }; failure = error; }
    }
    fs.writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ passed: evidence.passed, version: evidence.version, reportPath, cleanup: evidence.cleanup }));
  }
  if (failure) process.exitCode = 1;
  return evidence;
}

module.exports = { main, verifyLifecycleEvidence, isolatedEnvironment, installedIsolationContract, createProtocolObserver,
  withValidatedIsolation, createDiagnosticCollector, collectIsolatedLogs };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
