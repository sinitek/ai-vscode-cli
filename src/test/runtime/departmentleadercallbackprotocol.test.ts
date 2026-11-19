import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { createHash } from "crypto";
import { leaderFixture } from "./fixtures/departmentleadercodexhost";
import { LeaderCallbackAssembler, leaderCallbackFrames, LEADER_CALLBACK_BYTES, LEADER_CALLBACK_CHUNK_BYTES,
  LEADER_CALLBACK_CHUNK_LIMIT, LEADER_REQUIREMENTS } from "../../runtime/departmentleadercodexcontract";
import { boundedCodexMessage } from "../../runtime/departmentcodexpreparationcontract";
import type { DepartmentExecutionIdentity } from "../../runtime/departmentexecutionidentity";

const envelope = { version: 1 as const, token: "a".repeat(64), identity: {} as DepartmentExecutionIdentity, sequence: 10 };
const large = ["原始工具🌛\\\"\n".repeat(9000)];
const encode = (args = large, name = "onNotification", sequence = 10) => leaderCallbackFrames({ ...envelope, sequence }, "invoke", name, args);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("private callback uses existing small envelope and bounded UTF-8 chunks with exact roundtrip", () => {
  const small = encode(["short"]);
  assert.equal(small.frames.length, 1); assert.equal(small.frames[0].type, "callback");
  const encoded = encode(), assembler = new LeaderCallbackAssembler();
  assert.ok(encoded.frames.length > 2);
  for (const [index, frame] of encoded.frames.entries()) {
    assert.equal(boundedCodexMessage(frame), true);
    assert.equal(frame.sequence, 10 + index);
    const ready = assembler.accept(frame);
    if (index < encoded.frames.length - 1) assert.deepEqual(ready, []);
    else assert.deepEqual(ready, [{ sequence: 10, invocationId: "invoke", name: "onNotification", args: large }]);
  }
  assert.equal(assembler.size, 1, "one logical slot until consumption ACK");
  assert.equal(assembler.incomplete, false);
  assembler.release(10); assert.equal(assembler.size, 0);
});

test("short callbacks interleaved with incomplete chunks retain initial callback order", () => {
  const frames = encode().frames, assembler = new LeaderCallbackAssembler();
  assert.deepEqual(assembler.accept(frames[0]), []);
  assert.deepEqual(assembler.accept(encode(["middle"], "onAssistantDelta", 11).frames[0]), []);
  let ready: ReturnType<LeaderCallbackAssembler["accept"]> = [];
  for (let i = 1; i < frames.length; i++) ready = assembler.accept({ ...frames[i], sequence: 11 + i });
  assert.deepEqual(ready.map((event) => [event.sequence, event.args]), [[10, large], [11, ["middle"]]]);
  assembler.release(10); assembler.release(11); assert.equal(assembler.size, 0);
});

test("logical, aggregate, fragment-count and callback-slot budgets stay bounded", () => {
  assert.throws(() => encode(["x".repeat(LEADER_CALLBACK_BYTES)]), /callback-size-limit/);
  const exact = encode(["x".repeat(LEADER_CALLBACK_BYTES - 4)]);
  assert.equal(exact.bytes, LEADER_CALLBACK_BYTES);
  assert.equal(exact.frames.length, LEADER_CALLBACK_CHUNK_LIMIT);
  const assembler = new LeaderCallbackAssembler();
  assembler.accept(exact.frames[0]);
  assembler.accept({ ...exact.frames[0], sequence: 11, callbackSequence: 11 });
  assert.throws(() => assembler.accept(encode(["short"], "onEvent", 12).frames[0]), /callback-size-limit/);
  assembler.clear();
  for (let i = 1; i <= 32; i++) assembler.accept(encode(["short"], "onEvent", i).frames[0]);
  assert.throws(() => assembler.accept(encode(["short"], "onEvent", 33).frames[0]), /callback-capacity/);
  assembler.release(1); assert.equal(assembler.accept(encode(["new"], "onEvent", 33).frames[0]).length, 1);
});

test("control/request/log callbacks are never fragmented and serialization has a fixed diagnosis", () => {
  for (const name of ["onRequest", "logInfo", "logError", "onThreadId", "onTurnCompleted"]) assert.throws(() => encode(large, name), /callback-size-limit/);
  const circular: any[] = []; circular.push(circular);
  assert.throws(() => encode(circular), /^Error: callback-serialization-failed$/);
  assert.throws(() => leaderCallbackFrames(envelope, "invoke", "onEvent", [1n]), /^Error: callback-serialization-failed$/);
  let serializations = 0;
  const snapshot = encode([{ toJSON() { serializations++; return "snapshot"; } }] as any);
  assert.equal(serializations, 1); assert.deepEqual(snapshot.frames[0].args, ["snapshot"]);
});

test("matching chunk digest cannot bypass JSON, UTF-8 or callback arity validation", () => {
  for (const payload of [Buffer.from(" ".repeat(70000) + "bad-json"), Buffer.concat([Buffer.from('["' + "x".repeat(70000)), Buffer.from([0xff]), Buffer.from('"]')]),
    Buffer.from(JSON.stringify(["x".repeat(70000), 1, 2, 3]))]) {
    const count = Math.ceil(payload.length / LEADER_CALLBACK_CHUNK_BYTES), assembler = new LeaderCallbackAssembler();
    const digest = createHash("sha256").update(payload).digest("hex");
    assert.throws(() => {
      for (let index = 0; index < count; index++) assembler.accept({ ...envelope, sequence: 10 + index,
        type: "callback-chunk", invocationId: "invoke", name: "onEvent", callbackSequence: 10, index, count,
        totalBytes: payload.length, digest, data: payload.subarray(index * LEADER_CALLBACK_CHUNK_BYTES, (index + 1) * LEADER_CALLBACK_CHUNK_BYTES).toString("base64") });
    }, /fragment-rejected/);
  }
});

for (const corruption of ["duplicate", "missing-first", "order", "digest", "metadata", "base64", "length", "count", "extra", "name", "invocation"])
  test(`private callback rejects ${corruption} without delivering partial data`, () => {
    const frames = encode().frames.map((frame) => ({ ...frame })), assembler = new LeaderCallbackAssembler();
    if (corruption === "missing-first") { assert.throws(() => assembler.accept(frames[1]), /fragment-rejected/); return; }
    assert.deepEqual(assembler.accept(frames[0]), []);
    const bad = frames[1];
    if (corruption === "duplicate") { assert.throws(() => assembler.accept(frames[0]), /fragment-rejected/); return; }
    if (corruption === "order") bad.index = 2;
    if (corruption === "digest") bad.data = Buffer.alloc(LEADER_CALLBACK_CHUNK_BYTES, 65).toString("base64");
    if (corruption === "metadata") bad.totalBytes = Number(bad.totalBytes) + 1;
    if (corruption === "base64") bad.data = String(bad.data).slice(0, -1) + "!";
    if (corruption === "length") bad.data = "YQ==";
    if (corruption === "count") bad.count = LEADER_CALLBACK_CHUNK_LIMIT + 1;
    if (corruption === "extra") bad.secret = "unexpected";
    if (corruption === "name") bad.name = "onRequest";
    if (corruption === "invocation") bad.invocationId = "other";
    assert.throws(() => { for (let i = 1; i < frames.length; i++) assembler.accept(frames[i]); }, /fragment-rejected/);
  });

/** In-process fake child tests host authentication/order/ACK only. It provides no
 * native execution or cleanup evidence; those use the real fixed worker suite. */
async function hostProtocol(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "leader-callback-host-"));
  const h = await leaderFixture(directory), cp = require("child_process");
  const child: any = new EventEmitter(), sent: any[] = [], logs: any[] = [];
  let input: any, outgoing = 0;
  child.connected = true; child.unref = () => {}; child.channel = { unref() {} };
  child.disconnect = () => { child.connected = false; queueMicrotask(() => child.emit("disconnect")); };
  const emit = (event: Record<string, unknown>) => child.emit("message", { version: 1, token: input.token,
    identity: input.identity, sequence: ++outgoing, ...event });
  child.send = (message: any, callback?: (error: null) => void) => {
    sent.push(message); callback?.(null);
    queueMicrotask(() => {
      if (!message.operation) { input = message; emit({ type: "ready", requirements: LEADER_REQUIREMENTS }); }
      if (message.operation === "invoke") emit({ type: "session", invocationId: "invoke", session: { threadId: "native", connectionId: 1,
        token: { runnerId: "fixture-runner", generation: 1, abortGeneration: 0, disposeGeneration: 0 } } });
      if (message.operation === "persisted") emit({ type: "owner-bound", invocationId: "invoke" });
      if (message.operation === "grant") emit({ type: "granted", invocationId: "invoke" });
    });
    return true;
  };
  t.mock.method(cp, "fork", () => child);
  h.host.logError = (message, data) => { if (message === "department-leader-native-failed") logs.push(data); };
  const seen: unknown[][] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  h.host.handlers.onNotification = async (...args) => { seen.push(args); await gate; };
  const p = h.port(), launch = await p.invoke({ invocationId: "invoke", prompt: "fixture" });
  const encoded = leaderCallbackFrames({ version: 1, token: input.token, identity: input.identity, sequence: outgoing + 1 }, "invoke", "onNotification", large);
  const frame = (value: Record<string, unknown>) => { outgoing++; child.emit("message", value); };
  t.after(() => { release(); p.disconnect(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { h, p, child, sent, logs, seen, launch, emit, frame, encoded, release };
}

test("host invokes complete large callback once and ACKs original sequence only after consumer resolves", async (t) => {
  const h = await hostProtocol(t);
  for (const frame of h.encoded.frames) h.frame(frame);
  await tick(); assert.deepEqual(h.seen, [large]);
  assert.equal(h.sent.filter((v) => v.operation === "ack").length, 0);
  h.release(); await tick();
  const acks = h.sent.filter((v) => v.operation === "ack");
  assert.equal(acks.length, 1); assert.equal(acks[0].callbackSequence, h.encoded.frames[0].sequence);
  assert.equal(acks[0].result, null);
});

for (const violation of ["token", "identity", "sequence", "invocation", "incomplete-settled", "incomplete-disconnect", "corrupt"])
  test(`host rejects ${violation} with no partial consumer or ACK`, async (t) => {
    const h = await hostProtocol(t), frames = h.encoded.frames.map((frame) => ({ ...frame }));
    h.frame(frames[0]);
    if (violation === "token") frames[1].token = "b".repeat(64);
    if (violation === "identity") frames[1].identity = { ...h.h.identity, generation: 2 };
    if (violation === "sequence") frames[1].sequence = Number(frames[1].sequence) + 1;
    if (violation === "invocation") frames[1].invocationId = "other";
    if (violation === "corrupt") frames[1].data = "YQ==";
    if (violation === "incomplete-settled") h.emit({ type: "settled", invocationId: "invoke", terminal:
      Object.fromEntries(["processTerminal", "turnTerminal", "streams"].map((part) => [part, { status: "confirmed", evidence: "fixture-only" }])) });
    else if (violation === "incomplete-disconnect") h.child.disconnect();
    else h.frame(frames[1]);
    await assert.rejects(h.launch.completion, /channel-or-delivery-unknown/);
    assert.deepEqual(h.seen, []); assert.equal(h.sent.filter((v) => v.operation === "ack").length, 0);
    assert.equal(h.logs.length, 1);
    if (violation === "incomplete-settled") assert.equal(h.logs[0].stage, "callback-fragment-incomplete");
    const saved = h.h.store.read("root", "workspace"); assert.ok(saved.ok && saved.value);
    assert.deepEqual(saved.value.capacity.leaders, ["module"]);
  });
