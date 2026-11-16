"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { isolatedEnvironment } = require("./verify_opencode_owned_native_drain");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function parseArgs(args) {
  const out = {}, keys = { "--product": "product", "--report": "report", "--binary": "binary" };
  for (let i = 0; i < args.length; i++) {
    const key = keys[args[i]];
    assert.ok(key && !out[key], `unknown/duplicate argument:${args[i]}`);
    const value = args[++i];
    assert.ok(value && path.isAbsolute(value) && !/[\r\n\0]/u.test(value), "absolute argument value required");
    out[key] = value;
  }
  assert.ok(out.product && out.report, "--product and --report required");
  return out;
}
function snapshot(product) {
  const files = {};
  for (const name of ["src", "scripts", "dist"]) {
    const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name); assert.ok(!entry.isSymbolicLink(), "physical source/scripts/dist required");
      if (entry.isDirectory()) visit(file); else files[path.relative(product, file)] = sha(file);
    } };
    assert.ok(!fs.lstatSync(path.join(product, name)).isSymbolicLink(), "physical product required"); visit(path.join(product, name));
  }
  return files;
}
function classify(input, state, allowed, denied, token) {
  assert.equal(input.model, "native-drain"); assert.ok(Array.isArray(input.messages));
  const all = JSON.stringify(input.messages);
  const title = input.messages.some(m => ["system", "user"].includes(m.role)
    && /You are a title generator|Generate a title for this conversation:/.test(JSON.stringify(m.content)));
  if (title) { assert.ok(++state.titles <= 2, "title budget"); return { content: "Managed permission verification", finish: "stop" }; }
  assert.ok(all.includes("MANAGED_MAIN_TOOL_CONTRACT"), "unknown production prompt");
  const tools = input.messages.filter(m => m.role === "tool");
  if (!tools.length) {
    assert.equal(state.stage, 0, "duplicate execution"); state.stage = 1;
    assert.ok(input.tools?.some(t => t.function.name === "read"), "native read tool absent");
    return { calls: [allowed, denied].map((filePath, index) => ({ index, id: `call_isolated_${index}`, type: "function",
      function: { name: "read", arguments: JSON.stringify({ filePath }) } })), finish: "tool_calls" };
  }
  assert.equal(state.stage, 1, "unexpected follow-up");
  assert.equal(tools.length, 2, "both native tool results required");
  const ok = tools.find(t => t.tool_call_id === "call_isolated_0"), no = tools.find(t => t.tool_call_id === "call_isolated_1");
  assert.ok(JSON.stringify(ok?.content).includes(token), "actual isolated read missing");
  assert.match(JSON.stringify(no?.content), /denied|permission|reject|not allowed/iu, "explicit deny missing");
  state.stage = 2;
  return { content: `[final_answer] MANAGED_MAIN_READ_OK ${token}`, finish: "stop" };
}
function provider(allowed, denied, token) {
  const state = { stage: 0, titles: 0 }, requests = [], failures = [];
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer isolated-free-provider");
      let raw = ""; for await (const chunk of req) { raw += chunk; assert.ok(Buffer.byteLength(raw) <= 1024 * 1024); }
      assert.ok(requests.length < 6, "provider budget");
      const body = JSON.parse(raw); requests.push(body);
      const reply = classify(body, state, allowed, denied, token);
      const base = { id: `chatcmpl-managed-${requests.length}`, model: "native-drain", created: 1 };
      if (!body.stream) {
        assert.ok(!reply.calls, "tools must stream");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: reply.content }, finish_reason: reply.finish }] })); return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      emit({ role: "assistant", content: "" });
      if (reply.calls) emit({ tool_calls: reply.calls }); else emit({ content: reply.content });
      emit({}, reply.finish); res.end("data: [DONE]\n\n");
    } catch (error) { failures.push(error.message); res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  return { server, state, requests, failures };
}
function installHttpAudit(evidence) {
  const request = http.request, get = http.get;
  const observe = req => {
    const route = req.path?.split("?")[0];
    if (!route || !["/event", "/agent", "/session"].includes(route) && !/^\/session\/|^\/permission\//u.test(route)) return req;
    const entry = { method: req.method, route, at: Date.now() }; evidence.http.push(entry);
    assert.ok(evidence.http.length <= 128, "audit request budget");
    let body = ""; const end = req.end;
    req.end = function(chunk, ...args) { if (chunk && typeof chunk !== "function") body += chunk.toString();
      if (body) { assert.ok(Buffer.byteLength(body) <= 1024 * 1024); entry.body = JSON.parse(body); }
      return end.call(this, chunk, ...args);
    };
    req.on("response", response => {
      let buffer = "", bytes = 0;
      response.on("data", chunk => {
        bytes += Buffer.byteLength(chunk); assert.ok(bytes <= 8 * 1024 * 1024, "audit response budget"); buffer += chunk.toString();
        if (route !== "/event") return;
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const data = buffer.slice(0, boundary).split("\n").filter(s => s.startsWith("data:")).map(s => s.slice(5).trim()).join("\n"); buffer = buffer.slice(boundary + 2);
          if (data) { assert.ok(evidence.events.length < 8192); evidence.events.push(JSON.parse(data)); }
        }
      });
      response.on("end", () => { if (route !== "/event" && buffer) { try { entry.response = JSON.parse(buffer); } catch { entry.response = "invalid-json"; } } });
      response.on("close", () => { entry.closed = true; });
    });
    return req;
  };
  http.request = function(...args) { return observe(request.apply(this, args)); };
  http.get = function(...args) { return observe(get.apply(this, args)); };
  return () => { http.request = request; http.get = get; };
}
async function child(options, root) {
  const evidence = { schemaVersion: 1, status: "running", root, product: options.product, http: [], events: [],
    lifecycle: [], statuses: [], completions: [], forcedCleanup: [], before: snapshot(options.product), envKeys: Object.keys(process.env).sort() };
  const write = () => fs.writeFileSync(options.report, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  const load = name => require(path.join(options.product, "dist", name));
  let source, handle, runId, task, sessionId = null, target = [], failure, activeProcess;
  const unobserve = installHttpAudit(evidence);
  let serverClose;
  const messages = [];
  const watchdog = setTimeout(() => { evidence.forcedCleanup.push("overall-timeout"); activeProcess?.kill(); handle?.kill(); }, 45000);
  try {
    const binary = options.binary ?? cp.execFileSync("/usr/bin/which", ["opencode"], { encoding: "utf8", env: process.env }).trim();
    evidence.binary = { path: binary, sha256: sha(fs.realpathSync(binary)), version: cp.execFileSync(binary, ["--version"], { encoding: "utf8", env: process.env }).trim() };
    const directory = fs.realpathSync(path.join(root, "workspace")), token = crypto.randomBytes(12).toString("hex");
    cp.execFileSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet", directory], { env: process.env });
    const allowed = path.join(directory, "allowed.txt"), denied = path.join(directory, "denied.txt");
    fs.writeFileSync(allowed, token); fs.writeFileSync(denied, "must never be read");
    source = provider(allowed, denied, token);
    await new Promise(resolve => source.server.listen(0, "127.0.0.1", resolve));
    const model = "isolated/native-drain", url = `http://127.0.0.1:${source.server.address().port}/v1`;
    const config = { model, small_model: model, default_agent: "build", enabled_providers: ["isolated"], permission: { "*": "deny" },
      agent: { build: { permission: { "*": "deny" } }, isolated_reader: { description: "Isolated reader", mode: "primary", permission: { "*": "deny", read: { "*": "deny", "allowed.txt": "ask" } } } },
      provider: { isolated: { npm: "@ai-sdk/openai-compatible", options: { baseURL: url, apiKey: "isolated-free-provider" },
        models: { "native-drain": { name: "Free fixture", limit: { context: 32768, output: 4096 } } } } } };
    load("test/vscodeMock.js").installVscodeMock();
    require("vscode").workspace.getConfiguration = () => ({ get: (key, fallback) => key === "commands.opencode" ? binary : key === "args.opencode" ? ["--agent=isolated_reader"] : fallback });
    const runner = load("cli/commandRunner.js"), monitor = load("cli/openCodeSubagentMonitor.js"), runtime = load("extensionHost/openCodeSubagentRuntime.js");
    const prepare = runtime.createOpenCodeSubagentRuntimePreparer({ getOpenCodeCliArgs: () => ["--agent=isolated_reader"],
      resolveConnection: monitor.resolveOpenCodeSubagentConnection, waitForServerReady: monitor.waitForOpenCodeServerReady,
      startServer: (port, handlers, opts) => {
        handle = runner.startOpenCodeServer(port, handlers, opts);
        evidence.serverPid = handle.pid;
        serverClose = new Promise(resolve => { const check = () => { try { process.kill(handle.pid, 0); setTimeout(check, 25); } catch { resolve(); } }; check(); });
        return handle;
      }, buildServerProcessLabel: id => `managed-main-${id}`, getDefaultDirectory: () => directory,
      logInfo: (event, data) => evidence.lifecycle.push({ event, ...data }), logDebug: () => {}, logError: (event, data) => evidence.lifecycle.push({ event, ...data }) });
    const noop = () => {};
    const host = load("extensionHost/promptOneShotRuntime.js").createPromptOneShotRuntimeHost({
      AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024 * 1024,
      resolveOpenCodeContextWindow: async () => 32768, adoptFreshOpenCodeLoopRecoverySession: () => { throw new Error("unexpected recovery"); },
      appendAssistantChunk: content => { target.push({ id: crypto.randomUUID(), role: "assistant", content, createdAt: Date.now() }); },
      appendCompletionMessage: status => evidence.completions.push(status), appendMessageToStore: (store, value) => store.push(value),
      appendSystemMessage: content => target.push({ id: crypto.randomUUID(), role: "system", content, createdAt: Date.now() }),
      appendTraceLines: noop, appendTraceMessage: noop, applyProcessTitle: noop, applyThinkingWorkspaceFiles: noop,
      buildOpenCodeFailureMessage: (out, fallback) => out.errorText ?? fallback, buildOpenCodeMissingFinalConclusionMessage: () => "missing final",
      buildSubagentProgressLabels: () => ({ provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" }, subagent: "child",
        status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" }, errorPrefix: "error" }),
      buildUserChatMessage: (input, createdAt, id) => ({ id, role: "user", content: input.displayPrompt, createdAt }),
      captureSessionFromBuffer: (_cli, buffer) => { const id = runner.extractOpenCodeRuntimeSessionId(buffer); if (id) sessionId = id; },
      cancelHumanInteractionForTab: noop, clearActiveRun: () => { runId = undefined; task = null; },
      createDisabledOpenCodeSubagentMonitor: runtime.createDisabledOpenCodeSubagentMonitor, createMessageId: () => crypto.randomUUID(), flushTraceBuffer: noop,
      getActiveRunId: () => runId, getActiveTaskRun: () => task, getEffectiveThinkingMode: () => "medium", getGlobalHumanInteractionEnabled: () => false,
      getPendingSessionDraft: () => ({ messages }), killActiveProcess: () => activeProcess?.kill(), loadSessionMessages: () => messages, logCliStartup: noop,
      maybeAutoCompactContextAfterPromptSuccess: async () => {}, maybePersistLongTermMemoryFromRun: noop,
      persistActiveMessages: () => fs.writeFileSync(path.join(root, "transcript.json"), JSON.stringify(messages)),
      prepareOpenCodeRuntime: async () => ({ envOverrides: {}, configContent: JSON.stringify(config), role: "main", mainModel: model, subtaskModel: model,
        effectiveModel: model, mainVariant: null, subtaskVariant: null, effectiveVariant: null, modelFallback: "none", primaryModel: model,
        smallModel: model, primaryVariant: null, smallVariant: null }), prepareOpenCodeSubagentRuntime: prepare, preparePendingLabel: noop,
      requestHumanInteraction: () => { throw new Error("unexpected human interaction"); }, resetActiveAssistantMessage: noop, resetTraceState: noop,
      resolveCliSessionIdForResume: (_cli, id) => id, resolveWorkspaceCwd: () => directory,
      sendOpenCodeTaskListUpdate: noop, sendPanelMessage: noop, sendRawStreamDelta: noop, sendRunStatus: (status, message) => evidence.statuses.push({ status, message }),
      setActiveCliForRun: noop, setActiveMessageTarget: value => { target = value ?? messages; }, setActiveProcess: value => { activeProcess = value; },
      setActiveRunId: value => { runId = value; }, setActiveSessionId: value => { if (value) sessionId = value; }, setActiveTabIdForRun: noop,
      shouldAutoCompactContextAfterRunForTarget: () => false, shouldRequireExplicitFinalAnswerForRun: () => false,
      showCliCommandNotFoundError: message => { throw new Error(message); },
      startTaskRun: (id, cli, session, prompt) => { task = { id, cli, sessionId: session, prompt, startedAt: Date.now() }; }, startTraceMessage: noop,
      t: key => key, updateSessionBuffer: (buffer, chunk) => buffer + chunk,
    });
    await host.runPromptOneShot({ displayPrompt: "MANAGED_MAIN_TOOL_CONTRACT", modelPrompt: `MANAGED_MAIN_TOOL_CONTRACT Read ${allowed}; verify ${denied} remains denied.`,
      contextTags: [], taskRole: "main", loopTaskId: crypto.randomUUID(), cliCommandRepairAttempted: true }, { tabId: "managed-main", cli: "opencode", sessionId: null });
    assert.deepEqual(evidence.completions, ["end"]); assert.equal(source.state.stage, 2); assert.deepEqual(source.failures, []);
    assert.ok(messages.some(m => m.role === "assistant" && m.content.includes(`MANAGED_MAIN_READ_OK ${token}`)));
    const submissions = evidence.http.filter(r => r.method === "POST" && /\/session\/[^/]+\/message$/u.test(r.route));
    assert.equal(submissions.length, 1, "must not replay"); const submission = submissions[0];
    assert.equal(submission.body.agent, "isolated_reader"); assert.equal(submission.response.info.agent, "isolated_reader");
    assert.equal(submission.response.info.parentID, submission.body.messageID); assert.equal(submission.response.info.sessionID, sessionId);
    assert.equal(submission.response.info.path.cwd, directory);
    const permissions = evidence.events.filter(e => e.type === "permission.asked");
    // Monitor and helper each subscribe. Native IDs are deduplicated for audit.
    const asked = [...new Map(permissions.map(e => [e.properties.id, e.properties])).values()];
    assert.equal(asked.length, 1); assert.equal(asked[0].sessionID, sessionId); assert.equal(asked[0].permission, "read");
    assert.deepEqual(asked[0].patterns, ["allowed.txt"]);
    const replies = evidence.http.filter(r => r.route.startsWith("/permission/"));
    assert.equal(replies.length, 1); assert.equal(replies[0].route, `/permission/${asked[0].id}/reply`); assert.deepEqual(replies[0].body, { reply: "once" });
    assert.ok(evidence.events.some(e => e.type === "message.updated" && e.properties.info?.id === asked[0].tool.messageID
      && e.properties.info.parentID === submission.body.messageID));
    evidence.sessionId = sessionId; evidence.permissions = { asked, replies, explicitDenyProducedNoAsk: true };
    evidence.nativeToolParts = evidence.events.filter(e => e.type === "message.part.updated" && e.properties.part?.type === "tool");
    await Promise.race([serverClose, new Promise((_, reject) => setTimeout(() => reject(new Error("server-close-timeout")), 5000))]);
    assert.ok(evidence.http.filter(r => r.route === "/event").length >= 2, "monitor plus managed subscriptions required");
    assert.ok(evidence.http.filter(r => r.route === "/event").every(r => r.closed), "event subscription leaked");
    assert.deepEqual(evidence.forcedCleanup, []); evidence.status = "passed";
  } catch (error) { failure = error; evidence.status = "failed"; evidence.failure = error.stack; }
  finally {
    clearTimeout(watchdog);
    if (failure) { activeProcess?.kill(); handle?.kill(); evidence.forcedCleanup.push("failure-hygiene"); }
    if (source) { evidence.provider = { state: source.state, requests: source.requests, failures: source.failures };
      source.server.closeAllConnections(); await new Promise(resolve => source.server.close(resolve)); }
    evidence.after = snapshot(options.product); assert.deepEqual(evidence.after, evidence.before, "product changed during execution");
    evidence.messages = messages; unobserve(); write();
  }
  if (failure) throw failure;
  console.log(JSON.stringify({ status: evidence.status, report: options.report, sessionId, permissions: evidence.permissions.asked.length }));
}
async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args); assert.ok(!fs.existsSync(options.report), "new report path required");
  const product = fs.realpathSync(options.product);
  assert.ok(!fs.existsSync(path.join(product, ".git")), "git workspace product forbidden"); snapshot(product);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "round376-managed-")), env = isolatedEnvironment(root);
  for (const key of ["HOME", "CODEX_HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "TMPDIR", "OPENCODE_CONFIG_DIR"]) fs.mkdirSync(env[key], { recursive: true });
  fs.mkdirSync(path.join(root, "workspace"));
  const childProcess = cp.spawn(process.execPath, [__filename, "--child", JSON.stringify({ ...options, product }), root], { env, stdio: "inherit" });
  const code = await new Promise(resolve => childProcess.on("exit", resolve)); assert.equal(code, 0, `managed-main failed; report=${options.report}`);
}
module.exports = { parseArgs, classify, provider, snapshot };
if (require.main === module) {
  const run = process.argv[2] === "--child" ? child(JSON.parse(process.argv[3]), process.argv[4]) : main();
  run.catch(error => { console.error(error.stack); process.exitCode = 1; });
}
