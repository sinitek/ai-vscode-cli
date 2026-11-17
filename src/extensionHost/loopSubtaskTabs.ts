import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";

type LoopSubtaskTabContext = {
  taskId: string;
  subtaskId: string;
  attemptId?: string;
};

export function findRunningLoopSubtaskConversationTabId(
  context: LoopSubtaskTabContext,
  deps: {
    getTabs: () => readonly ConversationTabRecord[];
    resolveContext: (tab: ConversationTabRecord) => LoopSubtaskTabContext | null;
    isTabRunActive: (tabId: string) => boolean;
  },
): string | null {
  const tabs = deps.getTabs();
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    const tab = tabs[index];
    if (!deps.isTabRunActive(tab.id)) continue;
    const candidate = deps.resolveContext(tab);
    if (candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId
      && (context.attemptId === undefined || candidate.attemptId === context.attemptId)) {
      return tab.id;
    }
  }
  return null;
}

export function prepareLoopSubtaskConversationTabClose(
  context: LoopSubtaskTabContext & { tabId?: string | null },
  deps: {
    getTabs: () => readonly ConversationTabRecord[];
    resolveContext: (tab: ConversationTabRecord) => LoopSubtaskTabContext | null;
    isTabRunActive: (tabId: string) => boolean;
    closeTab: (tabId: string) => Promise<void>;
  },
): () => Promise<void> {
  const tabs = [...deps.getTabs()];
  const currentIndex = context.tabId ? tabs.findIndex((tab) => tab.id === context.tabId) : tabs.length - 1;
  const candidates = tabs.slice(0, currentIndex + 1).filter((tab) => {
    if (tab.id === context.tabId) {
      const candidate = deps.resolveContext(tab);
      return context.attemptId === undefined || candidate?.attemptId === context.attemptId;
    }
    const candidate = deps.resolveContext(tab);
    return candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId
      && (context.attemptId === undefined || candidate.attemptId === context.attemptId);
  }).map((tab) => ({ tab, cli: tab.cli, sessionId: getConversationTabSessionIdForCli(tab, tab.cli) }));
  return async () => {
    const failures: Array<{ tabId: string; error: unknown }> = [];
    for (const { tab, cli, sessionId } of candidates) {
      const current = deps.getTabs().find((item) => item.id === tab.id);
      if (!current) continue;
      const candidate = deps.resolveContext(current);
      if (current !== tab || current.cli !== cli || getConversationTabSessionIdForCli(current, cli) !== sessionId
        || (candidate && (candidate.taskId !== context.taskId || candidate.subtaskId !== context.subtaskId
          || (context.attemptId !== undefined && candidate.attemptId !== context.attemptId)))
        || (context.attemptId !== undefined && candidate?.attemptId !== context.attemptId)) {
        continue;
      }
      if (deps.isTabRunActive(tab.id)) {
        if (tab.id === context.tabId) {
          failures.push({ tabId: tab.id, error: new Error("子任务标签仍在运行，尚未自动关闭。") });
        }
        continue;
      }
      try {
        await deps.closeTab(tab.id);
        if (deps.getTabs().some((item) => item === tab)) {
          throw new Error("子任务标签关闭未生效，保留标签以便重试。");
        }
      } catch (error) {
        // A stale tab or its panel refresh must not strand the completed tab.
        failures.push({ tabId: tab.id, error });
      }
    }
    if (failures.length > 0) {
      throw new Error(failures.map(({ tabId, error }) => `${tabId}: ${error instanceof Error ? error.message : String(error)}`).join("\n"));
    }
  };
}

export async function closeLoopSubtaskConversationTabs(
  context: Parameters<typeof prepareLoopSubtaskConversationTabClose>[0],
  deps: Parameters<typeof prepareLoopSubtaskConversationTabClose>[1],
): Promise<void> {
  await prepareLoopSubtaskConversationTabClose(context, deps)();
}
