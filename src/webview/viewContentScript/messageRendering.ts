// Message rendering and conversation tab helpers.
export const VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING = `      function captureOpenTraceCollapsibleKeys() {
        traceCollapsibleOpenKeys.clear();
        const nodes = elements.messages.querySelectorAll("details.trace-collapsible[data-trace-key]");
        nodes.forEach((node) => {
          if (!node.open) {
            return;
          }
          const key = node.getAttribute("data-trace-key");
          if (key) {
            traceCollapsibleOpenKeys.add(key);
          }
        });
      }

      function forceCollapseToolResultBubbles() {
        const nodes = elements.messages.querySelectorAll("details.trace-collapsible.trace-collapsible-tool-result[open]");
        nodes.forEach((node) => {
          try {
            node.open = false;
            node.removeAttribute("open");
          } catch {
            // ignore
          }
        });
      }

      function isWarningOrErrorMessage(message) {
        if (!message || (message.role !== "trace" && message.role !== "system")) {
          return false;
        }
        const presentation = getTracePresentation(message.content || "");
        return Boolean(
          presentation
          && (presentation.type === "warning" || presentation.type === "error")
        );
      }

      function normalizeDuplicateMessageContent(content) {
        return typeof content === "string"
          ? content.replace(/\\r\\n/g, "\\n").trim()
          : "";
      }

      function hasExistingMessageId(message) {
        const id = message && typeof message.id === "string" ? message.id : "";
        return Boolean(
          id
          && Array.isArray(state.messages)
          && state.messages.some((existing) => existing && existing.id === id)
        );
      }

      function findExistingMessageIndexById(messageId) {
        if (!messageId || !Array.isArray(state.messages)) {
          return -1;
        }
        return state.messages.findIndex((existing) => existing && existing.id === messageId);
      }

      function isNearDuplicateWarningOrErrorMessage(message, last) {
        if (!message || !last) {
          return false;
        }
        if (message.role !== last.role || (message.role !== "trace" && message.role !== "system")) {
          return false;
        }
        if (message.role === "trace" && (message.kind || "normal") !== (last.kind || "normal")) {
          return false;
        }
        if (!isWarningOrErrorMessage(message) || !isWarningOrErrorMessage(last)) {
          return false;
        }
        const content = normalizeDuplicateMessageContent(message.content);
        const lastContent = normalizeDuplicateMessageContent(last.content);
        if (!content || content !== lastContent) {
          return false;
        }
        const createdAt = typeof message.createdAt === "number" ? message.createdAt : Date.now();
        const lastCreatedAt = typeof last.createdAt === "number" ? last.createdAt : 0;
        return lastCreatedAt > 0 && Math.abs(createdAt - lastCreatedAt) <= DUPLICATE_STATUS_TRACE_WINDOW_MS;
      }

      function shouldShowMessageInResultOnlyMode(message, messageIndex) {
        if (!message) {
          return false;
        }
        if (message.role === "user") {
          return true;
        }
        if (isWarningOrErrorMessage(message)) {
          return true;
        }
        return message.role === "assistant" && isFinalAssistantSummaryMessage(messageIndex);
      }

      function getVisibleMessages() {
        if (!Array.isArray(state.messages) || state.messages.length === 0) {
          return [];
        }
        return state.messages
          .map((message, index) => ({ message, index }))
          .filter(({ message, index }) => {
            if (shouldHideSystemRunStatusMessage(message)) {
              return false;
            }
            if (typeof shouldHideParsedTaskListMessage === "function" && shouldHideParsedTaskListMessage(message)) {
              return false;
            }
            if (!state.onlyShowFinalResults) {
              return true;
            }
            return shouldShowMessageInResultOnlyMode(message, index);
          });
      }

      function persistWebviewUiState() {
        try {
          vscode.setState({
            onlyShowFinalResults: state.onlyShowFinalResults,
          });
        } catch {
          // ignore
        }
      }

      function normalizeInteractiveMode(value) {
        if (value === "loop" || value === "graph") {
          return value;
        }
        return "coding";
      }

      function getMessageTaskRoleLabel(message) {
        if (!message || message.taskRole !== "main" && message.taskRole !== "subtask") {
          return "";
        }
        if (message.taskRole === "main") {
          return t("taskRoleMain");
        }
        const round = typeof message.loopRound === "number" && Number.isFinite(message.loopRound)
          ? Math.floor(message.loopRound)
          : 0;
        if (round > 0) {
          return t("taskRoleSubtaskWithRound", { round });
        }
        return t("taskRoleSubtask");
      }

      function createMessageTaskRoleElement(message) {
        const label = getMessageTaskRoleLabel(message);
        if (!label) {
          return null;
        }
        const badge = document.createElement("div");
        badge.className = "message-task-role message-task-role-" + message.taskRole;
        badge.textContent = label;
        return badge;
      }

      function applyMessageElementClasses(wrapper, message, index) {
        wrapper.className = "message " + message.role;
        const tracePresentation = getTracePresentation(message.content || "");
        const shouldUseTraceWrapper = message.role === "trace" || tracePresentation.type === "tool-result";
        if (shouldUseTraceWrapper) {
          wrapper.classList.add("trace");
          const isThinkingTrace = message.kind === "thinking" || tracePresentation.type === "thinking";
          wrapper.classList.add(isThinkingTrace ? "trace-thinking" : "trace-nonthinking");
          if (tracePresentation.type) {
            wrapper.classList.add("trace-type-" + tracePresentation.type);
          }
          if (tracePresentation.commandTag && tracePresentation.commandTag.type) {
            wrapper.classList.add("trace-command-purpose-" + tracePresentation.commandTag.type);
          }
        }
        if (message.role === "assistant" && isFinalAssistantSummaryMessage(index)) {
          wrapper.classList.add("message-final-summary");
        }
      }

      function normalizeMessageAction(action) {
        if (!action || typeof action !== "object") {
          return null;
        }
        if (action.type === "openLoopGroupChat") {
          const taskId = normalizeLoopTaskId(action.taskId);
          if (!taskId) {
            return null;
          }
          const roundKey = typeof action.roundKey === "string" && action.roundKey.trim()
            ? action.roundKey.trim()
            : "";
          const label = typeof action.label === "string" && action.label.trim()
            ? action.label.trim()
            : t("openLoopGroupChatAction");
          return {
            type: "openLoopGroupChat",
            taskId,
            roundKey,
            label,
          };
        }
        if (action.type === "openGraphRun") {
          const graphRunId = typeof action.graphRunId === "string" && action.graphRunId.trim()
            ? action.graphRunId.trim()
            : "";
          if (!graphRunId) {
            return null;
          }
          const nodeId = typeof action.nodeId === "string" && action.nodeId.trim()
            ? action.nodeId.trim()
            : "";
          const label = typeof action.label === "string" && action.label.trim()
            ? action.label.trim()
            : t("openGraphRunAction");
          return {
            type: "openGraphRun",
            graphRunId,
            nodeId,
            label,
          };
        }
        return null;
      }

      function normalizeMessageActions(message) {
        const actions = Array.isArray(message && message.actions) ? message.actions : [];
        return actions
          .map((action) => normalizeMessageAction(action))
          .filter(Boolean);
      }

      function handleMessageAction(action) {
        if (!action) {
          return;
        }
        if (action.type === "openLoopGroupChat" && action.taskId) {
          vscode.postMessage({
            type: "openLoopGroupChat",
            taskId: action.taskId,
            roundKey: action.roundKey || undefined,
          });
          return;
        }
        if (action.type === "openGraphRun" && action.graphRunId) {
          vscode.postMessage({
            type: "openGraphRun",
            graphRunId: action.graphRunId,
            nodeId: action.nodeId || undefined,
          });
        }
      }

      function createMessageActionsElement(message) {
        const actions = normalizeMessageActions(message);
        if (!actions.length) {
          return null;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "message-actions";
        actions.forEach((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "message-action-link";
          button.textContent = action.label;
          button.title = action.type === "openLoopGroupChat"
            ? t("openLoopGroupChatActionTitle")
            : action.type === "openGraphRun"
              ? t("openGraphRunActionTitle")
              : action.label;
          button.addEventListener("click", () => {
            handleMessageAction(action);
          });
          wrapper.appendChild(button);
        });
        return wrapper;
      }

      function createMessageElement(message, index) {
        const wrapper = document.createElement("div");
        applyMessageElementClasses(wrapper, message, index);
        if (message && message.id) {
          wrapper.dataset.messageId = message.id;
        }

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.innerHTML = safelyRenderMessageContent(message, index);
        const actions = createMessageActionsElement(message);
        if (actions) {
          bubble.appendChild(actions);
        }

        if (message.role === "user" && message.createdAt) {
          const time = document.createElement("div");
          time.className = "message-time";
          time.textContent = formatDateTime(message.createdAt);
          wrapper.appendChild(time);
        }
        const taskRoleBadge = createMessageTaskRoleElement(message);
        if (taskRoleBadge) {
          wrapper.appendChild(taskRoleBadge);
        }
        wrapper.appendChild(bubble);
        return wrapper;
      }

      function findRenderedMessageElement(messageId) {
        if (!messageId || !elements.messages) {
          return null;
        }
        const children = Array.from(elements.messages.children);
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (child && child.dataset && child.dataset.messageId === messageId) {
            return child;
          }
        }
        return null;
      }

      function updateRenderedAssistantMessage(message, index) {
        if (!message || message.role !== "assistant" || !message.id) {
          return false;
        }
        if (typeof shouldHideParsedTaskListMessage === "function" && shouldHideParsedTaskListMessage(message)) {
          renderMessages();
          return true;
        }
        const wrapper = findRenderedMessageElement(message.id);
        if (!wrapper) {
          return false;
        }
        applyMessageElementClasses(wrapper, message, index);
        const oldBadge = wrapper.querySelector(".message-task-role");
        if (oldBadge) {
          oldBadge.remove();
        }
        const bubble = wrapper.querySelector(".bubble");
        if (!bubble) {
          return false;
        }
        const nextBadge = createMessageTaskRoleElement(message);
        if (nextBadge) {
          wrapper.insertBefore(nextBadge, bubble);
        }
        bubble.innerHTML = safelyRenderMessageContent(message, index);
        return true;
      }

      function renderMessages() {
        try {
          const shouldAutoScroll = !elements.messages.childElementCount || shouldFollowLatestMessagesForActiveTab() || isChatNearBottom();
          captureOpenTraceCollapsibleKeys();
          elements.messages.innerHTML = "";
          const visibleMessages = getVisibleMessages();
          visibleMessages.forEach(({ message, index }) => {
            elements.messages.appendChild(createMessageElement(message, index));
          });

          forceCollapseToolResultBubbles();
          elements.emptyState.style.display = visibleMessages.length === 0 ? "block" : "none";
          updateRunWait();
          if (shouldAutoScroll) {
            stickChatToBottom("auto");
          } else {
            updateScrollToBottomButton();
          }
          updateTaskList();
        } catch (error) {
          reportWebviewFailure("renderMessages-failed", error, {
            activeTabId: getActiveConversationTabId(),
            messageCount: Array.isArray(state.messages) ? state.messages.length : -1,
          });
          elements.messages.innerHTML = '<div class="message system"><div class="bubble"><div class="system-line"><span class="system-text">' + escapeHtml(t("session.loadFailedMessage")) + '</span></div></div></div>';
          elements.emptyState.style.display = "none";
        }
      }

      function normalizeMessageOrder(messages) {
        if (!Array.isArray(messages) || messages.length <= 1) {
          return Array.isArray(messages) ? messages : [];
        }
        const entries = messages.map((message, index) => ({ message, index }));
        const allHaveSequence = entries.every((entry) => typeof entry.message.sequence === "number");
        if (!allHaveSequence) {
          return messages;
        }
        return entries
          .slice()
          .sort((a, b) => (a.message.sequence - b.message.sequence) || (a.index - b.index))
          .map((entry) => entry.message);
      }

      function getActiveConversationTabId() {
        return state.conversationTabs ? state.conversationTabs.activeTabId : null;
      }

      function getConversationTabSummary(tabId) {
        if (!tabId || !state.conversationTabs || !Array.isArray(state.conversationTabs.tabs)) {
          return null;
        }
        return state.conversationTabs.tabs.find((tab) => tab && tab.id === tabId) || null;
      }

      function isActiveConversationTabResetLocked() {
        const activeTabId = getActiveConversationTabId();
        return isConversationTabBusy(activeTabId);
      }

      function normalizeLoopTaskRole(value) {
        return value === "main" || value === "subtask" ? value : "";
      }

      function normalizeLoopTaskId(value) {
        if (typeof value !== "string") {
          return "";
        }
        return value.trim();
      }

      function normalizeGraphRunId(value) {
        if (typeof value !== "string") {
          return "";
        }
        return value.trim();
      }

      function setLoopMetaForTab(tabId, role, taskId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        const normalizedRole = normalizeLoopTaskRole(role);
        const normalizedTaskId = normalizeLoopTaskId(taskId);
        const hadMeta = Object.prototype.hasOwnProperty.call(loopMetaByTabId, tabId);
        const previous = hadMeta ? loopMetaByTabId[tabId] : undefined;
        if (!normalizedRole || !normalizedTaskId) {
          if (!hadMeta) {
            return false;
          }
          delete loopMetaByTabId[tabId];
          return true;
        }
        if (
          previous
          && previous !== null
          && previous.taskRole === normalizedRole
          && previous.loopTaskId === normalizedTaskId
        ) {
          return false;
        }
        loopMetaByTabId[tabId] = {
          taskRole: normalizedRole,
          loopTaskId: normalizedTaskId,
        };
        return true;
      }

      function overrideLoopMetaAsCleared(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        if (Object.prototype.hasOwnProperty.call(loopMetaByTabId, tabId) && loopMetaByTabId[tabId] === null) {
          return false;
        }
        loopMetaByTabId[tabId] = null;
        return true;
      }

      function updateLoopMetaForTabFromSummary(tab) {
        if (!tab || !tab.id) {
          return false;
        }
        if (
          Object.prototype.hasOwnProperty.call(loopMetaByTabId, tab.id)
          && loopMetaByTabId[tab.id] === null
        ) {
          // Keep local explicit clear marker to avoid stale backend state re-adding prefix.
          return false;
        }
        const taskRole = normalizeLoopTaskRole(tab.loopTaskRole);
        const loopTaskId = normalizeLoopTaskId(tab.loopTaskId);
        if (!taskRole || !loopTaskId) {
          return false;
        }
        return setLoopMetaForTab(tab.id, taskRole, loopTaskId);
      }

      function updateLoopMetaForTabFromMessage(tabId, message) {
        if (!tabId || !message || typeof message !== "object") {
          return false;
        }
        const taskRole = normalizeLoopTaskRole(message.taskRole);
        const loopTaskId = normalizeLoopTaskId(message.loopTaskId);
        if (!taskRole || !loopTaskId) {
          if (message.role === "user" && String(message.content || "").trim()) {
            return overrideLoopMetaAsCleared(tabId);
          }
          return false;
        }
        return setLoopMetaForTab(tabId, taskRole, loopTaskId);
      }

      function updateLoopMetaForTabFromMessages(tabId, messages) {
        if (!tabId || !Array.isArray(messages)) {
          return false;
        }
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          const role = normalizeLoopTaskRole(message && message.taskRole);
          const taskId = normalizeLoopTaskId(message && message.loopTaskId);
          if (!role || !taskId) {
            if (message && message.role === "user" && String(message.content || "").trim()) {
              return overrideLoopMetaAsCleared(tabId);
            }
            continue;
          }
          return setLoopMetaForTab(tabId, role, taskId);
        }
        if (!Object.prototype.hasOwnProperty.call(loopMetaByTabId, tabId)) {
          return false;
        }
        delete loopMetaByTabId[tabId];
        return true;
      }

      function getLoopMetaForTabSummary(tab) {
        const tabId = tab && typeof tab.id === "string" ? tab.id : "";
        if (tabId && Object.prototype.hasOwnProperty.call(loopMetaByTabId, tabId)) {
          const fromRuntime = loopMetaByTabId[tabId];
          if (fromRuntime === null) {
            return null;
          }
          if (fromRuntime && fromRuntime.taskRole && fromRuntime.loopTaskId) {
            return fromRuntime;
          }
        }
        const taskRole = normalizeLoopTaskRole(tab && tab.loopTaskRole);
        const loopTaskId = normalizeLoopTaskId(tab && tab.loopTaskId);
        if (!taskRole || !loopTaskId) {
          return null;
        }
        return {
          taskRole,
          loopTaskId,
        };
      }

      function findGraphRunIdInMessage(message) {
        const directGraphRunId = normalizeGraphRunId(message && message.graphRunId);
        if (directGraphRunId) {
          return directGraphRunId;
        }
        const actions = message && Array.isArray(message.actions) ? message.actions : [];
        for (let index = actions.length - 1; index >= 0; index -= 1) {
          const action = actions[index];
          if (action && action.type === "openGraphRun") {
            const graphRunId = normalizeGraphRunId(action.graphRunId);
            if (graphRunId) {
              return graphRunId;
            }
          }
        }
        return "";
      }

      function setGraphMetaForTab(tabId, graphRunId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        const normalizedGraphRunId = normalizeGraphRunId(graphRunId);
        const hadMeta = Object.prototype.hasOwnProperty.call(graphMetaByTabId, tabId);
        const previous = hadMeta ? graphMetaByTabId[tabId] : undefined;
        if (!normalizedGraphRunId) {
          if (!hadMeta) {
            return false;
          }
          delete graphMetaByTabId[tabId];
          return true;
        }
        if (previous && previous.graphRunId === normalizedGraphRunId) {
          return false;
        }
        graphMetaByTabId[tabId] = {
          graphRunId: normalizedGraphRunId,
        };
        return true;
      }

      function updateGraphMetaForTabFromMessage(tabId, message) {
        if (!tabId || !message || typeof message !== "object") {
          return false;
        }
        const graphRunId = findGraphRunIdInMessage(message);
        if (graphRunId) {
          return setGraphMetaForTab(tabId, graphRunId);
        }
        return false;
      }

      function updateGraphMetaForTabFromMessages(tabId, messages) {
        if (!tabId || !Array.isArray(messages)) {
          return false;
        }
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          const graphRunId = findGraphRunIdInMessage(message);
          if (graphRunId) {
            return setGraphMetaForTab(tabId, graphRunId);
          }
        }
        return setGraphMetaForTab(tabId, "");
      }

      function updateGraphMetaForTabFromRunStatus(tabId, runStatus) {
        if (!tabId || !runStatus || typeof runStatus !== "object" || runStatus.status !== "start") {
          return false;
        }
        return setGraphMetaForTab(tabId, runStatus.graphRunId);
      }

      function getGraphMetaForTabSummary(tab) {
        const tabId = tab && typeof tab.id === "string" ? tab.id : "";
        if (tabId && Object.prototype.hasOwnProperty.call(graphMetaByTabId, tabId)) {
          const fromRuntime = graphMetaByTabId[tabId];
          if (fromRuntime && fromRuntime.graphRunId) {
            return fromRuntime;
          }
        }
        const graphRunId = normalizeGraphRunId(tab && tab.graphRunId);
        return graphRunId ? { graphRunId } : null;
      }

      function isLoopMainTabCloseLocked(tab) {
        const meta = getLoopMetaForTabSummary(tab);
        if (!meta || meta.taskRole !== "main" || !meta.loopTaskId) {
          return false;
        }
        if (tab && tab.loopTaskRunning === true) {
          return true;
        }
        if (tab && isTabRunning(tab.id)) {
          return true;
        }
        const tabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs
          : [];
        for (let index = 0; index < tabs.length; index += 1) {
          const candidate = tabs[index];
          if (!candidate || !isTabRunning(candidate.id)) {
            continue;
          }
          const candidateMeta = getLoopMetaForTabSummary(candidate);
          if (candidateMeta && candidateMeta.loopTaskId === meta.loopTaskId) {
            return true;
          }
        }
        return false;
      }

      function isLoopMainTab(tab) {
        const meta = getLoopMetaForTabSummary(tab);
        return Boolean(meta && meta.taskRole === "main");
      }

      function formatConversationTabLabel(tab, baseLabel) {
        const meta = getLoopMetaForTabSummary(tab);
        if (meta) {
          if (meta.taskRole === "main") {
            return "☀️ " + baseLabel;
          }
          if (meta.taskRole === "subtask") {
            return "🌛 " + baseLabel;
          }
        }
        const graphMeta = typeof getGraphMetaForTabSummary === "function"
          ? getGraphMetaForTabSummary(tab)
          : null;
        if (graphMeta) {
          return "🗺️ " + baseLabel;
        }
        return baseLabel;
      }

      function shouldForceFollowLatestMessagesForActiveTab() {
        const activeTab = getConversationTabSummary(getActiveConversationTabId());
        return isLoopMainTab(activeTab) && isLoopMainTabCloseLocked(activeTab);
      }

      function shouldFollowLatestMessagesForActiveTab() {
        return followLatestMessages || shouldForceFollowLatestMessagesForActiveTab();
      }

      function resolveAutoInteractiveModeForTab(tab) {
        const graphMeta = typeof getGraphMetaForTabSummary === "function"
          ? getGraphMetaForTabSummary(tab)
          : null;
        if (graphMeta) {
          return "graph";
        }
        const meta = getLoopMetaForTabSummary(tab);
        if (meta && meta.taskRole === "main") {
          return "loop";
        }
        return "coding";
      }

      function applyAutoInteractiveModeForTab(tab) {
        const nextMode = resolveAutoInteractiveModeForTab(tab);
        if (state.interactiveMode === nextMode) {
          return false;
        }
        state.interactiveMode = nextMode;
        if (elements.interactiveModeSelect) {
          elements.interactiveModeSelect.value = nextMode;
        }
        syncModelSelectorByInteractiveMode();
        return true;
      }

      function isTabRunning(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        return typeof runningTabStartedAtById[tabId] === "number";
      }

      function isConversationTabRunning(tab) {
        return Boolean(
          tab
          && (
            isTabRunning(tab.id)
            || (
              isLoopMainTab(tab)
              && (tab.loopTaskRunning === true || tab.loopTaskStatus === "running")
            )
          )
        );
      }

      function isConversationTabBusy(tabId) {
        const tab = getConversationTabSummary(tabId);
        return isConversationTabRunning(tab) || isLoopMainTabCloseLocked(tab);
      }

      function isLoopMainConversationTabRunning(tabId) {
        const tab = getConversationTabSummary(tabId);
        return isLoopMainTab(tab) && isConversationTabBusy(tabId);
      }

      function isTabErrored(tabId) {
        return Boolean(tabId && typeof tabId === "string" && erroredTabIds.has(tabId));
      }

      function setTabErrored(tabId, errored) {
        if (!tabId || typeof tabId !== "string") {
          return;
        }
        const wasErrored = erroredTabIds.has(tabId);
        if (wasErrored === Boolean(errored)) {
          return;
        }
        if (errored) {
          erroredTabIds.add(tabId);
        } else {
          erroredTabIds.delete(tabId);
        }
        renderConversationTabs();
      }

      function isHiddenRetryQueuedMessage(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^任务已中断，将在\\s*.+\\s*后开始第\\s*\\d+\\s*\\/\\s*\\d+\\s*次自动重试。?$/.test(normalized)
          || /^task interrupted\\. automatic retry\\s+\\d+\\s*\\/\\s*\\d+\\s+will start in\\s+.+\\.$/i.test(normalized);
      }

      function isHiddenRetryStartedMessage(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^第\\s*\\d+\\s*\\/\\s*\\d+\\s*次自动重试已开始。?$/.test(normalized)
          || /^automatic retry\\s+\\d+\\s*\\/\\s*\\d+\\s+started\\.$/i.test(normalized);
      }

      function getTabRunStartedAt(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return 0;
        }
        const value = runningTabStartedAtById[tabId];
        return typeof value === "number" ? value : 0;
      }

      function shouldHandleTabScopedEvent(data) {
        const eventTabId = data && typeof data.tabId === "string" ? data.tabId : null;
        if (!eventTabId) {
          return true;
        }
        const activeTabId = getActiveConversationTabId();
        return !activeTabId || eventTabId === activeTabId;
      }

      function syncConversationControlsForActiveTab() {
        updateQueueIndicator();
        updateRunPromptButton();
        updateRunStreamButton();
        syncOpenCurrentLoopGroupChatButton();
        syncOpenCurrentGraphRunButton();
        syncRunConflictOverlay();
        syncQueueOverlay();
        syncRunPromptOverlay();
        syncRunStreamOverlay();
        syncResetSessionAvailability();
      }

      function syncRunningStateForActiveTab() {
        const activeTabId = getActiveConversationTabId();
        const isRunningOnActiveTab = isTabRunning(activeTabId);
        updateRunningState(isRunningOnActiveTab, {
          preserveRunArtifacts: true,
          startedAt: isRunningOnActiveTab ? getTabRunStartedAt(activeTabId) : 0,
        });
        syncConversationControlsForActiveTab();
      }

      function getConversationTabPageCount(totalCount) {
        const normalizedCount = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;
        return Math.max(1, Math.ceil(normalizedCount / CONVERSATION_TAB_PAGE_SIZE));
      }

      function clampConversationTabPageIndex(nextPageIndex, totalCount) {
        const pageCount = getConversationTabPageCount(totalCount);
        const normalized = Number.isFinite(nextPageIndex) ? Math.floor(nextPageIndex) : 0;
        if (normalized < 0) {
          return 0;
        }
        if (normalized >= pageCount) {
          return pageCount - 1;
        }
        return normalized;
      }

      function getConversationTabPageForTabIndex(tabIndex) {
        if (!Number.isFinite(tabIndex) || tabIndex < 0) {
          return 0;
        }
        return Math.floor(tabIndex / CONVERSATION_TAB_PAGE_SIZE);
      }

      function setConversationTabPageIndex(nextPageIndex, totalCount) {
        conversationTabPageIndex = clampConversationTabPageIndex(nextPageIndex, totalCount);
        return conversationTabPageIndex;
      }

      function shouldShowConversationTabPagerButton(direction, pageIndex, pageCount) {
        if (pageCount <= 1) {
          return false;
        }
        if (direction === "prev") {
          return pageIndex > 0;
        }
        return direction === "next" && pageIndex < pageCount - 1;
      }

      function createConversationTabPagerButton(direction, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-button conversation-tabs-nav conversation-tabs-nav-" + direction;
        button.textContent = direction === "prev" ? "<" : ">";
        const ariaKey = direction === "prev" ? "conversationTabsPrevPage" : "conversationTabsNextPage";
        const ariaLabel = t(ariaKey);
        button.title = ariaLabel;
        button.setAttribute("aria-label", ariaLabel);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        });
        return button;
      }

      function renderConversationTabs() {
        if (!elements.conversationTabs) {
          return;
        }
        const tabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs
          : [];
        const activeTabId = state.conversationTabs ? state.conversationTabs.activeTabId : null;
        elements.conversationTabs.innerHTML = "";
        const showTabs = tabs.length > 0;
        elements.conversationTabs.classList.toggle("visible", showTabs);
        if (!showTabs) {
          conversationTabPageIndex = 0;
          conversationTabPageAnchorTabId = activeTabId;
          return;
        }
        const activeTabIndex = tabs.findIndex((tab) => tab && tab.id === activeTabId);
        const activeTabChanged = activeTabId !== conversationTabPageAnchorTabId;
        if (activeTabChanged) {
          const activePageIndex = getConversationTabPageForTabIndex(activeTabIndex);
          setConversationTabPageIndex(activePageIndex, tabs.length);
        } else {
          setConversationTabPageIndex(conversationTabPageIndex, tabs.length);
        }
        conversationTabPageAnchorTabId = activeTabId;
        const pageCount = getConversationTabPageCount(tabs.length);
        const pageStartIndex = conversationTabPageIndex * CONVERSATION_TAB_PAGE_SIZE;
        const pageEndIndex = pageStartIndex + CONVERSATION_TAB_PAGE_SIZE;

        if (shouldShowConversationTabPagerButton("prev", conversationTabPageIndex, pageCount)) {
          const prevButton = createConversationTabPagerButton(
            "prev",
            () => {
              setConversationTabPageIndex(conversationTabPageIndex - 1, tabs.length);
              renderConversationTabs();
            },
          );
          elements.conversationTabs.appendChild(prevButton);
        }

        const tabTrack = document.createElement("div");
        tabTrack.className = "conversation-tabs-track";
        const groupIndexes = Object.create(null);

        tabs.forEach((tab, index) => {
          const cliLabel = typeof tab.cli === "string" && tab.cli ? tab.cli : "session";
          const groupIndex = (groupIndexes[cliLabel] || 0) + 1;
          groupIndexes[cliLabel] = groupIndex;
          if (index < pageStartIndex || index >= pageEndIndex) {
            return;
          }
          const tabItem = document.createElement("div");
          tabItem.className = "conversation-tab";
          const isActive = tab.id === activeTabId;
          if (isActive) {
            tabItem.classList.add("active");
          }
          if (isTabErrored(tab.id)) {
            tabItem.classList.add("errored");
          } else if (isConversationTabRunning(tab)) {
            tabItem.classList.add("running");
          }
          tabItem.setAttribute("role", "tab");
          tabItem.setAttribute("aria-selected", String(isActive));
          tabItem.setAttribute("tabindex", isActive ? "0" : "-1");
          tabItem.setAttribute("aria-disabled", "false");

          const tabBaseLabel = groupIndex > 1 ? (cliLabel + String(groupIndex)) : cliLabel;
          const labelText = formatConversationTabLabel(tab, tabBaseLabel);
          const label = document.createElement("span");
          label.className = "conversation-tab-label";
          label.textContent = labelText;
          tabItem.appendChild(label);

          if (tabs.length > 1) {
            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.className = "conversation-tab-close";
            closeButton.textContent = "×";
            closeButton.title = t("conversationTabCloseAria", { label: labelText });
            closeButton.setAttribute("aria-label", t("conversationTabCloseAria", { label: labelText }));
            closeButton.disabled = isConversationTabRunning(tab) || isLoopMainTabCloseLocked(tab);
            closeButton.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              vscode.postMessage({ type: "closeConversationTab", tabId: tab.id, cli: tab.cli });
            });
            tabItem.appendChild(closeButton);
          }

          const selectTab = () => {
            if (tab.id === activeTabId) {
              return;
            }
            applyAutoInteractiveModeForTab(tab);
            if (state.conversationTabs) {
              state.conversationTabs.activeTabId = tab.id;
            }
            syncActiveMessagesFromRuntime();
            syncRunningStateForActiveTab();
            armPromptContextForConversationStart();
            vscode.postMessage({ type: "selectConversationTab", tabId: tab.id, cli: tab.cli });
          };

          tabItem.addEventListener("click", () => {
            selectTab();
          });
          tabItem.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectTab();
            }
          });

          tabTrack.appendChild(tabItem);
        });
        elements.conversationTabs.appendChild(tabTrack);
        if (shouldShowConversationTabPagerButton("next", conversationTabPageIndex, pageCount)) {
          const nextButton = createConversationTabPagerButton(
            "next",
            () => {
              setConversationTabPageIndex(conversationTabPageIndex + 1, tabs.length);
              renderConversationTabs();
            },
          );
          elements.conversationTabs.appendChild(nextButton);
        }
      }

`;
