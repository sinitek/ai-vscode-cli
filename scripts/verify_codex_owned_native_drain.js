"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { createRequire } = require("node:module");
const { createLocalResponsesServer } = require("./fixtures/codex_local_responses_server");

const DEFAULT_TIMEOUT_MS = 60000;

function within(promise, timeoutMs, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}-timeout-${timeoutMs}ms`)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

function makeParser(onMessage) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (buffer.length > 1024 * 1024) throw new Error("app-server-jsonl-line-limit");
    const lines = buffer.split("\n"); buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) onMessage(JSON.parse(line));
    }
  };
}

function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (predicate()) { resolve(); return; } } catch (error) { reject(error); return; }
      if (Date.now() >= deadline) { reject(new Error(`${label}-timeout-${timeoutMs}ms`)); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function containsText(value, expected, depth = 0) {
  if (depth > 24 || value === null || value === undefined) return false;
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value)) return value.some((item) => containsText(item, expected, depth + 1));
  if (typeof value === "object") return Object.entries(value).some(([key, item]) =>
    key === "text" && typeof item === "string" ? item.includes(expected) : containsText(item, expected, depth + 1));
  return false;
}

function isPathWithin(parentPath, candidatePath, pathApi = path) {
  const parent = pathApi.resolve(parentPath);
  const candidate = pathApi.resolve(candidatePath);
  const relative = pathApi.relative(parent, candidate);
  return relative === "" || (!pathApi.isAbsolute(relative)
    && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`));
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      if (options.live) throw new Error("duplicate --live");
      options.live = true;
    } else if (argument === "--module-root" || argument === "--report") {
      if (options[argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())]) {
        throw new Error(`duplicate ${argument}`);
      }
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument === "--module-root" ? "moduleRoot" : "reportPath"] = value;
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  assert.ok(options.live, "pass --live to run the real Codex scenario");
  assert.ok(options.moduleRoot, "pass --module-root with an isolated build path; shared dist is not used");
  assert.ok(path.isAbsolute(options.moduleRoot), "module root must be an absolute isolated-build path");
  return options;
}

function realPathWithin(parentPath, candidatePath) {
  return isPathWithin(fs.realpathSync(parentPath), fs.realpathSync(candidatePath));
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const reportPath = path.resolve(options.reportPath
    || path.join(os.tmpdir(), `codex-owned-native-drain-${Date.now()}-${process.pid}.json`));
  assert.ok(!fs.existsSync(reportPath), "refusing to overwrite an existing report");
  const moduleRoot = fs.realpathSync(options.moduleRoot);
  const sharedDist = path.resolve(__dirname, "..", "dist");
  assert.ok(!fs.existsSync(sharedDist) || !isPathWithin(fs.realpathSync(sharedDist), moduleRoot)
    && !isPathWithin(moduleRoot, fs.realpathSync(sharedDist)), "module root must not be the shared repository dist");
  assert.ok(fs.existsSync(path.join(moduleRoot, "interactive/codexRunnerProcessCore.js"))
    && fs.existsSync(path.join(moduleRoot, "interactive/codexOwnedExecution.js")), "module root is not a complete isolated build");
  const codeRequire = createRequire(path.join(moduleRoot, "interactive/codexRunnerProcessCore.js"));
  const crossSpawn = codeRequire("cross-spawn");
  const originalSpawn = crossSpawn.spawn;
  const executable = path.resolve(process.env.CODEX_BINARY || cp.execFileSync(process.platform === "win32" ? "where" : "which", ["codex"], {
    encoding: "utf8", env: { PATH: process.env.PATH || "", PATHEXT: process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" },
  }).trim().split(/\r?\n/)[0]);
  const versionResult = cp.spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH || "", HOME: os.tmpdir(), USERPROFILE: os.tmpdir() } });
  assert.equal(versionResult.status, 0, versionResult.stderr || versionResult.error?.message);
  const version = /^codex-cli\s+(\S+)/.exec(versionResult.stdout.trim())?.[1];
  assert.ok(version, `unexpected Codex binary version output: ${versionResult.stdout.trim()}`);

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codex-owned-native-drain-")));
  const home = path.join(root, "home"), codexHome = path.join(root, "codex-home"), workspace = path.join(root, "workspace");
  for (const directory of [home, codexHome, workspace]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.txt"), "Temporary Codex drain verification workspace.\n");
  const fixture = createLocalResponsesServer(), processes = [], requests = [];
  const evidence = { binary: executable, version, platform: process.platform, arch: process.arch,
    node: process.version, responsesProvider: "127.0.0.1 only", processes, turns: requests };
  let failure, forcedCleanup = false, serverStarted = false, firstThreadId;
  const isolatedEnv = { PATH: process.env.PATH || "", PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR, ComSpec: process.env.ComSpec, HOME: home, USERPROFILE: home,
    CODEX_HOME: codexHome, CODEX_HOME_DIR: codexHome, TMPDIR: root, TMP: root, TEMP: root,
    LANG: "en_US.UTF-8", NO_COLOR: "1" };

  try {
    await new Promise((resolve, reject) => { fixture.server.once("error", reject); fixture.server.listen(0, "127.0.0.1", resolve); });
    serverStarted = true;
    const port = fixture.server.address().port;
    fs.writeFileSync(path.join(codexHome, "config.toml"), [
      'model = "local-test"', 'model_provider = "native_drain_local"',
      '[features]', 'plugins = false', 'shell_tool = false', 'web_search_request = false',
      '[model_providers.native_drain_local]', 'name = "Loopback Responses test fixture"',
      `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"', 'requires_openai_auth = false',
      '', `[projects.${JSON.stringify(workspace)}]`, 'trust_level = "trusted"', '',
    ].join("\n"));

    crossSpawn.spawn = (...spawnArgs) => {
      const child = originalSpawn(...spawnArgs);
      const command = spawnArgs[0], childArgs = [...(spawnArgs[1] || [])];
      if (!childArgs.includes("app-server")) return child;
      const entry = { pid: child.pid, command, args: childArgs, exit: null, close: null,
        stdio: { stdinEnded: false, stdinClosed: false, stdoutEnded: false, stdoutClosed: false,
          stderrEnded: false, stderrClosed: false }, requests: [] };
      processes.push(entry);
      child.once("exit", (code, signal) => { entry.exit = { code, signal, at: Date.now() }; });
      child.once("close", (code, signal) => { entry.close = { code, signal, at: Date.now() }; });
      for (const [name, readable] of [["stdout", true], ["stderr", true], ["stdin", false]]) {
        const stream = child[name]; if (!stream) continue;
        if (readable) stream.once("end", () => { entry.stdio[`${name}Ended`] = true; });
        else stream.once("finish", () => { entry.stdio.stdinEnded = true; });
        stream.once("close", () => { entry.stdio[`${name}Closed`] = true; });
      }
      const pending = new Map();
      const observe = (message, direction) => {
        if (direction === "request" && message.id !== undefined) {
          pending.set(message.id, message.method);
          entry.requests.push({ method: message.method, params: message.params, direction });
        } else if (message.id !== undefined && pending.has(message.id)) {
          const method = pending.get(message.id); pending.delete(message.id);
          const nativePath = message.result?.thread?.path;
          entry.requests.push({ method, direction: "response", error: message.error ?? null,
            threadId: message.result?.thread?.id ?? message.result?.threadId ?? null,
            nativePath: typeof nativePath === "string" ? nativePath : null });
        } else if (message.method) {
          entry.requests.push({ method: message.method, direction: "notification",
            threadId: message.params?.threadId ?? null, turnId: message.params?.turn?.id ?? null,
            status: message.params?.turn?.status ?? null });
        }
      };
      const outgoing = makeParser((message) => observe(message, "request"));
      const write = child.stdin.write;
      child.stdin.write = function (chunk, ...writeArgs) { outgoing(chunk); return write.call(this, chunk, ...writeArgs); };
      child.stdout.on("data", (chunk) => {
        const parser = entry.stdoutParser || (entry.stdoutParser = makeParser((message) => observe(message, "notification")));
        parser(chunk);
      });
      return child;
    };

    const { CodexOwnedExecution } = require(path.join(moduleRoot, "interactive/codexOwnedExecution.js"));
    const runtime = { macTaskShell: "bash", logInfo() {}, logError() {} };
    const handlerEvents = [];
    const handlers = { onAssistantDelta(text, meta) { handlerEvents.push({ type: "assistant", text, final: meta?.codexFinalAnswer === true }); },
      onTrace(text, kind) { handlerEvents.push({ type: "trace", kind }); }, onTaskListUpdate() {}, onThreadId(id) { handlerEvents.push({ type: "thread", id }); } };
    const runImmutableExecution = async (threadId, ordinal) => {
      const signal = new AbortController().signal;
      const execution = new CodexOwnedExecution({
        runner: { command: executable, args: [], cwd: workspace, env: isolatedEnv, thinkingMode: "medium",
          interactiveMode: "coding", model: "local-test", threadId, configFingerprint: "native-drain-local-provider-v1" },
        runtime, prompt: `Return one short answer. Local drain invocation ${ordinal}.`, handlers, signal,
        bindSession: async (session) => session,
      });
      const session = await within(execution.prepare(), DEFAULT_TIMEOUT_MS, `execution-${ordinal}-prepare`);
      if (ordinal === 1) {
        assert.equal(threadId, null);
        assert.ok(session.threadId);
        firstThreadId = session.threadId;
      } else {
        assert.equal(threadId, firstThreadId, "second immutable execution must resume the exact first native thread");
        assert.equal(session.threadId, firstThreadId);
      }
      await within(execution.execute(), DEFAULT_TIMEOUT_MS, `execution-${ordinal}-business`);
      const cleanup = await within(execution.cleanup(), DEFAULT_TIMEOUT_MS, `execution-${ordinal}-cleanup`);
      requests.push({ ordinal, threadId: session.threadId, connectionId: session.connectionId,
        turnTerminal: cleanup.turnTerminal, business: cleanup.business, processTerminal: cleanup.processTerminal,
        streams: cleanup.streams, executionDrain: cleanup.executionDrain, runner: cleanup.runner,
        handlerEvents: [...handlerEvents] });
      return cleanup;
    };

    const first = await runImmutableExecution(null, 1);
    const firstProcess = processes.at(-1);
    assert.ok(firstProcess?.exit && firstProcess.close, "first app-server must emit exit and close before resuming its thread");
    const firstThreadResponse = firstProcess.requests.find((message) => message.method === "thread/start" && message.direction === "response");
    await waitFor(() => Boolean(firstThreadResponse?.nativePath && fs.existsSync(firstThreadResponse.nativePath)), 5000,
      "native-thread-file-persistence");
    firstThreadResponse.persistedUnderIsolatedCodexHome = realPathWithin(codexHome, firstThreadResponse.nativePath);
    delete firstThreadResponse.nativePath;
    assert.ok(firstProcess.stdio.stdinEnded && firstProcess.stdio.stdinClosed
      && firstProcess.stdio.stdoutEnded && firstProcess.stdio.stdoutClosed
      && firstProcess.stdio.stderrEnded && firstProcess.stdio.stderrClosed, "first app-server stdio must end and close naturally");
    assert.ok(firstProcess.requests.some((message) => message.method === "thread/start" && message.direction === "request"));
    assert.ok(firstProcess.requests.some((message) => message.method === "thread/start" && message.direction === "response"
      && message.threadId === firstThreadId && message.persistedUnderIsolatedCodexHome),
    "native thread must persist under isolated CODEX_HOME before the directory is removed");
    assert.deepEqual([first.business.status, first.turnTerminal.status, first.processTerminal.status,
      first.streams.status, first.executionDrain.status, first.runner.status],
    ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "confirmed"]);

    const second = await runImmutableExecution(firstThreadId, 2);
    const secondProcess = processes.at(-1);
    assert.ok(secondProcess && secondProcess !== firstProcess && secondProcess.close, "resumed immutable execution must use a newly closed owned process");
    const resumeResponse = secondProcess.requests.find((message) => message.method === "thread/resume" && message.direction === "response");
    await waitFor(() => Boolean(resumeResponse?.nativePath && fs.existsSync(resumeResponse.nativePath)), 5000,
      "resumed-native-thread-file-persistence");
    resumeResponse.persistedUnderIsolatedCodexHome = realPathWithin(codexHome, resumeResponse.nativePath);
    delete resumeResponse.nativePath;
    assert.ok(secondProcess.requests.some((message) => message.method === "thread/resume" && message.direction === "request"
      && message.params?.threadId === firstThreadId), "second app-server must request exact native thread/resume");
    assert.ok(secondProcess.requests.some((message) => message.method === "thread/resume" && message.direction === "response"
      && message.threadId === firstThreadId && message.persistedUnderIsolatedCodexHome),
    "native app-server must confirm the exact resumed thread from isolated persistent storage");
    assert.ok(secondProcess.requests.some((message) => message.method === "turn/start" && message.direction === "request"
      && message.params?.threadId === firstThreadId), "second task must target the exact resumed thread");
    assert.deepEqual([second.business.status, second.turnTerminal.status, second.processTerminal.status,
      second.streams.status, second.executionDrain.status, second.runner.status],
    ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "confirmed"]);
    assert.equal(fixture.requests.length, 2, "exactly two local Responses requests, one per immutable execution");
    evidence.threadId = firstThreadId;
    evidence.serverRequests = fixture.requests.map(({ body, responseId }) => ({ responseId, model: body.model,
      previous_response_id: body.previous_response_id ?? null, stream: body.stream === true,
      inputKind: Array.isArray(body.input) ? "array" : typeof body.input,
      inputCount: Array.isArray(body.input) ? body.input.length : null,
      promptIncluded: containsText(body.input, `Local drain invocation ${fixture.requests.indexOf(fixture.requests.find((request) => request.responseId === responseId)) + 1}`) }));
    assert.ok(evidence.serverRequests[0].promptIncluded);
    assert.ok(evidence.serverRequests[1].promptIncluded);
    evidence.cleanupVerified = true;
  } catch (error) {
    failure = error;
  } finally {
    crossSpawn.spawn = originalSpawn;
    if (serverStarted) {
      try { await closeServer(fixture.server); } catch (error) { failure ||= error; }
    }
    const alive = processes.filter((entry) => !entry.close && entry.pid);
    if (alive.length) {
      forcedCleanup = true;
      for (const entry of alive) { try { process.kill(-entry.pid, "SIGTERM"); } catch { try { process.kill(entry.pid, "SIGTERM"); } catch {} } }
      for (const entry of alive) { try { process.kill(-entry.pid, "SIGKILL"); } catch {} }
      failure ||= new Error("forced-process-cleanup-is-not-drain-evidence");
    }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (error) { failure ||= error; }
    if (fs.existsSync(root)) { failure ||= new Error("temporary-root-removal-failed"); }
  }

  const report = { passed: !failure && !forcedCleanup, forcedCleanup, evidence,
    limitation: "A failed or timed-out drain remains failure; process killing is fixture reclamation only." };
  if (failure) report.failure = failure.stack || String(failure);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ reportPath, passed: report.passed, version, threadId: evidence.threadId,
    executions: requests.map(({ ordinal, processTerminal, streams, executionDrain }) => ({ ordinal, processTerminal, streams, executionDrain })),
    forcedCleanup, failure: report.failure }));
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { isPathWithin, main, parseArgs, realPathWithin };
