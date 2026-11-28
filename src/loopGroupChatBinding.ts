import { CLI_LIST, type CliName } from "./cli/types";

export const LOOP_GROUP_CHAT_VIEW_TYPE = "sinitek-cli-tools.loopGroupChatChat";

export type LoopGroupChatBinding = {
  taskId: string;
  workspaceKey: string;
  cli: CliName;
  sessionId: string | null;
};

export function readLoopGroupChatBinding(state: unknown, workspaceKey: string): LoopGroupChatBinding | null {
  if (!state || typeof state !== "object" || !("loopGroupChat" in state)) return null;
  const binding = state.loopGroupChat as Partial<LoopGroupChatBinding> | null;
  if (!binding || binding.workspaceKey !== workspaceKey || !workspaceKey
    || !binding.cli || !CLI_LIST.includes(binding.cli)
    || !isStoreKey(binding.taskId) || !(binding.sessionId === null || isStoreKey(binding.sessionId))) return null;
  return { taskId: binding.taskId, workspaceKey, cli: binding.cli, sessionId: binding.sessionId };
}

function isStoreKey(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value === value.trim() && value !== "." && value !== "..";
}
