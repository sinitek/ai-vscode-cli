import * as vscode from "vscode";
import { isDeepStrictEqual } from "util";
import { CLI_LIST, CliName } from "./cli/types";
import { PanelState } from "./webview/types";
import { type CliModelStore } from "./modelSelectionStore";

import { ConfigItem, ConfigPlatform, CurrentConfig } from "./config/types";
import { stripCodexSkillsBlock } from "./config/codexSkills";
import { stripManagedClaudeSkillRules } from "./config/claudeSkills";
import { stripManagedOpenCodeSkillRules } from "./config/geminiSkills";
import { mergeZcodeProviderConfigText } from "./config/zcodeConfig";
import { parseGrokToml } from "./config/grokToml";
import { type WorkspaceSettings } from "./workspaceSettingsStore";
import { resolveLoopAnswerConclusion } from "./loopGroupChat";
import { type LoopMainDecision, type LoopTaskRecord } from "./loopTaskStore";

export type { ConfigHeartbeatSnapshot } from "./configHeartbeatSnapshot";
import {
  buildConfigHeartbeatSnapshot,
  shouldRefreshConfigHeartbeat,
  type ConfigHeartbeatSnapshot,
} from "./configHeartbeatSnapshot";

export type ConfigHeartbeatCoordinatorDeps = {
  intervalMs: number;
  getCurrentCli: () => CliName;
  getWorkspaceKey: () => string;
  loadConfigState: (cli: CliName) => Promise<PanelState["configState"]>;
  getLastConfigStateLoadError: (cli: CliName) => string | null;
  readNormalizedModelStoreFromDisk: () => CliModelStore;
  setModelStore: (store: CliModelStore) => void;
  resolveModelConfigIdForCli: (cli: CliName, configState?: PanelState["configState"]) => string | null;
  buildPanelStateWithConfigState: (configState: PanelState["configState"]) => Promise<PanelState>;
  postState: (state: PanelState) => void;
  syncConfigManagerPanel: () => void;
  logDebug: (event: string, payload?: unknown) => void;
  logEssential: (event: string, payload?: unknown) => void;
  logError: (event: string, payload?: unknown) => void;
  createDisposable: (dispose: () => void) => vscode.Disposable;
};

export function createConfigHeartbeatCoordinator(deps: ConfigHeartbeatCoordinatorDeps) {
  let snapshot: ConfigHeartbeatSnapshot | null = null;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const updateSnapshot = (cli: CliName, configState: PanelState["configState"], store: CliModelStore): void => {
    snapshot = buildConfigHeartbeatSnapshot(cli, configState, store, deps);
  };

  const poll = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    const targetCli = deps.getCurrentCli();
    const workspaceKey = deps.getWorkspaceKey();
    try {
      const configState = await deps.loadConfigState(targetCli);
      const configStateLoadError = deps.getLastConfigStateLoadError(targetCli);
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
      const nextSnapshot = buildConfigHeartbeatSnapshot(targetCli, configState, latestModelStore, deps);
      deps.logDebug("config-heartbeat-tick", {
        workspaceKey,
        cli: targetCli,
        snapshot,
        next: nextSnapshot,
      });
      if (!shouldRefreshConfigHeartbeat(snapshot, nextSnapshot)) {
        return;
      }
      snapshot = nextSnapshot;
      deps.logEssential("config-heartbeat-change", {
        workspaceKey,
        cli: targetCli,
        state: nextSnapshot,
      });
      const state = await deps.buildPanelStateWithConfigState(configState);
      deps.postState(state);
      deps.syncConfigManagerPanel();
    } catch (error) {
      deps.logError("config-heartbeat-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };

  const start = (context: vscode.ExtensionContext): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    timer = setInterval(() => {
      void poll();
    }, deps.intervalMs);
    context.subscriptions.push(
      deps.createDisposable(() => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      })
    );
  };

  return {
    getSnapshot: (): ConfigHeartbeatSnapshot | null => snapshot,
    updateSnapshot,
    poll,
    start,
  };
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
  platform: ConfigPlatform | CliName,
  config: ConfigItem,
  current: CurrentConfig
): boolean {
  if (platform === "zcode") {
    const content = config.content ?? config.configContent ?? "";
    const currentContent = current.content ?? current.configContent ?? "";
    const merged = mergeZcodeProviderConfigText(currentContent, content);
    if (!merged.ok) {
      return false;
    }
    try {
      return isDeepStrictEqual(JSON.parse(merged.content), JSON.parse(currentContent));
    } catch {
      return false;
    }
  }
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
  if (platform === "opencode") {
    const normalizedConfigContent = stripManagedOpenCodeSkillRules(config.content, config.openCodeSkills);
    const normalizedCurrentContent = stripManagedOpenCodeSkillRules(current.content, config.openCodeSkills);
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
  if (platform === "grok" || platform === "kimi-code") {
    const expected = parseGrokToml(config.configContent ?? config.content ?? "");
    const actual = parseGrokToml(current.configContent ?? current.content ?? "");
    return expected.ok && actual.ok && isDeepEqualSubset(expected.value, actual.value);
  }
  if (platform === "dsh") {
    const expected = parseJsonObject(config.content ?? config.configContent);
    const actual = parseJsonObject(current.content ?? current.configContent);
    return Boolean(expected && actual && isDeepEqualSubset(expected, actual));
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

export async function loadConfigStateByCli(
  loader: (cli: CliName) => Promise<PanelState["configState"]>,
  seed?: { cli: CliName; state: PanelState["configState"] },
  onError?: (cli: CliName, error: unknown) => void,
): Promise<Record<CliName, PanelState["configState"]>> {
  const entries = await Promise.all(CLI_LIST.map(async (cli) => {
    if (seed?.cli === cli) {
      return [cli, seed.state] as const;
    }
    try {
      return [cli, await loader(cli)] as const;
    } catch (error) {
      onError?.(cli, error);
      return [cli, { configs: [], activeConfigId: null }] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<CliName, PanelState["configState"]>;
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

export function normalizeLoopSupplementalRequirement(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function buildLoopSupplementalRequirementsLines(
  task: Pick<LoopTaskRecord, "supplementalRequirements">,
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

export function buildLoopCompletedConclusionAndSummaryMarkdown(
  task: LoopTaskRecord,
  decision?: LoopMainDecision | null,
): string {
  const finalSummary = typeof decision?.finalSummary === "string" && decision.finalSummary.trim()
    ? decision.finalSummary.trim()
    : (typeof task.finalSummary === "string" && task.finalSummary.trim() ? task.finalSummary.trim() : "主任务已完成。");
  return [
    "### 问题回答结论",
    resolveLoopAnswerConclusion(task, decision),
    "",
    "### 完成摘要",
    finalSummary,
  ].join("\n");
}

export function resolveLoopResumeRound(task: LoopTaskRecord): number {
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

export function buildLoopRoundSummary(round: number, role: "main" | "subtask", subtaskId?: string): string {
  const subtaskSuffix = role === "subtask" && subtaskId ? ` (${subtaskId})` : "";
  return `${role === "main" ? "Main task" : "Subtask"}${subtaskSuffix} round ${round} finished from extension observation.`;
}
