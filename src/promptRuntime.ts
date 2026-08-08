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
  includeTaskListInstruction?: boolean;
  includeHumanInteractionInstruction?: boolean;
};

export const CODEX_TASK_LIST_PROMPT_INSTRUCTION = [
  "TaskList logging requirement for Codex progress updates:",
  "When sending a progress update that includes task status, use exactly this parseable format:",
  "Tasklist:",
  "- [completed] <已完成事项>",
  "- [in_progress] <当前事项>",
  "- [pending] <下一步事项>",
  "Allowed statuses are exactly `[pending]`, `[in_progress]`, and `[completed]`.",
  "Write every task item description in Simplified Chinese (中文) unless the user explicitly requests another language; preserve code identifiers, commands, file paths, package names, and exact user-provided terms as-is.",
  "Do not use other Tasklist headings, inline prose lists, semicolon-separated lists, localized status words, or checkbox syntax for task status.",
  "Omit the Tasklist block when there is no meaningful task-list change.",
].join("\n");

export const CODEX_HUMAN_INTERACTION_PROMPT_INSTRUCTION = [
  "Human interaction requirement for Codex Vibe tasks:",
  "When you need user clarification, missing requirements, or user preferences before continuing, request structured user input through the available app-server user-input or elicitation mechanism.",
  "Ask at most 3 short questions. Each question must resolve one decision, and when clear candidates exist provide 2-3 mutually exclusive options with the recommended option first.",
  "For request_user_input style payloads, prefer questions like { id, header, question, options: [{ label, description }], isOther: true } instead of free-form text fields unless the answer is inherently open-ended.",
  "Do not respond with a plain final-answer list of clarification questions when structured human interaction is available.",
].join("\n");

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
  const includeTaskListInstruction = cli === "codex"
    && options.includeTaskListInstruction !== false
    && options.includeFinalAnswerInstruction !== false;
  const promptWithTaskListInstruction = includeTaskListInstruction
    ? mergePromptSections("", promptWithThinkingInstructions, CODEX_TASK_LIST_PROMPT_INSTRUCTION)
    : promptWithThinkingInstructions;
  const includeHumanInteractionInstruction = cli === "codex"
    && options.includeHumanInteractionInstruction === true
    && options.includeFinalAnswerInstruction !== false;
  const promptWithHumanInteractionInstruction = includeHumanInteractionInstruction
    ? mergePromptSections("", promptWithTaskListInstruction, CODEX_HUMAN_INTERACTION_PROMPT_INSTRUCTION)
    : promptWithTaskListInstruction;
  if (options.includeFinalAnswerInstruction === false) {
    return promptWithHumanInteractionInstruction;
  }
  return mergePromptSections("", promptWithHumanInteractionInstruction, FINAL_ANSWER_PROMPT_INSTRUCTION);
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
