import { getZcodeAgentArgs } from "../cli/config";
import { buildZcodeChildEnv, ZCODE_APPROVAL_MODE, ZCODE_PLAN_MODE } from "../interactive/zcodeAppServerProtocol";
import { resolveZcodeModelWireForRun, readZcodeProviderConfigText } from "../config/zcodeConfig";

export type ZcodeInteractiveLaunch = {
  agentArgs: string[];
  env: NodeJS.ProcessEnv;
  modeId: string;
  modelRef: string | null;
  thinkingValue: string | null;
};

export async function prepareZcodeInteractiveLaunch(input: {
  parentEnv?: NodeJS.ProcessEnv;
  interactiveMode: string;
  selectedModel: string | null;
  thinkingMode: string;
}): Promise<ZcodeInteractiveLaunch> {
  const parentEnv = input.parentEnv ?? process.env;
  const configText = await readZcodeProviderConfigText(undefined, parentEnv);
  const selectedModel = input.selectedModel?.trim() || null;
  const modelRef = selectedModel?.includes("$")
    ? selectedModel
    : resolveZcodeModelWireForRun(configText, selectedModel);
  return {
    agentArgs: getZcodeAgentArgs(),
    env: buildZcodeChildEnv(parentEnv),
    modeId: input.interactiveMode === "plan" ? ZCODE_PLAN_MODE : ZCODE_APPROVAL_MODE,
    modelRef: modelRef && modelRef.length > 0 ? modelRef : null,
    thinkingValue: resolveZcodeThinkingRequest(input.thinkingMode),
  };
}

/**
 * ZCode only accepts thought levels the current model advertises. `ultra` is
 * not rewritten to `max`. `off` and `on` are not ZCode thought levels.
 */
export function resolveZcodeThinkingRequest(thinkingMode: string): string | null {
  const requested = thinkingMode.trim();
  if (!requested || requested === "off" || requested === "on" || requested === "ultra") {
    return null;
  }
  return requested;
}
