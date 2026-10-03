import type { PanelMessage } from "./webview/types";

export type PanelMessageHandler<TType extends PanelMessage["type"] = PanelMessage["type"]> = (
  message: Extract<PanelMessage, { type: TType }>
) => Promise<void> | void;

export type PanelMessageHandlerRegistry = {
  [TType in PanelMessage["type"]]?: PanelMessageHandler<TType>;
};

export type PanelMessageRouter = {
  dispatch: (message: PanelMessage) => Promise<boolean>;
};

export function createPanelMessageRouter(
  handlers: PanelMessageHandlerRegistry
): PanelMessageRouter {
  return {
    async dispatch(message) {
      const handler = handlers[message.type] as PanelMessageHandler | undefined;
      if (!handler) {
        return false;
      }
      await handler(message as never);
      return true;
    },
  };
}

export function mergePanelMessageHandlerRegistries(
  ...registries: PanelMessageHandlerRegistry[]
): PanelMessageHandlerRegistry {
  return Object.assign({}, ...registries);
}

export function isPanelMessageType<TType extends PanelMessage["type"]>(
  message: PanelMessage,
  type: TType
): message is Extract<PanelMessage, { type: TType }> {
  return message.type === type;
}
