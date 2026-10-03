import type { CliName } from "../cli/types";
import type { RunProcess } from "../cli/commandRunner";
import type { ChatMessage } from "../webview/types";
import type { TaskRunDraft } from "../promptRunState";

export type PrimaryPromptRunState = {
  process: RunProcess | undefined;
  interactiveStop: (() => void) | null;
  assistantMessageId: string | undefined;
  traceMessageId: string | undefined;
  traceBuffer: string;
  traceSegmentLines: string[];
  completionSent: boolean;
  runId: string | undefined;
  taskRun: TaskRunDraft | null;
  messageTarget: ChatMessage[] | null;
  messageIndex: number | null;
  sessionId: string | null;
  cliForRun: CliName | null;
  tabIdForRun: string | null;
};

export type PrimaryPromptRunStart = {
  runId: string;
  cli: CliName;
  sessionId: string | null;
  tabId: string | null;
  messageTarget: ChatMessage[] | null;
};

export type PrimaryPromptRunController = {
  activeProcess: RunProcess | undefined;
  activeInteractiveStop: (() => void) | null;
  activeAssistantMessageId: string | undefined;
  activeTraceMessageId: string | undefined;
  activeTraceBuffer: string;
  activeTraceSegmentLines: string[];
  activeCompletionSent: boolean;
  activeRunId: string | undefined;
  activeTaskRun: TaskRunDraft | null;
  activeMessageTarget: ChatMessage[] | null;
  activeMessageIndex: number | null;
  activeSessionId: string | null;
  activeCliForRun: CliName | null;
  activeTabIdForRun: string | null;
  begin: (input: PrimaryPromptRunStart) => void;
  isCurrent: (runId: string | undefined) => boolean;
  clear: () => void;
  snapshot: () => PrimaryPromptRunState;
};

function createEmptyState(): PrimaryPromptRunState {
  return {
    process: undefined,
    interactiveStop: null,
    assistantMessageId: undefined,
    traceMessageId: undefined,
    traceBuffer: "",
    traceSegmentLines: [],
    completionSent: false,
    runId: undefined,
    taskRun: null,
    messageTarget: null,
    messageIndex: null,
    sessionId: null,
    cliForRun: null,
    tabIdForRun: null,
  };
}

export function createPrimaryPromptRunController(): PrimaryPromptRunController {
  let state = createEmptyState();

  const controller = {
    get activeProcess() {
      return state.process;
    },
    set activeProcess(value: RunProcess | undefined) {
      state.process = value;
    },
    get activeInteractiveStop() {
      return state.interactiveStop;
    },
    set activeInteractiveStop(value: (() => void) | null) {
      state.interactiveStop = value;
    },
    get activeAssistantMessageId() {
      return state.assistantMessageId;
    },
    set activeAssistantMessageId(value: string | undefined) {
      state.assistantMessageId = value;
    },
    get activeTraceMessageId() {
      return state.traceMessageId;
    },
    set activeTraceMessageId(value: string | undefined) {
      state.traceMessageId = value;
    },
    get activeTraceBuffer() {
      return state.traceBuffer;
    },
    set activeTraceBuffer(value: string) {
      state.traceBuffer = value;
    },
    get activeTraceSegmentLines() {
      return state.traceSegmentLines;
    },
    set activeTraceSegmentLines(value: string[]) {
      state.traceSegmentLines = value;
    },
    get activeCompletionSent() {
      return state.completionSent;
    },
    set activeCompletionSent(value: boolean) {
      state.completionSent = value;
    },
    get activeRunId() {
      return state.runId;
    },
    set activeRunId(value: string | undefined) {
      state.runId = value;
    },
    get activeTaskRun() {
      return state.taskRun;
    },
    set activeTaskRun(value: TaskRunDraft | null) {
      state.taskRun = value;
    },
    get activeMessageTarget() {
      return state.messageTarget;
    },
    set activeMessageTarget(value: ChatMessage[] | null) {
      state.messageTarget = value;
    },
    get activeMessageIndex() {
      return state.messageIndex;
    },
    set activeMessageIndex(value: number | null) {
      state.messageIndex = value;
    },
    get activeSessionId() {
      return state.sessionId;
    },
    set activeSessionId(value: string | null) {
      state.sessionId = value;
    },
    get activeCliForRun() {
      return state.cliForRun;
    },
    set activeCliForRun(value: CliName | null) {
      state.cliForRun = value;
    },
    get activeTabIdForRun() {
      return state.tabIdForRun;
    },
    set activeTabIdForRun(value: string | null) {
      state.tabIdForRun = value;
    },
    begin(input: PrimaryPromptRunStart) {
      state.runId = input.runId;
      state.cliForRun = input.cli;
      state.sessionId = input.sessionId;
      state.tabIdForRun = input.tabId;
      state.messageTarget = input.messageTarget;
    },
    isCurrent(runId: string | undefined) {
      return Boolean(runId) && state.runId === runId;
    },
    clear() {
      state = createEmptyState();
    },
    snapshot() {
      return {
        ...state,
        traceSegmentLines: [...state.traceSegmentLines],
      };
    },
  } satisfies PrimaryPromptRunController;

  return controller;
}
