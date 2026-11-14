import type { PromptRunTarget } from "../promptRunTypes";
import { getConversationTabSessionIdForCli, type ConversationTabRecord } from "../sessionTabs";

type SessionRunOwner = Pick<PromptRunTarget, "tabId" | "cli" | "sessionId">;

export type SessionTabOwnershipDeps = {
  getWorkspaceKey: () => string;
  getTabs: () => readonly ConversationTabRecord[];
  getActiveRuns: () => readonly SessionRunOwner[];
  stopTab: (tabId: string) => void;
  isTabRunActive: (tabId: string) => boolean;
  closeTab: (tabId: string) => Promise<void>;
};

/** Transfer a session's UI ownership before acquiring its CLI runner. */
export async function takeOverSessionTab(
  target: PromptRunTarget,
  deps: SessionTabOwnershipDeps,
  isAborted: () => boolean = () => false,
): Promise<boolean> {
  const workspaceKey = deps.getWorkspaceKey();
  const tab = deps.getTabs().find((item) => item.id === target.tabId);
  if (!tab || tab.cli !== target.cli) {
    return false;
  }
  const binding = getConversationTabSessionIdForCli(tab, target.cli);
  const isCurrent = (): boolean => !isAborted()
    && workspaceKey === deps.getWorkspaceKey()
    && deps.getTabs().find((item) => item.id === target.tabId) === tab
    && tab.cli === target.cli
    && getConversationTabSessionIdForCli(tab, target.cli) === binding;
  if (!isCurrent()) {
    return false;
  }
  if (!target.sessionId) {
    return true;
  }

  // Include actual run bindings: a tab's persisted session may lag its runner.
  const owners = new Set([
    ...deps.getTabs()
      .filter((item) => item.cli === target.cli
        && getConversationTabSessionIdForCli(item, target.cli) === target.sessionId)
      .map((item) => item.id),
    ...deps.getActiveRuns()
      .filter((run) => run.cli === target.cli && run.sessionId === target.sessionId)
      .map((run) => run.tabId),
  ]);
  owners.delete(target.tabId);
  for (const tabId of owners) {
    if (!isCurrent()) {
      return false;
    }
    deps.stopTab(tabId);
    if (deps.isTabRunActive(tabId)) {
      throw Object.assign(new Error("原会话任务尚未停止，无法接管会话，请稍后重试。"), { code: "SESSION_RUN_ACTIVE" });
    }
    await deps.closeTab(tabId);
    if (!isCurrent()) {
      return false;
    }
    if (deps.getTabs().some((item) => item.id === tabId)) {
      throw Object.assign(new Error("原会话标签尚未关闭，无法接管会话，请稍后重试。"), { code: "SESSION_RUN_ACTIVE" });
    }
  }
  return isCurrent();
}
