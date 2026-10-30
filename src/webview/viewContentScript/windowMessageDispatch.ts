// Window message dispatch and startup requestState call.
export const VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH = `      window.addEventListener("message", (event) => {
        try {
          const data = event.data;
          if (data.type === "chatImageResolved") {
            applyChatImageSource(data);
          }
          if (data.type === "state") {
            applyState(data.payload);
          }
          if (data.type === "humanInteractionHistory") {
            applyHumanInteractionHistory(data.items);
          }
          if (data.type === "codexLongConnectionCount") {
            applyCodexLongConnectionCount(data);
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
            if (typeof instructionGroupOpenKeys !== "undefined") {
              instructionGroupOpenKeys.clear();
            }
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
            syncTabErrorFromMessage(eventTabId, data.message);
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
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            syncTabErrorFromMessage(eventTabId, data.message);
            const runtimeState = getConversationRuntimeState(eventTabId, { create: false });
            const replacement = data.message;
            if (runtimeState && replacement && typeof replacement.id === "string") {
              let replaced = false;
              const nextMessages = ensureRuntimeStateMessages(runtimeState).map((message) => {
                if (message.id !== replacement.id) {
                  return message;
                }
                replaced = true;
                return replacement;
              });
              if (replaced) {
                setMessagesForTab(eventTabId, nextMessages);
                if (isRuntimeStateForActiveTab(eventTabId)) {
                  updateRunPromptButton();
                  syncRunPromptOverlay();
                }
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
          if (data.type === "runActivity") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            if (eventTabId) {
              const runtimeState = getConversationRuntimeState(eventTabId);
              if (runtimeState) {
                runtimeState.runStreamActivityAt = Date.now();
                if (isRuntimeStateForActiveTab(eventTabId)) {
                  updateRunStreamButton();
                }
              }
            }
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
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            syncTabErrorFromMessage(eventTabId, { role: "trace", content: data.content });
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            applyTraceSegment(data);
          }
          if (data.type === "runningConversationTabsReconciled") {
            if (typeof startConversationTabRunningFlow === "function") {
              startConversationTabRunningFlow(data.startTabIds);
            }
            if (typeof stopConversationTabRunningFlow === "function") {
              stopConversationTabRunningFlow(data.stopTabIds);
            }
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
              if (
                typeof runningFlowStoppedTabIds !== "undefined"
                && runningFlowStoppedTabIds
                && typeof runningFlowStoppedTabIds.delete === "function"
                && targetTabId
              ) {
                runningFlowStoppedTabIds.delete(targetTabId);
              }
              runningTabStartedAtById[targetTabId] = typeof data.startedAt === "number" ? data.startedAt : Date.now();
              setTabErrored(targetTabId, false);
              resetRunRawStream(targetTabId, { syncOverlay: false });
              updateCurrentRunPrompt(data.prompt, targetTabId);
              if (runtimeState) {
                runtimeState.lastRunStatusMessage = "";
                runtimeState.activeRunActivity = normalizeRunActivity(data.activity);
                if (runtimeState.activeRunActivity !== "contextCompaction") {
                  runtimeState.tokensInContextWindow = null;
                  runtimeState.modelContextWindow = null;
                  runtimeState.contextWindowSource = null;
                }
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

            if (typeof syncConversationTabRunningFlowWatch === "function") {
              syncConversationTabRunningFlowWatch();
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
            if (data.status !== "start" && !isRunningOnActiveTab && typeof flushAssistantDeltaMarkdownRenders === "function") {
              flushAssistantDeltaMarkdownRenders();
            }
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
            if (typeof syncConversationTabRunningFlowWatch === "function") {
              syncConversationTabRunningFlowWatch();
            }
          }
          if (data.type === "contextTokenUsage") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            const targetTabId = eventTabId || getActiveConversationTabId();
            const runtimeState = getConversationRuntimeState(targetTabId);
            const tokens = typeof data.tokensInContextWindow === "number" && Number.isFinite(data.tokensInContextWindow)
              ? data.tokensInContextWindow
              : null;
            const windowSize = typeof data.modelContextWindow === "number" && Number.isFinite(data.modelContextWindow)
              ? data.modelContextWindow
              : null;
            if (runtimeState) {
              runtimeState.tokensInContextWindow = tokens;
              runtimeState.modelContextWindow = windowSize && windowSize > 0 ? windowSize : null;
              runtimeState.contextWindowSource = data.contextWindowSource === "adapter-fallback"
                ? "adapter-fallback"
                : data.contextWindowSource === "kimi-config-window"
                ? "kimi-config-window"
                : data.contextWindowSource === "zcode-projection"
                ? "zcode-projection"
                : null;
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            if (typeof updateContextTokenUsage === "function") {
              updateContextTokenUsage(runtimeState);
            }
          }
          if (data.type === "kimiCompactionUpdate") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            const targetTabId = eventTabId || getActiveConversationTabId();
            const runtimeState = getConversationRuntimeState(targetTabId);
            if (runtimeState) {
              runtimeState.activeRunActivity = data.status === "started" ? "contextCompaction" : "";
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            updateRunWait();
          }
          if (data.type === "zcodeThinkingOptions") {
            if (!shouldHandleTabScopedEvent(data) || state.currentCli !== "zcode") {
              return;
            }
            state.zcodeThinkingOptions = Array.isArray(data.options)
              ? data.options.filter((option) => ["low", "medium", "high", "xhigh", "max"].includes(option))
              : [];
            if (!state.zcodeThinkingOptions.includes(state.thinkingMode)
              && state.zcodeThinkingOptions.includes(data.currentValue)) {
              state.thinkingMode = data.currentValue;
            }
            if (typeof syncThinkingOptions === "function") {
              syncThinkingOptions();
            }
          }
          if (data.type === "dshReasoningOptions") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            state.dshReasoningOptions = Array.isArray(data.options)
              ? data.options.filter((option) => typeof option === "string" && option.trim())
              : [];
            if (typeof data.currentValue === "string" && state.dshReasoningOptions.includes(data.currentValue)) {
              state.thinkingMode = data.currentValue;
            }
            if (typeof syncThinkingOptions === "function") {
              syncThinkingOptions();
            }
          }
          if (data.type === "kimiThinkingOptions") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            // ACP 公布 off/low/.../max；off 由 resolveKimiThinkingValue 映射成配置里的档位，
            // 选择框只保留五档真实 effort，避免把 off 当成真实档位下发。
            const advertisedKimiThinking = Array.isArray(data.options)
              ? data.options.filter((option) =>
                typeof option === "string"
                && ["low", "medium", "high", "xhigh", "max"].includes(option.trim()),
              )
              : [];
            state.kimiThinkingOptions = advertisedKimiThinking;
            // 记录“ACP 确实公布过”，用于区分「还没收到广告」和「广告里没有五档努力值」。
            state.kimiThinkingOptionsAdvertised = Array.isArray(data.options) && data.options.length > 0;
            const confirmedKimiThinking = typeof data.currentValue === "string"
              ? data.currentValue.trim()
              : "";
            if (confirmedKimiThinking && advertisedKimiThinking.includes(confirmedKimiThinking)) {
              state.thinkingMode = confirmedKimiThinking;
            } else if (confirmedKimiThinking === "ultra" && advertisedKimiThinking.includes("max")) {
              state.thinkingMode = "max";
            }
            if (typeof syncThinkingOptions === "function") {
              syncThinkingOptions();
            }
          }
          if (data.type === "kimiModeUpdate") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            const modeTabId = typeof data.tabId === "string" && data.tabId
              ? data.tabId
              : getActiveConversationTabId();
            const modeRuntimeState = getConversationRuntimeState(modeTabId, { create: false });
            if (modeRuntimeState) {
              modeRuntimeState.kimiAcpModeId = typeof data.modeId === "string" && data.modeId.trim()
                ? data.modeId.trim()
                : null;
            }
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
          if (data.type === "scheduledTaskSaved") {
            if (elements.saveScheduledTask) {
              elements.saveScheduledTask.disabled = false;
            }
            if (data.error) {
              setScheduledTaskError(String(data.error));
            } else {
              showToast(t("scheduledTaskSaved"));
              if (elements.promptInput && elements.scheduledTaskPrompt && elements.promptInput.value === elements.scheduledTaskPrompt.value) {
                elements.promptInput.value = "";
              }
              if (elements.scheduledTaskPrompt) {
                elements.scheduledTaskPrompt.value = "";
              }
              if (elements.scheduledTaskTime) {
                elements.scheduledTaskTime.value = getDefaultScheduledTaskTime();
              }
              syncScheduledTaskModeSelect();
              scheduledTaskFiles = [];
              if (elements.scheduledTaskAttachmentInput) {
                elements.scheduledTaskAttachmentInput.value = "";
              }
              renderScheduledTaskAttachments();
              setScheduledTaskError("");
            }
          }
          if (data.type === "loopPlusAcceptancePlanSaved") {
            handleAcceptancePlanSavedMessage(data);
          }
          if (data.type === "loopPlusAcceptancePlanSelected") {
            handleAcceptancePlanSelectedMessage(data);
          }
          if (data.type === "insertPromptPaths" || data.type === "dropPathsResult") {
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
          if (data.type === "configApplyApplied") {
            if (
              typeof data.configId === "string"
              && data.configId
              && state.pendingConfigApply
              && state.pendingConfigApply.cli === data.cli
              && state.pendingConfigApply.configId === data.configId
            ) {
              state.pendingConfigApply = null;
            }
          }
          if (data.type === "configApplyError") {
            if (
              typeof data.configId === "string"
              && data.configId
              && state.pendingConfigApply
              && state.pendingConfigApply.cli === data.cli
              && state.pendingConfigApply.configId === data.configId
            ) {
              state.pendingConfigApply = null;
              if (data.cli === state.currentCli) {
                const activeConfigId = state.configState && typeof state.configState.activeConfigId === "string"
                  ? state.configState.activeConfigId
                  : "";
                state.selectedConfigId = activeConfigId;
                renderConfigOptions();
              }
            }
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
            const cliLabel = formatRuleTargetLabel(data.scope, data.cli);
            setRulesHint(t("rulesHintLoaded", { scope: scopeLabel, cli: cliLabel }));
          }
          if (data.type === "cliRepairIssues") {
            renderCliRepairIssues(data.issues);
          }
          if (data.type === "cliRepairResult") {
            if (data.error) {
              showToast(String(data.error));
            } else if (data.message) {
              showToast(String(data.message));
            }
            requestCliRepairs();
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
                  ? data.targets.map((target) => formatRuleTargetLabel(data.scope, target)).join(", ")
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
