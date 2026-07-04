import * as vscode from "vscode";
import { CliName } from "./cli/types";
import { PanelState } from "./webview/types";
import { type CliModelStore } from "./modelSelectionStore";

import { ConfigItem, ConfigPlatform, CurrentConfig } from "./config/types";
import { stripCodexSkillsBlock } from "./config/codexSkills";
import { stripManagedClaudeSkillRules } from "./config/claudeSkills";
import { stripManagedGeminiSkillRules } from "./config/geminiSkills";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import {
  formatLobsterGroupChatMemberName,
  LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
  resolveLobsterAnswerConclusion,
  type LobsterDebateModeratorDecisionRecord,
  type LobsterDebateNeedsReviewSummary,
  type LobsterDebateParticipantRecord,
  type LobsterDebatePaths,
} from "./lobsterDebate";
import { type LobsterDebateParticipantDefinition } from "./lobsterPromptBuilders";
import { type LobsterMainDecision, type LobsterSubtaskDecision, type LobsterTaskRecord } from "./lobsterTaskStore";

export type ConfigHeartbeatSnapshot = {
  cli: CliName;
  activeConfigId: string | null;
  configIds: string[];
  modelSelected: string | null;
  managedModelOptions: string[];
  lobsterMainModelSelected: string | null;
  lobsterSubtaskModelSelected: string | null;
  lobsterRoleSignature: string;
};

export type ConfigHeartbeatCoordinatorDeps = {
  intervalMs: number;
  getCurrentCli: () => CliName;
  getWorkspaceKey: () => string;
  getSnapshot: () => ConfigHeartbeatSnapshot | null;
  setSnapshot: (snapshot: ConfigHeartbeatSnapshot) => void;
  isRunning: () => boolean;
  setRunning: (running: boolean) => void;
  getTimer: () => NodeJS.Timeout | null;
  setTimer: (timer: NodeJS.Timeout | null) => void;
  loadConfigState: (cli: CliName) => Promise<PanelState["configState"]>;
  getLastConfigStateLoadError: (cli: CliName) => string | null;
  readNormalizedModelStoreFromDisk: () => CliModelStore;
  setModelStore: (store: CliModelStore) => void;
  resolveModelConfigIdForCli: (cli: CliName, configState?: PanelState["configState"]) => string | null;
  ensureCliModelStore: (store?: CliModelStore) => CliModelStore;
  normalizeCliModelName: (value: unknown) => string | null;
  mergeUniqueModelNames: (...groups: Array<readonly string[]>) => string[];
  getSelectedLobsterCliModel: (cli: CliName, role: "main" | "subtask", configId?: string | null) => string | null;
  normalizeLobsterModelRoleFlags: (value: unknown) => { main: boolean; subtask: boolean };
  buildPanelStateWithConfigState: (configState: PanelState["configState"]) => Promise<PanelState>;
  postState: (state: PanelState) => void;
  syncConfigManagerPanel: () => void;
  logDebug: (event: string, payload?: unknown) => void;
  logEssential: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
  createDisposable: (dispose: () => void) => vscode.Disposable;
};

function areStringListsEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i] !== next[i]) {
      return false;
    }
  }
  return true;
}

function getConfigHeartbeatPayload(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore,
  deps: ConfigHeartbeatCoordinatorDeps
): ConfigHeartbeatSnapshot {
  const activeConfigId = configState.activeConfigId;
  const modelConfigId = deps.resolveModelConfigIdForCli(cli, configState);
  const normalizedStore = deps.ensureCliModelStore(store);
  const modelSelected = modelConfigId
    ? deps.normalizeCliModelName(normalizedStore.selectedByConfigId[modelConfigId])
    : null;
  const managedModelOptions = modelConfigId
    ? deps.mergeUniqueModelNames(normalizedStore.optionsByConfigId[modelConfigId] ?? [])
    : [];
  const lobsterMainModelSelected = modelConfigId
    ? deps.getSelectedLobsterCliModel(cli, "main", modelConfigId)
    : null;
  const lobsterSubtaskModelSelected = modelConfigId
    ? deps.getSelectedLobsterCliModel(cli, "subtask", modelConfigId)
    : null;
  const lobsterRolesForConfig = modelConfigId
    ? (normalizedStore.lobsterRolesByConfigId[modelConfigId] ?? {})
    : {};
  const lobsterRoleSignature = JSON.stringify(
    Object.keys(lobsterRolesForConfig)
      .sort((left, right) => left.localeCompare(right))
      .map((modelName) => {
        const flags = deps.normalizeLobsterModelRoleFlags(lobsterRolesForConfig[modelName]);
        return `${modelName}:${flags.main ? "1" : "0"}${flags.subtask ? "1" : "0"}`;
      })
  );
  return {
    cli,
    activeConfigId,
    configIds: configState.configs.map((config) => config.id),
    modelSelected,
    managedModelOptions,
    lobsterMainModelSelected,
    lobsterSubtaskModelSelected,
    lobsterRoleSignature,
  };
}

function shouldRefreshConfigState(
  cli: CliName,
  configState: PanelState["configState"],
  store: CliModelStore,
  deps: ConfigHeartbeatCoordinatorDeps
): boolean {
  const snapshot = deps.getSnapshot();
  const nextPayload = getConfigHeartbeatPayload(cli, configState, store, deps);
  if (!snapshot || snapshot.cli !== cli) {
    return true;
  }
  if (snapshot.activeConfigId !== nextPayload.activeConfigId) {
    return true;
  }
  if (!areStringListsEqual(snapshot.configIds, nextPayload.configIds)) {
    return true;
  }
  if (snapshot.modelSelected !== nextPayload.modelSelected) {
    return true;
  }
  if (!areStringListsEqual(snapshot.managedModelOptions, nextPayload.managedModelOptions)) {
    return true;
  }
  if (snapshot.lobsterMainModelSelected !== nextPayload.lobsterMainModelSelected) {
    return true;
  }
  if (snapshot.lobsterSubtaskModelSelected !== nextPayload.lobsterSubtaskModelSelected) {
    return true;
  }
  if (snapshot.lobsterRoleSignature !== nextPayload.lobsterRoleSignature) {
    return true;
  }
  return false;
}

export function createConfigHeartbeatCoordinator(deps: ConfigHeartbeatCoordinatorDeps) {
  const updateSnapshot = (cli: CliName, configState: PanelState["configState"], store: CliModelStore): void => {
    deps.setSnapshot(getConfigHeartbeatPayload(cli, configState, store, deps));
  };

  const poll = async (): Promise<void> => {
    if (deps.isRunning()) {
      return;
    }
    deps.setRunning(true);
    const targetCli = deps.getCurrentCli();
    const workspaceKey = deps.getWorkspaceKey();
    try {
      const configState = await deps.loadConfigState(targetCli);
      const configStateLoadError = deps.getLastConfigStateLoadError(targetCli);
      const snapshot = deps.getSnapshot();
      if (configStateLoadError && snapshot?.cli === targetCli) {
        deps.logError("config-heartbeat-skip-after-config-state-error", {
          workspaceKey,
          cli: targetCli,
          error: configStateLoadError,
        });
        return;
      }
      const latestModelStore = deps.readNormalizedModelStoreFromDisk();
      deps.setModelStore(latestModelStore);
      if (targetCli !== deps.getCurrentCli()) {
        return;
      }
      const nextPayload = getConfigHeartbeatPayload(targetCli, configState, latestModelStore, deps);
      deps.logDebug("config-heartbeat-tick", {
        workspaceKey,
        cli: targetCli,
        snapshot: deps.getSnapshot(),
        next: nextPayload,
      });
      if (!shouldRefreshConfigState(targetCli, configState, latestModelStore, deps)) {
        return;
      }
      updateSnapshot(targetCli, configState, latestModelStore);
      deps.logEssential("config-heartbeat-change", {
        workspaceKey,
        cli: targetCli,
        state: nextPayload,
      });
      const state = await deps.buildPanelStateWithConfigState(configState);
      deps.postState(state);
      deps.syncConfigManagerPanel();
    } catch (error) {
      deps.logError("config-heartbeat-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      deps.setRunning(false);
    }
  };

  const start = (context: vscode.ExtensionContext): void => {
    const existingTimer = deps.getTimer();
    if (existingTimer) {
      clearInterval(existingTimer);
      deps.setTimer(null);
    }
    const timer = setInterval(() => {
      void poll();
    }, deps.intervalMs);
    deps.setTimer(timer);
    context.subscriptions.push(
      deps.createDisposable(() => {
        const activeTimer = deps.getTimer();
        if (activeTimer) {
          clearInterval(activeTimer);
          deps.setTimer(null);
        }
      })
    );
  };

  return { updateSnapshot, poll, start };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeJson(value: string | undefined, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!value.trim()) {
    return fallback;
  }
  try {
    return stableStringify(JSON.parse(value));
  } catch {
    return normalizeLineEndings(value);
  }
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isDeepEqualSubset(expected: unknown, actual: unknown): boolean {
  if (expected === actual) {
    return true;
  }
  if (typeof expected !== typeof actual) {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }
    return expected.every((item, index) => isDeepEqualSubset(item, actual[index]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") {
      return false;
    }
    const actualRecord = actual as Record<string, unknown>;
    return Object.keys(expected as Record<string, unknown>).every((key) =>
      isDeepEqualSubset((expected as Record<string, unknown>)[key], actualRecord[key])
    );
  }
  return false;
}

export function matchesActiveConfig(
  platform: ConfigPlatform,
  config: ConfigItem,
  current: CurrentConfig
): boolean {
  if (platform === "claude") {
    const normalizedConfigContent = stripManagedClaudeSkillRules(config.content, config.claudeSkills);
    const normalizedCurrentContent = stripManagedClaudeSkillRules(current.content, config.claudeSkills);
    const configContentObj = parseJsonObject(normalizedConfigContent);
    const currentContentObj = parseJsonObject(normalizedCurrentContent);
    const contentMatch = configContentObj && currentContentObj
      ? isDeepEqualSubset(configContentObj, currentContentObj)
      : normalizeJson(normalizedConfigContent, "{}") === normalizeJson(normalizedCurrentContent, "{}");

    const configMcp = parseJsonObject(config.mcpContent);
    const currentMcp = parseJsonObject(current.mcpContent);
    const mcpMatch = configMcp && currentMcp
      ? isDeepEqualSubset(configMcp, currentMcp)
      : normalizeJson(config.mcpContent, "{}") === normalizeJson(current.mcpContent, "{}");

    return contentMatch && mcpMatch;
  }
  if (platform === "gemini") {
    const normalizedConfigContent = stripManagedGeminiSkillRules(config.content, config.geminiSkills);
    const normalizedCurrentContent = stripManagedGeminiSkillRules(current.content, config.geminiSkills);
    const configContentObj = parseJsonObject(normalizedConfigContent);
    const currentContentObj = parseJsonObject(normalizedCurrentContent);
    const contentMatch = configContentObj && currentContentObj
      ? isDeepEqualSubset(configContentObj, currentContentObj)
      : normalizeJson(normalizedConfigContent, "{}") === normalizeJson(normalizedCurrentContent, "{}");
    return (
      contentMatch &&
      normalizeLineEndings(config.envContent ?? "") === normalizeLineEndings(current.envContent ?? "")
    );
  }
  return (
    areLinesSubset(
      normalizeConfigLines(config.configContent),
      normalizeConfigLines(current.configContent)
    ) &&
    normalizeJson(config.authContent, "{}") === normalizeJson(current.authContent, "{}")
  );
}

function normalizeConfigLines(value: string | undefined): string[] {
  const normalized = stripCodexSkillsBlock(normalizeLineEndings(value ?? ""));
  return normalized
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => normalizeTomlLine(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function areLinesSubset(required: string[], actual: string[]): boolean {
  if (required.length === 0) {
    return true;
  }
  if (actual.length < required.length) {
    return false;
  }
  const counts = new Map<string, number>();
  actual.forEach((line) => {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  });
  for (const line of required) {
    const count = counts.get(line) ?? 0;
    if (count <= 0) {
      return false;
    }
    counts.set(line, count - 1);
  }
  return true;
}

function normalizeTomlLine(line: string): string {
  if (!line) {
    return "";
  }
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (char === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === "=" && !inDouble && !inSingle) {
      const left = line.slice(0, i).trimEnd();
      const right = line.slice(i + 1).trimStart();
      return `${left} = ${right}`.trim();
    }
  }
  return line.trim();
}

export function applyConfigOrder(configs: ConfigItem[], orderIds: string[]): ConfigItem[] {
  if (!orderIds || orderIds.length === 0) {
    return configs;
  }
  const used = new Set<string>();
  const ordered: ConfigItem[] = [];
  for (const id of orderIds) {
    const match = configs.find((item) => item.id === id);
    if (match) {
      ordered.push(match);
      used.add(match.id);
    }
  }
  const remaining = configs.filter((item) => !used.has(item.id));
  return [...ordered, ...remaining];
}

export function getWorkspacePreferredConfigIdForCli(settings: WorkspaceSettings, cli: CliName): string | null {
  const configId = settings.activeConfigIdByCli?.[cli];
  return typeof configId === "string" && configId ? configId : null;
}

export function resolveModelConfigIdForCli(
  cli: CliName,
  configState: PanelState["configState"] | undefined,
  getActiveConfigIdForCli: () => string | null,
  getWorkspacePreferredConfigIdForCli: () => string | null,
): string | null {
  const activeConfigId = configState ? configState.activeConfigId : getActiveConfigIdForCli();
  if (activeConfigId) {
    return activeConfigId;
  }
  const preferredConfigId = getWorkspacePreferredConfigIdForCli();
  if (!preferredConfigId) {
    return null;
  }
  if (configState && Array.isArray(configState.configs) && configState.configs.length > 0) {
    return configState.configs.some((config) => config.id === preferredConfigId)
      ? preferredConfigId
      : null;
  }
  return preferredConfigId;
}

export type ConfigStateLoaderDeps = {
  workspaceSettings: WorkspaceSettings;
  getConfigList: (cli: CliName) => Promise<ConfigItem[]>;
  getConfigOrder: (cli: CliName) => Promise<Partial<Record<CliName, string[]>>>;
  getCurrentConfig: (cli: CliName) => Promise<CurrentConfig>;
  setWorkspaceActiveConfigId: (cli: CliName, configId: string | null) => void;
  setLastConfigStateLoadError: (cli: CliName, message: string | null) => void;
  logInfo: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
  errorToMessage: (error: unknown) => string;
};

export async function loadConfigStateWithDeps(
  cli: CliName,
  deps: ConfigStateLoaderDeps,
): Promise<PanelState["configState"]> {
  try {
    const configs = await deps.getConfigList(cli);
    if (configs.length === 0) {
      deps.setWorkspaceActiveConfigId(cli, null);
      deps.setLastConfigStateLoadError(cli, null);
      deps.logInfo("loadConfigState-empty", { cli, reason: "no-configs" });
      return { configs: [], activeConfigId: null };
    }
    let orderIds: string[] = [];
    try {
      const order = await deps.getConfigOrder(cli);
      orderIds = order[cli] ?? [];
    } catch (error) {
      deps.logInfo("loadConfigState-order-failed", {
        cli,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const orderedConfigs = applyConfigOrder(configs, orderIds);
    const current = await deps.getCurrentConfig(cli);
    const preferredActiveConfigId = deps.workspaceSettings.activeConfigIdByCli?.[cli] ?? null;
    const preferredActive = preferredActiveConfigId
      ? orderedConfigs.find((config) => config.id === preferredActiveConfigId) ?? null
      : null;
    const matchedActive = preferredActive && matchesActiveConfig(cli, preferredActive, current)
      ? preferredActive
      : orderedConfigs.find((config) => matchesActiveConfig(cli, config, current));
    const active = matchedActive ?? preferredActive;
    const activeConfigId = active ? active.id : null;
    if (matchedActive && preferredActiveConfigId !== activeConfigId) {
      deps.setWorkspaceActiveConfigId(cli, activeConfigId);
    } else if (!preferredActive && preferredActiveConfigId) {
      deps.setWorkspaceActiveConfigId(cli, null);
    } else if (!matchedActive && preferredActive) {
      deps.logInfo("loadConfigState-preferred-fallback", {
        cli,
        configId: preferredActive.id,
        reason: "current-config-did-not-match-known-profile",
      });
    }
    deps.setLastConfigStateLoadError(cli, null);
    return {
      configs: orderedConfigs.map((config) => ({
        id: config.id,
        name: config.name,
        platform: config.platform,
      })),
      activeConfigId,
    };
  } catch (error) {
    const message = deps.errorToMessage(error);
    deps.setLastConfigStateLoadError(cli, message);
    deps.logError("panel-config-state", { cli, error: message });
    return { configs: [], activeConfigId: null };
  }
}

export type CliInstallStatus = {
  command: string;
  installed: boolean;
  checkedAt: number;
};

export type CodexImageSupportStatus = {
  command: string;
  checkedAt: number;
  version: string | null;
  versionLabel: string | null;
  supportsImageFlag: boolean;
  supported: boolean;
  reason: "supported" | "version-too-low" | "flag-missing" | "probe-failed";
  probeError?: string;
};

export async function normalizeCliInstallStatus(
  cli: CliName,
  command: string,
  deps: {
    isCliCommandAvailable: (command: string) => Promise<boolean>;
    logError: (event: string, payload?: unknown) => void;
  },
): Promise<CliInstallStatus> {
  let installed = false;
  try {
    installed = await deps.isCliCommandAvailable(command);
  } catch (error) {
    installed = false;
    deps.logError("cli-install-status-detect-failed", {
      cli,
      command,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { command, installed, checkedAt: Date.now() };
}

export function buildCliCommandNotFoundMessage(
  cli: CliName,
  command: string,
  processPlatform: NodeJS.Platform,
  t: (key: any, params?: any) => string,
): string {
  const configKey = `sinitek-cli-tools.commands.${cli}`;
  if (processPlatform === "win32") {
    return [
      t("cli.notFound.win.title", { command }),
      t("cli.notFound.win.hint1", { configKey, command }),
      t("cli.notFound.win.hint2", { command }),
      t("cli.notFound.win.hint3"),
    ].join("\n");
  }
  return [
    t("cli.notFound.unix.title", { command }),
    t("cli.notFound.unix.hint1", { configKey }),
    t("cli.notFound.unix.hint2", { command }),
  ].join("\n");
}

function extractFirstLine(value: string): string | null {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? null;
}

function extractSemverVersion(value: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value);
  return match ? match[1] : null;
}

function parseSemverParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string, right: string): number {
  const leftParts = parseSemverParts(left);
  const rightParts = parseSemverParts(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  const leftStable = !left.includes("-");
  const rightStable = !right.includes("-");
  if (leftStable !== rightStable) {
    return leftStable ? 1 : -1;
  }
  return left.localeCompare(right);
}

export async function probeCodexImageSupportStatus(
  command: string,
  deps: {
    minVersion: string;
    timeoutMs: number;
    captureCliOutput: (command: string, args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string }>;
  },
): Promise<CodexImageSupportStatus> {
  let version: string | null = null;
  let versionLabel: string | null = null;
  let supportsImageFlag = false;
  const probeErrors: string[] = [];

  try {
    const versionResult = await deps.captureCliOutput(command, ["--version"], {
      timeoutMs: deps.timeoutMs,
    });
    const versionOutput = [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n").trim();
    versionLabel = extractFirstLine(versionOutput);
    version = extractSemverVersion(versionOutput);
  } catch (error) {
    probeErrors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const helpResult = await deps.captureCliOutput(command, ["exec", "--help"], {
      timeoutMs: deps.timeoutMs,
    });
    const helpOutput = [helpResult.stdout, helpResult.stderr].filter(Boolean).join("\n");
    supportsImageFlag = /(?:^|\s)(?:-i,\s*)?--image\b/m.test(helpOutput);
  } catch (error) {
    probeErrors.push(error instanceof Error ? error.message : String(error));
  }

  const versionTooLow = Boolean(version && compareSemver(version, deps.minVersion) < 0);
  const supported = supportsImageFlag && !versionTooLow;
  let reason: CodexImageSupportStatus["reason"] = "supported";
  if (versionTooLow) {
    reason = "version-too-low";
  } else if (!supportsImageFlag) {
    reason = probeErrors.length ? "probe-failed" : "flag-missing";
  }

  return {
    command,
    checkedAt: Date.now(),
    version,
    versionLabel,
    supportsImageFlag,
    supported,
    reason,
    probeError: probeErrors.length ? probeErrors.join("; ") : undefined,
  };
}

export function buildCodexImageSupportWarningKey(status: CodexImageSupportStatus): string {
  return [
    status.command,
    status.version ?? status.versionLabel ?? "unknown",
    status.supportsImageFlag ? "image" : "no-image",
    status.reason,
  ].join("|");
}

export function buildLobsterDebateStartedText(
  taskId: string,
  round: number,
  participants: LobsterDebateParticipantRecord[],
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 红蓝对抗群聊已启动：主任务第 ${round} 轮，${participants.length} 个红蓝参与者，裁判主持，最多 ${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS} 个发言批次安全上限`,
    `龙虾任务：${taskId}`,
    `brief：${paths.briefFile}`,
    `chat：${paths.chatFile}`,
  ].join("\n");
}

export function buildLobsterDebateDialogueTurnStartedText(
  taskId: string,
  round: number,
  dialogueTurn: number,
  maxDialogueTurns: number,
  speakers: readonly LobsterDebateParticipantDefinition[],
  paths: LobsterDebatePaths,
): string {
  const speakersLine = speakers.length > 0
    ? `点名发言者：${speakers.map((speaker) => formatLobsterGroupChatMemberName(speaker.title)).join("、")}`
    : "点名发言者：未指定";
  return [
    `🦞 红蓝对抗发言开始：主任务第 ${round} 轮，发言批次 ${dialogueTurn}/${maxDialogueTurns}，本批次结束后由裁判主持人判断是否继续`,
    `龙虾任务：${taskId}`,
    speakersLine,
    `chat：${paths.chatFile}`,
  ].join("\n");
}

export function buildLobsterDebateRerunText(taskId: string, round: number, reasons: string[]): string {
  return [
    `🦞 红蓝对抗恢复校验未通过，将重跑第 ${round} 轮辩论。`,
    `龙虾任务：${taskId}`,
    `原因：${reasons.join("；")}`,
  ].join("\n");
}

export function buildLobsterDebateReuseText(taskId: string, round: number, paths: LobsterDebatePaths): string {
  return [
    `🦞 已复用第 ${round} 轮红蓝对抗共识。`,
    `龙虾任务：${taskId}`,
    `chat：${paths.chatFile}`,
    `decision：${paths.decisionFile}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantRosterStartedText(
  taskId: string,
  round: number,
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 裁判主持人正在设计红蓝参与者：第 ${round} 轮`,
    `龙虾任务：${taskId}`,
    `roster：${paths.participantRosterFile}`,
    `chat：${paths.chatFile}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantRosterFinishedText(
  taskId: string,
  round: number,
  participants: readonly LobsterDebateParticipantDefinition[],
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 红蓝参与者已动态加入：第 ${round} 轮，${participants.length} 个参与者`,
    `龙虾任务：${taskId}`,
    `参与者：${participants.map((participant) => formatLobsterGroupChatMemberName(participant.title)).join("、")}`,
    `roster：${paths.participantRosterFile}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantRosterFailedText(
  taskId: string,
  round: number,
  reasons: string[],
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 裁判主持人红蓝组队无效：第 ${round} 轮`,
    `龙虾任务：${taskId}`,
    `原因：${reasons.join("；") || "未提供具体原因"}`,
    `roster：${paths.participantRosterFile}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantStartedText(
  taskId: string,
  round: number,
  dialogueTurn: number,
  title: string,
  artifactFile: string,
  finalPass: boolean,
): string {
  return [
    finalPass
      ? `🦞 红蓝参与者已启动最终立场收集：${title}`
      : `🦞 红蓝参与者已启动：${title}（发言批次 ${dialogueTurn}/${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}）`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `artifact：${artifactFile}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantFinishedText(
  taskId: string,
  round: number,
  dialogueTurn: number,
  participant: LobsterDebateParticipantRecord,
  finalPass: boolean,
): string {
  return [
    finalPass
      ? `🦞 红蓝最终立场已收集：${participant.title}`
      : `🦞 红蓝发言已收集：${participant.title}（发言批次 ${dialogueTurn}/${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}）`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `状态：${participant.status}`,
    `立场：${participant.stance ?? "未解析"}`,
  ].join("\n");
}

export function buildLobsterDebateParticipantsCollectedText(
  taskId: string,
  round: number,
  participants: LobsterDebateParticipantRecord[],
): string {
  const titles = participants.map((participant) => `${participant.title}=${participant.stance ?? "unknown"}`).join("、");
  return [
    `🦞 红蓝最终立场已收集：${participants.length} 个参与者`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `最终立场：${titles}`,
  ].join("\n");
}

export function buildLobsterDebateConsensusStartedText(taskId: string, round: number, paths: LobsterDebatePaths): string {
  return [
    `🦞 红蓝对抗共识汇总已启动：第 ${round} 轮`,
    `龙虾任务：${taskId}`,
    `chat：${paths.chatFile}`,
    `cross-review：${paths.crossReviewFile}`,
    `consensus：${paths.consensusFile}`,
    `decision：${paths.decisionFile}`,
  ].join("\n");
}

export function buildLobsterDebateModeratorStartedText(
  taskId: string,
  round: number,
  dialogueTurn: number,
  artifactFile: string,
): string {
  return [
    `🦞 裁判主持人控场已启动：主任务第 ${round} 轮，发言批次 ${dialogueTurn}`,
    `龙虾任务：${taskId}`,
    `artifact：${artifactFile}`,
  ].join("\n");
}

export function buildLobsterDebateModeratorFinishedText(
  taskId: string,
  round: number,
  decision: LobsterDebateModeratorDecisionRecord,
  maxDialogueTurns: number,
  participants: readonly LobsterDebateParticipantDefinition[],
): string {
  const participantById = new Map(participants.map((participant) => [participant.id, participant] as const));
  const nextSpeakerNames = decision.nextSpeakerIds
    .map((speakerId) => participantById.get(speakerId)?.title ?? speakerId)
    .map(formatLobsterGroupChatMemberName);
  return [
    `🦞 裁判主持人控场已收束：${decision.action}`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `当前发言批次：${decision.dialogueTurn}/${maxDialogueTurns}`,
    `理由：${decision.reason}`,
    decision.nextSpeakerIds.length > 0
      ? `下一批发言者：${nextSpeakerNames.join("、")}`
      : "下一批发言者：无",
    decision.nextFocus.length > 0
      ? `下一轮关注点：${decision.nextFocus.join("；")}`
      : "下一轮关注点：无",
  ].join("\n");
}

export function buildLobsterDebateFinalStanceStartedText(
  taskId: string,
  round: number,
  decision: LobsterDebateModeratorDecisionRecord,
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 红蓝对抗进入最终立场收集：裁判动作 ${decision.action}`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `chat：${paths.chatFile}`,
  ].join("\n");
}

export function buildLobsterDebateConsensusReachedText(
  taskId: string,
  round: number,
  decision: LobsterMainDecision,
  paths: LobsterDebatePaths,
  getDecisionSubtasks: (decision: LobsterMainDecision) => LobsterSubtaskDecision[],
  formatEstimatedRemainingRounds: (value?: number) => string | null,
): string {
  const decisionSummary = decision.status === "continue"
    ? `派发 ${getDecisionSubtasks(decision).length} 个子任务，预计剩余 ${formatEstimatedRemainingRounds(decision.estimatedRemainingRounds) ?? "未记录"}`
    : decision.status;
  return [
    `🦞 红蓝对抗共识已形成：${decisionSummary}`,
    `龙虾任务：${taskId}`,
    `轮次：${round}`,
    `chat：${paths.chatFile}`,
    `decision：${paths.decisionFile}`,
  ].join("\n");
}

export function buildLobsterDebateNeedsReviewText(
  taskId: string,
  round: number,
  reviewSummary: LobsterDebateNeedsReviewSummary,
  paths: LobsterDebatePaths,
): string {
  return [
    `🦞 ${reviewSummary.title}，已进入人工复核：第 ${round} 轮`,
    `龙虾任务：${taskId}`,
    `摘要：${reviewSummary.details.join("；")}`,
    `辩论目录：${paths.roundDir}`,
  ].join("\n");
}

export function normalizeLobsterSupplementalRequirement(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function buildLobsterSupplementalRequirementsLines(
  task: Pick<LobsterTaskRecord, "supplementalRequirements">,
): string[] {
  const requirements = Array.isArray(task.supplementalRequirements)
    ? task.supplementalRequirements.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (requirements.length === 0) {
    return [];
  }
  return [
    "补充需求：",
    ...requirements.map((item, index) => `${index + 1}. ${item}`),
    "",
  ];
}

export function buildLobsterCompletedConclusionAndSummaryMarkdown(
  task: LobsterTaskRecord,
  decision?: LobsterMainDecision | null,
): string {
  const finalSummary = typeof decision?.finalSummary === "string" && decision.finalSummary.trim()
    ? decision.finalSummary.trim()
    : (typeof task.finalSummary === "string" && task.finalSummary.trim() ? task.finalSummary.trim() : "主任务已完成。");
  return [
    "### 问题回答结论",
    resolveLobsterAnswerConclusion(task, decision),
    "",
    "### 完成摘要",
    finalSummary,
  ].join("\n");
}

export function resolveLobsterResumeRound(task: LobsterTaskRecord): number {
  const recordedRound = typeof task.currentRound === "number" && Number.isFinite(task.currentRound)
    ? Math.floor(task.currentRound)
    : 0;
  const latestRoundFromHistory = task.rounds.reduce((maxValue, current) => {
    const round = typeof current.round === "number" && Number.isFinite(current.round)
      ? Math.floor(current.round)
      : 0;
    return Math.max(maxValue, round);
  }, 0);
  const resolved = Math.max(recordedRound, latestRoundFromHistory, 1);
  return Math.min(resolved, task.maxRounds);
}

export function buildLobsterRoundSummary(round: number, role: "main" | "subtask", subtaskId?: string): string {
  const subtaskSuffix = role === "subtask" && subtaskId ? ` (${subtaskId})` : "";
  return `${role === "main" ? "Main task" : "Subtask"}${subtaskSuffix} round ${round} finished from extension observation.`;
}
