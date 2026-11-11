import type { ConversationTabRecord } from "../sessionTabs";

type LoopSubtaskTabContext = {
  taskId: string;
  subtaskId: string;
};

export async function closeLoopSubtaskConversationTabs(
  context: LoopSubtaskTabContext & { tabId?: string | null },
  deps: {
    getTabs: () => readonly ConversationTabRecord[];
    resolveContext: (tab: ConversationTabRecord) => LoopSubtaskTabContext | null;
    isTabRunActive: (tabId: string) => boolean;
    closeTab: (tabId: string) => Promise<void>;
  },
): Promise<void> {
  const tabs = deps.getTabs();
  const currentIndex = context.tabId ? tabs.findIndex((tab) => tab.id === context.tabId) : tabs.length - 1;
  const tabIds = tabs.slice(0, currentIndex + 1).filter((tab) => {
    if (tab.id === context.tabId) {
      return true;
    }
    const candidate = deps.resolveContext(tab);
    return candidate?.taskId === context.taskId && candidate.subtaskId === context.subtaskId;
  }).map((tab) => tab.id);
  for (const tabId of tabIds) {
    if (!deps.isTabRunActive(tabId)) {
      await deps.closeTab(tabId);
    }
  }
}
