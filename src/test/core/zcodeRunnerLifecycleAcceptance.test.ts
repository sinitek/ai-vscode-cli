import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readZcodeSnapshot, readZcodeSessionId } from "../../interactive/zcodeAppServerProtocol";

type Event = {
  role: string; kind: string; seq: number; method?: string; sessionId?: string;
  id?: number | string;
  protocolConfirmed?: boolean; titleGenerationEnabled?: boolean; failed?: boolean;
  code?: number; signal?: string | null;
};

type DiagnosticSummary = {
  bytes: number; truncated: boolean; categories: string[]; events: string[]; rejectedFields: string[];
  assertions: { category: string; library?: string; source?: string; line?: number }[];
  structured: { event: string; module?: string; status?: string; stage?: string }[];
  errorCodes: string[];
  format: { jsonRecords: number; malformedLines: number; unknownEvents: number; errorRecords: number };
};

const { verifyLifecycleEvidence, isolatedEnvironment, installedIsolationContract, createProtocolObserver,
  withValidatedIsolation, createDiagnosticCollector, collectIsolatedLogs } = require(path.resolve("scripts/verify_zcode_runner_lifecycle.js")) as {
  verifyLifecycleEvidence: (value: ReturnType<typeof fixture>) => { normalDisposal: boolean };
  isolatedEnvironment: (root: string) => NodeJS.ProcessEnv;
  installedIsolationContract: (command: string) => unknown;
  withValidatedIsolation: (options: { root: string; settingsPath: string; probe: () => Promise<{ output: string; exitCode: number }>;
    record: (value: unknown) => void; run: () => Promise<unknown> }) => Promise<unknown>;
  createDiagnosticCollector: (limit?: number) => { write: (chunk: string | Buffer) => void;
    summary: () => DiagnosticSummary };
  collectIsolatedLogs: (root: string) => unknown[];
  createProtocolObserver: (options: {
    role: string; record: (event: Omit<Event, "seq">) => void; errors: string[];
    readZcodeSnapshot: typeof readZcodeSnapshot; readZcodeSessionId: typeof readZcodeSessionId;
  }) => { incoming: (chunk?: Buffer | string, end?: boolean) => void; outgoing: (chunk?: Buffer | string, end?: boolean) => void };
};

function fixture() {
  const events: Event[] = [];
  let seq = 0;
  const event = (role: string, kind: string, extra: Partial<Event> = {}) => events.push({ role, kind, ...extra, seq: ++seq });
  const rpc = (role: string, method: string, sessionId: string) => {
    event(role, "request", { method, sessionId, ...(method === "session/create" ? { titleGenerationEnabled: false } : {}) });
    event(role, "response", { method, sessionId, protocolConfirmed: true, failed: false });
  };
  const start = (role: string, sessionId: string, resumed = false) => {
    rpc(role, resumed ? "session/resume" : "session/create", sessionId);
    rpc(role, "session/subscribe", sessionId);
  };
  const finish = (role: string) => {
    event(role, "stdout_end"); event(role, "stderr_end"); event(role, "exit", { code: 0, signal: null });
    event(role, "close"); event(role, "dispose_complete");
  };
  const close = (role: string, sessionId: string) => {
    event(role, "dispose_begin"); rpc(role, "session/close", sessionId); event(role, "stdin_end");
  };
  const sessionA = "sess_original_a";
  const sessionB = "sess_peer_b";
  event("version", "stdout_end"); event("version", "stderr_end"); event("version", "exit", { code: 0 }); event("version", "close");
  start("A", sessionA); start("B", sessionB);
  close("A", sessionA); event("B", "read_begin", { sessionId: sessionB });
  rpc("B", "session/read", sessionB); event("B", "read_complete", { sessionId: sessionB }); finish("A");
  start("resumeA", sessionA, true); close("resumeA", sessionA); finish("resumeA");
  close("B", sessionB); finish("B");
  return {
    version: "zcode-app-cli 3.16.3-41\nzcode-runtime 0.17.0", events,
    processes: ["version", "doctor", "A", "B", "resumeA"].map((role, index) => ({ role, pid: 100 + index })),
    sessionA, sessionB, resumed: true, sameDisposeBarrier: true, observationErrors: [] as string[],
    cleanup: { processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true },
  };
}

test("native ZCode evidence requires original resume, live peer read and complete resource barrier", () => {
  assert.equal(verifyLifecycleEvidence(fixture()).normalDisposal, true);
});

test("version identity needs a real successful probe and normal stream closure", () => {
  for (const kind of ["exit", "close", "stdout_end", "stderr_end"]) {
    const value = fixture(); value.events = value.events.filter((event) => !(event.role === "version" && event.kind === kind));
    assert.throws(() => verifyLifecycleEvidence(value));
  }
  const failed = fixture(); failed.events.find((event) => event.role === "version" && event.kind === "exit")!.code = 1;
  assert.throws(() => verifyLifecycleEvidence(failed));
  const invalid = fixture(); invalid.version = "0.17.0"; assert.throws(() => verifyLifecycleEvidence(invalid));
});

test("close ACK, exit, logical closure and kill cannot substitute for stdout EOF and close", () => {
  for (const kind of ["exit", "close", "stdout_end", "stderr_end", "stdin_end", "dispose_complete"]) {
    const value = fixture();
    value.events = value.events.filter((event) => !(event.role === "A" && event.kind === kind));
    assert.throws(() => verifyLifecycleEvidence(value), kind);
  }
  for (const kind of ["signal", "forced_cleanup"]) {
    const value = fixture(); value.events.push({ role: "A", kind, seq: 1000 });
    assert.throws(() => verifyLifecycleEvidence(value), /强制回收/);
  }
  for (const kind of ["exit", "close", "stdout_end"]) {
    const value = fixture(); value.events.find((event) => event.role === "A" && event.kind === kind)!.seq = 1000;
    assert.throws(() => verifyLifecycleEvidence(value));
  }
});

test("native close must be written once before stdin ends and explicit ACK failures fail", () => {
  const missing = fixture(); missing.events = missing.events.filter((event) => !(event.role === "A" && event.method === "session/close"));
  assert.throws(() => verifyLifecycleEvidence(missing));
  const late = fixture(); late.events.find((event) => event.role === "A" && event.kind === "request" && event.method === "session/close")!.seq = 1000;
  assert.throws(() => verifyLifecycleEvidence(late));
  const duplicate = fixture(); duplicate.events.push({ ...duplicate.events.find((event) => event.role === "A" && event.method === "session/close")!, seq: 1000 });
  assert.throws(() => verifyLifecycleEvidence(duplicate));
  const rejected = fixture(); rejected.events.find((event) => event.role === "A" && event.kind === "response" && event.method === "session/close")!.failed = true;
  assert.throws(() => verifyLifecycleEvidence(rejected));
  const differentBarrier = fixture(); differentBarrier.sameDisposeBarrier = false;
  assert.throws(() => verifyLifecycleEvidence(differentBarrier));
});

test("missing close ACK passes only with complete normal native resource release", () => {
  const value = fixture();
  value.events = value.events.filter((event) => !(event.kind === "response" && event.method === "session/close"));
  assert.equal(verifyLifecycleEvidence(value).normalDisposal, true);
  for (const kind of ["exit", "close", "stdout_end", "stderr_end", "stdin_end"]) {
    const incomplete = { ...value, events: value.events.filter((event) => !(event.role === "A" && event.kind === kind)) };
    assert.throws(() => verifyLifecycleEvidence(incomplete), kind);
  }
});

test("B read may finish after A disposal when the real read operation began concurrently", () => {
  const value = fixture();
  // Neither the protocol request nor its response must beat the other process's close.
  const delayed = value.events.filter((event) => event.method === "session/read" || event.kind === "read_complete");
  value.events = value.events.filter((event) => !delayed.includes(event));
  const completedA = value.events.findIndex((event) => event.role === "A" && event.kind === "dispose_complete");
  value.events.splice(completedA + 1, 0, ...delayed);
  value.events.forEach((event, index) => { event.seq = index + 1; });
  assert.equal(verifyLifecycleEvidence(value).normalDisposal, true);
  for (const kind of ["read_begin", "read_complete"]) {
    const missing = { ...value, events: value.events.filter((event) => event.kind !== kind) };
    assert.throws(() => verifyLifecycleEvidence(missing));
  }
  const begin = value.events.find((event) => event.kind === "read_begin")!;
  value.events = value.events.filter((event) => event !== begin);
  const completion = value.events.findIndex((event) => event.role === "A" && event.kind === "dispose_complete");
  value.events.splice(completion + 1, 0, begin);
  value.events.forEach((event, index) => { event.seq = index + 1; });
  assert.throws(() => verifyLifecycleEvidence(value), /B read must begin/);
});

test("repeated start or swallowed read errors do not prove the peer remains alive", () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.events = value.events.filter((event) => event.method !== "session/read"); },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/read" && event.kind === "response")!.failed = true; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/read" && event.kind === "response")!.sessionId = value.sessionA; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/read" && event.kind === "response")!.protocolConfirmed = false; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/read" && event.kind === "response")!.seq = 1000; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.role === "B" && event.kind === "exit")!.seq = 1; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => verifyLifecycleEvidence(value)); }
});

test("resume requires an actual successful native snapshot of the original persisted ID", () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => { value.resumed = false; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/resume" && event.kind === "request")!.sessionId = "sess_replacement"; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/resume" && event.kind === "response")!.sessionId = "sess_replacement"; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/resume" && event.kind === "response")!.protocolConfirmed = false; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.method === "session/resume" && event.kind === "response")!.failed = true; },
    (value: ReturnType<typeof fixture>) => { value.events.find((event) => event.role === "A" && event.kind === "dispose_complete")!.seq = 1000; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => verifyLifecycleEvidence(value)); }
});

test("model calls, automatic titles, protocol errors and incomplete cleanup remain failures", () => {
  for (const method of ["session/send", "session/compact", "session/generateTitle"]) {
    const value = fixture(); value.events.push({ role: "B", kind: "request", method, seq: 1000 });
    assert.throws(() => verifyLifecycleEvidence(value));
  }
  const titles = fixture(); titles.events.find((event) => event.method === "session/create" && event.kind === "request")!.titleGenerationEnabled = true;
  assert.throws(() => verifyLifecycleEvidence(titles));
  for (const key of ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"] as const) {
    const value = fixture(); value.cleanup[key] = false; assert.throws(() => verifyLifecycleEvidence(value));
  }
  const errors = fixture(); errors.observationErrors.push("invalid snapshot"); assert.throws(() => verifyLifecycleEvidence(errors));
  const exit = fixture(); exit.events.find((event) => event.role === "A" && event.kind === "exit")!.code = 1;
  assert.throws(() => verifyLifecycleEvidence(exit));
});

test("isolation creates fresh stores and does not inherit parent authentication or task environment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-isolation-test-"));
  try {
    const env = isolatedEnvironment(root);
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
      "XDG_CACHE_HOME", "ZCODE_DATA_BASE_DIR", "ZCODE_CLI_SETTINGS_FILE", "ZCODE_SESSION_DB_PATH", "ZCODE_PERSONAL_PROVIDER_CONFIG_FILE", "ZCODE_CLI_CREDENTIALS_FILE"]) {
      const relative = path.relative(root, env[key]!);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), key);
    }
    assert.ok(Object.keys(env).every((key) => !/(?:TOKEN|SECRET|PASSWORD|API_KEY|PROXY|NODE_OPTIONS|SINITEK)/i.test(key)));
    assert.equal(fs.existsSync(env.ZCODE_CLI_CREDENTIALS_FILE!), false);
    assert.equal(fs.existsSync(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE!), false);
    const settings = JSON.parse(fs.readFileSync(env.ZCODE_CLI_SETTINGS_FILE!, "utf8"));
    assert.equal(settings.storage.sessionDbPath, env.ZCODE_SESSION_DB_PATH);
    assert.equal(settings.hooks.enabled, false);
    assert.equal(settings.plugins.enabled, false);
    assert.equal(settings.features.mcp, false);
    assert.throws(() => installedIsolationContract(env.ZCODE_CLI_SETTINGS_FILE!));
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("doctor gate forbids app-server for invalid, missing, foreign or MCP-enabled settings", async () => {
  const root = path.resolve(".tmp/doctor-gate-test");
  const settingsPath = path.join(root, "home/setting.json");
  const valid = () => ({ configuration: { user: { path: settingsPath, status: "loaded" }, mcp: { enabled: false }, diagnostics: [] as unknown[] } });
  for (const mutate of [
    (value: ReturnType<typeof valid>) => { value.configuration.user.status = "invalid"; },
    (value: ReturnType<typeof valid>) => { value.configuration.user.status = "missing"; },
    (value: ReturnType<typeof valid>) => { value.configuration.user.path = path.resolve("outside-setting.json"); },
    (value: ReturnType<typeof valid>) => { value.configuration.user.path = path.join(root, "another-setting.json"); },
    (value: ReturnType<typeof valid>) => { value.configuration.mcp.enabled = true; },
    (value: ReturnType<typeof valid>) => { value.configuration.diagnostics.push({ diagnosticPath: "features.mcp", message: "private-secret" }); },
  ]) {
    const value = valid(); mutate(value);
    const records: unknown[] = [];
    await assert.rejects(withValidatedIsolation({ root, settingsPath,
      probe: async () => ({ output: JSON.stringify(value), exitCode: 0 }), record: (entry) => records.push(entry),
      run: async () => assert.fail("invalid doctor must never enter app-server") }), /preflight failed/);
    assert.ok(!JSON.stringify(records).includes("private-secret"));
  }
  for (const probe of [
    async () => ({ output: "private-secret-not-json", exitCode: 0 }),
    async () => ({ output: JSON.stringify(valid()), exitCode: 1 }),
    async () => { throw new Error("doctor failed"); },
  ]) await assert.rejects(withValidatedIsolation({ root, settingsPath, probe, record: () => {},
    run: async () => assert.fail("failed doctor must never enter app-server") }));
  let entered = 0;
  await withValidatedIsolation({ root, settingsPath, probe: async () => ({ output: JSON.stringify(valid()), exitCode: 0 }),
    record: () => {}, run: async () => { entered++; } });
  assert.equal(entered, 1);
});

test("bounded native diagnostics retain error categories and rejected fields without raw payloads", () => {
  const collector = createDiagnosticCollector(1024);
  collector.write("private-secret".repeat(300));
  collector.write('\nFATAL ERROR: private-secret\nAssertion failed: private-secret\nECONNREFUSED private-secret\n');
  collector.write(`${JSON.stringify({ event: "config.file.invalid", context: { diagnosticPath: "features.mcp", diagnosticMessage: "private-secret" } })}\n`);
  const summary = collector.summary();
  assert.equal(summary.truncated, true);
  assert.ok(summary.bytes > 1024);
  assert.deepEqual(summary.categories, ["connection-refused", "configuration-invalid", "native-assertion", "fatal-runtime-error"]);
  assert.deepEqual(summary.events, ["config.file.invalid"]);
  assert.deepEqual(summary.rejectedFields, ["features.mcp"]);
  assert.ok(!JSON.stringify(summary).includes("private-secret"));
});

test("structured log diagnostics only read the fresh isolation log directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-logs-test-"));
  try {
    const log = path.join(root, "home/.zcode/cli/log");
    fs.mkdirSync(log, { recursive: true });
    fs.writeFileSync(path.join(log, "runtime.jsonl"), `${JSON.stringify({ event: "bootstrap.app.startup.config.completed", private: "private-secret" })}\n`);
    fs.writeFileSync(path.join(root, "unrelated.jsonl"), "FATAL ERROR: private-secret\n");
    const result = collectIsolatedLogs(root);
    assert.equal(result.length, 1);
    assert.ok(JSON.stringify(result).includes("bootstrap.app.startup.config.completed"));
    assert.ok(!JSON.stringify(result).includes("private-secret"));
    assert.ok(!JSON.stringify(result).includes("fatal-runtime-error"));
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("CRT assertion diagnostics retain only known relative libuv locations and fixed categories across chunks", () => {
  const collector = createDiagnosticCollector();
  const text = "Assertion failed: new_time >= loop->time, file C:\\private-secret\\deps\\uv\\src\\win\\core.c, line 331\n"
    + "Assertion failed: private-secret, file src/win/pipe.c, line 123\n"
    + "Assertion failed: private-secret, file C:\\private-secret\\other.c, line 456\n"
    + "Check failed: private-secret stack and path\n";
  for (const byte of Buffer.from(text)) collector.write(Buffer.from([byte]));
  assert.deepEqual(collector.summary().assertions, [
    { category: "loop-time-monotonicity", library: "libuv", source: "src/win/core.c", line: 331 },
    { category: "unknown", library: "libuv", source: "src/win/pipe.c", line: 123 },
    { category: "unknown" }, { category: "unknown" },
  ]);
  assert.ok(!JSON.stringify(collector.summary()).includes("private-secret"));
});

test("installed NodeFileLogger schema exports protocol startup stages and exact error codes without payloads", () => {
  const collector = createDiagnosticCollector();
  const entries = [
    { timestamp: "private-secret", level: 30, levelName: "INFO", event: "zcode_protocol.startup.started",
      module: "bootstrap.zcode_protocol", status: "started", message: "private-secret",
      context: { stage: "start", version: "private-secret", workspacePath: "private-secret" } },
    { event: "zcode_protocol.provider_registry.ready", module: "bootstrap.zcode_protocol", message: "private-secret" },
    { event: "zcode_protocol.startup.failed", module: "bootstrap.zcode_protocol", status: "failed", context: { stage: "total" },
      error: { name: "private-secret", message: "private-secret", code: "ENOENT", stack: "private-secret",
        cause: { code: "config_file_invalid", context: { secret: "private-secret" } } } },
    { event: "zcode_protocol.session_create.started", module: "private-secret", status: "private-secret",
      context: { stage: "private-secret", diagnosticPath: "storage.private_secret" }, error: { code: "private-secret" } },
  ];
  for (const byte of Buffer.from(entries.map((item) => JSON.stringify(item)).join("\n"))) collector.write(Buffer.from([byte]));
  const summary = collector.summary();
  assert.deepEqual(summary.events, entries.map((item) => item.event));
  assert.deepEqual(summary.structured, [
    { event: entries[0].event, module: "bootstrap.zcode_protocol", status: "started", stage: "start" },
    { event: entries[1].event, module: "bootstrap.zcode_protocol" },
    { event: entries[2].event, module: "bootstrap.zcode_protocol", status: "failed", stage: "total" },
    { event: entries[3].event },
  ]);
  assert.deepEqual(summary.errorCodes, ["ENOENT", "config_file_invalid"]);
  assert.equal(summary.format.errorRecords, 2);
  assert.deepEqual(summary.rejectedFields, []);
  assert.ok(!JSON.stringify(summary).includes("private-secret"));
});

test("truncated JSON and unknown schema degrade to counts without treating messages or event prefixes as identifiers", () => {
  const collector = createDiagnosticCollector(512);
  collector.write(`{"event":"${"private-secret".repeat(100)}"`);
  collector.write('\n{"event":"zcode_protocol.private_secret","error":{"code":"private-secret"}}\n');
  collector.write('{"eventName":"bootstrap.app.startup.started","message":"zcode_protocol.startup.failed"}\n');
  collector.write('{"event":"bootstrap.private_secret","context":{"diagnosticPath":"features.private_secret"}}\n');
  collector.write('{"event":"zcode_protocol.startup.completed","module":"bootstrap.zcode_protocol","status":"completed"}');
  const summary = collector.summary();
  assert.equal(summary.truncated, true);
  assert.deepEqual(summary.events, ["zcode_protocol.startup.completed"]);
  assert.equal(summary.format.malformedLines, 1);
  assert.equal(summary.format.unknownEvents, 2);
  assert.deepEqual(summary.errorCodes, []);
  assert.ok(!JSON.stringify(summary).includes("private"));
});

test("default stderr tail and isolated log file and total sampling limits stay bounded", () => {
  const collector = createDiagnosticCollector();
  collector.write("Assertion failed: private-secret\n");
  collector.write(Buffer.alloc(64 * 1024, 120));
  assert.deepEqual(collector.summary().assertions, []);
  assert.equal(collector.summary().truncated, true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-log-limits-"));
  try {
    const directory = path.join(root, "home/.zcode/cli/log");
    fs.mkdirSync(directory, { recursive: true });
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(directory, `${i}.jsonl`), "{}\n");
    assert.equal(collectIsolatedLogs(root).length, 16);
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(directory, `${i}.jsonl`), Buffer.alloc(70 * 1024, 120));
    const sampled = collectIsolatedLogs(root) as { sampledBytes: number }[];
    assert.equal(sampled.length, 8);
    assert.ok(sampled.every((item) => item.sampledBytes === 64 * 1024));
    assert.equal(sampled.reduce((sum, item) => sum + item.sampledBytes, 0), 512 * 1024);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("isolated log collection rejects ancestor junctions and child links to external logs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-log-links-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-zcode-log-external-"));
  try {
    const externalLog = path.join(external, ".zcode/cli/log");
    fs.mkdirSync(externalLog, { recursive: true });
    fs.writeFileSync(path.join(externalLog, "external.jsonl"), '{"event":"zcode_protocol.startup.failed"}\n');
    fs.symlinkSync(external, path.join(root, "home"), process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(collectIsolatedLogs(root), []);
    fs.rmSync(path.join(root, "home")); // Remove this test's link, never the target.
    const directory = path.join(root, "home/.zcode/cli/log");
    fs.mkdirSync(directory, { recursive: true });
    fs.symlinkSync(externalLog, path.join(directory, "external"), process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(collectIsolatedLogs(root), []);
    fs.rmSync(path.join(directory, "external"));
  } finally {
    fs.rmSync(root, { recursive: true });
    fs.rmSync(external, { recursive: true });
  }
});

test("passive wire observer handles native server requests and fragmented UTF8 without retaining payloads", () => {
  const events: Omit<Event, "seq">[] = [];
  const errors: string[] = [];
  const observer = createProtocolObserver({ role: "A", record: (event) => events.push(event), errors, readZcodeSnapshot, readZcodeSessionId });
  observer.outgoing('{"id":1,"method":"session/create","params":{"titleGenerationEnabled":false}}\n');
  // The two directions have independent request ID namespaces.
  observer.incoming('{"id":1,"method":"session/requestRuntimePreferences","params":{}}\n');
  observer.outgoing('{"id":1,"result":{"private":"private-answer"}}\n');
  const result = Buffer.from(JSON.stringify({ id: 1, result: { protocol: { name: "ZCode Protocol", version: 1 },
    session: { sessionId: "sess_真实" }, private: "private-answer" } }));
  for (const byte of result) observer.incoming(Buffer.from([byte]));
  observer.incoming(undefined, true); // Normal EOF may carry an unterminated final line.
  assert.deepEqual(errors, []);
  assert.deepEqual(events.map((event) => event.kind), ["request", "server_request", "client_response", "response"]);
  assert.equal(events[3].sessionId, "sess_真实");
  assert.equal(events[3].protocolConfirmed, true);
  assert.equal(JSON.stringify(events).includes("private-answer"), false);
});

test("wire observer rejects invalid snapshots, mismatched IDs, model requests and raw malformed content", () => {
  for (const mutate of [
    (observer: ReturnType<typeof createProtocolObserver>) => observer.incoming('{"id":"1","result":{}}\n'),
    (observer: ReturnType<typeof createProtocolObserver>) => observer.incoming('{"id":1,"result":{"session":{"sessionId":"sess_a"}}}\n'),
    (observer: ReturnType<typeof createProtocolObserver>) => observer.outgoing('{"id":2,"method":"session/send","params":{"content":"private-answer"}}\n'),
    (observer: ReturnType<typeof createProtocolObserver>) => observer.incoming('private-answer-invalid-json\n'),
    (observer: ReturnType<typeof createProtocolObserver>) => observer.incoming('{"jsonrpc":"2.0","id":1,"result":{}}\n'),
    (observer: ReturnType<typeof createProtocolObserver>) => observer.outgoing('{"id":2,"result":{"private":"private-answer"}}\n'),
  ]) {
    const errors: string[] = [];
    const observer = createProtocolObserver({ role: "A", record: () => {}, errors, readZcodeSnapshot, readZcodeSessionId });
    observer.outgoing('{"id":1,"method":"session/create","params":{"titleGenerationEnabled":false}}\n');
    mutate(observer);
    assert.ok(errors.length > 0);
    assert.ok(!JSON.stringify(errors).includes("private-answer"));
  }
});
