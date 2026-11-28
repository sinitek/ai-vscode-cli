import { setTimeout as delay } from "timers/promises";
import type { LoopTaskRecord, LoopTaskStoreReadOptions } from "../loopTaskStore";
import type { PromptRunInput } from "../promptRunTypes";
import { loopPlusMainFailure } from "../loopMainFailure";

type ReadTask = (taskId: string, options?: LoopTaskStoreReadOptions) => LoopTaskRecord | null;
type MainAdmission = NonNullable<PromptRunInput["loopPlusMainAdmission"]> & { hasOpened: () => boolean };

class IdentityLockPresent extends Error {}

function readParent(readTask: ReadTask, taskId: string): LoopTaskRecord {
  let busy = false;
  const task = readTask(taskId, { onUnavailable: (reason) => { busy = reason === "identity-lock-present"; } });
  if (task?.id === taskId) return task;
  if (busy) throw new IdentityLockPresent();
  throw loopPlusMainFailure("LOOP_PLUS_PARENT_UNAVAILABLE");
}

/** Shared with employee admission so a transient identity lock does not allocate a second backoff budget. */
export const loopPlusIdentityRetryDelaysMs = [50, 100, 200, 400, 800, 1600, 2400, 2400, 2400];

export function sameLoopPlusMainParent(original: LoopTaskRecord, current: LoopTaskRecord): boolean {
  return original.id === current.id && original.taskStoreFile === current.taskStoreFile
    && original.workspaceKey === current.workspaceKey && original.cli === current.cli
    && (!original.sessionId || original.sessionId === current.sessionId)
    && original.schedulingMode === current.schedulingMode && original.departmentInvalid === current.departmentInvalid
    && JSON.stringify(original.department) === JSON.stringify(current.department);
}

export async function withLoopPlusMainAdmission(
  taskId: string,
  readTask: ReadTask,
  signal: AbortSignal,
  invoke: (parent: LoopTaskRecord, admission: MainAdmission) => Promise<string | null>,
): Promise<string | null> {
  let original: LoopTaskRecord | undefined;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let opened = false;
    let refusal: unknown;
    try {
      const parent = readParent(readTask, taskId);
      if (original && !sameLoopPlusMainParent(original, parent)) throw loopPlusMainFailure("LOOP_PLUS_PARENT_UNAVAILABLE");
      original = parent;
      const isParentInactive = () => {
        if (signal.aborted || refusal) return true;
        try {
          const current = readParent(readTask, taskId);
          if (!sameLoopPlusMainParent(parent, current) || current.status !== "running") throw loopPlusMainFailure("LOOP_PLUS_PARENT_UNAVAILABLE");
          return false;
        } catch (error) {
          refusal = error;
          return true;
        }
      };
      const result = await invoke(parent, {
        isParentInactive,
        hasOpened: () => opened,
        onRunOpened: () => {
          signal.throwIfAborted();
          if (isParentInactive()) throw refusal;
          opened = true;
        },
      });
      if (refusal) throw refusal;
      return result;
    } catch (error) {
      signal.throwIfAborted();
      const failure = refusal ?? error;
      if (!(failure instanceof IdentityLockPresent)) throw failure;
      if (opened) throw loopPlusMainFailure("LOOP_PLUS_RUN_UNCONFIRMED");
      if (attempt >= loopPlusIdentityRetryDelaysMs.length) throw loopPlusMainFailure("LOOP_PLUS_IDENTITY_BUSY");
      await delay(loopPlusIdentityRetryDelaysMs[attempt], undefined, { signal });
    }
  }
}
