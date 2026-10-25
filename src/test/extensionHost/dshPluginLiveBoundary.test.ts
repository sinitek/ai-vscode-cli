import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import type { CliName } from "../../cli/types";
import type { DshStreamHandlers } from "../../interactive/dshRunner";
import type { DshRunnerCreateOptions } from "../../interactive/runnerLifecycleTypes";
import type { ChatMessage } from "../../webview/types";
import type { PromptRunInput, PromptRunTarget } from "../../extensionHost/graphRuntime";
import type { InteractiveTabRun } from "../../extensionHost/promptExecutionShared";

const { createPromptInteractiveRuntimeHost } = require("../../extensionHost/promptInteractiveRuntime") as typeof import("../../extensionHost/promptInteractiveRuntime");
const { prepareDshIsolatedLaunch } = require("../../extensionHost/dshInteractiveLaunch") as typeof import("../../extensionHost/dshInteractiveLaunch");
const { dshRunnerLifecycleStrategy } = require("../../interactive/runnerLifecycleStrategies") as typeof import("../../interactive/runnerLifecycleStrategies");
const { DshInteractiveRunner } = require("../../interactive/dshRunner") as typeof import("../../interactive/dshRunner");
const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");
const { activateSavedDshConfig, saveConfig } = require("../../config/configService") as typeof import("../../config/configService");
const { readDshActivation, resolveDshConfigPaths } = require("../../config/dshConfig") as typeof import("../../config/dshConfig");
const {
  createDshExampleDocument,
  DSH_RESPONSE_MODEL_ALIAS,
  DSH_VERIFIED_MODEL_ID,
  parseDshConfigModels,
  readDshModelWireForRun,
  serializeDshProfile,
  toDshModelWireValue,
} = require("../../cli/dshConfigModels") as typeof import("../../cli/dshConfigModels");

const WIRE = toDshModelWireValue(DSH_VERIFIED_MODEL_ID);
const ACP_ID = "9a871318-21c4-4603-8e65-693ba8589abe";

type RuntimeDeps = Parameters<typeof createPromptInteractiveRuntimeHost>[0];

function loopbackBaseUrl(value: string | undefined): string | null {
  if (!value || /\s/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const loopback = host === "localhost"
      || host.endsWith(".localhost")
      || host === "::1"
      || host.startsWith("127.");
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !loopback) {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

const LIVE_BASE_URL = loopbackBaseUrl(process.env.SINITEK_DSH_BASE_URL);
const LIVE_KEY_PRESENT = typeof process.env.SINITEK_DSH_API_KEY === "string" && process.env.SINITEK_DSH_API_KEY.length > 0;
const LIVE_ENABLED = process.env.SINITEK_DSH_LIVE === "1" && LIVE_BASE_URL !== null && LIVE_KEY_PRESENT;

function inputFor(prompt: string, model?: string): PromptRunInput {
  return { displayPrompt: prompt, modelPrompt: prompt, contextTags: [], ...(model ? { model } : {}) };
}

function targetFor(sessionId: string | null, tabId: string): PromptRunTarget {
  return { tabId, cli: "dsh", sessionId };
}

async function fileStamp(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function activateProfile(configHome: string, baseURL: string): Promise<void> {
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = configHome;
  try {
    const content = serializeDshProfile(createDshExampleDocument(baseURL));
    await saveConfig({
      id: "dsh_plugin_profile",
      name: "DSH plugin",
      platform: "dsh",
      content,
      createdAt: 1,
      updatedAt: 1,
    });
    await activateSavedDshConfig("dsh_plugin_profile");
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
  }
}

function protocolCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

test("DSH host reuses one isolated home and remembers the ACP session id", async () => {
  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-plugin-config-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = configHome;
  const created: DshRunnerCreateOptions[] = [];
  const registered: Array<Record<string, unknown>> = [];
  const starts: Array<{ requireResume?: boolean }> = [];
  let tabSessionId = "local_stable_1";
  const mapped = new Map<string, string>();
  const activeRunsByTabId = new Map<string, InteractiveTabRun>();
  const messagesBySession = new Map<string, ChatMessage[]>();
  const runner = {
    start: async (options?: { requireResume?: boolean }) => {
      starts.push(options ?? {});
      return { acpSessionId: ACP_ID, resumed: options?.requireResume === true, retainedLocalSessionId: null };
    },
    prompt: async (_prompt: string, handlers?: DshStreamHandlers) => {
      handlers?.onAssistantDelta?.("pong");
      handlers?.onComplete?.({ stopReason: "end_turn" });
      return { stopReason: "end_turn" };
    },
    cancelTurn: () => undefined,
    dispose: () => undefined,
    isReusable: () => true,
    setModel: async () => runner.getConfigSnapshot(),
    setThinkingMode: async () => runner.getConfigSnapshot(),
    getConfigSnapshot: () => ({
      model: WIRE,
      reasoningEffort: null,
      modelOptions: [WIRE],
      reasoningOptions: [],
    }),
  };
  const manager = {
    getOrCreateDshRunner: (options: DshRunnerCreateOptions) => {
      created.push(options);
      return runner;
    },
    hasDshRunner: () => created.length > 0,
    setRunner: (_cli: string, _sessionId: string, _runner: unknown, _thinking: string, _mode: string, _model: string | null, options: Record<string, unknown>) => {
      registered.push(options);
    },
    detachRunner: () => undefined,
  };
  const deps = {
    AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
    activeRunsByTabId,
    adoptSessionId: (_cli: CliName, sessionId: string) => {
      tabSessionId = sessionId;
    },
    applyProcessTitle: () => undefined,
    applyThinkingWorkspaceFiles: () => undefined,
    appendTaskRun: () => undefined,
    buildSubagentProgressLabels: () => ({
      provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
      subagent: "subagent",
      status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" },
      errorPrefix: "error: ",
    }),
    buildTaskRunCompletionText: () => "",
    createMessageId: (() => {
      let id = 0;
      return () => `msg-${++id}`;
    })(),
    getActiveConfigIdForCli: () => "dsh_plugin_profile",
    getConversationTabById: () => ({ sessionId: tabSessionId, cli: "dsh" as const }),
    getEffectiveCliArgs: () => [],
    getEffectiveThinkingMode: () => "off" as const,
    getGlobalHumanInteractionEnabled: () => false,
    getPendingSessionDraft: () => ({ messages: [] as ChatMessage[] }),
    getSelectedCliModel: () => DSH_VERIFIED_MODEL_ID,
    resolveDshModelWireForRun: async (selected: string | null) => {
      const paths = resolveDshConfigPaths();
      return readDshModelWireForRun(parseDshConfigModels(await fs.readFile(paths.appliedProfilePath, "utf8")), selected);
    },
    getWorkspaceInteractiveMode: () => "coding" as const,
    getInteractiveRunnerManager: () => manager,
    loadSessionMessages: (_cli: CliName, sessionId: string) => {
      const existing = messagesBySession.get(sessionId);
      if (existing) {
        return existing;
      }
      const next: ChatMessage[] = [];
      messagesBySession.set(sessionId, next);
      return next;
    },
    logCliStartup: () => undefined,
    maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
    maybePersistLongTermMemoryFromRun: () => undefined,
    migrateLocalSessionToTargetSession: () => undefined,
    persistMessagesForTab: () => undefined,
    preparePendingLabel: () => undefined,
    resolveClaudeInteractiveEntrypoint: () => undefined,
    resolveCodexInteractiveSelection: () => null,
    resolveInteractiveMappedId: (_cli: CliName, sessionId: string) => mapped.get(sessionId) ?? null,
    resolveInteractiveSessionForResume: async (_cli: CliName, sessionId: string | null) => sessionId,
    resolveWorkspaceCwd: () => "/workspace",
    requestHumanInteraction: async () => ({
      interactionId: "interaction",
      tabId: "tab-stable",
      status: "completed" as const,
      values: {},
    }),
    cancelHumanInteractionForTab: () => undefined,
    sendPanelMessage: () => undefined,
    sendRunStatusForTab: () => undefined,
    shouldAutoCompactContextAfterRunForTarget: () => false,
    shouldRequireExplicitFinalAnswerForRun: () => false,
    t: (key: string) => key,
    updateProcessTitle: () => undefined,
    upsertInteractiveMapping: (_cli: CliName, sessionId: string, mappedId: string) => {
      mapped.set(sessionId, mappedId);
    },
  } as unknown as RuntimeDeps;
  const homes = new Set<string>();
  try {
    await activateProfile(configHome, "https://gateway.example/v1");
    process.env.DSH_HOME = configHome;
    const activation = await readDshActivation(resolveDshConfigPaths());
    assert.equal(activation.activeProfileId, "dsh_plugin_profile");
    const host = createPromptInteractiveRuntimeHost(deps);
    await host.runPromptInteractive(inputFor("Reply with exactly: pong"), targetFor("local_stable_1", "tab-stable"));
    await host.runPromptInteractive(inputFor("Reply with exactly: pong-2"), targetFor(tabSessionId, "tab-stable"));
    assert.equal(created.length, 2);
    assert.equal(created[0]?.localSessionId ?? null, null);
    assert.equal(created[1]?.localSessionId, ACP_ID);
    assert.equal(registered[0]?.localSessionId, ACP_ID);
    const firstHome = created[0]?.env?.DSH_HOME;
    const secondHome = created[1]?.env?.DSH_HOME;
    assert.equal(typeof firstHome, "string");
    assert.equal(secondHome, firstHome);
    assert.notEqual(firstHome, configHome);
    assert.equal(String(firstHome).startsWith(path.join(os.tmpdir(), "sinitek-dsh-acp")), true);
    homes.add(String(firstHome));
    const firstCreate = created[0];
    const secondCreate = created[1];
    assert.ok(firstCreate);
    assert.ok(secondCreate);
    const prepared = dshRunnerLifecycleStrategy.prepare(secondCreate);
    const reusable = dshRunnerLifecycleStrategy.canReuse({
      cli: "dsh",
      sessionId: ACP_ID,
      runner: { isReusable: () => true },
      thinkingMode: "off",
      interactiveMode: firstCreate.interactiveMode,
      model: firstCreate.model,
      command: firstCreate.command,
      args: firstCreate.agentArgs,
      cwd: firstCreate.cwd,
      localSessionId: typeof registered[0]?.localSessionId === "string" ? registered[0].localSessionId : null,
      env: firstCreate.env,
      idleTimer: null,
      lastUsedAt: 0,
    } as unknown as Parameters<typeof dshRunnerLifecycleStrategy.canReuse>[0], prepared);
    assert.equal(reusable, true);
    assert.equal(starts[1]?.requireResume, true);
    await assert.rejects(
      () => host.runPromptInteractive(inputFor("no", DSH_RESPONSE_MODEL_ALIAS), targetFor(ACP_ID, "tab-stable")),
      /wire value/,
    );
    assert.equal(created.length, 2);
  } finally {
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    await Promise.all([...homes].map((home) => fs.rm(home, { recursive: true, force: true })));
    await fs.rm(configHome, { recursive: true, force: true });
  }
});

async function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function scanHome(home: string): Promise<{ permission: boolean; compactMethod: boolean; compactSlash: boolean; modelWire: boolean; secretShape: boolean }> {
  const found = { permission: false, compactMethod: false, compactSlash: false, modelWire: false, secretShape: false };
  const pending = [home];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          pending.push(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > 2_000_000) {
        continue;
      }
      const text = await fs.readFile(full, "utf8").catch(() => "");
      if (text.includes("session/request_permission")) {
        found.permission = true;
      }
      if (text.includes("session/compact")) {
        found.compactMethod = true;
      }
      if (text.split("session/compact").join("").includes("/compact")) {
        found.compactSlash = true;
      }
      if (text.includes(DSH_VERIFIED_MODEL_ID) && text.includes("sinitek-custom")) {
        found.modelWire = true;
      }
      if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/.test(text)) {
        found.secretShape = true;
      }
    }
  }
  return found;
}

test("DSH plugin runner and extension host talk to the configured loopback model", {
  skip: LIVE_ENABLED ? false : "SINITEK_DSH_LIVE=1 plus a loopback SINITEK_DSH_BASE_URL and SINITEK_DSH_API_KEY are required",
  timeout: 240000,
}, async () => {
  const baseURL = LIVE_BASE_URL;
  assert.ok(baseURL);
  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-plugin-live-config-"));
  const workHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-plugin-live-work-"));
  const userHome = path.join(os.homedir(), ".dsh");
  const userBefore = {
    root: await fileStamp(userHome),
    settings: await fileStamp(path.join(userHome, "settings.yaml")),
    credentials: await fileStamp(path.join(userHome, ".credentials.yaml")),
  };
  const previousHome = process.env.DSH_HOME;
  const homes = new Set<string>();
  const runners: InstanceType<typeof DshInteractiveRunner>[] = [];
  const manager = new InteractiveRunnerManager();
  process.env.DSH_HOME = configHome;
  try {
    await activateProfile(configHome, baseURL);
    process.env.DSH_HOME = configHome;
    const activation = await readDshActivation(resolveDshConfigPaths());
    assert.equal(activation.activeProfileId, "dsh_plugin_profile");
    assert.equal(activation.patchPath?.endsWith("active-patch.yaml"), true);
    const profileText = await fs.readFile(resolveDshConfigPaths().appliedProfilePath, "utf8");
    const wire = readDshModelWireForRun(parseDshConfigModels(profileText), DSH_VERIFIED_MODEL_ID);
    assert.equal(wire, WIRE);
    assert.throws(
      () => readDshModelWireForRun(parseDshConfigModels(profileText), DSH_RESPONSE_MODEL_ALIAS),
      /wire value/,
    );
    assert.throws(
      () => readDshModelWireForRun(parseDshConfigModels(profileText), JSON.stringify(["subcoco", "deepseek-v4.1-flash"])),
      /wire value/,
    );

    const launch = await prepareDshIsolatedLaunch({ sessionKey: "runner-live" });
    homes.add(launch.isolatedHome);
    assert.notEqual(launch.isolatedHome, configHome);
    assert.notEqual(launch.env.DSH_HOME, userHome);
    assert.equal(launch.agentArgs.join("\n").includes(String(process.env.SINITEK_DSH_API_KEY)), false);
    const patch = await fs.readFile(launch.patchPath, "utf8");
    assert.equal(patch.includes(DSH_VERIFIED_MODEL_ID), true);
    assert.equal(patch.includes("sinitek-custom"), true);
    assert.equal(patch.includes(String(process.env.SINITEK_DSH_API_KEY)), false);
    assert.equal(patch.includes("apiKey:"), false);

    const usage: Array<{ tokensInContextWindow: number; modelContextWindow: number }> = [];
    const runner = new DshInteractiveRunner({
      command: "dsh",
      agentArgs: launch.agentArgs,
      cwd: workHome,
      model: wire,
      env: launch.env,
    });
    runners.push(runner);
    const started = await bounded(runner.start(), 60000, "runner start");
    assert.equal(started.resumed, false);
    assert.equal(started.acpSessionId.startsWith("local_"), false);
    assert.equal(runner.getConfigSnapshot().model, wire);
    assert.deepEqual(runner.getConfigSnapshot().reasoningOptions, ["low", "high", "xhigh", "max"]);

    const firstText: string[] = [];
    const first = await bounded(runner.prompt("Reply with exactly: pong", {
      onAssistantDelta: (text) => firstText.push(text),
      onTokenUsageUpdate: (update) => usage.push(update),
    }), 90000, "first prompt");
    assert.equal(first.stopReason, "end_turn");
    assert.equal(firstText.join("").includes("pong"), true);
    const secondText: string[] = [];
    const second = await bounded(runner.prompt("Reply with exactly: pong-2", {
      onAssistantDelta: (text) => secondText.push(text),
      onTokenUsageUpdate: (update) => usage.push(update),
    }), 90000, "second prompt");
    assert.equal(second.stopReason, "end_turn");
    assert.equal(secondText.join("").includes("pong-2"), true);
    assert.equal(runner.getSessionInfo()?.acpSessionId, started.acpSessionId);

    const beforeBadModel = runner.getConfigSnapshot().model;
    await assert.rejects(() => runner.setModel(JSON.stringify(["subcoco", "deepseek-v4.1-flash"])), (error: unknown) => {
      assert.equal(["model-not-advertised", "model-wire-invalid", "rpc-error"].includes(protocolCode(error)), true);
      return true;
    });
    await assert.rejects(() => runner.setModel(DSH_RESPONSE_MODEL_ALIAS), (error: unknown) => {
      assert.notEqual(protocolCode(error), "");
      return true;
    });
    assert.equal(runner.getConfigSnapshot().model, beforeBadModel);
    assert.equal(runner.getConfigSnapshot().model, wire);

    await assert.rejects(runner.compactSession(), (error: unknown) => {
      assert.equal(protocolCode(error), "compaction-unsupported");
      assert.equal((error as { compacted?: boolean }).compacted, false);
      assert.equal((error as Error).message.includes("/compact"), true);
      return true;
    });
    const stillText: string[] = [];
    const still = await bounded(runner.prompt("Reply with exactly: still", {
      onAssistantDelta: (text) => stillText.push(text),
    }), 90000, "post-compact prompt");
    assert.equal(still.stopReason, "end_turn");
    assert.equal(stillText.join("").includes("still"), true);

    let cancelStop = "";
    for (let attempt = 0; attempt < 2 && cancelStop !== "cancelled"; attempt += 1) {
      const pending = runner.prompt("Count from 1 to 400, one number per line, with no preamble.");
      const timer = setTimeout(() => runner.cancelTurn(), 400);
      const cancelled = await bounded(pending, 90000, "cancel prompt");
      clearTimeout(timer);
      cancelStop = cancelled.stopReason;
    }
    assert.equal(cancelStop, "cancelled");
    runner.dispose();

    const resumedRunner = new DshInteractiveRunner({
      command: "dsh",
      agentArgs: launch.agentArgs,
      cwd: workHome,
      model: wire,
      localSessionId: started.acpSessionId,
      env: launch.env,
    });
    runners.push(resumedRunner);
    const resumed = await bounded(resumedRunner.start({ requireResume: true }), 60000, "resume start");
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.acpSessionId, started.acpSessionId);
    const resumedText: string[] = [];
    const resumedPrompt = await bounded(resumedRunner.prompt("Reply with exactly: resumed", {
      onAssistantDelta: (text) => resumedText.push(text),
      onTokenUsageUpdate: (update) => usage.push(update),
    }), 90000, "resume prompt");
    assert.equal(resumedPrompt.stopReason, "end_turn");
    assert.equal(resumedText.join("").includes("resumed"), true);
    resumedRunner.dispose();

    assert.equal(usage.some((update) => update.tokensInContextWindow === 0 && update.modelContextWindow === 0), false);
    assert.equal(usage.every((update) => Number.isFinite(update.tokensInContextWindow) && update.tokensInContextWindow >= 0), true);
    const fallbackSizes = usage.map((update) => update.modelContextWindow);

    const panel: Array<Record<string, unknown>> = [];
    const adopted: string[] = [];
    let tabSessionId = "local_live_host";
    const mapped = new Map<string, string>();
    const activeRunsByTabId = new Map<string, InteractiveTabRun>();
    const messagesBySession = new Map<string, ChatMessage[]>();
    let creates = 0;
    const host = createPromptInteractiveRuntimeHost({
      AI_TASK_RAW_OUTPUT_MAX_BYTES: 1024,
      activeRunsByTabId,
      adoptSessionId: (_cli: CliName, sessionId: string) => {
        adopted.push(sessionId);
        tabSessionId = sessionId;
      },
      applyProcessTitle: () => undefined,
      applyThinkingWorkspaceFiles: () => undefined,
      appendTaskRun: () => undefined,
      buildSubagentProgressLabels: () => ({
        provider: { codex: "Codex", loop: "Loop", opencode: "OpenCode" },
        subagent: "subagent",
        status: { running: "running", completed: "completed", failed: "failed", interrupted: "interrupted" },
        errorPrefix: "error: ",
      }),
      buildTaskRunCompletionText: () => "",
      createMessageId: (() => {
        let id = 0;
        return () => `live-${++id}`;
      })(),
      getActiveConfigIdForCli: () => "dsh_plugin_profile",
      getConversationTabById: () => ({ sessionId: tabSessionId, cli: "dsh" as const }),
      getEffectiveCliArgs: () => [],
      getEffectiveThinkingMode: () => "off" as const,
      getGlobalHumanInteractionEnabled: () => false,
      getPendingSessionDraft: () => ({ messages: [] as ChatMessage[] }),
      getSelectedCliModel: () => DSH_VERIFIED_MODEL_ID,
      resolveDshModelWireForRun: async (selected: string | null) => readDshModelWireForRun(parseDshConfigModels(profileText), selected),
      getWorkspaceInteractiveMode: () => "coding" as const,
      getInteractiveRunnerManager: () => new Proxy(manager, {
        get(target, prop, receiver) {
          if (prop === "getOrCreateDshRunner") {
            return (options: DshRunnerCreateOptions) => {
              creates += 1;
              if (typeof options.env?.DSH_HOME === "string") {
                homes.add(options.env.DSH_HOME);
              }
              return target.getOrCreateDshRunner(options);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
      loadSessionMessages: (_cli: CliName, sessionId: string) => {
        const existing = messagesBySession.get(sessionId);
        if (existing) {
          return existing;
        }
        const next: ChatMessage[] = [];
        messagesBySession.set(sessionId, next);
        return next;
      },
      logCliStartup: () => undefined,
      maybeAutoCompactContextAfterPromptSuccess: async () => undefined,
      maybePersistLongTermMemoryFromRun: () => undefined,
      migrateLocalSessionToTargetSession: () => undefined,
      persistMessagesForTab: () => undefined,
      preparePendingLabel: () => undefined,
      resolveClaudeInteractiveEntrypoint: () => undefined,
      resolveCodexInteractiveSelection: () => null,
      resolveInteractiveMappedId: (_cli: CliName, sessionId: string) => mapped.get(sessionId) ?? null,
      resolveInteractiveSessionForResume: async (_cli: CliName, sessionId: string | null) => sessionId,
      resolveWorkspaceCwd: () => workHome,
      requestHumanInteraction: async () => ({
        interactionId: "interaction",
        tabId: "tab-live-dsh",
        status: "completed" as const,
        values: {},
      }),
      cancelHumanInteractionForTab: () => undefined,
      sendPanelMessage: (payload: Record<string, unknown>) => {
        panel.push(payload);
      },
      sendRunStatusForTab: () => undefined,
      shouldAutoCompactContextAfterRunForTarget: () => false,
      shouldRequireExplicitFinalAnswerForRun: () => false,
      t: (key: string) => key,
      updateProcessTitle: () => undefined,
      upsertInteractiveMapping: (_cli: CliName, sessionId: string, mappedId: string) => {
        mapped.set(sessionId, mappedId);
      },
    } as unknown as RuntimeDeps);

    const createsBeforeAlias = creates;
    await assert.rejects(
      () => host.runPromptInteractive(inputFor("no", "not-configured-model"), targetFor("local_alias", "tab-alias")),
      /wire value/,
    );
    assert.equal(creates, createsBeforeAlias);

    await bounded(
      host.runPromptInteractive(inputFor("Reply with exactly: host-pong"), targetFor("local_live_host", "tab-live-dsh"), { cwd: workHome }),
      120000,
      "host first prompt",
    );
    const hostSession = adopted[0];
    assert.equal(typeof hostSession, "string");
    assert.equal(String(hostSession).startsWith("local_"), false);
    await bounded(
      host.runPromptInteractive(inputFor("Reply with exactly: host-pong-2"), targetFor(hostSession ?? null, "tab-live-dsh"), { cwd: workHome }),
      120000,
      "host continue",
    );
    assert.deepEqual(adopted, [hostSession]);
    manager.disposeAll();
    await bounded(
      host.runPromptInteractive(inputFor("Reply with exactly: host-resumed"), targetFor(hostSession ?? null, "tab-live-dsh"), { cwd: workHome }),
      120000,
      "host resume",
    );
    assert.deepEqual(adopted, [hostSession]);
    const hostMessages = [...messagesBySession.values()].flat().filter((message) => message.role === "assistant" && message.kind !== "thinking");
    const hostBody = hostMessages.map((message) => message.content).join("\n");
    assert.equal(hostBody.includes("host-pong"), true);
    assert.equal(hostBody.includes("host-pong-2"), true);
    assert.equal(hostBody.includes("host-resumed"), true);
    const hostUsage = panel.filter((message) => message.type === "contextTokenUsage");
    assert.equal(hostUsage.every((message) => message.contextWindowSource === "adapter-fallback"), true);
    assert.equal(hostUsage.some((message) => message.tokensInContextWindow === 0 && message.modelContextWindow === 0), false);
    assert.equal(JSON.stringify(hostUsage).includes("服务确认"), false);

    const scanned = { permission: false, compactMethod: false, compactSlash: false, modelWire: false, secretShape: false };
    for (const home of homes) {
      const next = await scanHome(home);
      scanned.permission = scanned.permission || next.permission;
      scanned.compactMethod = scanned.compactMethod || next.compactMethod;
      scanned.compactSlash = scanned.compactSlash || next.compactSlash;
      scanned.modelWire = scanned.modelWire || next.modelWire;
      scanned.secretShape = scanned.secretShape || next.secretShape;
    }
    console.log(JSON.stringify({
      runnerStops: [first.stopReason, second.stopReason, still.stopReason, cancelStop, resumedPrompt.stopReason],
      usageCount: usage.length,
      usageSizes: [...new Set(fallbackSizes)],
      hostUsageCount: hostUsage.length,
      hostUsageSources: [...new Set(hostUsage.map((message) => message.contextWindowSource))],
      permissionRequestSeen: scanned.permission,
      compactMethodInHome: scanned.compactMethod,
      slashCompactInHome: scanned.compactSlash,
      modelWireInHome: scanned.modelWire,
      credentialShapeInIsolatedHome: scanned.secretShape,
      adoptedSessions: adopted.length,
    }));
  } finally {
    for (const runner of runners) {
      try {
        runner.dispose();
      } catch {
        // The process may already be closed.
      }
    }
    manager.disposeAll();
    if (previousHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousHome;
    }
    await Promise.all([...homes].map((home) => fs.rm(home, { recursive: true, force: true })));
    await fs.rm(configHome, { recursive: true, force: true });
    await fs.rm(workHome, { recursive: true, force: true });
    const userAfter = {
      root: await fileStamp(userHome),
      settings: await fileStamp(path.join(userHome, "settings.yaml")),
      credentials: await fileStamp(path.join(userHome, ".credentials.yaml")),
    };
    assert.deepEqual(userAfter, userBefore);
  }
});
