import { t } from "../i18n";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessageHandlerRegistry } from "../sessionMessageRouter";

type PromptPanelMessageDeps = Pick<
  PanelMessageHandlerDeps,
  | "isCliName"
  | "getActiveConversationTab"
  | "getCurrentCli"
  | "recordPromptHistory"
  | "postPanelState"
  | "schedulePromptTask"
  | "deleteScheduledTask"
  | "postWebviewMessage"
  | "appendUserMessageForCli"
  | "getCurrentSessionId"
  | "runContextCompactionCommand"
  | "openLoopGroupChatPanel"
  | "openGraphRunPanel"
  | "getActiveConversationTabId"
  | "stopRunForTab"
>;

export function createPromptPanelMessageHandlers(
  deps: PromptPanelMessageDeps
): PanelMessageHandlerRegistry {
  return {
    recordPromptHistory: async (message) => {
      if (typeof message.prompt !== "string") {
        return;
      }
      const prompt = message.prompt.trim();
      if (!prompt) {
        return;
      }
      const messageCli = typeof message.cli === "string" && deps.isCliName(message.cli)
        ? message.cli
        : null;
      const targetCli = messageCli ?? deps.getActiveConversationTab()?.cli ?? deps.getCurrentCli();
      deps.recordPromptHistory(prompt, targetCli);
      await deps.postPanelState();
    },

    scheduleTask: async (message) => {
      const result = deps.schedulePromptTask
        ? await deps.schedulePromptTask(message)
        : { error: t("scheduledTaskUnavailable") };
      deps.postWebviewMessage({
        type: "scheduledTaskSaved",
        ...(result.task ? { task: result.task } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
      await deps.postPanelState();
    },

    deleteScheduledTask: async (message) => {
      const id = typeof message.id === "string" ? message.id.trim() : "";
      if (!id || !deps.deleteScheduledTask?.(id)) {
        return;
      }
      await deps.postPanelState();
    },

    runCommonCommand: async (message) => {
      if (message.command !== "compactContext") {
        return;
      }
      const label = t("common.compactContext");
      deps.appendUserMessageForCli(
        deps.getCurrentCli(),
        deps.getCurrentSessionId(deps.getCurrentCli()),
        t("common.commonCommandPrefix", { label }),
        { merge: false }
      );
      await deps.runContextCompactionCommand();
    },

    openLoopGroupChat: async (message) => {
      await deps.openLoopGroupChatPanel({
        taskId: typeof message.taskId === "string" ? message.taskId : undefined,
        roundKey: typeof message.roundKey === "string" ? message.roundKey : undefined,
      });
    },

    openGraphRun: async (message) => {
      await deps.openGraphRunPanel({
        graphRunId: typeof message.graphRunId === "string" ? message.graphRunId : undefined,
        nodeId: typeof message.nodeId === "string" ? message.nodeId : undefined,
      });
    },

    stopRun: () => {
      deps.stopRunForTab(deps.getActiveConversationTabId());
    },
  };
}
