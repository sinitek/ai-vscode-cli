import { PanelMessage } from "./webview/types";

export function isPanelMessageType<TType extends PanelMessage["type"]>(
  message: PanelMessage,
  type: TType
): message is Extract<PanelMessage, { type: TType }> {
  return message.type === type;
}
