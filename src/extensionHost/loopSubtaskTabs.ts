import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";

type LoopSubtaskTabContext = {
  taskId: string;
  subtaskId: string;
};

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
      return true;
    }
    const candidate = deps.resolveContext(tab);
    return candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId;
  }).map((tab) => ({ tab, cli: tab.cli, sessionId: getConversationTabSessionIdForCli(tab, tab.cli) }));
  return async () => {
    for (const { tab, cli, sessionId } of candidates) {
      const current = deps.getTabs().find((item) => item.id === tab.id);
      if (!current) continue;
      const candidate = deps.resolveContext(current);
      if (current !== tab || current.cli !== cli || getConversationTabSessionIdForCli(current, cli) !== sessionId
        || (candidate && (candidate.taskId !== context.taskId || candidate.subtaskId !== context.subtaskId))) {
        continue;
      }
      if (deps.isTabRunActive(tab.id)) {
        if (tab.id === context.tabId) throw new Error("子任务标签仍在运行，尚未自动关闭。");
        continue;
      }
      await deps.closeTab(tab.id);
      if (deps.getTabs().some((item) => item === tab)) {
        throw new Error("子任务标签关闭未生效，保留标签以便重试。");
      }
    }
  };
}

export async function closeLoopSubtaskConversationTabs(
  context: Parameters<typeof prepareLoopSubtaskConversationTabClose>[0],
  deps: Parameters<typeof prepareLoopSubtaskConversationTabClose>[1],
): Promise<void> {
  await prepareLoopSubtaskConversationTabClose(context, deps)();
}
