import type { ThinkingMode } from "../cli/types";
import type { ChatMessage } from "../webview/types";
import type { LoopTaskRole, TaskRunRecord, TaskRunStatus } from "../promptRunState";
import type { LoopTaskRecord } from "../loopTaskStore";
import type { PromptRunInput, PromptRunTarget } from "./graphRuntime";
import {
  createLoopPlusOrchestrationHost,
  type LoopPlusAttemptHandle,
  type LoopPlusAttemptRequest,
  type LoopPlusAttemptResult,
  type LoopPlusMainHandle,
  type LoopPlusMainRequest,
  type LoopPlusOrchestrationDeps,
  type LoopPlusPromptTarget,
  type LoopPlusRunInput,
  type LoopPlusRunOptions,
  resolveLoopPlusEntry,
} from "./loopPlusOrchestration";
import {
  loopPlusResumeRefusal,
  mergeLoopPlusResumeContinueInstruction,
  resolveLoopPlusAttemptOutcome,
  resolveLoopPlusPromptRoleBinding,
  shouldBindLoopPlusResumeTarget,
  withLoopPlusExecutionRoot,
  type LoopPlusPromptRoleBinding,
} from "./promptRunRuntime";

export type LoopPlusInvocationBoundary = {
  messageIds: ReadonlySet<string>;
  runIds: ReadonlySet<string>;
  startedAt: number;
};

export type LoopPlusInvocationQuery = {
  taskId: string;
  round: number;
  role: LoopTaskRole;
  subtaskId?: string;
  displayPrompt: string;
};

type LoopPlusTranscriptMessage = {
  target: LoopPlusPromptTarget;
  content: string;
  taskId: string;
  round: number;
  subtaskId: string;
};

export type LoopPlusRuntimeAdapterDeps = {
  maxConcurrency?: number;
  launchDelayMs?: LoopPlusOrchestrationDeps["launchDelayMs"];
  delay?: LoopPlusOrchestrationDeps["delay"];
  now?: () => number;
  readTask: (taskId: string) => LoopTaskRecord | null;
  createTask: LoopPlusOrchestrationDeps["createTask"];
  updateTask: (taskId: string, patch: Partial<LoopTaskRecord>) => LoopTaskRecord | null;
  appendHostMessage: LoopPlusOrchestrationDeps["appendMessage"];
  prepareCommunication?: LoopPlusOrchestrationDeps["prepareCommunication"];
  appendAttemptReport: (filePath: string, content: string) => void;
  log?: LoopPlusOrchestrationDeps["log"];
  runPrompt: (input: PromptRunInput, options?: { targetTabId?: string | null }) => Promise<void>;
  getMessages: (target: LoopPlusPromptTarget) => ChatMessage[];
  readRuns: () => TaskRunRecord[];
  resolveThinkingMode: (
    input: PromptRunInput,
    cli: PromptRunTarget["cli"],
    role: "main" | "subtask",
    model: string | undefined,
  ) => ThinkingMode | undefined;
  createExecutionRoot: () => { cwd?: string; dispose: () => void } | null;
  createSubtaskTarget: (cli: LoopPlusPromptTarget["cli"]) => LoopPlusPromptTarget;
  cancelInvocation: (tabId: string) => void;
  appendSubtaskPrompt: (message: LoopPlusTranscriptMessage) => void;
  resolveSessionId: (target: LoopPlusPromptTarget) => string | null;
  activeWorkspaceKey: () => string;
  isSubtaskConversation: (target: LoopPlusPromptTarget) => boolean;
  isTaskCompatible: (task: LoopTaskRecord, target: LoopPlusPromptTarget) => boolean;
  bindResumeTarget: (
    taskId: string,
    cli: LoopPlusPromptTarget["cli"],
    sessionId: string | null,
  ) => LoopTaskRecord | null;
  hiddenContinuePrompt: () => string;
  normalizeContinuePrompt: (prompt: string) => string | null;
  appendRefusal: (
    target: LoopPlusPromptTarget,
    kind: "nested" | "original-unavailable" | "incompatible",
  ) => void;
};

export type LoopPlusRuntimeAdapter = {
  host: () => ReturnType<typeof createLoopPlusOrchestrationHost>;
  runEventDriven: (
    input: PromptRunInput,
    options: LoopPlusRunOptions & { targetTabId?: string | null },
    target: LoopPlusPromptTarget,
    onTaskOwnershipAcquired?: (taskId: string, target: LoopPlusPromptTarget) => void,
  ) => Promise<boolean>;
  runMain: (request: LoopPlusMainRequest) => LoopPlusMainHandle;
  startAttempt: (request: LoopPlusAttemptRequest) => LoopPlusAttemptHandle;
  getLivePrompt: (taskId: string) => PromptRunInput | null;
};

type AttemptExecution = {
  thrown: boolean;
  error: unknown;
  boundary: LoopPlusInvocationBoundary;
  promptInput: PromptRunInput;
  target: LoopPlusPromptTarget;
};

export function selectLoopPlusInvocationRun(
  runs: readonly TaskRunRecord[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
): TaskRunRecord | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!isInvocationRun(run, boundary, query)) {
      continue;
    }
    return run;
  }
  return null;
}

export function selectLoopPlusInvocationAssistant(
  messages: readonly ChatMessage[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
): string | null {
  if (!hasUsableInvocationWindow(run)) {
    return null;
  }
  const duplicates = duplicatedMessageIds(messages);
  const userAnchor = findInvocationUserAnchor(messages, boundary, query, run, duplicates);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (userAnchor !== null && index <= userAnchor) {
      break;
    }
    const message = messages[index];
    if (!isInvocationAssistant(message, boundary, query, run, duplicates)) {
      continue;
    }
    return message.content;
  }
  return null;
}

export function selectLoopPlusContinuationDetail(
  messages: readonly ChatMessage[],
  run: TaskRunRecord | null,
  query: Omit<LoopPlusInvocationQuery, "displayPrompt">,
): string | null {
  if (
    !run
    || run.status !== "end"
    || run.loopTaskId !== query.taskId
    || run.loopRound !== query.round
    || run.taskRole !== query.role
    || (query.role === "subtask" && run.loopSubtaskId !== query.subtaskId)
  ) {
    return null;
  }
  return selectLoopPlusInvocationAssistant(messages, {
    messageIds: new Set<string>(),
    runIds: new Set<string>(),
    startedAt: run.startedAt,
  }, {
    ...query,
    displayPrompt: run.prompt,
  }, run);
}

export function createLoopPlusRuntimeAdapter(deps: LoopPlusRuntimeAdapterDeps): LoopPlusRuntimeAdapter {
  const now = deps.now ?? (() => Date.now());
  const livePrompts = new Map<string, PromptRunInput>();
  let hostInstance: ReturnType<typeof createLoopPlusOrchestrationHost> | null = null;

  function rememberLivePrompt(taskId: string, input: PromptRunInput): void {
    livePrompts.set(taskId, input);
  }

  function rememberRunInput(taskId: string, prompt: LoopPlusRunInput): void {
    rememberLivePrompt(taskId, {
      displayPrompt: prompt.displayPrompt,
      modelPrompt: prompt.modelPrompt ?? prompt.displayPrompt,
      contextTags: [],
      model: prompt.model,
      loopMainModel: prompt.loopMainModel,
      loopSubtaskModel: prompt.loopSubtaskModel,
      loopMainThinkingMode: prompt.loopMainThinkingMode,
      loopSubtaskThinkingMode: prompt.loopSubtaskThinkingMode,
    });
  }

  function releaseLivePromptIfCompleted(taskId: string | null): void {
    if (!taskId) {
      return;
    }
    const task = deps.readTask(taskId);
    if (task?.status === "completed") {
      livePrompts.delete(taskId);
    }
  }

  function promptForRole(
    taskId: string,
    role: "main" | "subtask",
    displayPrompt: string,
    modelPrompt: string,
    cli: PromptRunTarget["cli"],
  ): PromptRunInput {
    const task = deps.readTask(taskId);
    const binding: LoopPlusPromptRoleBinding = resolveLoopPlusPromptRoleBinding({
      role,
      task,
      live: livePrompts.get(taskId) ?? null,
    });
    const promptInput: PromptRunInput = {
      displayPrompt,
      modelPrompt,
      contextTags: [],
      model: binding.model,
      loopMainModel: binding.loopMainModel,
      loopSubtaskModel: binding.loopSubtaskModel,
      loopMainThinkingMode: binding.loopMainThinkingMode,
      loopSubtaskThinkingMode: binding.loopSubtaskThinkingMode,
      taskRole: role,
      loopTaskId: taskId,
      loopRound: 1,
      throwOnError: true,
    };
    promptInput.thinkingModeOverride = deps.resolveThinkingMode(
      promptInput,
      cli,
      role,
      role === "subtask" ? binding.loopSubtaskModel : binding.model,
    );
    return promptInput;
  }

  function captureBoundary(target: LoopPlusPromptTarget): LoopPlusInvocationBoundary {
    return {
      messageIds: new Set(deps.getMessages(target).map((message) => message.id)),
      runIds: new Set(deps.readRuns().map((run) => run.id)),
      startedAt: now(),
    };
  }

  function readInvocation(
    target: LoopPlusPromptTarget,
    boundary: LoopPlusInvocationBoundary,
    promptInput: PromptRunInput,
    role: "main" | "subtask",
    subtaskId?: string,
  ): { run: TaskRunRecord | null; content: string | null } {
    const query: LoopPlusInvocationQuery = {
      taskId: promptInput.loopTaskId ?? "",
      round: promptInput.loopRound ?? 1,
      role,
      subtaskId,
      displayPrompt: promptInput.displayPrompt,
    };
    const run = selectLoopPlusInvocationRun(deps.readRuns(), boundary, query);
    if (!run) {
      return { run: null, content: null };
    }
    return {
      run,
      content: selectLoopPlusInvocationAssistant(deps.getMessages(target), boundary, query, run),
    };
  }

  function runMain(request: LoopPlusMainRequest): LoopPlusMainHandle {
    let aborted = false;
    const promise = (async (): Promise<string | null> => {
      const promptInput = promptForRole(
        request.taskId,
        "main",
        request.prompt,
        request.modelPrompt,
        request.target.cli,
      );
      const boundary = captureBoundary(request.target);
      try {
        await deps.runPrompt(promptInput, { targetTabId: request.target.tabId });
      } catch (error) {
        const invocation = readInvocation(request.target, boundary, promptInput, "main");
        if (aborted || invocation.run?.status === "stopped") {
          return null;
        }
        throw error;
      }
      const invocation = readInvocation(request.target, boundary, promptInput, "main");
      if (aborted || invocation.run?.status === "stopped" || invocation.run?.status !== "end") {
        return null;
      }
      return invocation.content;
    })();
    return {
      promise,
      abort: () => {
        if (aborted) {
          return;
        }
        aborted = true;
        deps.cancelInvocation(request.target.tabId);
      },
    };
  }

  function startAttempt(request: LoopPlusAttemptRequest): LoopPlusAttemptHandle {
    const subtaskTarget = deps.createSubtaskTarget(request.targetCli);
    let aborted = false;
    const promise = (async (): Promise<LoopPlusAttemptResult> => {
      deps.appendSubtaskPrompt({
        target: subtaskTarget,
        content: request.prompt,
        taskId: request.taskId,
        round: request.round,
        subtaskId: request.subtaskId,
      });
      const rootResult = await withLoopPlusExecutionRoot(
        () => deps.createExecutionRoot(),
        async (executionRoot): Promise<AttemptExecution> => {
          const promptInput = promptForRole(
            request.taskId,
            "subtask",
            request.prompt,
            request.modelPrompt,
            request.targetCli,
          );
          promptInput.loopRound = request.round;
          promptInput.loopSubtaskId = request.subtaskId;
          const root = executionRoot as { cwd?: string; dispose: () => void } | null;
          promptInput.executionCwd = root?.cwd;
          promptInput.isolateProjectInstructions = Boolean(root);
          const boundary = captureBoundary(subtaskTarget);
          try {
            await deps.runPrompt(promptInput, { targetTabId: subtaskTarget.tabId });
            return { thrown: false, error: null, boundary, promptInput, target: subtaskTarget };
          } catch (error) {
            return { thrown: true, error, boundary, promptInput, target: subtaskTarget };
          }
        },
      );
      if (!rootResult.ok) {
        return { outcome: "failed", detail: errorDetail(rootResult.error) };
      }
      const invocation = readInvocation(
        rootResult.value.target,
        rootResult.value.boundary,
        rootResult.value.promptInput,
        "subtask",
        request.subtaskId,
      );
      const outcome = resolveAttemptOutcome({
        aborted,
        thrown: rootResult.value.thrown,
        run: invocation.run,
      });
      if (outcome === "completed") {
        return { outcome, detail: invocation.content };
      }
      if (outcome === "stopped") {
        return {
          outcome,
          detail: rootResult.value.thrown ? errorDetail(rootResult.value.error) : "stopped",
        };
      }
      return {
        outcome,
        detail: rootResult.value.thrown
          ? errorDetail(rootResult.value.error)
          : (invocation.content ?? "failed"),
      };
    })();
    return {
      promise,
      abort: () => {
        if (aborted) {
          return;
        }
        aborted = true;
        deps.cancelInvocation(subtaskTarget.tabId);
      },
    };
  }

  function host(): ReturnType<typeof createLoopPlusOrchestrationHost> {
    if (!hostInstance) {
      hostInstance = createLoopPlusOrchestrationHost({
        maxConcurrency: deps.maxConcurrency,
        launchDelayMs: deps.launchDelayMs,
        delay: deps.delay,
        now,
        readTask: deps.readTask,
        createTask: (input) => {
          const task = deps.createTask(input);
          rememberRunInput(task.id, input.prompt);
          return deps.readTask(task.id) ?? task;
        },
        updateTask: (taskId, patch) => deps.updateTask(taskId, patch),
        appendMessage: deps.appendHostMessage,
        runMain,
        startAttempt,
        prepareCommunication: deps.prepareCommunication,
        recordAttempt: (input) => {
          if (!input.communicationFile) {
            return;
          }
          deps.appendAttemptReport(input.communicationFile, [
            "",
            "## Attempt result",
            `- attempt: ${input.attemptId}`,
            `- outcome: ${input.outcome}`,
            input.detail ?? "",
            "",
          ].join("\n"));
        },
        log: deps.log,
      });
    }
    return hostInstance;
  }

  async function runEventDriven(
    input: PromptRunInput,
    options: LoopPlusRunOptions = {},
    target: LoopPlusPromptTarget,
    onTaskOwnershipAcquired?: (taskId: string, target: LoopPlusPromptTarget) => void,
  ): Promise<boolean> {
    const resumeTaskId = typeof options.resumeTaskId === "string" && options.resumeTaskId.trim()
      ? options.resumeTaskId.trim()
      : null;
    const resumeRequested = options.resumeRequested === true;
    const preserveLoopOrigin = options.preserveLoopOrigin === true;
    let existing = resumeTaskId ? deps.readTask(resumeTaskId) : null;
    if (resolveLoopPlusEntry(existing, options.schedulingMode) !== "event_driven") {
      return false;
    }
    if (deps.isSubtaskConversation(target)) {
      deps.appendRefusal(target, "nested");
      return true;
    }
    const targetSessionId = deps.resolveSessionId(target);
    if (existing && shouldBindLoopPlusResumeTarget({
      resumeRequested,
      preserveLoopOrigin,
      sameWorkspace: existing.workspaceKey === deps.activeWorkspaceKey(),
      runtimeTargetDiffers: existing.cli !== target.cli || existing.sessionId !== targetSessionId,
    })) {
      existing = deps.bindResumeTarget(existing.id, target.cli, targetSessionId) ?? existing;
    }
    const refusal = loopPlusResumeRefusal({
      hasExistingTask: Boolean(existing),
      resumeRequested,
      preserveLoopOrigin,
      compatible: existing ? deps.isTaskCompatible(existing, target) : false,
    });
    if (refusal) {
      deps.appendRefusal(target, refusal);
      return true;
    }
    if (existing && resumeRequested) {
      rememberLivePrompt(existing.id, input);
      const mergedRequirements = mergeLoopPlusResumeContinueInstruction(
        existing.supplementalRequirements,
        input.loopContinuePrompt ?? deps.normalizeContinuePrompt(input.displayPrompt || input.modelPrompt),
        deps.hiddenContinuePrompt(),
      );
      if (mergedRequirements) {
        existing = deps.updateTask(existing.id, {
          supplementalRequirements: mergedRequirements,
          updatedAt: now(),
        }) ?? existing;
      }
    }
    const result = host().tryRun({
      displayPrompt: input.displayPrompt,
      modelPrompt: input.modelPrompt,
      model: input.model,
      loopMainModel: input.loopMainModel,
      loopSubtaskModel: input.loopSubtaskModel,
      loopMainThinkingMode: input.loopMainThinkingMode,
      loopSubtaskThinkingMode: input.loopSubtaskThinkingMode,
    }, target, {
      resumeTaskId,
      resumeRequested,
      preserveLoopOrigin,
      schedulingMode: options.schedulingMode,
      sessionId: targetSessionId,
    });
    if (result.taskId) {
      rememberLivePrompt(result.taskId, input);
      onTaskOwnershipAcquired?.(result.taskId, target);
    }
    if (result.handled) {
      await result.done;
    }
    releaseLivePromptIfCompleted(result.taskId);
    return true;
  }

  return {
    host,
    runEventDriven,
    runMain,
    startAttempt,
    getLivePrompt: (taskId) => livePrompts.get(taskId) ?? null,
  };
}

function resolveAttemptOutcome(input: {
  aborted: boolean;
  thrown: boolean;
  run: TaskRunRecord | null;
}): LoopPlusAttemptResult["outcome"] {
  if (!input.run) {
    return input.aborted ? "stopped" : "failed";
  }
  return resolveLoopPlusAttemptOutcome({
    aborted: input.aborted,
    thrown: input.thrown,
    runStatus: input.run.status,
  });
}

function hasUsableInvocationWindow(run: TaskRunRecord): boolean {
  return Number.isFinite(run.startedAt)
    && Number.isFinite(run.endedAt)
    && run.endedAt >= run.startedAt;
}

function isInvocationRun(
  run: TaskRunRecord,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
): boolean {
  return hasUsableInvocationWindow(run)
    && !boundary.runIds.has(run.id)
    && run.startedAt >= boundary.startedAt
    && run.prompt === query.displayPrompt
    && run.loopTaskId === query.taskId
    && run.loopRound === query.round
    && run.taskRole === query.role
    && (query.role !== "subtask" || run.loopSubtaskId === query.subtaskId);
}

function invocationAssistantEarliestAt(boundary: LoopPlusInvocationBoundary, run: TaskRunRecord): number {
  return Math.max(boundary.startedAt, run.startedAt);
}

function isInvocationAssistant(
  message: ChatMessage,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): boolean {
  return message.role === "assistant"
    && !boundary.messageIds.has(message.id)
    && !duplicates.has(message.id)
    && typeof message.createdAt === "number"
    && Number.isFinite(message.createdAt)
    && message.createdAt >= invocationAssistantEarliestAt(boundary, run)
    && message.createdAt <= run.endedAt
    && message.taskRole === query.role
    && message.loopTaskId === query.taskId
    && message.loopRound === query.round
    && (query.role !== "subtask" || message.loopSubtaskId === query.subtaskId)
    && Boolean(message.content.trim());
}

function findInvocationUserAnchor(
  messages: readonly ChatMessage[],
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isInvocationUserAnchor(message, boundary, query, run, duplicates)) {
      continue;
    }
    return index;
  }
  return null;
}

function isInvocationUserAnchor(
  message: ChatMessage,
  boundary: LoopPlusInvocationBoundary,
  query: LoopPlusInvocationQuery,
  run: TaskRunRecord,
  duplicates: ReadonlySet<string>,
): boolean {
  return message.role === "user"
    && !boundary.messageIds.has(message.id)
    && !duplicates.has(message.id)
    && typeof message.createdAt === "number"
    && Number.isFinite(message.createdAt)
    && message.createdAt >= boundary.startedAt
    && message.createdAt <= run.endedAt
    && message.content === query.displayPrompt
    && message.loopTaskId === query.taskId
    && message.taskRole === query.role
    && message.loopRound === query.round
    && (query.role !== "subtask" || message.loopSubtaskId === query.subtaskId);
}

function duplicatedMessageIds(messages: readonly ChatMessage[]): Set<string> {
  const counts = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    const count = (counts.get(message.id) ?? 0) + 1;
    counts.set(message.id, count);
    if (count > 1) {
      duplicates.add(message.id);
    }
  }
  return duplicates;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
