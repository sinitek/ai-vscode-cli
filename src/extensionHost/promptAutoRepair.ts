import { isCliCommandRepairableError } from "../cli/cliCommandRepair";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";

type PromptAutoRepairOptions = {
  execute: (input: PromptRunInput, target: PromptRunTarget) => Promise<void>;
  repairCommand: () => Promise<boolean>;
  startFreshSession: () => Promise<void>;
  isTargetCurrent: () => boolean;
  onRepairStarted: () => void;
  onRepairFailed: (error: unknown) => void;
};

export function createPromptAutoRepairController() {
  const runs = new Map<string, { repairing: boolean }>();

  return {
    cancel: (tabId: string): void => { runs.delete(tabId); },
    cancelAll: (): void => { runs.clear(); },
    isRepairing: (tabId: string): boolean => runs.get(tabId)?.repairing === true,
    hasRepairingRuns: (): boolean => Array.from(runs.values()).some((entry) => entry.repairing),
    async run(input: PromptRunInput, target: PromptRunTarget, options: PromptAutoRepairOptions): Promise<void> {
      const entry = { repairing: false };
      runs.set(target.tabId, entry);
      const isCurrent = (): boolean => runs.get(target.tabId) === entry && options.isTargetCurrent();
      try {
        try {
          await options.execute(input, target);
          return;
        } catch (error) {
          if (!isCurrent()) {
            return;
          }
          if (input.cliCommandRepairAttempted || !isCliCommandRepairableError(error)) {
            throw error;
          }
          entry.repairing = true;
          options.onRepairStarted();
          let repaired = false;
          try {
            repaired = await options.repairCommand();
          } catch (repairError) {
            options.onRepairFailed(repairError);
          }
          if (!isCurrent()) {
            return;
          }
          if (!repaired) {
            throw error;
          }
          await options.startFreshSession();
          if (!isCurrent()) {
            return;
          }
          entry.repairing = false;
          await options.execute({
            ...input,
            preloadedUserMessageId: undefined,
            cliCommandRepairAttempted: true,
          }, { ...target, sessionId: null });
        }
      } finally {
        if (runs.get(target.tabId) === entry) {
          runs.delete(target.tabId);
        }
      }
    },
  };
}
