import test = require("node:test");
import assert = require("node:assert/strict");
import { EventEmitter } from "events";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const crossSpawn = require("cross-spawn") as {
  spawn: (...args: unknown[]) => unknown;
};
const {
  captureCliOutput,
  isCliCommandAvailable,
  parseOpenCodeSessionId,
  runCli,
} = require("../../cli/commandRunner") as typeof import("../../cli/commandRunner");

type FakeStream = EventEmitter & {
  setEncoding: (encoding: string) => void;
};

type FakeChild = EventEmitter & {
  stdout: FakeStream;
  stderr: FakeStream;
  pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

function createFakeStream(): FakeStream {
  const stream = new EventEmitter() as FakeStream;
  stream.setEncoding = () => undefined;
  return stream;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = createFakeStream();
  child.stderr = createFakeStream();
  child.kill = () => true;
  return child;
}

test("sends an escaped configured CLI command to the VS Code terminal", async () => {
  const vscode = require("vscode") as {
    window: {
      createTerminal: (options: { name: string; env?: NodeJS.ProcessEnv }) => {
        sendText: (value: string) => void;
      };
    };
    workspace: {
      getConfiguration: () => {
        get: <T>(key: string, fallback?: T) => T | undefined;
      };
    };
  };
  const originalCreateTerminal = vscode.window.createTerminal;
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const terminalOptions: Array<{ name: string; env?: NodeJS.ProcessEnv }> = [];
  const sentCommands: string[] = [];

  vscode.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      if (key === "commands.codex") {
        return "cli-terminal-mock-command-not-installed" as T;
      }
      if (key === "args.codex") {
        return ["--flag", "O'Reilly"] as T;
      }
      return fallback;
    },
  });
  vscode.window.createTerminal = (options) => {
    terminalOptions.push(options);
    return { sendText: (value) => sentCommands.push(value) };
  };

  try {
    await runCli("codex", { envOverrides: { TEST_TERMINAL_ENV: "enabled" } });

    assert.deepEqual(terminalOptions.map((options) => options.name), ["CLI Bridge: codex"]);
    assert.equal(terminalOptions[0]?.env?.TEST_TERMINAL_ENV, "enabled");
    assert.deepEqual(sentCommands, [
      "cli-terminal-mock-command-not-installed '--flag' 'O'\"'\"'Reilly' '--skip-git-repo-check'",
    ]);
  } finally {
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  }
});

test("rejects whitespace-only CLI availability checks without spawning a process", async () => {
  assert.equal(await isCliCommandAvailable(" \n\t "), false);
});

test("extracts a nested OpenCode session id while ignoring malformed JSONL lines", () => {
  const output = [
    "OpenCode startup output",
    "{incomplete-json",
    JSON.stringify({ type: "step_start", part: { session_id: "ses_nested" } }),
  ].join("\n");

  assert.equal(parseOpenCodeSessionId(output), "ses_nested");
});

test("captures mocked stdout and stderr for a non-zero CLI exit", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const spawnCalls: unknown[][] = [];
  crossSpawn.spawn = (...args: unknown[]): unknown => {
    spawnCalls.push(args);
    queueMicrotask(() => {
      child.stdout.emit("data", "partial ");
      child.stdout.emit("data", "response");
      child.stderr.emit("data", "provider warning");
      child.emit("close", 23);
    });
    return child;
  };

  try {
    const output = await captureCliOutput(process.execPath, ["--version"], { cwd: process.cwd() });

    assert.deepEqual(output, {
      stdout: "partial response",
      stderr: "provider warning",
      exitCode: 23,
      resolvedCommand: process.execPath,
    });
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.[0], process.execPath);
    assert.deepEqual(spawnCalls[0]?.[1], ["--version"]);
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});

test("rejects capture output when the mocked child process emits an error", async () => {
  const originalSpawn = crossSpawn.spawn;
  const child = createFakeChild();
  const expectedError = new Error("mock child process error");
  crossSpawn.spawn = (): unknown => {
    queueMicrotask(() => {
      child.emit("error", expectedError);
      child.emit("error", new Error("late child process error"));
      child.emit("close", 1);
    });
    return child;
  };

  try {
    await assert.rejects(
      captureCliOutput(process.execPath, ["--version"]),
      expectedError,
    );
  } finally {
    crossSpawn.spawn = originalSpawn;
  }
});
