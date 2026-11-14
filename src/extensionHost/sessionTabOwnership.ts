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

  const ownsSession = (run: SessionRunOwner): boolean => run.cli === target.cli && run.sessionId === target.sessionId;
  // A live runner is authoritative when the stored binding has fallen behind.
  const getOwners = (): Set<string> => {
    const runs = deps.getActiveRuns();
    return new Set([
      ...deps.getTabs().filter((item) => item.cli === target.cli
        && getConversationTabSessionIdForCli(item, target.cli) === target.sessionId
        && !runs.some((run) => run.tabId === item.id && !ownsSession(run)))
        .map((item) => item.id),
      ...runs.filter(ownsSession).map((run) => run.tabId),
    ].filter((id) => id !== target.tabId));
  };
  const owners = [...getOwners()].map((tabId) => {
    const ownerTab = deps.getTabs().find((item) => item.id === tabId);
    return { tabId, tab: ownerTab, cli: ownerTab?.cli,
      sessionId: ownerTab ? getConversationTabSessionIdForCli(ownerTab, target.cli) : null };
  });
  for (const owner of owners) {
    if (!isCurrent()) {
      return false;
    }
    const { tabId } = owner;
    const currentTab = deps.getTabs().find((item) => item.id === tabId);
    // Earlier closes can await UI/configuration work. Do not act on a replaced
    // or rebound tab using the original list of duplicate IDs.
    const isOwnerTabCurrent = (): boolean => deps.getTabs().find((item) => item.id === tabId) === owner.tab
      && (!owner.tab || (owner.tab.cli === owner.cli
        && getConversationTabSessionIdForCli(owner.tab, target.cli) === owner.sessionId));
    if (!getOwners().has(tabId) || !isOwnerTabCurrent()) {
      continue;
    }
    if (currentTab && currentTab.cli !== target.cli) {
      throw Object.assign(new Error("原会话运行与标签 CLI 绑定不一致，无法安全接管。"), { code: "SESSION_RUN_ACTIVE" });
    }
    deps.stopTab(tabId);
    if (deps.isTabRunActive(tabId)) {
      throw Object.assign(new Error("原会话任务尚未停止，无法接管会话，请稍后重试。"), { code: "SESSION_RUN_ACTIVE" });
    }
    if (!isCurrent() || !isOwnerTabCurrent()) return false;
    await deps.closeTab(tabId);
    if (!isCurrent()) {
      return false;
    }
    if (deps.isTabRunActive(tabId) || deps.getTabs().some((item) => item.id === tabId)) {
      throw Object.assign(new Error("原会话标签尚未关闭，无法接管会话，请稍后重试。"), { code: "SESSION_RUN_ACTIVE" });
    }
  }
  if (isCurrent() && getOwners().size > 0) {
    throw Object.assign(new Error("会话所有者在接管期间发生变化，请稍后重试。"), { code: "SESSION_RUN_ACTIVE" });
  }
  return isCurrent();
}
