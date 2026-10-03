import { countAliveCodexAppServerConnections } from "../interactive/codexAppServerPool";
import { buildErrorDetail } from "../errorDisplay";
import { t } from "../i18n";
import { logError } from "../logger";
import {
  exportSessionHistoryMessagesToTxt,
} from "../webview/panelFileActions";
import type { PanelMessage } from "../webview/types";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessageHandlerRegistry } from "../sessionMessageRouter";

type SessionPanelMessageDeps = Pick<
  PanelMessageHandlerDeps,
  | "postPanelState"
  | "sendSessionMessagesToPanel"
  | "getCurrentCli"
  | "setCurrentCliValue"
  | "getCurrentSessionId"
  | "showWebviewError"
  | "inspectModelManagerState"
  | "getActiveConversationTabBinding"
  | "setCurrentCli"
  | "disposeInteractiveRunnerIfUnused"
  | "syncCurrentSessionWithActiveTab"
  | "getActiveConfigIdForCli"
  | "selectCliModel"
  | "selectCliLoopModel"
  | "updateOpenCodeRoleModel"
  | "addCliModel"
  | "renameCliModel"
  | "deleteCliModel"
  | "moveCliModel"
  | "repairSupersededLocalSession"
  | "findConversationTabIdBySession"
  | "setActiveConversationTab"
  | "updateStatusBar"
  | "getWorkspaceSettings"
  | "saveWorkspaceSettings"
  | "addConversationTab"
  | "startNewSession"
  | "getConversationTabById"
  | "hasAnyTaskRunning"
  | "disposeAllInteractiveRunners"
  | "maybePromptInstallOnCliGroupSwitch"
  | "closeConversationTabAndRefreshPanel"
  | "confirm"
  | "disposeInteractiveRunnerSession"
  | "deleteSession"
  | "detachConversationTabsFromSession"
  | "loadSessionMessages"
  | "getSessionLoadError"
  | "postWebviewMessage"
  | "clearAllSessions"
  | "clearPromptHistory"
  | "setPromptHistoryFavorite"
  | "setWorkspaceInteractiveModeForCli"
  | "resetConversationTabSession"
  | "getConfigManagerPanel"
  | "applyConfigById"
  | "waitForConfigApply"
>;

export function createSessionPanelMessageHandlers(
  deps: SessionPanelMessageDeps
): PanelMessageHandlerRegistry {
  return {
    selectCli: async (message) => {
      const previousBinding = deps.getActiveConversationTabBinding();
      await deps.setCurrentCli(message.cli);
      deps.disposeInteractiveRunnerIfUnused(previousBinding);
      const activeSessionId = deps.syncCurrentSessionWithActiveTab();
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(deps.getCurrentCli(), activeSessionId);
    },

    selectCliModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      deps.selectCliModel(message.cli, message.model ?? null, configId);
      await deps.postPanelState();
    },

    selectCliLoopModel: async (message) => {
      const role = message.role === "subtask" ? "subtask" : "main";
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      deps.selectCliLoopModel?.(message.cli, role, message.model ?? null, configId);
      await deps.postPanelState();
    },

    updateOpenCodeRoleModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId.trim()
        ? message.configId.trim()
        : deps.getActiveConfigIdForCli("opencode");
      const error = deps.updateOpenCodeRoleModel
        ? await deps.updateOpenCodeRoleModel(message.role, message.value ?? null, configId)
        : "OpenCode role model updates are unavailable.";
      if (error) {
        deps.showWebviewError(t("panel.runtimeError"), error);
      }
      await deps.postPanelState();
    },

    addCliModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      const addedModel = deps.addCliModel(message.cli, message.model, configId);
      if (!addedModel) {
        return;
      }
      await deps.postPanelState();
    },

    renameCliModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      const renamedModel = deps.renameCliModel(
        message.cli,
        message.previousModel,
        message.nextModel,
        configId
      );
      if (!renamedModel) {
        return;
      }
      await deps.postPanelState();
    },

    deleteCliModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      deps.deleteCliModel(message.cli, message.model, configId);
      await deps.postPanelState();
    },

    moveCliModel: async (message) => {
      const configId = typeof message.configId === "string" && message.configId
        ? message.configId
        : deps.getActiveConfigIdForCli(message.cli);
      const movedModel = deps.moveCliModel(message.cli, message.model, message.direction, configId);
      if (!movedModel) {
        return;
      }
      await deps.postPanelState();
    },

    selectSession: async (message) => {
      const previousBinding = deps.getActiveConversationTabBinding(message.cli);
      await deps.setCurrentCli(message.cli, { syncActiveTab: false });
      const selectedSessionId = message.sessionId
        ? deps.repairSupersededLocalSession(message.cli, message.sessionId)
        : null;
      if (selectedSessionId) {
        const existingTabId = deps.findConversationTabIdBySession(message.cli, selectedSessionId);
        if (existingTabId) {
          const switched = deps.setActiveConversationTab(existingTabId);
          if (switched && deps.getCurrentCli() !== switched.cli) {
            deps.setCurrentCliValue(switched.cli);
            deps.updateStatusBar();
            const workspaceSettings = deps.getWorkspaceSettings();
            workspaceSettings.currentCli = deps.getCurrentCli();
            deps.saveWorkspaceSettings(workspaceSettings);
          }
        } else {
          deps.addConversationTab(message.cli, selectedSessionId);
        }
      } else {
        deps.startNewSession(message.cli);
      }
      deps.disposeInteractiveRunnerIfUnused(previousBinding);
      const activeSessionId = deps.syncCurrentSessionWithActiveTab();
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(deps.getCurrentCli(), activeSessionId);
    },

    selectConversationTab: async (message) => {
      if (!deps.getConversationTabById(message.tabId)) {
        return;
      }
      const previousCli = deps.getCurrentCli();
      if (!deps.hasAnyTaskRunning()) {
        deps.disposeAllInteractiveRunners();
      }
      const switched = deps.setActiveConversationTab(message.tabId);
      if (!switched) {
        return;
      }
      if (deps.getCurrentCli() !== switched.cli) {
        deps.setCurrentCliValue(switched.cli);
        deps.updateStatusBar();
        const workspaceSettings = deps.getWorkspaceSettings();
        workspaceSettings.currentCli = deps.getCurrentCli();
        deps.saveWorkspaceSettings(workspaceSettings);
      }
      if (previousCli !== switched.cli) {
        await deps.maybePromptInstallOnCliGroupSwitch(switched.cli);
      }
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(switched.cli, switched.sessionId, message.tabId);
    },

    closeConversationTab: async (message) => {
      await deps.closeConversationTabAndRefreshPanel(message.tabId);
    },

    deleteSession: async (message) => {
      if (!(await deps.confirm(t("session.confirmDelete"), t("common.delete")))) {
        return;
      }
      deps.disposeInteractiveRunnerSession(message.cli, message.sessionId);
      deps.deleteSession(message.cli, message.sessionId);
      deps.detachConversationTabsFromSession(message.cli, message.sessionId);
      const activeSessionId = deps.syncCurrentSessionWithActiveTab();
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(deps.getCurrentCli(), activeSessionId);
    },

    loadHistorySessionMessages: async (message) => {
      const requestedSessionId = message.sessionId;
      const resolvedSessionId = deps.repairSupersededLocalSession(message.cli, requestedSessionId);
      try {
        const messages = deps.loadSessionMessages(message.cli, resolvedSessionId);
        const loadError = deps.getSessionLoadError(message.cli, resolvedSessionId);
        deps.postWebviewMessage({
          type: "historySessionMessages",
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          messages,
          error: loadError ?? undefined,
        });
        if (loadError) {
          void logError("history-session-message-load-error", {
            cli: message.cli,
            sessionId: requestedSessionId,
            resolvedSessionId,
            detail: loadError,
          });
        }
      } catch (error) {
        const detail = buildErrorDetail(error);
        deps.postWebviewMessage({
          type: "historySessionMessages",
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          messages: [],
          error: detail,
        });
        void logError("history-session-message-load-failed", {
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          error: detail,
        });
      }
    },

    exportHistorySessionMessages: async (message) => {
      const requestedSessionId = message.sessionId;
      const resolvedSessionId = deps.repairSupersededLocalSession(message.cli, requestedSessionId);
      try {
        const messages = deps.loadSessionMessages(message.cli, resolvedSessionId);
        const exportResult = await exportSessionHistoryMessagesToTxt({
          cli: message.cli,
          sessionId: resolvedSessionId,
          messages,
        });
        deps.postWebviewMessage({
          type: "historySessionExportResult",
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          path: exportResult.path,
          fileName: exportResult.fileName,
        });
      } catch (error) {
        const messageText = error instanceof Error && error.message
          ? error.message
          : t("historySession.exportFailed");
        deps.postWebviewMessage({
          type: "historySessionExportResult",
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          error: messageText,
        });
        void logError("export history session messages failed", {
          cli: message.cli,
          sessionId: requestedSessionId,
          resolvedSessionId,
          error: buildErrorDetail(error),
        });
      }
    },

    clearAllSessions: async () => {
      if (!(await deps.confirm(t("session.confirmClearAll"), t("common.clear")))) {
        return;
      }
      deps.disposeAllInteractiveRunners();
      deps.clearAllSessions();
      const activeSessionId = deps.syncCurrentSessionWithActiveTab();
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(deps.getCurrentCli(), activeSessionId);
    },

    clearPromptHistory: async () => {
      if (!(await deps.confirm(t("session.confirmClearPromptHistory"), t("common.clear")))) {
        return;
      }
      deps.clearPromptHistory();
      await deps.postPanelState();
    },

    togglePromptHistoryFavorite: async (message) => {
      const id = typeof message.id === "string" ? message.id.trim() : "";
      if (!id) {
        return;
      }
      deps.setPromptHistoryFavorite(id, message.favorite);
      await deps.postPanelState();
    },

    newSession: async () => {
      const sessionId = deps.addConversationTab(deps.getCurrentCli(), null);
      deps.setWorkspaceInteractiveModeForCli(deps.getCurrentCli(), "coding");
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(deps.getCurrentCli(), sessionId);
    },

    queryCodexLongConnectionCount: (message) => {
      const token = typeof message.token === "number" && Number.isFinite(message.token)
        ? message.token
        : null;
      deps.postWebviewMessage({
        type: "codexLongConnectionCount",
        token,
        count: countAliveCodexAppServerConnections(),
      });
    },

    resetConversationTabSession: async () => {
      await deps.resetConversationTabSession();
    },

    openConfig: () => {
      deps.getConfigManagerPanel()?.show();
      deps.getConfigManagerPanel()?.syncActiveConfig();
    },

    applyConfig: async (message) => {
      try {
        const applyResult = await deps.applyConfigById(message.cli, message.configId);
        if (applyResult === "superseded") {
          return;
        }
        if (deps.waitForConfigApply) {
          await deps.waitForConfigApply(message.cli);
        }
        deps.postWebviewMessage({
          type: "configApplyApplied",
          cli: message.cli,
          configId: message.configId,
        });
        await deps.postPanelState();
        deps.getConfigManagerPanel()?.syncActiveConfig();
      } catch (error) {
        const detail = buildErrorDetail(error);
        deps.postWebviewMessage({
          type: "configApplyError",
          error: detail,
          cli: message.cli,
          configId: message.configId,
        });
        deps.showWebviewError(
          t("config.applyFailedTitle"),
          error,
          { detailTitle: t("config.applyFailedTitle") }
        );
        if (deps.waitForConfigApply) {
          await deps.waitForConfigApply(message.cli);
        }
        await deps.postPanelState();
        deps.getConfigManagerPanel()?.syncActiveConfig();
      }
    },
  };
}

export type SessionPanelMessage = Extract<
  PanelMessage,
  | { type: "selectCli" }
  | { type: "selectCliModel" }
  | { type: "selectCliLoopModel" }
  | { type: "updateOpenCodeRoleModel" }
  | { type: "addCliModel" }
  | { type: "renameCliModel" }
  | { type: "deleteCliModel" }
  | { type: "moveCliModel" }
  | { type: "selectSession" }
  | { type: "selectConversationTab" }
  | { type: "closeConversationTab" }
  | { type: "deleteSession" }
  | { type: "loadHistorySessionMessages" }
  | { type: "exportHistorySessionMessages" }
  | { type: "clearAllSessions" }
  | { type: "clearPromptHistory" }
  | { type: "togglePromptHistoryFavorite" }
  | { type: "newSession" }
  | { type: "queryCodexLongConnectionCount" }
  | { type: "resetConversationTabSession" }
  | { type: "openConfig" }
  | { type: "applyConfig" }
>;
