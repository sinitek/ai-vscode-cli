import type { ConfigAction, ConfigRequestMessage, ConfigResponseMessage } from "./configProtocol";

export type ConfigRequestHandlers = {
  [Action in ConfigAction]: (
    request: Extract<ConfigRequestMessage, { action: Action }>,
    response: ConfigResponseMessage,
  ) => void | Promise<void>;
};

export async function routeConfigRequest(
  handlers: ConfigRequestHandlers,
  request: ConfigRequestMessage,
  response: ConfigResponseMessage,
): Promise<boolean> {
  const action: unknown = request.action;
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(handlers, action)) {
    return false;
  }
  const handler = handlers[action as ConfigAction] as (
    request: ConfigRequestMessage,
    response: ConfigResponseMessage,
  ) => void | Promise<void>;
  await handler(request, response);
  return true;
}
