import type { LoopSubtaskSession } from "../loopSubtaskSession";

/** One invocation owns this read-only validator and its fixed transcript key.
 * The task's executionSession and Owner binding already persist the native
 * identity; ordinary interactive metadata has no OpenCode mapping. */
export function createDepartmentLeaderNativeSessionValidator(deps: {
  localSessionId: string | null | undefined;
  configId: string | null;
  readExecutionSession(): LoopSubtaskSession | null | undefined;
}): (sessionId: string) => void {
  const { localSessionId, configId } = deps;
  let observedSessionId: string | undefined;
  return (sessionId) => {
    const saved = deps.readExecutionSession();
    if (!saved || saved.cli !== "opencode" || saved.sessionId !== sessionId || saved.configId !== configId
      || (observedSessionId !== undefined && observedSessionId !== sessionId)) {
      throw new Error("部门组长原生会话输出与持久绑定冲突。");
    }
    if (!localSessionId) throw new Error("部门组长缺少固定本地会话。");
    observedSessionId = sessionId;
  };
}
