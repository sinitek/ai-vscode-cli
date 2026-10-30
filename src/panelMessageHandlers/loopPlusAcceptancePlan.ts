import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessageHandlerRegistry } from "../sessionMessageRouter";
import {
  deleteLoopPlusAcceptancePlan,
  saveLoopPlusAcceptancePlan,
  selectLoopPlusAcceptancePlan,
  type LoopPlusAcceptancePlanMutationResult,
} from "../extensionHost/loopPlusAcceptancePlanHost";
import type { LoopPlusAcceptancePlan } from "../loopPlusAcceptancePlan";
import type { WorkspaceSettings } from "../workspaceSettingsStore";

type AcceptancePlanPanelMessageDeps = Pick<
  PanelMessageHandlerDeps,
  | "getWorkspaceSettings"
  | "setWorkspaceSettings"
  | "saveWorkspaceSettingsWithResult"
  | "postWebviewMessage"
  | "postPanelState"
>;

function toPanelSummary(plan: LoopPlusAcceptancePlan): LoopPlusAcceptancePlan {
  return plan;
}

function postSaveResult(
  deps: AcceptancePlanPanelMessageDeps,
  result: LoopPlusAcceptancePlanMutationResult,
): void {
  if (result.ok) {
    deps.postWebviewMessage({
      type: "loopPlusAcceptancePlanSaved",
      plan: toPanelSummary(result.plan),
      plans: result.plans.map(toPanelSummary),
      selection: result.selection,
    });
    return;
  }
  deps.postWebviewMessage({
    type: "loopPlusAcceptancePlanSaved",
    error: result.error,
  });
}

export function createLoopPlusAcceptancePlanPanelMessageHandlers(
  deps: AcceptancePlanPanelMessageDeps,
): PanelMessageHandlerRegistry {
  const host = {
    getWorkspaceSettings: (): WorkspaceSettings => deps.getWorkspaceSettings(),
    setWorkspaceSettings: (settings: WorkspaceSettings): void => {
      deps.setWorkspaceSettings?.(settings);
    },
    saveWorkspaceSettings: (settings: WorkspaceSettings) => {
      if (typeof deps.saveWorkspaceSettingsWithResult === "function") {
        const result = deps.saveWorkspaceSettingsWithResult(settings);
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }
      // 未注入带结果的保存实现时，退回静默保存语义，避免误报成功。
      return { ok: false, error: "验收方案保存失败，请稍后重试。" };
    },
  };
  return {
    saveLoopPlusAcceptancePlan: async (message) => {
      if (message.type !== "saveLoopPlusAcceptancePlan") {
        return;
      }
      const result = saveLoopPlusAcceptancePlan(host, {
        planId: message.planId ?? null,
        name: message.name,
        checks: message.checks,
        otherText: message.otherText,
        select: message.select,
      });
      postSaveResult(deps, result);
      if (result.ok) {
        await deps.postPanelState();
      }
    },

    deleteLoopPlusAcceptancePlan: async (message) => {
      if (message.type !== "deleteLoopPlusAcceptancePlan") {
        return;
      }
      const result = deleteLoopPlusAcceptancePlan(host, message.planId);
      postSaveResult(deps, result);
      if (result.ok) {
        await deps.postPanelState();
      }
    },

    selectLoopPlusAcceptancePlan: async (message) => {
      if (message.type !== "selectLoopPlusAcceptancePlan") {
        return;
      }
      const result = selectLoopPlusAcceptancePlan(host, message.planId);
      if (!result.ok) {
        deps.postWebviewMessage({
          type: "loopPlusAcceptancePlanSelected",
          error: result.error,
        });
        return;
      }
      deps.postWebviewMessage({
        type: "loopPlusAcceptancePlanSelected",
        selection: result.selection,
      });
      await deps.postPanelState();
    },
  };
}
