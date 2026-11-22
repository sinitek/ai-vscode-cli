import { createDiagnosticsPanelMessageHandlers } from "./diagnostics";
import { createLoopPlusAcceptancePlanPanelMessageHandlers } from "./loopPlusAcceptancePlan";
import { createPromptPanelMessageHandlers } from "./prompt";
import { createSessionPanelMessageHandlers } from "./session";
import { createWorkspacePanelMessageHandlers } from "./workspace";
import {
  handleSendPromptMessage,
  handleUpdateOpenCodeVariantMessage,
  handleUpdateSettingMessage,
} from "../sessionMessageActions";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import {
  mergePanelMessageHandlerRegistries,
  type PanelMessageHandlerRegistry,
} from "../sessionMessageRouter";

export function createPanelMessageHandlerRegistry(
  deps: PanelMessageHandlerDeps
): PanelMessageHandlerRegistry {
  let settingsQueue = Promise.resolve();
  const enqueueSettingsAction = (action: () => Promise<void>): Promise<void> => {
    const result = settingsQueue.then(action, action);
    settingsQueue = result.catch(() => undefined);
    return result;
  };
  const specialHandlers: PanelMessageHandlerRegistry = {};
  const updateOpenCodeVariant = deps.updateOpenCodeVariant;
  if (updateOpenCodeVariant) {
    specialHandlers.updateOpenCodeVariant = (message) => handleUpdateOpenCodeVariantMessage(message, {
      updateOpenCodeVariant,
      updateOpenCodeVariantForConfig: deps.updateOpenCodeVariantForConfig,
      postPanelState: deps.postPanelState,
    });
  }
  if (deps.resolveHumanInteractionResponse) {
    specialHandlers.humanInteractionResponse = (message) => {
      deps.resolveHumanInteractionResponse?.(message);
    };
  }
  const registries: PanelMessageHandlerRegistry[] = [
    createDiagnosticsPanelMessageHandlers(deps),
    createSessionPanelMessageHandlers(deps),
    createPromptPanelMessageHandlers(deps),
    createLoopPlusAcceptancePlanPanelMessageHandlers(deps),
    {
      refreshToolSettings: () => enqueueSettingsAction(async () => {
        deps.reloadStoredToolSettings();
        deps.reloadWorkspaceSettings?.();
        await deps.postPanelState();
      }),
      updateSetting: (message) => enqueueSettingsAction(async () => {
        if (message.key) {
          await handleUpdateSettingMessage(message, deps);
        }
      }),
      sendPrompt: async (message) => {
        if (typeof message.prompt === "string") {
          await handleSendPromptMessage(message, deps);
        }
      },
    },
    specialHandlers,
    createWorkspacePanelMessageHandlers(deps),
  ];
  return mergePanelMessageHandlerRegistries(...registries);
}
