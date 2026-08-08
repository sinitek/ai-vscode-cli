// Window message dispatch and startup requestState call.
export const VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH = `      window.addEventListener("message", (event) => {
        try {
          const data = event.data;
          if (data.type === "state") {
            applyState(data.payload);
          }
          if (data.type === "editorContext") {
            applyEditorContext(data.payload);
          }
          if (data.type === "setMessages") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            const incoming = Array.isArray(data.messages) ? data.messages : [];
            setMessagesForTab(eventTabId, normalizeMessageOrder(incoming), { render: false });
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            traceCollapsibleOpenKeys.clear();
            syncConversationControlsForActiveTab();
            renderMessages();
          }
          if (data.type === "sessionLoadError") {
            console.error("[sinitek-webview] sessionLoadError", {
              title: data.title,
              detail: data.detail,
              tabId: data.tabId || null,
              sessionId: data.sessionId || null,
              cli: data.cli || null,
            });
          }
          if (data.type === "appendMessage") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            const loopMetaChanged = updateLoopMetaForTabFromMessage(eventTabId, data.message);
            const graphMetaChanged = updateGraphMetaForTabFromMessage(eventTabId, data.message);
            if (loopMetaChanged || graphMetaChanged) {
              renderConversationTabs();
            }
            if (graphMetaChanged && typeof syncOpenCurrentGraphRunButton === "function") {
              syncOpenCurrentGraphRunButton();
            }
            const runtimeState = getConversationRuntimeState(eventTabId, { create: false });
            let statusSummaryUpdated = false;
            if (runtimeState && data.message && data.message.role === "system") {
              const content = String(data.message.content || "").trim();
              if (isHiddenRetryQueuedMessage(content)) {
                setTabErrored(eventTabId, true);
              }
              if (isHiddenRetryStartedMessage(content)) {
                setTabErrored(eventTabId, false);
              }
              if (isRunStatusSummaryText(content)) {
                runtimeState.lastRunStatusMessage = content;
                statusSummaryUpdated = true;
              }
            }
            if (data.message && data.message.role === "assistant" && String(data.message.content || "").trim()) {
              setTabErrored(eventTabId, false);
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            appendMessage(data.message);
            if (statusSummaryUpdated) {
              syncConversationControlsForActiveTab();
            }
          }
          if (data.type === "replaceMessage") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            const replacement = data.message;
            if (replacement && typeof replacement.id === "string") {
              let replaced = false;
              const nextMessages = state.messages.map((message) => {
                if (message.id !== replacement.id) {
                  return message;
                }
                replaced = true;
                return replacement;
              });
              if (replaced) {
                setMessagesForTab(getActiveConversationTabId(), nextMessages);
              }
            }
          }
          if (data.type === "assistantDelta") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            if (String(data.content || "").trim()) {
              setTabErrored(eventTabId, false);
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            appendAssistantDelta(data.id, data.content, data.kind, {
              codexFinalAnswer: data.codexFinalAnswer === true,
            });
          }
          if (data.type === "rawStreamDelta") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            if (eventTabId && String(data.content || "").trim()) {
              // Hidden-retry may set a tab to errored; once fresh stream output arrives, recover to running/normal state.
              setTabErrored(eventTabId, false);
            }
            appendRunRawStream(data.content, data.stream, eventTabId || getActiveConversationTabId());
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
          }
          if (data.type === "traceSegment") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            applyTraceSegment(data);
          }
          if (data.type === "runStatus") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            const targetTabId = eventTabId || getActiveConversationTabId();
            const graphMetaChanged = updateGraphMetaForTabFromRunStatus(targetTabId, data);
            if (graphMetaChanged) {
              renderConversationTabs();
            }
            const runtimeState = getConversationRuntimeState(targetTabId);
            const shouldHandleActiveTabEvent = shouldHandleTabScopedEvent(data);
            let queuePausedNotice = "";
            if (data.status === "start") {
              runningTabStartedAtById[targetTabId] = typeof data.startedAt === "number" ? data.startedAt : Date.now();
              setTabErrored(targetTabId, false);
              resetRunRawStream(targetTabId, { syncOverlay: false });
              updateCurrentRunPrompt(data.prompt, targetTabId);
              if (runtimeState) {
                runtimeState.lastRunStatusMessage = "";
                runtimeState.activeRunActivity = normalizeRunActivity(data.activity);
              }
              resetTaskListForRunStart(targetTabId);
            } else {
              if (data.status === "error") {
                setTabErrored(targetTabId, true);
              } else {
                setTabErrored(targetTabId, false);
              }
              if (runtimeState && typeof data.message === "string" && isRunStatusSummaryText(data.message)) {
                runtimeState.lastRunStatusMessage = data.message.trim();
              }
              if (runtimeState) {
                runtimeState.activeRunActivity = "";
              }
              if (eventTabId) {
                delete runningTabStartedAtById[eventTabId];
              } else {
                const fallbackTabId = getActiveConversationTabId();
                if (fallbackTabId) {
                  delete runningTabStartedAtById[fallbackTabId];
                }
              }
              const hasPendingQueue = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
              const shouldPauseQueueNotice = data.status !== "end"
                && hasPendingQueue
                && !(runtimeState && runtimeState.suppressQueueFlushOnce);
              if (shouldPauseQueueNotice && runtimeState) {
                queuePausedNotice = t("toastQueuePaused", { count: String(runtimeState.pendingPromptQueue.length) });
                runtimeState.lastRunStatusMessage = buildQueuePausedStatusText(
                  runtimeState.lastRunStatusMessage || data.message || "",
                  runtimeState.pendingPromptQueue.length,
                );
              }
              closeTaskListForRunCompletion(targetTabId);
            }

            if (!shouldHandleActiveTabEvent) {
              renderConversationTabs();
              if (data.status !== "start") {
                if (runtimeState && runtimeState.suppressQueueFlushOnce) {
                  runtimeState.suppressQueueFlushOnce = false;
                } else if (data.status === "end") {
                  flushPendingPromptQueue(targetTabId);
                }
              }
              return;
            }

            const activeTabId = getActiveConversationTabId();
            const isRunningOnActiveTab = isTabRunning(activeTabId);
            updateRunningState(isRunningOnActiveTab, {
              preserveRunArtifacts: true,
              startedAt: isRunningOnActiveTab ? getTabRunStartedAt(activeTabId) : 0,
            });
            if (data.status === "start") {
              Object.keys(assistantRedirects).forEach((key) => {
                delete assistantRedirects[key];
              });
            }
            if (data.message) {
              if (!isDuplicateSystemStatusMessage(data.message)) {
                appendMessage({ id: createMessageId(), role: "system", content: data.message });
              }
            }
            if (queuePausedNotice) {
              showToast(queuePausedNotice);
            }
            if (data.status !== "start") {
              if (runtimeState && runtimeState.suppressQueueFlushOnce) {
                runtimeState.suppressQueueFlushOnce = false;
              } else if (data.status === "end") {
                flushPendingPromptQueue(targetTabId);
              }
            }
            syncConversationControlsForActiveTab();
          }
          if (data.type === "removeMessage") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            if (data.id) {
              const nextMessages = state.messages.filter((message) => message.id !== data.id);
              setMessagesForTab(getActiveConversationTabId(), nextMessages);
            }
          }
          if (data.type === "uploadResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "dropPathsResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "pickWorkspacePathResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            } else if (data.canceled || data.error) {
              insertPromptText("@");
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "runStreamExportResult") {
            handleRunStreamExportResult(data);
          }
          if (data.type === "historySessionMessages") {
            handleHistorySessionMessages(data);
          }
          if (data.type === "historySessionExportResult") {
            handleHistorySessionExportResult(data);
          }
          if (data.type === "configApplyError") {
            openConfigApplyErrorOverlay(data.error);
          }
          if (data.type === "taskListUpdate") {
            applyExternalTaskListUpdate(data.items, data.tabId);
          }
          if (data.type === "humanInteractionRequest") {
            openHumanInteractionDialog(data.request);
          }
          if (data.type === "humanInteractionCancel") {
            cancelHumanInteractionDialog(typeof data.tabId === "string" ? data.tabId : "");
            if (data.statusText) {
              showToast(String(data.statusText));
            }
          }
          if (data.type === "rulesContent") {
            if (data.error) {
              setRulesHint(data.error);
              return;
            }
            elements.rulesInput.value = typeof data.content === "string" ? data.content : "";
            const scopeLabel = data.scope === "project"
              ? t("rulesScopeProject")
              : t("rulesScopeGlobal");
            const cliLabel = data.scope === "project" && data.cli === "codex" ? "codex/opencode" : data.cli;
            setRulesHint(t("rulesHintLoaded", { scope: scopeLabel, cli: cliLabel }));
          }
          if (data.type === "rulesSaved") {
            if (data.error) {
              setRulesHint(data.error);
              return;
            }
            const scopeLabel = data.scope === "project"
              ? t("rulesScopeProject")
              : t("rulesScopeGlobal");
            setRulesHint(
              t("rulesHintSaved", {
                scope: scopeLabel,
                targets: Array.isArray(data.targets)
                  ? data.targets.map((target) => data.scope === "project" && target === "codex" ? "codex/opencode" : target).join(", ")
                  : "",
              })
            );
          }
        } catch (error) {
          reportWebviewFailure("window-message-handler-failed", error, {
            eventType: event && event.data && event.data.type ? event.data.type : null,
          });
        }
      });

      updateAppHeight();
      window.addEventListener("resize", scheduleAppHeightUpdate);
      vscode.postMessage({ type: "requestState" });
`;
