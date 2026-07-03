import { appendMemoryEntry, ensureMemoryWorkspaceScaffold } from "./memoryFiles";
import { buildWorkspaceMemoryIndex, writeWorkspaceMemoryIndex } from "./memoryIndexer";
import type { WorkspaceMemoryPaths } from "./memoryPaths";

export type PromptRunMemoryCaptureInput = {
  prompt: string;
  assistantResponse: string;
  cli: string;
  taskRole?: "main" | "subtask";
  lobsterTaskId?: string;
  lobsterRound?: number;
  lobsterSubtaskId?: string;
  capturedAt?: Date;
};

export type PromptRunMemoryCaptureResult = {
  skipped: boolean;
  updatedFiles: string[];
  reason?: string;
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function shouldRecordEvent(input: PromptRunMemoryCaptureInput, response: string): boolean {
  if (input.taskRole || input.lobsterTaskId) {
    return true;
  }
  return /(?:decision|risk|blocked|resolved|migrat|rollback|incident|结论|风险|阻塞|决定|迁移|回滚|事故)/iu.test(response);
}

function buildEntryTitle(input: PromptRunMemoryCaptureInput): string {
  if (input.lobsterTaskId) {
    const role = input.taskRole === "subtask" ? "lobster-subtask" : "lobster-main";
    return `${role}:${input.lobsterTaskId}`;
  }
  return `${input.cli}-prompt`;
}

export function persistPromptRunSummary(
  paths: WorkspaceMemoryPaths,
  input: PromptRunMemoryCaptureInput,
): PromptRunMemoryCaptureResult {
  const prompt = compactWhitespace(input.prompt);
  const assistantResponse = compactWhitespace(input.assistantResponse);
  if (!prompt || !assistantResponse) {
    return {
      skipped: true,
      updatedFiles: [],
      reason: "empty-prompt-or-response",
    };
  }

  ensureMemoryWorkspaceScaffold(paths);
  const capturedAt = input.capturedAt ?? new Date();
  const title = buildEntryTitle(input);
  const updatedFiles = [
    appendMemoryEntry(paths, "rollingSummary", {
      title,
      occurredAt: capturedAt,
      lines: [
        `CLI: ${input.cli}`,
        `Prompt: ${shorten(prompt, 220)}`,
        `Answer: ${shorten(assistantResponse, 480)}`,
      ],
    }),
  ];

  if (shouldRecordEvent(input, assistantResponse)) {
    const eventLines = [
      `CLI: ${input.cli}`,
      `Summary: ${shorten(assistantResponse, 480)}`,
    ];
    if (input.lobsterTaskId) {
      eventLines.push(`Lobster task: ${input.lobsterTaskId}`);
    }
    if (typeof input.lobsterRound === "number") {
      eventLines.push(`Lobster round: ${input.lobsterRound}`);
    }
    if (input.lobsterSubtaskId) {
      eventLines.push(`Lobster subtask: ${input.lobsterSubtaskId}`);
    }
    updatedFiles.push(
      appendMemoryEntry(paths, "eventMemory", {
        title,
        occurredAt: capturedAt,
        lines: eventLines,
      }),
    );
  }

  const index = buildWorkspaceMemoryIndex(paths);
  writeWorkspaceMemoryIndex(paths, index);
  return {
    skipped: false,
    updatedFiles,
  };
}
