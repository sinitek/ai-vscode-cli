import { createDiagnosticsPanelMessageHandlers } from "./diagnostics";
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
  const specialHandlers: PanelMessageHandlerRegistry = {};
  const updateOpenCodeVariant = deps.updateOpenCodeVariant;
  if (updateOpenCodeVariant) {
    specialHandlers.updateOpenCodeVariant = (message) => handleUpdateOpenCodeVariantMessage(message, {
      updateOpenCodeVariant,
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
    {
      updateSetting: async (message) => {
        if (message.key) {
          await handleUpdateSettingMessage(message, deps);
        }
      },
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
