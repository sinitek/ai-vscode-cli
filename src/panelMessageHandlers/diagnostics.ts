import { buildErrorDetail } from "../errorDisplay";
import { t } from "../i18n";
import { logDebug, logError } from "../logger";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessageHandlerRegistry } from "../sessionMessageRouter";

type DiagnosticsPanelMessageDeps = Pick<
  PanelMessageHandlerDeps,
  | "postPanelState"
  | "sendSessionMessagesToPanel"
  | "getCurrentCli"
  | "getCurrentSessionId"
  | "showWebviewError"
  | "inspectModelManagerState"
  | "postWebviewMessage"
  | "reconcileRunningConversationTabs"
>;

export function createDiagnosticsPanelMessageHandlers(
  deps: DiagnosticsPanelMessageDeps
): PanelMessageHandlerRegistry {
  return {
    requestState: async () => {
      await deps.postPanelState();
      deps.sendSessionMessagesToPanel(
        deps.getCurrentCli(),
        deps.getCurrentSessionId(deps.getCurrentCli())
      );
    },

    reconcileRunningConversationTabs: () => {
      deps.reconcileRunningConversationTabs?.();
    },

    webviewError: (message) => {
      void logError("webview-runtime-error", {
        message: message.message,
        source: message.source ?? null,
        line: message.lineno ?? null,
        column: message.colno ?? null,
        reason: message.reason ?? null,
        stack: message.stack ?? null,
      });
      const detail = [
        message.message,
        message.reason ? `reason: ${message.reason}` : "",
        message.source ? `source: ${message.source}` : "",
        typeof message.lineno === "number" ? `line: ${message.lineno}` : "",
        typeof message.colno === "number" ? `column: ${message.colno}` : "",
        message.stack ?? "",
      ].filter(Boolean).join("\n");
      void deps.showWebviewError(t("panel.runtimeError"), detail || message.message);
    },

    webviewDebug: (message) => {
      void logDebug("webview-debug", {
        event: message.event,
        payload: message.payload ?? null,
      });
    },

    inspectModelManager: async (message) => {
      await deps.inspectModelManagerState(message);
    },

    sessionLoadError: (message) => {
      void logError("webview-session-load-error", {
        title: message.title,
        detail: message.detail,
        tabId: message.tabId ?? null,
        sessionId: message.sessionId ?? null,
        cli: message.cli ?? null,
      });
      void deps.showWebviewError(message.title, message.detail);
    },
  };
}
