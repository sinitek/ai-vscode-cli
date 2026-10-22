import type { CliName, ThinkingMode } from "./cli/types";
import type { ConfigApplyResult } from "./config/configApplyQueue";
import type { LoopTaskRecord } from "./loopTaskStore";
import type { ChatMessage, ConversationExecutionProfile } from "./webview/types";

export type ConversationModelRole = "vibe" | "main" | "subtask";

export type ConversationModelRoute = {
  cli: CliName;
  configId: string | null;
  model?: string | null;
  thinkingMode?: ThinkingMode;
  openCodeVariant?: string | null;
};

export type ConversationTabConfiguration = {
  main: ConversationModelRoute;
  mainRole?: ConversationModelRole;
  subtask?: ConversationModelRoute;
};

export function buildConversationExecutionProfile(
  configId: string | null | undefined,
  model: string | null,
  thinkingMode?: ThinkingMode,
  openCodeVariant?: string | null,
): ConversationExecutionProfile | undefined {
  if (!configId?.trim()) {
    return undefined;
  }
  return {
    configId: configId.trim(),
    model,
    ...(thinkingMode !== undefined ? { thinkingMode } : {}),
    ...(openCodeVariant !== undefined ? { openCodeVariant } : {}),
  };
}

export function resolveConversationTabConfiguration(input: {
  cli: CliName;
  taskRole?: "main" | "subtask" | null;
  task?: Pick<LoopTaskRecord, "cli" | "modelRouting" | "originProfile"> | null;
  messages: readonly ChatMessage[];
}): ConversationTabConfiguration | null {
  const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
  const snapshot = latestUserMessage?.executionProfile;
  const task = input.task;
  if (input.taskRole === "main" && task?.cli === input.cli) {
    const routing = task.modelRouting;
    const origin = task.originProfile;
    const configId = routing?.main.configId ?? origin?.configId ?? snapshot?.configId ?? null;
    const subtaskCli = routing?.subtask.cli ?? task.cli;
    return {
      mainRole: "main",
      main: {
        cli: task.cli,
        configId,
        model: routing?.main.model ?? routing?.main.fallback ?? snapshot?.model,
        thinkingMode: origin?.mainThinkingMode ?? snapshot?.thinkingMode,
        openCodeVariant: origin?.mainOpenCodeVariant ?? snapshot?.openCodeVariant,
      },
      ...(routing ? {
        subtask: {
          cli: subtaskCli,
          configId: routing.subtask.configId ?? (subtaskCli === task.cli ? configId : null),
          model: routing.subtask.model ?? routing.subtask.fallback ?? (subtaskCli === "claude" ? null : undefined),
          thinkingMode: origin?.subtaskThinkingMode,
          openCodeVariant: origin?.subtaskOpenCodeVariant,
        },
      } : {}),
    };
  }
  if (snapshot) {
    return { main: { cli: input.cli, ...snapshot } };
  }
  if (input.taskRole === "subtask" && task) {
    const route = task.modelRouting?.subtask;
    const subtaskCli = route?.cli ?? task.cli;
    if (subtaskCli !== input.cli) {
      return null;
    }
    return {
      main: {
        cli: subtaskCli,
        configId: route?.configId ?? (subtaskCli === task.cli ? task.originProfile?.configId ?? null : null),
        model: input.cli === "grok"
          ? route?.model ?? route?.fallback
          : latestUserMessage?.executionModel !== undefined
            ? latestUserMessage.executionModel
            : route?.model ?? route?.fallback,
        thinkingMode: task.originProfile?.subtaskThinkingMode,
        openCodeVariant: task.originProfile?.subtaskOpenCodeVariant,
      },
    };
  }
  return null;
}

export function createConversationTabConfigurationRestorer(deps: {
  getActiveTabId: () => string | null;
  getWorkspaceKey: () => string;
  getConfiguration: (tabId: string) => ConversationTabConfiguration | null;
  configExists: (cli: CliName, configId: string) => Promise<boolean>;
  waitForConfigApply: (cli: CliName) => Promise<boolean>;
  getActiveConfigId: (cli: CliName) => string | null;
  applyConfig: (cli: CliName, configId: string) => Promise<ConfigApplyResult>;
  getModelOptions: (cli: CliName, configId: string, role: ConversationModelRole) => Promise<string[]>;
  selectModel: (route: ConversationModelRoute, role: ConversationModelRole) => void;
  restoreThinking: (route: ConversationModelRoute, role: ConversationModelRole) => void;
  selectSubtaskCli: (configId: string, cli: CliName) => void;
  onError: (error: unknown) => void;
}) {
  let requestId = 0;
  return async (tabId: string): Promise<void> => {
    const currentRequestId = ++requestId;
    const workspaceKey = deps.getWorkspaceKey();
    const isCurrent = (): boolean => currentRequestId === requestId
      && deps.getActiveTabId() === tabId
      && deps.getWorkspaceKey() === workspaceKey;
    const restoreRoute = async (route: ConversationModelRoute, role: ConversationModelRole): Promise<boolean> => {
      const configId = route.configId;
      if (!configId || !isCurrent() || !(await deps.configExists(route.cli, configId))) {
        return false;
      }
      await deps.waitForConfigApply(route.cli);
      if (!isCurrent()) {
        return false;
      }
      if (deps.getActiveConfigId(route.cli) !== configId) {
        if (await deps.applyConfig(route.cli, configId) !== "applied" || !isCurrent()) {
          return false;
        }
      }
      if (route.model !== undefined && route.cli !== "claude") {
        const options = route.model === null ? [] : await deps.getModelOptions(route.cli, configId, role);
        if (!isCurrent()) {
          return false;
        }
        if (route.model !== null && !options.includes(route.model)) {
          return true;
        }
        deps.selectModel(route, role);
      }
      if (isCurrent() && (route.model !== undefined || route.cli === "claude")) {
        deps.restoreThinking(route, role);
      }
      return isCurrent();
    };
    try {
      const configuration = deps.getConfiguration(tabId);
      if (!configuration) {
        return;
      }
      const mainRole = configuration.mainRole ?? "vibe";
      if (!(await restoreRoute(configuration.main, mainRole)) || !configuration.subtask) {
        return;
      }
      const subtask = configuration.subtask;
      if (await restoreRoute(subtask, "subtask") && isCurrent() && configuration.main.configId) {
        deps.selectSubtaskCli(configuration.main.configId, subtask.cli);
      }
    } catch (error) {
      deps.onError(error);
    }
  };
}
