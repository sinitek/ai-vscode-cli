import type { CliName, ThinkingMode } from "../cli/types";
import type { LoopTaskRole } from "../promptRunState";
import type { PromptRunInput, ResolvedOpenCodeRoleModels } from "../promptRunTypes";
import * as configService from "../config/configService";
import { normalizeCliModelName } from "../modelSelectionStore";
import { parseCliName } from "../subtaskCliRoute";

export type PromptRunModelsHostDeps = {
  getActiveConfigIdForCli: (cli: CliName) => string | null;
  getSelectedCliModel: (cli: CliName, configId?: string | null) => string | null;
  getSelectedLoopCliModel: (cli: CliName, role: LoopTaskRole, configId?: string | null) => string | null;
  getSelectedLoopThinkingMode: (cli: CliName, role: LoopTaskRole, model?: string | null, configId?: string | null) => ThinkingMode | null;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  getEffectiveThinkingMode: (cli: CliName, model?: string | null) => ThinkingMode;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  resolveOpenCodeRoleModelsForConfig: (configId: string | null, configContent: string) => ResolvedOpenCodeRoleModels;
};

export function createPromptRunModelsHost(deps: PromptRunModelsHostDeps) {
  function normalizePromptRunModel(value: string | undefined): string | undefined {
    return normalizeCliModelName(value) ?? undefined;
  }

  function resolvePromptRunModelForRole(input: PromptRunInput, role: LoopTaskRole): string | undefined {
    const mainModel = normalizePromptRunModel(input.loopMainModel) ?? normalizePromptRunModel(input.model);
    const subtaskCli = parseCliName(input.loopSubtaskCli);
    const explicitSubtask = normalizePromptRunModel(input.loopSubtaskModel);
    const isolated = Boolean(subtaskCli);
    if (role === "subtask") {
      if (isolated) {
        return explicitSubtask;
      }
      return explicitSubtask ?? normalizePromptRunModel(input.model) ?? mainModel;
    }
    if (isolated && subtaskCli) {
      return mainModel;
    }
    return mainModel ?? explicitSubtask;
  }

  function resolvePromptRunThinkingModeForRole(
    input: PromptRunInput,
    cli: CliName,
    role: LoopTaskRole,
    model: string | undefined,
    options: { configId?: string | null } = {}
  ): ThinkingMode | undefined {
    const crossCli = Boolean(parseCliName(input.loopSubtaskCli));
    const roleModel = normalizePromptRunModel(model)
      ?? (role === "subtask" && crossCli
        ? normalizePromptRunModel(input.loopSubtaskModel)
          ?? deps.getSelectedLoopCliModel(cli, "subtask", options.configId)
          ?? undefined
        : resolvePromptRunModelForRole(input, role))
      ?? (crossCli ? undefined : deps.getSelectedCliModel(cli, options.configId) ?? undefined);
    const explicitThinkingMode = role === "subtask"
      ? input.loopSubtaskThinkingMode
      : input.loopMainThinkingMode;
    const usesLoopRoleThinking = cli === "codex" || cli === "grok" || cli === "dsh" || cli === "kimi-code" || cli === "zcode" || cli === "opencode"
      || (cli === "claude" && role === "subtask");
    const roleThinkingMode = usesLoopRoleThinking && deps.isThinkingMode(explicitThinkingMode)
      ? deps.normalizeThinkingModeForCli(cli, explicitThinkingMode)
      : usesLoopRoleThinking && cli !== "opencode"
        ? deps.getSelectedLoopThinkingMode(cli, role, roleModel, options.configId) ?? undefined
        : undefined;
    return roleThinkingMode
      ?? (cli !== "opencode" && !crossCli && role === "subtask"
        ? deps.getEffectiveThinkingMode(cli, roleModel ?? deps.getSelectedCliModel(cli))
        : undefined);
  }

  async function hydrateOpenCodePromptRoleModels(input: PromptRunInput, cli: CliName): Promise<PromptRunInput> {
    if (cli !== "opencode") {
      return input;
    }
    const configId = deps.getActiveConfigIdForCli("opencode");
    const activeConfig = configId
      ? await configService.getConfigById("opencode", configId)
      : null;
    const current = activeConfig ?? await configService.getCurrentConfig("opencode");
    const roles = deps.resolveOpenCodeRoleModelsForConfig(configId, current.content ?? "{}");
    const explicitMain = normalizePromptRunModel(input.loopMainModel);
    const explicitSubtask = normalizePromptRunModel(input.loopSubtaskModel);
    const explicitSingle = normalizePromptRunModel(input.model);
    const subtaskCli = parseCliName(input.loopSubtaskCli);
    const subtaskIsOtherCli = Boolean(subtaskCli && subtaskCli !== "opencode");
    const executingCrossCliSubtask = input.taskRole === "subtask" && subtaskCli === "opencode";
    const loopMainModel = executingCrossCliSubtask
      ? undefined
      : explicitMain ?? explicitSingle ?? roles.main ?? undefined;
    const loopSubtaskModel = subtaskIsOtherCli
      ? explicitSubtask
      : explicitSubtask ?? roles.subtask ?? (executingCrossCliSubtask ? undefined : explicitSingle ?? loopMainModel) ?? undefined;
    return {
      ...input,
      ...(executingCrossCliSubtask
        ? (loopSubtaskModel ? { model: loopSubtaskModel } : {})
        : (loopMainModel ? { model: loopMainModel, loopMainModel } : {})),
      ...(loopSubtaskModel ? { loopSubtaskModel } : {}),
      ...(!executingCrossCliSubtask && roles.fallback.main ? { loopMainModelFallback: roles.fallback.main } : {}),
      ...(!subtaskIsOtherCli && roles.fallback.subtask ? { loopSubtaskModelFallback: roles.fallback.subtask } : {}),
      ...(input.taskRole === "subtask" ? { model: explicitSingle ?? loopSubtaskModel } : {}),
    };
  }

  return {
    resolvePromptRunModelForRole,
    resolvePromptRunThinkingModeForRole,
    hydrateOpenCodePromptRoleModels,
  };
}
