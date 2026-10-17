import * as fs from "fs/promises";
import { GROK_REASONING_EFFORTS, mapThinkingModeToGrokEffort } from "../cli/types";
import { writeFileAtomically } from "../shared/atomicWrite";
import { resolveGrokConfigPath } from "../shared/userHomePaths";
import { readGrokVisualModel } from "./grokConfig";
import { isGrokTomlTable, parseGrokToml, serializeGrokToml } from "./grokToml";

let pendingConfigUpdate = Promise.resolve();

export function mergeGrokReasoningConfig(
  content: string,
  selectedModel?: string | null,
): { content: string; changed: boolean; modelId: string | null } {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) {
    throw new Error("Invalid Grok configuration.");
  }
  const document = parsed.value;
  const models = isGrokTomlTable(document.models) ? document.models : {};
  const modelTable = isGrokTomlTable(document.model) ? document.model : {};
  const requestedModel = selectedModel?.trim()
    || (typeof models.default === "string" ? models.default.trim() : "");
  const modelId = isGrokTomlTable(modelTable[requestedModel])
    ? requestedModel
    : Object.keys(modelTable).find((key) => {
      const model = modelTable[key];
      return isGrokTomlTable(model) && model.model === requestedModel;
    });
  if (!requestedModel || !modelId) {
    return { content, changed: false, modelId: null };
  }
  const model = readGrokVisualModel(document, modelId)!;
  if (model.reasoning_efforts !== undefined || model.supports_reasoning_effort === false) {
    return { content, changed: false, modelId };
  }
  const reasoningEfforts = GROK_REASONING_EFFORTS.map((value) => ({ value, label: value }));
  const hasModelHeader = content.split(/\r?\n/u).some((line) => {
    if (!/^\s*\[(?!\[).*\]\s*(?:#.*)?$/u.test(line)) {
      return false;
    }
    const header = parseGrokToml(line);
    return header.ok && readGrokVisualModel(header.value, modelId) !== null;
  });
  model.reasoning_efforts = reasoningEfforts;
  const serialized = serializeGrokToml(hasModelHeader
    ? { model: { [modelId]: { reasoning_efforts: reasoningEfforts } } }
    : document);
  if (!serialized.ok) {
    throw new Error("Unable to serialize Grok configuration.");
  }
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const addition = serialized.content.replace(/\n/gu, newline);
  const nextContent = hasModelHeader
    ? `${content}${content.endsWith("\n") ? newline : newline + newline}${addition}`
    : addition;
  return { content: nextContent, changed: true, modelId };
}

export async function ensureGrokReasoningConfig(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  model?: string | null;
  thinkingMode?: unknown;
} = {}): Promise<boolean> {
  if (!mapThinkingModeToGrokEffort(options.thinkingMode)) {
    return false;
  }
  const operation = pendingConfigUpdate.then(async () => {
    const configPath = resolveGrokConfigPath(options.env ?? process.env, options.homeDir);
    let content: string;
    try {
      content = await fs.readFile(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
    const merged = mergeGrokReasoningConfig(content, options.model);
    if (!merged.changed) {
      return false;
    }
    const targetPath = await fs.realpath(configPath);
    const stat = await fs.stat(targetPath);
    await writeFileAtomically(targetPath, merged.content, { mode: stat.mode & 0o777 });
    return true;
  });
  pendingConfigUpdate = operation.then(() => undefined, () => undefined);
  return operation;
}
