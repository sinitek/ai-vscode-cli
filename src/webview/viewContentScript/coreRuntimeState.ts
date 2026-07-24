// Conversation runtime and prompt context state helpers.
export const VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE = `      function createTaskListState() {
        return {
          items: [],
          open: false,
          source: "auto",
          startIndex: 0,
        };
      }

      function createConversationRuntimeState() {
        return {
          messages: [],
          pendingPromptQueue: [],
          queueEditingIndex: -1,
          queueEditingDraft: "",
          pendingRunPrompt: null,
          suppressQueueFlushOnce: false,
          currentRunPrompt: "",
          lastRunStatusMessage: "",
          activeRunActivity: "",
          runStreamRecordCounter: 0,
          runStreamRecords: [],
          runStreamOpenRecordIds: new Set(),
          taskList: createTaskListState(),
          overlays: {
            runConflict: false,
            queue: false,
            runPrompt: false,
            runStream: false,
          },
        };
      }

      function resolveConversationRuntimeKey(tabId) {
        return typeof tabId === "string" && tabId ? tabId : TAB_RUNTIME_DEFAULT_KEY;
      }

      function getConversationRuntimeState(tabId, options = {}) {
        const key = resolveConversationRuntimeKey(tabId);
        const shouldCreate = options.create !== false;
        if (!conversationRuntimeByTabId[key] && shouldCreate) {
          conversationRuntimeByTabId[key] = createConversationRuntimeState();
        }
        return conversationRuntimeByTabId[key] || null;
      }

      function getActiveConversationRuntimeState(options = {}) {
        const activeTabId = state.conversationTabs ? state.conversationTabs.activeTabId : null;
        return getConversationRuntimeState(activeTabId, options);
      }

      function pruneConversationRuntimeStates(tabIds) {
        const validKeys = new Set([TAB_RUNTIME_DEFAULT_KEY]);
        if (Array.isArray(tabIds)) {
          tabIds.forEach((tabId) => {
            if (typeof tabId === "string" && tabId) {
              validKeys.add(tabId);
            }
          });
        }
        Object.keys(conversationRuntimeByTabId).forEach((key) => {
          if (!validKeys.has(key)) {
            delete conversationRuntimeByTabId[key];
          }
        });
        Object.keys(runningTabStartedAtById).forEach((key) => {
          if (!validKeys.has(key)) {
            delete runningTabStartedAtById[key];
          }
        });
        Array.from(erroredTabIds).forEach((tabId) => {
          if (!validKeys.has(tabId)) {
            erroredTabIds.delete(tabId);
          }
        });
        Object.keys(loopMetaByTabId).forEach((key) => {
          if (!validKeys.has(key)) {
            delete loopMetaByTabId[key];
          }
        });
      }

      function isRuntimeStateForActiveTab(tabId) {
        const activeTabId = getActiveConversationTabId();
        return resolveConversationRuntimeKey(tabId) === resolveConversationRuntimeKey(activeTabId);
      }

      function ensureRuntimeStateMessages(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.messages)) {
          if (runtimeState) {
            runtimeState.messages = [];
          }
          return [];
        }
        return runtimeState.messages;
      }

      function ensureRuntimeTaskList(runtimeState) {
        if (!runtimeState || !runtimeState.taskList || typeof runtimeState.taskList !== "object") {
          if (runtimeState) {
            runtimeState.taskList = createTaskListState();
          }
          return null;
        }
        if (!Array.isArray(runtimeState.taskList.items)) {
          runtimeState.taskList.items = [];
        }
        runtimeState.taskList.open = Boolean(runtimeState.taskList.open);
        runtimeState.taskList.source = runtimeState.taskList.source === "external" ? "external" : "auto";
        runtimeState.taskList.startIndex = Number.isInteger(runtimeState.taskList.startIndex)
          ? Math.max(0, runtimeState.taskList.startIndex)
          : 0;
        return runtimeState.taskList;
      }

      function getTaskListState(tabId, options = {}) {
        const runtimeState = getConversationRuntimeState(tabId, options);
        return ensureRuntimeTaskList(runtimeState);
      }

      function getActiveTaskListState(options = {}) {
        const runtimeState = getActiveConversationRuntimeState(options);
        return ensureRuntimeTaskList(runtimeState);
      }

      function resetTaskListState(taskListState, startIndex = 0) {
        if (!taskListState) {
          return;
        }
        taskListState.startIndex = Number.isInteger(startIndex) ? Math.max(0, startIndex) : 0;
        taskListState.items = [];
        taskListState.open = false;
        taskListState.source = "auto";
      }

      function syncActiveMessagesFromRuntime(options = {}) {
        const runtimeState = getActiveConversationRuntimeState({ create: true });
        const nextMessages = ensureRuntimeStateMessages(runtimeState);
        state.messages = nextMessages;
        if (options.render !== false) {
          renderMessages();
        }
      }

      function setMessagesForTab(tabId, messages, options = {}) {
        try {
          const runtimeState = getConversationRuntimeState(tabId, { create: true });
          runtimeState.messages = Array.isArray(messages) ? messages : [];
          const loopMetaChanged = updateLoopMetaForTabFromMessages(tabId, runtimeState.messages);
          const graphMetaChanged = updateGraphMetaForTabFromMessages(tabId, runtimeState.messages);
          const taskListState = ensureRuntimeTaskList(runtimeState);
          const shouldPreserveExternalTaskList = Boolean(
            taskListState
            && taskListState.source === "external"
            && isConversationTabBusy(tabId)
          );
          if (!shouldPreserveExternalTaskList) {
            resetTaskListState(taskListState, 0);
          }
          hydrateRunArtifactsFromMessages(tabId, runtimeState.messages);
          if (isRuntimeStateForActiveTab(tabId)) {
            state.messages = runtimeState.messages;
            if (options.render !== false) {
              renderMessages();
            }
          }
          if (loopMetaChanged || graphMetaChanged) {
            renderConversationTabs();
          }
        } catch (error) {
          reportWebviewFailure("setMessagesForTab-failed", error, {
            tabId,
            messageCount: Array.isArray(messages) ? messages.length : -1,
          });
          throw error;
        }
      }

      function isRunStatusSummaryText(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^(?:任务已完成|运行已终止|用户已终止|CLI\s*退出码[:：]\s*\S+|Task completed|Run stopped|Stopped by user|CLI exit code:\s*\S+)/i.test(normalized);
      }

      function normalizeRunActivity(activity) {
        return activity === "contextCompaction" ? "contextCompaction" : "";
      }

      function buildQueuePausedStatusText(summary, remainingCount) {
        const count = Number.isFinite(remainingCount) ? Math.max(0, Number(remainingCount)) : 0;
        const baseSummary = String(summary || "").trim();
        const pauseNotice = t("toastQueuePaused", { count: String(count) });
        if (!baseSummary) {
          return pauseNotice;
        }
        return baseSummary + " " + pauseNotice;
      }

      function shouldHideSystemRunStatusMessage(message) {
        if (!message || message.role !== "system") {
          return false;
        }
        return isRunStatusSummaryText(message.content);
      }

      function isFinalAssistantSummaryMessage(messageIndex) {
        if (!Array.isArray(state.messages) || messageIndex < 0 || messageIndex >= state.messages.length) {
          return false;
        }
        const current = state.messages[messageIndex];
        if (!current || current.role !== "assistant") {
          return false;
        }
        if (current.loopAnswerConclusion === true) {
          return true;
        }
        if (current.loopFinalSummary === true) {
          return true;
        }
        if (current.codexFinalAnswer === true) {
          return true;
        }
        for (let i = messageIndex + 1; i < state.messages.length; i += 1) {
          const next = state.messages[i];
          if (!next) {
            continue;
          }
          if (next.role === "system" && isRunStatusSummaryText(next.content)) {
            return true;
          }
          if (next.role === "system" && !String(next.content || "").trim()) {
            continue;
          }
          return false;
        }
        return false;
      }

      function deriveLatestRunPromptFromMessages(messages) {
        if (!Array.isArray(messages)) {
          return "";
        }
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const item = messages[i];
          if (!item || item.role !== "user") {
            continue;
          }
          const prompt = String(item.content || "").trim();
          if (prompt) {
            return prompt;
          }
        }
        return "";
      }

      function deriveLatestRunStatusMessageFromMessages(messages) {
        if (!Array.isArray(messages)) {
          return "";
        }
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const item = messages[i];
          if (!item || item.role !== "system") {
            continue;
          }
          const content = String(item.content || "").trim();
          if (isRunStatusSummaryText(content)) {
            return content;
          }
        }
        return "";
      }

      function hydrateRunArtifactsFromMessages(tabId, messages) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        if (!runtimeState || isTabRunning(tabId)) {
          return;
        }

        const promptFromMessages = deriveLatestRunPromptFromMessages(messages);
        if (promptFromMessages) {
          runtimeState.currentRunPrompt = promptFromMessages;
        }

        const statusFromMessages = deriveLatestRunStatusMessageFromMessages(messages);
        runtimeState.lastRunStatusMessage = statusFromMessages || "";

      }

      function resetConversationRuntimeState(tabId) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        if (!runtimeState) {
          return;
        }
        resetTaskListState(ensureRuntimeTaskList(runtimeState), 0);
        ensureRuntimeStateMessages(runtimeState).length = 0;
        runtimeState.pendingPromptQueue.length = 0;
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        runtimeState.pendingRunPrompt = null;
        runtimeState.suppressQueueFlushOnce = false;
        runtimeState.currentRunPrompt = "";
        runtimeState.lastRunStatusMessage = "";
        runtimeState.activeRunActivity = "";
        runtimeState.runStreamRecordCounter = 0;
        runtimeState.runStreamRecords.length = 0;
        runtimeState.runStreamOpenRecordIds.clear();
        runtimeState.overlays.runConflict = false;
        runtimeState.overlays.queue = false;
        runtimeState.overlays.runPrompt = false;
        runtimeState.overlays.runStream = false;
        if (isRuntimeStateForActiveTab(tabId)) {
          syncActiveMessagesFromRuntime();
          syncConversationControlsForActiveTab();
        }
      }

      function normalizeEditorContext(payload) {
        const filePath = payload && typeof payload.filePath === "string" && payload.filePath
          ? payload.filePath
          : null;
        const fileLabel = payload && typeof payload.fileLabel === "string" && payload.fileLabel
          ? payload.fileLabel
          : filePath;
        const hasSelection = Boolean(payload && payload.hasSelection);
        const selectionLabel = payload && typeof payload.selectionLabel === "string" && payload.selectionLabel
          ? payload.selectionLabel
          : null;
        return {
          filePath,
          fileLabel,
          hasSelection,
          selectionLabel,
        };
      }

      function getFileTagKeyFor(editorContext) {
        if (!editorContext) {
          return "";
        }
        return editorContext.filePath || editorContext.fileLabel || "";
      }

      function getSelectionTagKeyFor(editorContext) {
        if (!editorContext || !editorContext.hasSelection) {
          return "";
        }
        const base = getFileTagKeyFor(editorContext);
        return base + "::" + (editorContext.selectionLabel || "selection");
      }

      function getCurrentFileTagKey() {
        return getFileTagKeyFor(state.editorContext);
      }

      function getSelectionTagKey() {
        return getSelectionTagKeyFor(state.editorContext);
      }

      function syncPromptContextWithEditorContext(options = {}) {
        const resetDismissed = Boolean(options.resetDismissed);
        if (resetDismissed) {
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        }

        if (!state.autoAddEditorContextTags) {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
          return;
        }

        if (!state.promptContext.autoIncludeArmed) {
          return;
        }

        const fileKey = getCurrentFileTagKey();
        if (!fileKey) {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.dismissedFileKey = "";
        } else {
          state.promptContext.includeCurrentFile = state.promptContext.dismissedFileKey !== fileKey;
        }

        const selectionKey = getSelectionTagKey();
        if (!selectionKey) {
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedSelectionKey = "";
        } else {
          state.promptContext.includeSelection = state.promptContext.dismissedSelectionKey !== selectionKey;
        }
      }

      function formatPromptContextTagLabel() {
        if (!state.editorContext.fileLabel) {
          return state.editorContext.selectionLabel
            ? "[" + state.editorContext.selectionLabel + "]"
            : t("contextTagSelection");
        }
        if (state.editorContext.hasSelection && state.promptContext.includeSelection && state.editorContext.selectionLabel) {
          return t("contextTagSelectionWithRange", {
            file: state.editorContext.fileLabel,
            range: state.editorContext.selectionLabel,
          });
        }
        return t("contextTagCurrentFile") + ": " + state.editorContext.fileLabel;
      }

      function removePromptContextTag(kind) {
        if (kind === "editorContext") {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = getCurrentFileTagKey();
          state.promptContext.dismissedSelectionKey = getSelectionTagKey();
        }
        renderPromptContextTags();
      }

      function renderPromptContextTags() {
        if (!elements.promptContextTags) {
          return;
        }
        if (!state.autoAddEditorContextTags) {
          elements.promptContextTags.innerHTML = "";
          elements.promptContextTags.style.display = "none";
          return;
        }
        elements.promptContextTags.innerHTML = "";
        const hasFileTag = Boolean(state.editorContext.fileLabel && state.promptContext.includeCurrentFile);
        const hasSelectionTag = Boolean(state.editorContext.hasSelection && state.promptContext.includeSelection);

        if (!hasFileTag && !hasSelectionTag) {
          elements.promptContextTags.style.display = "none";
          return;
        }

        const chip = document.createElement("div");
        chip.className = "prompt-context-tag";

        const label = document.createElement("span");
        label.className = "prompt-context-tag-label";
        label.textContent = formatPromptContextTagLabel();
        label.title = label.textContent;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "prompt-context-tag-remove";
        removeButton.textContent = "x";
        removeButton.setAttribute("aria-label", t("contextTagRemoveAria", { label: t("contextTagCurrentFile") }));
        removeButton.setAttribute("title", t("contextTagRemoveAria", { label: t("contextTagCurrentFile") }));
        removeButton.addEventListener("click", () => {
          removePromptContextTag("editorContext");
        });

        chip.appendChild(label);
        chip.appendChild(removeButton);
        elements.promptContextTags.appendChild(chip);
        elements.promptContextTags.style.display = "flex";
      }

      function rearmPromptContextOnEditorChange(previousContext, nextContext) {
        const previousFileKey = getFileTagKeyFor(previousContext);
        const previousSelectionKey = getSelectionTagKeyFor(previousContext);
        const nextFileKey = getFileTagKeyFor(nextContext);
        const nextSelectionKey = getSelectionTagKeyFor(nextContext);

        if (previousFileKey !== nextFileKey) {
          if (!nextFileKey) {
            state.promptContext.includeCurrentFile = false;
            state.promptContext.dismissedFileKey = "";
          } else if (state.promptContext.dismissedFileKey === nextFileKey) {
            state.promptContext.includeCurrentFile = false;
          } else {
            state.promptContext.includeCurrentFile = true;
            if (state.promptContext.dismissedFileKey) {
              state.promptContext.dismissedFileKey = "";
            }
          }
        }

        if (previousSelectionKey !== nextSelectionKey) {
          if (!nextSelectionKey) {
            state.promptContext.includeSelection = false;
            state.promptContext.dismissedSelectionKey = "";
          } else if (state.promptContext.dismissedSelectionKey === nextSelectionKey) {
            state.promptContext.includeSelection = false;
          } else {
            state.promptContext.includeSelection = true;
            if (state.promptContext.dismissedSelectionKey) {
              state.promptContext.dismissedSelectionKey = "";
            }
          }
        }
      }

      function applyEditorContext(payload, options = {}) {
        const nextEditorContext = normalizeEditorContext(payload);
        const previousEditorContext = state.editorContext;
        const shouldAutoRearm = options.autoRearm !== false;

        if (shouldAutoRearm && !state.promptContext.autoIncludeArmed) {
          rearmPromptContextOnEditorChange(previousEditorContext, nextEditorContext);
        }

        state.editorContext = nextEditorContext;
        syncPromptContextWithEditorContext(options);
        renderPromptContextTags();
      }

      function buildPromptPayload(prompt) {
        const autoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        const includeCurrentFile = Boolean(autoAddEditorContextTags && state.promptContext.includeCurrentFile && getCurrentFileTagKey());
        const includeSelection = Boolean(autoAddEditorContextTags && state.promptContext.includeSelection && state.editorContext.hasSelection);
        return {
          prompt,
          contextOptions: {
            includeCurrentFile,
            includeSelection,
          },
        };
      }

      function normalizePromptPayload(payload) {
        if (!payload) {
          return null;
        }
        if (typeof payload === "string") {
          return {
            prompt: payload,
            contextOptions: {
              includeCurrentFile: true,
              includeSelection: true,
            },
          };
        }
        const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
        if (!prompt) {
          return null;
        }
        const contextOptions = payload.contextOptions || {};
        const interactiveMode = payload.interactiveMode === "loop" || payload.interactiveMode === "coding" || payload.interactiveMode === "graph"
          ? payload.interactiveMode
          : undefined;
        return {
          prompt,
          contextOptions: {
            includeCurrentFile: contextOptions.includeCurrentFile !== false,
            includeSelection: contextOptions.includeSelection !== false,
          },
          ...(interactiveMode ? { interactiveMode } : {}),
        };
      }

      function armPromptContextForConversationStart() {
        state.promptContext.autoIncludeArmed = true;
        syncPromptContextWithEditorContext({ resetDismissed: true });
        renderPromptContextTags();
      }

      function resetPromptContextForNextPrompt() {
        state.promptContext.autoIncludeArmed = false;
        state.promptContext.includeCurrentFile = false;
        state.promptContext.includeSelection = false;
        renderPromptContextTags();
      }

`;
