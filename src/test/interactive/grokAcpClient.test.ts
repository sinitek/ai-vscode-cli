import assert = require("node:assert/strict");
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { GrokAcpClient, GrokAcpClientError } = require("../../interactive/grokAcpClient") as typeof import("../../interactive/grokAcpClient");

const SESSION = "grok-session";

test("runs an ACP terminal command and returns its output", async () => {
  const client = new GrokAcpClient(process.cwd());
  const created = await client.handle("terminal/create", {
    sessionId: SESSION,
    command: process.execPath,
    args: ["-e", "process.stdout.write('weather-ok')"],
  }, SESSION) as { terminalId: string };
  const exited = await client.handle("terminal/wait_for_exit", {
    sessionId: SESSION,
    terminalId: created.terminalId,
  }, SESSION) as { exitCode: number | null };
  const output = await client.handle("terminal/output", {
    sessionId: SESSION,
    terminalId: created.terminalId,
  }, SESSION) as { output: string; truncated: boolean; exitStatus?: { exitCode: number | null } };
  assert.equal(exited.exitCode, 0);
  assert.equal(output.output, "weather-ok");
  assert.equal(output.truncated, false);
  assert.equal(output.exitStatus?.exitCode, 0);
  await client.handle("terminal/release", { sessionId: SESSION, terminalId: created.terminalId }, SESSION);
  client.dispose();
});

test("truncates terminal output at outputByteLimit and can kill a running command", async () => {
  const client = new GrokAcpClient(process.cwd());
  const created = await client.handle("terminal/create", {
    sessionId: SESSION,
    command: process.execPath,
    args: ["-e", "process.stdout.write('hello')"],
    outputByteLimit: 4,
  }, SESSION) as { terminalId: string };
  const exited = await client.handle("terminal/wait_for_exit", {
    sessionId: SESSION,
    terminalId: created.terminalId,
  }, SESSION) as { exitCode: number | null };
  const output = await client.handle("terminal/output", {
    sessionId: SESSION,
    terminalId: created.terminalId,
  }, SESSION) as { output: string; truncated: boolean };
  assert.equal(exited.exitCode, 0);
  assert.equal(output.output, "hell");
  assert.equal(output.truncated, true);

  const hanging = await client.handle("terminal/create", {
    sessionId: SESSION,
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
  }, SESSION) as { terminalId: string };
  await client.handle("terminal/kill", { sessionId: SESSION, terminalId: hanging.terminalId }, SESSION);
  const killed = await client.handle("terminal/wait_for_exit", {
    sessionId: SESSION,
    terminalId: hanging.terminalId,
  }, SESSION) as { exitCode: number | null; signal: string | null };
  assert.ok(killed.exitCode !== 0 || killed.signal);
  client.dispose();
});

test("reads and writes text files for the advertised ACP filesystem", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "grok-acp-fs-"));
  const client = new GrokAcpClient(root);
  await client.handle("fs/write_text_file", {
    sessionId: SESSION,
    path: "notes/weather.txt",
    content: "one\ntwo\nthree\n",
  }, SESSION);
  const read = await client.handle("fs/read_text_file", {
    sessionId: SESSION,
    path: "notes/weather.txt",
    line: 2,
    limit: 1,
  }, SESSION) as { content: string };
  assert.equal(read.content, "two");
  client.dispose();
});

test("allows a permission request once and rejects unknown client methods", async () => {
  const client = new GrokAcpClient(process.cwd());
  const allowed = await client.handle("session/request_permission", {
    sessionId: SESSION,
    options: [
      { optionId: "reject", kind: "reject_once", name: "Reject" },
      { optionId: "once", kind: "allow_once", name: "Allow once" },
    ],
  }, SESSION) as { outcome: { outcome: string; optionId?: string } };
  assert.deepEqual(allowed.outcome, { outcome: "selected", optionId: "once" });
  await assert.rejects(
    client.handle("terminal/create", { sessionId: "other", command: process.execPath }, SESSION),
    (error: unknown) => error instanceof GrokAcpClientError && error.code === -32602,
  );
  await assert.rejects(
    client.handle("x.ai/not-a-client-method", {}, SESSION),
    (error: unknown) => error instanceof GrokAcpClientError && error.code === -32601,
  );
  client.dispose();
});
