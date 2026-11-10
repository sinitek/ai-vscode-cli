import type { ContextCompactionRunDeps } from "../contextCompactionRunner";
import type { CliName } from "../cli/types";
import type { ChatMessage } from "../webview/types";
import { appendMessageToStore } from "../promptRunState";
import { createPrimaryPromptRunController } from "./primaryPromptRunController";

export function createIsolatedContextCompactionDeps(
  base: ContextCompactionRunDeps,
  ports: {
    saveMessages: (cli: CliName, sessionId: string, messages: ChatMessage[]) => void;
    publishMessage: (message: ChatMessage, tabId: string | null) => void;
    publishPanelMessage: (message: Record<string, unknown>) => void;
    sendRunStatus: (tabId: string | null, ...args: Parameters<ContextCompactionRunDeps["sendRunStatus"]>) => void;
  },
): ContextCompactionRunDeps {
  const controller = createPrimaryPromptRunController();
  const appendMessage = (role: ChatMessage["role"], content: string): void => {
    if (!controller.activeMessageTarget || !content.trim()) {
      return;
    }
    const message: ChatMessage = { id: base.createMessageId(), role, content, createdAt: Date.now() };
    appendMessageToStore(controller.activeMessageTarget, message);
    ports.publishMessage(message, controller.activeTabIdForRun);
  };
  return {
    ...base,
    hasActiveProcessOrInteractiveStop: () => Boolean(controller.activeProcess || controller.activeInteractiveStop),
    beginActiveRunState: (input) => controller.begin(input),
    getActiveRunId: () => controller.activeRunId,
    setActiveInteractiveStop: (stop) => { controller.activeInteractiveStop = stop; },
    isActiveInteractiveStop: (stop) => controller.activeInteractiveStop === stop,
    appendStopMessageToStore: () => undefined,
    killActiveProcess: () => { controller.activeProcess?.kill(); },
    sendRunStatus: (...args) => ports.sendRunStatus(controller.activeTabIdForRun, ...args),
    appendCompletionMessage: () => undefined,
    persistActiveMessages: () => {
      if (controller.activeCliForRun && controller.activeSessionId && controller.activeMessageTarget) {
        ports.saveMessages(controller.activeCliForRun, controller.activeSessionId, controller.activeMessageTarget);
      }
    },
    clearActiveRun: () => controller.clear(),
    appendSystemMessage: (content) => appendMessage("system", content),
    sendRawStreamDelta: () => undefined,
    sendPanelMessage: (message) => ports.publishPanelMessage({
      ...message,
      tabId: ("tabId" in message ? message.tabId : undefined) ?? controller.activeTabIdForRun ?? undefined,
    }),
    updateProcessTitle: () => undefined,
    appendTraceMessage: (content) => appendMessage("trace", content),
    setActiveProcess: (process) => { controller.activeProcess = process; },
    appendAssistantChunk: (content) => appendMessage("assistant", content),
    adoptSessionId: (_cli, sessionId) => {
      if (sessionId !== controller.activeSessionId) {
        throw new Error("后台压缩返回了不同的会话，保留原子任务会话记录。");
      }
    },
  };
}
