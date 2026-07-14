import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getThinkingPromptPrefix, getThinkingPromptSuffix } from "./cli/config";
import type { CliName, ThinkingMode } from "./cli/types";
import { t, type AppLocale } from "./i18n";
import { buildLongTermMemoryPromptBlock, injectLongTermMemoryPrompt } from "./memory/memoryPrompt";
import type { WorkspaceMemoryPaths } from "./memory/memoryPaths";
import { buildWorkspaceMemoryRecallPack } from "./memory/memoryRecall";
import type { MemoryRuntimeGateSettings } from "./memory/runtimeGate";
import { isMemoryRuntimeOperationAllowed } from "./memory/runtimeGate";
import type { ChatMessage, PromptContextOptions } from "./webview/types";
import { FINAL_ANSWER_PROMPT_INSTRUCTION } from "./finalAnswerProtocol";

const CODEX_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
  ".heic",
  ".heif",
  ".avif",
]);

export type PromptRunInputBase = {
  displayPrompt: string;
  modelPrompt: string;
  contextTags: string[];
  preloadedUserMessageId?: string;
  model?: string;
  imagePaths?: string[];
  taskRole?: string;
  loopTaskId?: string;
  loopRound?: number;
  loopSubtaskId?: string;
};

export function normalizePromptContextTags(input: { contextTags?: unknown }): string[] {
  return Array.isArray(input.contextTags)
    ? input.contextTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
}

export function buildRuntimeModelPrompt(input: { displayPrompt: string; modelPrompt?: string | null }): string {
  return input.modelPrompt || input.displayPrompt;
}

export function hasNonEmptyAssistantText(message: ChatMessage | undefined): boolean {
  return Boolean(message && message.role === "assistant" && String(message.content ?? "").trim());
}

export function mergePromptSections(prefix: string, prompt: string, suffix: string): string {
  const sections: string[] = [];
  if (prefix.trim()) {
    sections.push(prefix.trimEnd());
  }
  sections.push(prompt);
  if (suffix.trim()) {
    sections.push(suffix.trimStart());
  }
  return sections.join("\n");
}

export type ThinkingPromptOptions = {
  includePrefix?: boolean;
  includeSuffix?: boolean;
  includeFinalAnswerInstruction?: boolean;
};

export function buildThinkingPrompt(
  cli: CliName,
  mode: ThinkingMode,
  prompt: string,
  options: ThinkingPromptOptions = {}
): string {
  const includePrefix = options.includePrefix !== false;
  const includeSuffix = options.includeSuffix !== false;
  const prefix = includePrefix ? getThinkingPromptPrefix(cli, mode) : "";
  const suffix = includeSuffix ? getThinkingPromptSuffix(cli, mode) : "";
  const promptWithThinkingInstructions = !prefix.trim() && !suffix.trim()
    ? prompt
    : mergePromptSections(prefix, prompt, suffix);
  if (options.includeFinalAnswerInstruction === false) {
    return promptWithThinkingInstructions;
  }
  return mergePromptSections("", promptWithThinkingInstructions, FINAL_ANSWER_PROMPT_INSTRUCTION);
}

export function buildHiddenRetryPrompt(
  cli: CliName,
  thinkingMode: ThinkingMode,
  options: Pick<ThinkingPromptOptions, "includeFinalAnswerInstruction"> = {},
): string {
  return buildThinkingPrompt(cli, thinkingMode, t("run.hiddenContinuePrompt"), {
    ...options,
    includeSuffix: false,
  });
}

export function redactPromptArg(args: string[], prompt?: string): string[] {
  if (!prompt) {
    return args;
  }
  const redacted = [...args];
  for (let i = redacted.length - 1; i >= 0; i -= 1) {
    if (redacted[i] === prompt) {
      redacted[i] = `<prompt:${prompt.length}>`;
      break;
    }
  }
  return redacted;
}

export function resolvePromptReferencedPath(rawPath: string, cwd?: string | null): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  const expanded = expandUserHomePath(trimmed);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  if (cwd) {
    return path.resolve(cwd, expanded);
  }
  return path.resolve(expanded);
}

function expandUserHomePath(targetPath: string): string {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

function isImageAttachmentPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (!CODEX_IMAGE_EXTENSIONS.has(extension)) {
    return false;
  }
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function collectCodexImagePathsFromPrompt(prompt: string, cwd?: string | null): string[] {
  if (!prompt.trim()) {
    return [];
  }
  const imagePaths: string[] = [];
  const seen = new Set<string>();
  const tokenPattern = /@(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  for (const match of prompt.matchAll(tokenPattern)) {
    const rawPath = match[1] ?? match[2] ?? match[3] ?? "";
    const resolvedPath = resolvePromptReferencedPath(rawPath, cwd);
    if (!resolvedPath || !isImageAttachmentPath(resolvedPath) || seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);
    imagePaths.push(resolvedPath);
  }
  return imagePaths;
}

export type PromptContextBuildResult = {
  modelPrompt: string;
  contextTags: string[];
};

export type ActiveEditorPromptContext = {
  fileLabel: string;
  hasSelection: boolean;
  selectionLabel: string | null;
};

export function normalizePromptContextOptions(
  options?: PromptContextOptions
): Required<PromptContextOptions> {
  return {
    includeCurrentFile: options?.includeCurrentFile !== false,
    includeSelection: options?.includeSelection !== false,
  };
}

export function formatPromptContextTagLabel(context: ActiveEditorPromptContext): string {
  if (context.hasSelection && context.selectionLabel) {
    return t("common.currentFileWithRange", {
      file: context.fileLabel,
      range: context.selectionLabel,
    });
  }
  return `${t("common.currentFile")}: ${context.fileLabel}`;
}

export function buildPromptWithAutoContextFromEditor(
  prompt: string,
  options: PromptContextOptions | undefined,
  deps: {
    autoAddEditorContextTags: boolean;
    getActiveEditorPromptContext: () => ActiveEditorPromptContext | null;
  }
): PromptContextBuildResult {
  if (!prompt) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  if (!deps.autoAddEditorContextTags) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  const normalized = normalizePromptContextOptions(options);
  if (!normalized.includeCurrentFile && !normalized.includeSelection) {
    return { modelPrompt: prompt, contextTags: [] };
  }
  const context = deps.getActiveEditorPromptContext();
  if (!context) {
    return { modelPrompt: prompt, contextTags: [] };
  }

  const referenceLines: string[] = [];
  const contextTags: string[] = [];

  if (normalized.includeSelection && context.hasSelection) {
    contextTags.push(formatPromptContextTagLabel(context));
    if (context.selectionLabel) {
      referenceLines.push(`Selected range in @${context.fileLabel}: ${context.selectionLabel}`);
    } else {
      referenceLines.push(`Selected range in @${context.fileLabel}`);
    }
  } else if (normalized.includeCurrentFile) {
    referenceLines.push(`@${context.fileLabel}`);
    contextTags.push(formatPromptContextTagLabel(context));
  }

  if (!referenceLines.length) {
    return { modelPrompt: prompt, contextTags: [] };
  }

  return {
    modelPrompt: [prompt, "", "----", "Auto Context References:", ...referenceLines].join("\n"),
    contextTags,
  };
}

export function buildLongTermMemoryFocusHints(
  contextTags: readonly string[],
  editorContext: ActiveEditorPromptContext | null
): string[] {
  const hints = new Set<string>();
  contextTags.forEach((tag) => {
    const normalized = String(tag ?? "").trim();
    if (normalized) {
      hints.add(normalized);
    }
  });
  if (editorContext?.fileLabel) {
    hints.add(editorContext.fileLabel);
  }
  if (editorContext?.selectionLabel) {
    hints.add(editorContext.selectionLabel);
  }
  return [...hints];
}

export function maybeInjectLongTermMemoryForPromptWithDeps(
  prompt: string,
  modelPrompt: string,
  contextTags: readonly string[],
  deps: {
    runtimeSettings: MemoryRuntimeGateSettings;
    memoryPaths: WorkspaceMemoryPaths | null;
    locale: AppLocale;
    getActiveEditorPromptContext: () => ActiveEditorPromptContext | null;
    onError: (error: unknown, paths: WorkspaceMemoryPaths) => void;
  }
): string {
  if (!isMemoryRuntimeOperationAllowed("inject", deps.runtimeSettings)) {
    return modelPrompt;
  }
  if (!deps.memoryPaths) {
    return modelPrompt;
  }
  try {
    const recallPack = buildWorkspaceMemoryRecallPack(deps.memoryPaths, {
      prompt,
      focusHints: buildLongTermMemoryFocusHints(contextTags, deps.getActiveEditorPromptContext()),
    });
    const memoryBlock = buildLongTermMemoryPromptBlock(recallPack, deps.locale);
    return injectLongTermMemoryPrompt(modelPrompt, memoryBlock);
  } catch (error) {
    deps.onError(error, deps.memoryPaths);
    return modelPrompt;
  }
}
