import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";
import type { DshRunnerCreateOptions } from "../../interactive/runnerLifecycleTypes";

const { createDshInteractiveTurnStrategy, resolveDshLoopWorkspaceCwd } = require("../../extensionHost/interactiveTurnDsh") as typeof import("../../extensionHost/interactiveTurnDsh");
const { createLoopSubtaskExecutionRoot } = require("../../loopSubtaskExecutionRoot") as typeof import("../../loopSubtaskExecutionRoot");

function createFixture(context: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-loop-resume-"));
  const workspaceCwd = path.join(root, "workspace");
  const isolatedHome = path.join(root, "home");
  fs.mkdirSync(path.join(workspaceCwd, "src"), { recursive: true });
  fs.mkdirSync(isolatedHome);
  fs.writeFileSync(path.join(workspaceCwd, "AGENTS.md"), "hidden project instructions");
  fs.writeFileSync(path.join(workspaceCwd, "src", "value.txt"), "initial");
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created: DshRunnerCreateOptions[] = [];
  const starts: Array<{ requireResume?: boolean }> = [];
  const registrations: Array<Record<string, unknown>> = [];
  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  let currentSessionId = "local_initial";
  let originalCwd: string | null = null;
  let failure: "create" | "start" | "prompt" | "settle" | "legacy" | null = null;
  let prompts = 0;
  const manager = {
    getOrCreateDshRunner: (options: DshRunnerCreateOptions) => {
      created.push(options);
      if (failure === "create") {
        throw new Error("create failed");
      }
      return {
        start: async (startOptions: { requireResume?: boolean }) => {
          starts.push(startOptions);
          if (failure === "start") {
            throw new Error("start failed");
          }
          if (failure === "legacy" || (startOptions.requireResume && options.cwd !== originalCwd)) {
            throw new Error("Invalid params: session cwd does not match");
          }
          originalCwd ??= options.cwd ?? null;
          return { acpSessionId: sessionId, resumed: startOptions.requireResume, retainedLocalSessionId: null };
        },
        prompt: async () => {
          prompts += 1;
          assert.equal(fs.existsSync(path.join(String(options.cwd), "AGENTS.md")), !fixture.isolate);
          if (failure === "prompt") {
            throw new Error("prompt failed");
          }
          fs.writeFileSync(path.join(String(options.cwd), "src", "value.txt"), prompts === 1 ? "draft" : "repaired");
          return { stopReason: "end_turn" };
        },
        getConfigSnapshot: () => ({ model: "wire", reasoningEffort: null, modelOptions: ["wire"], reasoningOptions: [] }),
        cancelTurn: () => undefined,
        dispose: () => undefined,
      };
    },
    setRunner: (...args: unknown[]) => registrations.push(args[6] as Record<string, unknown>),
    detachRunner: () => undefined,
    hasDshRunner: () => false,
  };
  const fixture = {
    workspaceCwd,
    isolatedHome,
    created,
    starts,
    registrations,
    isolate: true,
    fail: (value: typeof failure) => { failure = value; },
    getSessionId: () => currentSessionId,
    getPromptCount: () => prompts,
    port: (cwd: string, tabId: string): InteractiveTurnAttemptPort => ({
      cli: "dsh",
      cwd,
      workspaceCwd,
      tabId,
      runId: tabId,
      dshLaunch: { isolatedHome, agentArgs: [], env: { DSH_HOME: isolatedHome } },
      dshModelWire: "wire",
      commandForRunner: "dsh",
      thinkingMode: "off",
      interactiveMode: "coding",
      attemptPrompt: "execute this attempt",
      isolateProjectInstructions: fixture.isolate,
      get uiSessionId() { return currentSessionId; },
      interactiveRunnerManager: manager,
      interactiveRunsByTabId: new Map(),
      resolveInteractiveMappedId: () => null,
      updateSessionForNewRun: (value: string) => { currentSessionId = value; },
      settleInteractiveAttempt: async () => {
        if (failure === "settle") {
          throw new Error("settle failed");
        }
        return "return";
      },
      setStopCurrentTurn: () => undefined,
      syncInteractiveRunEntry: () => undefined,
      isCurrentRunActive: () => false,
      logInfo: () => undefined,
      appendSystemMessageForTab: () => undefined,
    } as unknown as InteractiveTurnAttemptPort),
  };
  return fixture;
}

test("DSH Loop+ repair restores the same cwd and session after the original tab and temporary root close", async (context) => {
  const fixture = createFixture(context);
  const strategy = createDshInteractiveTurnStrategy();
  const first = createLoopSubtaskExecutionRoot(fixture.workspaceCwd);
  try {
    await strategy.runAttempt(fixture.port(first.cwd, "closed-tab"));
  } finally {
    first.dispose();
  }
  const stableCwd = String(fixture.created[0].cwd);
  const identity = fs.lstatSync(stableCwd, { bigint: true });
  assert.deepEqual(fs.readdirSync(stableCwd), []);
  assert.equal(fs.existsSync(first.cwd), false);
  const sessionId = fixture.getSessionId();
  const repair = createLoopSubtaskExecutionRoot(fixture.workspaceCwd);
  try {
    await strategy.runAttempt(fixture.port(repair.cwd, "new-repair-tab"));
  } finally {
    repair.dispose();
  }
  assert.notEqual(first.cwd, repair.cwd);
  assert.equal(fixture.created.length, 2);
  assert.equal(fixture.created[1].cwd, stableCwd);
  assert.equal(fs.lstatSync(stableCwd, { bigint: true }).ino, identity.ino);
  assert.equal(fixture.created[1].localSessionId, sessionId);
  assert.equal(fixture.registrations[0].cwd, stableCwd);
  assert.deepEqual(fixture.starts, [{ requireResume: false }, { requireResume: true }]);
  assert.deepEqual(fs.readdirSync(stableCwd), []);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceCwd, "src", "value.txt"), "utf8"), "repaired");
});

for (const failure of ["create", "start", "prompt", "settle"] as const) {
  test(`DSH isolated cwd is empty after ${failure} fails`, async (context) => {
    const fixture = createFixture(context);
    fixture.fail(failure);
    await assert.rejects(() => createDshInteractiveTurnStrategy().runAttempt(fixture.port(fixture.workspaceCwd, "failed-tab")), new RegExp(`${failure} failed`));
    assert.deepEqual(fs.readdirSync(String(fixture.created[0].cwd)), []);
    assert.equal(fs.readFileSync(path.join(fixture.workspaceCwd, "AGENTS.md"), "utf8"), "hidden project instructions");
  });
}

test("DSH old cwd mismatch is explicit and never becomes a new session", async (context) => {
  const fixture = createFixture(context);
  const strategy = createDshInteractiveTurnStrategy();
  await strategy.runAttempt(fixture.port(fixture.workspaceCwd, "first"));
  fixture.fail("legacy");
  await assert.rejects(() => strategy.runAttempt(fixture.port(fixture.workspaceCwd, "repair")), /旧会话.*未创建替代会话/);
  assert.equal(fixture.getPromptCount(), 1);
  assert.deepEqual(fixture.starts, [{ requireResume: false }, { requireResume: true }]);
});

test("DSH Vibe continues using its original workspace without creating an isolated cwd", async (context) => {
  const fixture = createFixture(context);
  fixture.isolate = false;
  const strategy = createDshInteractiveTurnStrategy();
  await strategy.runAttempt(fixture.port(fixture.workspaceCwd, "vibe-first"));
  await strategy.runAttempt(fixture.port(fixture.workspaceCwd, "vibe-reloaded"));
  assert.deepEqual(fixture.created.map((options) => options.cwd), [fixture.workspaceCwd, fixture.workspaceCwd]);
  assert.equal(fs.existsSync(path.join(fixture.isolatedHome, "loop-workspace")), false);
  assert.equal(fixture.starts[1].requireResume, true);
});

test("Windows cross-volume DSH cwd stays stable on the actual workspace volume", (context) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(descriptor);
  const originalParse = path.parse;
  context.mock.method(path, "parse", (value: string) => ({
    ...originalParse(value),
    root: value.includes("workspace-volume") ? "workspace-volume" : "home-volume",
  }));
  Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
  try {
    const home = path.resolve("home-volume", "unique-session-home");
    const workspace = path.resolve("workspace-volume", "project");
    assert.equal(resolveDshLoopWorkspaceCwd(home, workspace), path.join(workspace, ".sinitek-loop-tmp", "dsh-unique-session-home"));
    assert.equal(resolveDshLoopWorkspaceCwd(home, path.resolve("home-volume", "project")), path.join(home, "loop-workspace"));
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
