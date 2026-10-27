import {
  buildKimiChildEnv,
  KIMI_FOREIGN_CREDENTIAL_ENV_KEYS,
} from "../interactive/kimiAppServerProtocol";
import { getKimiAgentArgs } from "../cli/config";
import {
  isKimiCodeBypassPermissionMode,
  parseKimiCodeConfigModels,
  readKimiCodeConfigText,
} from "../config/kimiCodeConfig";

export type KimiInteractiveLaunch = {
  agentArgs: string[];
  env: NodeJS.ProcessEnv;
  /** ACP `mode` value: default | plan | auto | yolo. */
  modeId: string;
  modelAlias: string | null;
  thinkingValue: string | null;
};

/**
 * Kimi Code reads provider credentials from `~/.kimi-code/config.toml`
 * (`api_key`, provider `env` table, or `api_key_env`), so this launch layer
 * never supplies a key. It only strips credentials belonging to other CLIs so
 * that Kimi Code cannot pick them up by accident.
 */
export async function prepareKimiInteractiveLaunch(input: {
  parentEnv?: NodeJS.ProcessEnv;
  interactiveMode: "coding" | "plan" | "loop" | "graph" | "loop_plus";
  selectedModel: string | null;
  thinkingMode: string;
}): Promise<KimiInteractiveLaunch> {
  const parentEnv = input.parentEnv ?? process.env;
  const env = buildKimiChildEnv(undefined, parentEnv);
  for (const key of KIMI_FOREIGN_CREDENTIAL_ENV_KEYS) {
    delete env[key];
  }
  const configText = await readKimiCodeConfigText(parentEnv);
  const config = parseKimiCodeConfigModels(configText);
  const modelAlias = input.selectedModel?.trim() || config.defaultModel;
  return {
    agentArgs: getKimiAgentArgs(),
    env,
    modeId: resolveKimiAcpMode(input.interactiveMode, config.permissionMode),
    modelAlias: modelAlias && modelAlias.length > 0 ? modelAlias : null,
    thinkingValue: resolveKimiThinkingValue(input.thinkingMode, config.thinkingEffort),
  };
}

/**
 * Plan mode is a real read-only ACP mode, so it must not be turned into an
 * approval bypass. Every other interactive mode follows the same
 * approvals-bypassed precedent as Codex / Claude / Grok.
 */
export function resolveKimiAcpMode(
  interactiveMode: string,
  permissionMode: string | null = null,
): string {
  if (interactiveMode === "plan") {
    return "plan";
  }
  if (permissionMode === "auto" || isKimiCodeBypassPermissionMode(permissionMode)) {
    return permissionMode === "auto" ? "auto" : "yolo";
  }
  return "yolo";
}

/**
 * The extension's thinking mode is only a request: the ACP session publishes
 * the legal values for the configured model, and the runner refuses values that
 * were not advertised. `off` is not a Kimi effort, so it is not forwarded.
 */
export function resolveKimiThinkingValue(
  thinkingMode: string,
  configuredEffort: string | null = null,
): string | null {
  const requested = String(thinkingMode ?? "").trim();
  if (!requested || requested === "off" || requested === "on" || requested === "ultra") {
    return configuredEffort && configuredEffort !== "off" ? configuredEffort : null;
  }
  return requested;
}

export function assertKimiLaunchHasNoCredential(
  launch: Pick<KimiInteractiveLaunch, "agentArgs" | "env">,
  parentEnv: NodeJS.ProcessEnv,
): void {
  for (const foreign of KIMI_FOREIGN_CREDENTIAL_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(launch.env, foreign)) {
      throw new Error(`Kimi Code child env must not include ${foreign}.`);
    }
  }
  const serialized = launch.agentArgs.join("\n");
  for (const [key, value] of Object.entries(parentEnv)) {
    if (typeof value !== "string" || value.length < 8) {
      continue;
    }
    if (!/(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/i.test(key)) {
      continue;
    }
    if (serialized.includes(value)) {
      throw new Error(`Kimi Code launch args must not contain the value of ${key}.`);
    }
  }
}
