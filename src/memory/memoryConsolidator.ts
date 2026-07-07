import { appendMemoryEntry, appendPitfallRecord, ensureMemoryWorkspaceScaffold } from "./memoryFiles";
import { buildWorkspaceMemoryIndex, writeWorkspaceMemoryIndex } from "./memoryIndexer";
import type { WorkspaceMemoryPaths } from "./memoryPaths";

export type PromptRunMemoryCaptureStatus = "end" | "error" | "stopped";

export type PromptRunMemoryCaptureInput = {
  prompt: string;
  assistantResponse: string;
  cli: string;
  status?: PromptRunMemoryCaptureStatus;
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

const PITFALL_EXPLICIT_PATTERN = /(?:pitfall|gotcha|踩坑|坑点|避坑)/iu;
const PITFALL_FAILURE_PATTERN = /(?:fail(?:ed|ure)?|error|bug|regression|blocked|rollback|incident|exception|报错|错误|失败|阻塞|回滚|事故|异常|缺陷)/iu;
const PITFALL_CAUSE_PATTERN = /(?:root cause|cause|trigger|because|原因|根因|触发|由于)/iu;
const PITFALL_AVOIDANCE_PATTERN = /(?:avoid|workaround|mitigat|prevent|guard|规避|绕过|避免|防止|护栏)/iu;
const PITFALL_VERIFICATION_PATTERN = /(?:verify|verification|test|build|check|assert|验证|测试|构建|检查|断言)/iu;

function shouldRecordPitfall(input: PromptRunMemoryCaptureInput, response: string): boolean {
  if (PITFALL_EXPLICIT_PATTERN.test(response)) {
    return true;
  }
  if (!PITFALL_FAILURE_PATTERN.test(response)) {
    return false;
  }
  const supportingSignals = [
    PITFALL_CAUSE_PATTERN,
    PITFALL_AVOIDANCE_PATTERN,
    PITFALL_VERIFICATION_PATTERN,
  ].filter((pattern) => pattern.test(response)).length;
  return supportingSignals > 0 || input.status === "error";
}

function buildEntryTitle(input: PromptRunMemoryCaptureInput): string {
  if (input.lobsterTaskId) {
    const role = input.taskRole === "subtask" ? "lobster-subtask" : "lobster-main";
    return `${role}:${input.lobsterTaskId}`;
  }
  return `${input.cli}-prompt`;
}

function splitCandidateLines(value: string): string[] {
  return value
    .split(/\r?\n|(?<=[.!?。！？])\s+/u)
    .map((line) => compactWhitespace(line.replace(/^[-*]\s+/u, "")))
    .filter(Boolean);
}

function pickRelevantLines(value: string, pattern: RegExp, maxItems: number): string[] {
  const picked: string[] = [];
  splitCandidateLines(value).forEach((line) => {
    if (picked.length >= maxItems) {
      return;
    }
    if (pattern.test(line)) {
      picked.push(shorten(line, 260));
    }
  });
  return picked;
}

function buildPitfallScope(input: PromptRunMemoryCaptureInput): string {
  const parts = [input.cli];
  if (input.lobsterTaskId) {
    parts.push(`loop:${input.lobsterTaskId}`);
  }
  if (input.lobsterSubtaskId) {
    parts.push(`subtask:${input.lobsterSubtaskId}`);
  }
  return parts.join(" / ");
}

function buildPitfallRelatedInfo(input: PromptRunMemoryCaptureInput): string[] {
  const lines = [`CLI: ${input.cli}`];
  if (input.lobsterTaskId) {
    lines.push(`Loop task: ${input.lobsterTaskId}`);
  }
  if (typeof input.lobsterRound === "number") {
    lines.push(`Loop round: ${input.lobsterRound}`);
  }
  if (input.lobsterSubtaskId) {
    lines.push(`Loop subtask: ${input.lobsterSubtaskId}`);
  }
  return lines;
}

function buildPitfallPhenomenon(assistantResponse: string, prompt: string): string[] {
  const lines = pickRelevantLines(assistantResponse, PITFALL_FAILURE_PATTERN, 3);
  if (!lines.length) {
    lines.push(shorten(assistantResponse, 280));
  }
  lines.push(`Prompt context: ${shorten(prompt, 220)}`);
  return lines;
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
  const status = input.status ?? "end";
  const title = buildEntryTitle(input);
  const updatedFiles: string[] = [];

  if (status === "end") {
    updatedFiles.push(appendMemoryEntry(paths, "rollingSummary", {
      title,
      occurredAt: capturedAt,
      lines: [
        `CLI: ${input.cli}`,
        `Prompt: ${shorten(prompt, 220)}`,
        `Answer: ${shorten(assistantResponse, 480)}`,
      ],
    }));

    if (shouldRecordEvent(input, assistantResponse)) {
      const eventLines = [
        `CLI: ${input.cli}`,
        `Summary: ${shorten(assistantResponse, 480)}`,
      ];
      if (input.lobsterTaskId) {
        eventLines.push(`Loop task: ${input.lobsterTaskId}`);
      }
      if (typeof input.lobsterRound === "number") {
        eventLines.push(`Loop round: ${input.lobsterRound}`);
      }
      if (input.lobsterSubtaskId) {
        eventLines.push(`Loop subtask: ${input.lobsterSubtaskId}`);
      }
      updatedFiles.push(
        appendMemoryEntry(paths, "eventMemory", {
          title,
          occurredAt: capturedAt,
          lines: eventLines,
        }),
      );
    }
  }

  if (shouldRecordPitfall(input, assistantResponse)) {
    const causeLines = pickRelevantLines(assistantResponse, PITFALL_CAUSE_PATTERN, 2);
    const avoidanceLines = pickRelevantLines(assistantResponse, PITFALL_AVOIDANCE_PATTERN, 2);
    const verificationLines = pickRelevantLines(assistantResponse, PITFALL_VERIFICATION_PATTERN, 2);
    updatedFiles.push(
      appendPitfallRecord(paths, {
        title: `pitfall:${title}`,
        status: status === "error" ? "active" : "needs-observation",
        firstSeen: capturedAt,
        scope: buildPitfallScope(input),
        phenomenon: buildPitfallPhenomenon(assistantResponse, prompt),
        trigger: [
          `Captured from a ${status} run summary because the response contained failure or pitfall signals.`,
        ],
        rootCause: causeLines.length
          ? causeLines
          : ["Auto-captured from assistant response; verify before treating the cause as definitive."],
        avoidance: avoidanceLines.length
          ? avoidanceLines
          : ["Review this note before repeating related workflow or code changes."],
        verification: verificationLines.length
          ? verificationLines
          : ["Run the smallest relevant check before considering this pitfall avoided."],
        relatedInfo: buildPitfallRelatedInfo(input),
      }),
    );
  }

  if (!updatedFiles.length) {
    return {
      skipped: true,
      updatedFiles: [],
      reason: "no-memory-capture-signals",
    };
  }

  const index = buildWorkspaceMemoryIndex(paths);
  writeWorkspaceMemoryIndex(paths, index);
  return {
    skipped: false,
    updatedFiles,
  };
}
