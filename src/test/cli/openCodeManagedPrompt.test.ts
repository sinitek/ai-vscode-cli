import test = require("node:test");
import assert = require("node:assert/strict");
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runOpenCodeManagedPrompt } from "../../cli/openCodeManagedPrompt";
import { parseOpenCodeRunOutput, extractOpenCodeRuntimeSessionId } from "../../cli/openCodeRunOutput";

type Mutation = (value: any) => void;
async function harness(t: test.TestContext, mutate: Mutation = () => {}, delay = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-prompt-test-"));
  const directory = fs.realpathSync(root);
  const calls: { method?: string; url: string; body: any }[] = [];
  let release: (() => void) | undefined;
  let entered!: () => void;
  const requested = new Promise<void>(resolve => { entered = resolve; });
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return;
    }
    calls.push({ method: req.method, url: url.pathname, body });
    assert.equal(url.searchParams.get("directory"), directory);
    assert.equal(req.headers.authorization, "Basic local-only");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/session" || req.method === "GET") {
      res.end(JSON.stringify({ id: "ses_original", directory })); return;
    }
    const response = { info: { id: "msg_answer", role: "assistant", sessionID: "ses_original", parentID: body.messageID,
      providerID: "local", modelID: "model", path: { cwd: directory }, time: { completed: Date.now() }, finish: "stop" },
      parts: [{ id: "prt_text", type: "text", sessionID: "ses_original", messageID: "msg_answer", text: '{"status":"continue"}' }] };
    mutate(response);
    entered();
    if (delay) await new Promise<void>(resolve => { release = resolve; });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { release?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true }); });
  const address = server.address() as { port: number };
  let active = true, stdout = "", sessions: string[] = [];
  let done!: (error: Error | null) => void;
  const result = new Promise<Error | null>(resolve => { done = resolve; });
  const start = (resume: string | null = null, timeoutMs?: number, maxBytes = 8192) => runOpenCodeManagedPrompt({
    connection: { serverUrl: `http://127.0.0.1:${address.port}`, authorization: "Basic local-only" },
    cwd: root, sessionId: resume, model: "local/model", variant: "high", prompt: "exact current prompt",
    isCurrent: () => active, onSession: id => sessions.push(id), maxBytes, timeoutMs,
  }, { onStdout: chunk => { stdout += chunk; }, onExit: code => { assert.equal(code, 0); done(null); }, onError: done });
  return { start, result, calls, requested, release: () => release?.(), stale: () => { active = false; }, output: () => stdout, sessions: () => sessions };
}

test("managed native response is bound to exact request/session/directory and parsed without another execution", async t => {
  const h = await harness(t); h.start(); assert.equal(await h.result, null);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].method, "POST");
  assert.deepEqual(h.calls[1].body.parts, [{ type: "text", text: "exact current prompt" }]);
  assert.deepEqual(h.calls[1].body.model, { providerID: "local", modelID: "model" });
  assert.equal(h.calls[1].body.variant, "high");
  assert.equal(extractOpenCodeRuntimeSessionId(h.output()), "ses_original");
  assert.equal(parseOpenCodeRunOutput(h.output(), "").finalText, '{"status":"continue"}');
  assert.deepEqual(h.sessions(), ["ses_original"]);
});
test("managed resume uses GET of fixed session and submits only once", async t => {
  const h = await harness(t); h.start("ses_original"); assert.equal(await h.result, null);
  assert.equal(h.calls[0].method, "GET"); assert.equal(h.calls[0].url, "/session/ses_original"); assert.equal(h.calls.length, 2);
});
for (const [name, mutate] of Object.entries<Mutation>({
  "wrong session": value => { value.info.sessionID = "ses_foreign"; },
  "old request": value => { value.info.parentID = "msg_old"; },
  "wrong directory": value => { value.info.path.cwd = "/foreign"; },
  "wrong model": value => { value.info.modelID = "other"; },
  "old completion": value => { value.info.time.completed = 1; },
  "duplicate part": value => { value.parts.push(value.parts[0]); },
  "foreign part": value => { value.parts[0].messageID = "msg_foreign"; },
  "empty output": value => { value.parts[0].text = ""; },
})) test(`managed response rejects ${name} without output or replay`, async t => {
  const h = await harness(t, mutate); h.start(); assert.ok(await h.result); assert.equal(h.output(), ""); assert.equal(h.calls.length, 2);
});
test("managed cancellation fences late result and does not replay", async t => {
  const h = await harness(t, undefined, true); const process = h.start(); await h.requested;
  process.kill(); h.release(); assert.match((await h.result)!.message, /cancelled/); assert.equal(h.output(), ""); assert.equal(process.kill(), false);
});
test("managed target invalidation fences a late successful response", async t => {
  const h = await harness(t, undefined, true); h.start(); await h.requested; h.stale(); h.release();
  assert.match((await h.result)!.message, /cancelled/); assert.equal(h.output(), "");
});
test("managed request has a finite timeout", async t => {
  const h = await harness(t, undefined, true); h.start(null, 30); await h.requested;
  assert.match((await h.result)!.message, /timeout/); h.release(); assert.equal(h.output(), "");
});
test("managed response rejects oversized output", async t => {
  const h = await harness(t, value => { value.parts[0].text = "x".repeat(10000); }); h.start(null, 1000, 2048);
  assert.match((await h.result)!.message, /budget/); assert.equal(h.output(), "");
});

async function eventHarness(t: test.TestContext, args: string[] = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "managed-events-")));
  let events!: http.ServerResponse, response!: http.ServerResponse, prompt: any;
  const replies: any[] = [], requests: string[] = [], sessions: string[] = [];
  let ready!: () => void, nativeDone!: (error: Error | null) => void;
  const entered = new Promise<void>(resolve => { ready = resolve; });
  const result = new Promise<Error | null>(resolve => { nativeDone = resolve; });
  let active = true, stdout = "", activities = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost"); requests.push(url.pathname);
    assert.equal(url.searchParams.get("directory"), root);
    if (url.pathname === "/event") { events = res; res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders(); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/agent") { res.end(JSON.stringify([{ name: "restricted", mode: "primary" }])); return; }
    if (url.pathname === "/session") { res.end(JSON.stringify({ id: "ses_current", directory: root })); return; }
    if (url.pathname === "/session/ses_child") { res.end(JSON.stringify({ id: "ses_child", parentID: "ses_current", directory: root, time: { created: Date.now() } })); return; }
    if (url.pathname.startsWith("/permission/")) { replies.push({ path: url.pathname, ...body }); res.end("true"); return; }
    if (url.pathname === "/session/ses_current/message") { response = res; prompt = body; ready(); return; }
    res.writeHead(404); res.end("false");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true }); });
  const run = runOpenCodeManagedPrompt({ connection: { serverUrl: `http://127.0.0.1:${(server.address() as any).port}` },
    cwd: root, sessionId: null, model: "local/model", variant: null, args, prompt: "read only isolated fixture",
    isCurrent: () => active, onSession: id => sessions.push(id), maxBytes: 65536,
  }, { onActivity: () => activities++, onStdout: chunk => { stdout += chunk; }, onExit: () => nativeDone(null), onError: nativeDone });
  await entered;
  const send = (type: string, properties: any) => events.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
  const info = (id = "msg_current", sessionID = "ses_current", parentID = prompt.messageID) => ({ id, sessionID, parentID, role: "assistant",
    providerID: "local", modelID: "model", agent: "restricted", path: { cwd: root }, time: { created: Date.now() } });
  const tool = (sessionID = "ses_current", messageID = "msg_current", callID = "call_read") => ({ id: `prt_${callID}`, type: "tool", sessionID, messageID, callID,
    tool: "read", state: { status: "running", input: { filePath: path.join(root, "only.txt") } } });
  const ask = (overrides: any = {}) => ({ id: "per_current", sessionID: "ses_current", permission: "read", patterns: [path.join(root, "only.txt")],
    metadata: {}, always: [], tool: { messageID: "msg_current", callID: "call_read" }, ...overrides });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 100 && !predicate(); i++) await flush(); assert.ok(predicate()); };
  const complete = () => response.end(JSON.stringify({ info: { ...info(), finish: "stop", time: { completed: Date.now() } },
    parts: [{ id: "prt_final", type: "text", sessionID: "ses_current", messageID: "msg_current", text: "EXACT_FINAL" }] }));
  return { send, info, tool, ask, flush, waitFor, complete, result, run, replies, requests, prompt,
    active: () => { active = false; }, activities: () => activities, stdout: () => stdout, sessions };
}

test("managed ask replies once only to the exact current tool, keeps question/plan denials and delivers final once", async t => {
  const h = await eventHarness(t, ["--agent=restricted"]);
  assert.equal(h.prompt.agent, "restricted");
  h.send("message.updated", { info: h.info() });
  h.send("message.part.updated", { part: h.tool() });
  for (let n = 0; n < 2; n++) h.send("permission.asked", h.ask());
  for (const permission of ["question", "plan_enter", "plan_exit"]) h.send("permission.asked", h.ask({ id: `per_${permission}`, permission }));
  await h.waitFor(() => h.replies.length === 4);
  assert.deepEqual(h.replies.map(r => r.reply), ["once", "reject", "reject", "reject"]);
  assert.equal(h.activities(), 1); assert.equal(h.stdout(), "");
  h.complete(); assert.equal(await h.result, null);
  assert.equal((h.stdout().match(/EXACT_FINAL/g) ?? []).length, 1);
});

test("foreign/old messages, session-only busy, unknown child and wrong tool never grant permission or startup activity", async t => {
  const h = await eventHarness(t);
  h.send("message.updated", { info: h.info("msg_old", "ses_current", "old_request") });
  h.send("message.part.updated", { part: h.tool("ses_current", "msg_old") });
  h.send("session.status", { sessionID: "ses_current", status: { type: "busy" } });
  h.send("session.created", { info: { id: "ses_child", parentID: "ses_current" } });
  h.send("permission.asked", h.ask());
  h.send("permission.asked", h.ask({ sessionID: "ses_child" }));
  await h.flush(); assert.equal(h.replies.length, 0); assert.equal(h.activities(), 0);
  h.send("message.updated", { info: h.info() });
  h.send("message.part.updated", { part: h.tool() });
  h.send("permission.asked", h.ask({ tool: { messageID: "msg_old", callID: "call_read" } }));
  h.send("permission.asked", h.ask({ sessionID: "ses_foreign" }));
  await h.waitFor(() => h.activities() === 1); assert.equal(h.replies.length, 0);
  h.complete(); assert.equal(await h.result, null);
});

test("child permission requires current task metadata plus native canonical parent verification", async t => {
  const h = await eventHarness(t);
  h.send("message.updated", { info: h.info() });
  const task = h.tool(); task.tool = "task"; (task.state as any).metadata = { sessionId: "ses_child", model: { modelID: "model", providerID: "local" } };
  h.send("message.part.updated", { part: task });
  h.send("message.updated", { info: h.info("msg_child", "ses_child", "msg_child_request") });
  h.send("message.part.updated", { part: h.tool("ses_child", "msg_child", "child_read") });
  h.send("permission.asked", h.ask({ sessionID: "ses_child", tool: { messageID: "msg_child", callID: "child_read" } }));
  await h.waitFor(() => h.replies.length === 1); assert.ok(h.requests.includes("/session/ses_child"));
  h.complete(); assert.equal(await h.result, null);
});

for (const cancel of [true, false]) test(`managed ${cancel ? "cancel" : "stale"} fences queued permission/activity/final callbacks`, async t => {
  const h = await eventHarness(t);
  if (cancel) h.run.kill(); else h.active();
  h.send("message.updated", { info: h.info() });
  h.send("message.part.updated", { part: h.tool() }); h.send("permission.asked", h.ask()); h.complete();
  assert.match((await h.result)!.message, /cancelled/);
  assert.equal(h.replies.length, 0); assert.equal(h.activities(), 0); assert.equal(h.stdout(), "");
});

test("managed arguments preserve explicit agent and reject unsupported modes rather than silently dropping them", () => {
  const { resolveManagedOpenCodeArgs } = require("../../cli/openCodeManagedPrompt");
  for (const args of [["--agent", "restricted"], ["--agent=restricted"]]) {
    assert.equal(resolveManagedOpenCodeArgs(args, "local/model", null).agent, "restricted");
  }
  assert.deepEqual(resolveManagedOpenCodeArgs(["run", "--auto", "--model=local/effective", "--variant", "low"], "local/old", "high"),
    { model: "local/effective", variant: "low" });
  for (const args of [["--agent"], ["--agent="], ["--agent=a", "--agent=b"], ["--command", "x"], ["--file=a"], ["--fork"], ["--format=default"]]) {
    assert.throws(() => resolveManagedOpenCodeArgs(args, "local/model", null), /opencode-managed-/);
  }
});
