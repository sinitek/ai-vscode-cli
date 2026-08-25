export type CodexRunSelection = {
  configId: string | null;
  model: string | null;
};

export type CodexThreadSelectionDecision = {
  threadId: string | null;
  freezePrevious: string | null;
  startedFreshForSelectionChange: boolean;
};

function normalizeSelectionValue(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

export function normalizeCodexRunSelection(selection: {
  configId?: string | null;
  model?: string | null;
}): CodexRunSelection {
  return {
    configId: normalizeSelectionValue(selection.configId),
    model: normalizeSelectionValue(selection.model),
  };
}

export function areCodexRunSelectionsEqual(
  previous: CodexRunSelection | null,
  next: CodexRunSelection
): boolean {
  if (!previous) {
    return true;
  }
  const normalizedPrevious = normalizeCodexRunSelection(previous);
  const normalizedNext = normalizeCodexRunSelection(next);
  return normalizedPrevious.configId === normalizedNext.configId
    && normalizedPrevious.model === normalizedNext.model;
}

export function decideCodexThreadForSelection(options: {
  mappedThreadId: string | null;
  previousSelection: CodexRunSelection | null;
  nextSelection: CodexRunSelection;
}): CodexThreadSelectionDecision {
  // Model/provider changes are applied by thread/resume. Keeping the threadId
  // preserves Codex's server-side conversation history across selection changes.
  return {
    threadId: options.mappedThreadId,
    freezePrevious: null,
    startedFreshForSelectionChange: false,
  };
}
