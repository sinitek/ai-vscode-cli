// Task list, toast, clipboard, running state, and dispatch helpers.
export const VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI = `      function updateTaskList() {
        const activeTabId = getActiveConversationTabId();
        if (!shouldDisplayTaskListForTab(activeTabId)) {
          closeTaskListForRunCompletion(activeTabId);
          return;
        }
        const taskListState = getActiveTaskListState({ create: true });
        if (!taskListState) {
          renderTaskList();
          return;
        }
        if (taskListState.source === "external") {
          renderTaskList(taskListState);
          return;
        }
        const items = extractTaskListFromMessages(state.messages, taskListState.startIndex);
        setTaskListItems(taskListState, items);
        renderTaskList(taskListState);
      }

      function setTaskListItems(taskListState, items) {
        if (!taskListState) {
          return;
        }
        const nextItems = Array.isArray(items) ? items : [];
        const hadItems = Array.isArray(taskListState.items) && taskListState.items.length > 0;
        if (!shouldDisplayTaskListItems(nextItems)) {
          taskListState.items = [];
          taskListState.open = false;
          return;
        }
        taskListState.items = nextItems;
        if (!hadItems) {
          taskListState.open = true;
        }
      }

      function shouldDisplayTaskListItems(items) {
        return Array.isArray(items) && items.some((item) => item && item.done !== true);
      }

      function shouldDisplayTaskListForTab(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const hasRunStateHelper = typeof isTabRunning === "function" || typeof isConversationTabBusy === "function";
        if (!hasRunStateHelper) {
          return true;
        }
        if (!targetTabId) {
          return state.isRunning === true;
        }
        if (typeof isTabRunning === "function" && isTabRunning(targetTabId)) {
          return true;
        }
        return typeof isConversationTabBusy === "function" && isConversationTabBusy(targetTabId);
      }

      function formatTaskListProgress(items) {
        const total = Array.isArray(items) ? items.length : 0;
        const completed = Array.isArray(items)
          ? items.reduce((count, item) => count + (item && item.done ? 1 : 0), 0)
          : 0;
        return completed + "/" + total;
      }

      function renderTaskList(taskListState) {
        if (!elements.taskListPanel || !elements.taskListDetails || !elements.taskListBody) {
          return;
        }
        const activeTaskListState = taskListState || getActiveTaskListState({ create: false });
        const items = activeTaskListState && Array.isArray(activeTaskListState.items)
          ? activeTaskListState.items
          : [];
        if (!items.length) {
          elements.taskListPanel.style.display = "none";
          elements.taskListDetails.open = false;
          if (elements.taskListCount) {
            elements.taskListCount.textContent = "";
          }
          elements.taskListBody.innerHTML = "";
          return;
        }
        elements.taskListPanel.style.display = "block";
        elements.taskListDetails.open = activeTaskListState ? activeTaskListState.open : true;
        if (elements.taskListCount) {
          elements.taskListCount.textContent = formatTaskListProgress(items);
        }
        const list = document.createElement("ul");
        list.className = "tasklist-items";
        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "tasklist-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "tasklist-checkbox";
          checkbox.checked = item.done;
          checkbox.disabled = true;
          const text = document.createElement("span");
          text.textContent = item.text;
          li.appendChild(checkbox);
          li.appendChild(text);
          list.appendChild(li);
        });
        elements.taskListBody.innerHTML = "";
        elements.taskListBody.appendChild(list);
      }

      function extractTaskListFromMessages(messages, startIndex = 0) {
        let lastItems = [];
        if (!Array.isArray(messages)) {
          return lastItems;
        }
        const start = Number.isInteger(startIndex) ? Math.max(0, startIndex) : 0;
        for (let i = start; i < messages.length; i += 1) {
          const message = messages[i];
          if (!message || message.role !== "assistant") {
            continue;
          }
          const items = parseTaskListFromText(message.content || "");
          if (items.length) {
            lastItems = items;
          }
        }
        return lastItems;
      }

      function normalizeTaskListStatus(value) {
        return String(value || "")
          .trim()
          .toLowerCase()
          .replace(/[\\s-]+/g, "_");
      }

      function readTaskListDoneFromStatus(value) {
        const status = normalizeTaskListStatus(value);
        if (!status) {
          return null;
        }
        if (["x", "done", "completed", "complete", "finished", "success", "succeeded"].includes(status)) {
          return true;
        }
        if (["完成", "已完成"].includes(status)) {
          return true;
        }
        if (["pending", "in_progress", "inprogress", "todo", "to_do", "not_started", "notstarted", "open", "running"].includes(status)) {
          return false;
        }
        if (["待办", "进行中", "处理中", "未开始", "未完成"].includes(status)) {
          return false;
        }
        return null;
      }

      function normalizeParsedTaskListText(value) {
        return String(value || "")
          .replace(/。[\\s\\S]*$/, "")
          .replace(/^[\\s;；。,.，、:：-]+/, "")
          .replace(/[\\s;；。,.，、]+$/, "")
          .trim();
      }

      function readTaskListDoneFromPlainText(value) {
        const text = normalizeParsedTaskListText(value);
        if (!text) {
          return null;
        }
        if (/(?:未完成|尚未完成|待(?:办|执行|确认|完成|跑|更新)|还没|进行中|正在|接下来|下一步|随后|最后|现在|开始|当前进入|进入.*阶段|接近完成)/.test(text)) {
          return false;
        }
        if (/\\b(?:pending|todo|to[_ -]?do|not[_ -]?started|open|running|in[_ -]?progress)\\b/i.test(text)) {
          return false;
        }
        if (/\\b(?:completed|complete|done|finished|success|succeeded)\\b/i.test(text)) {
          return true;
        }
        if (/^已(?:完成|读|确认|定位|补齐|落地|通过|写入|更新|修复|创建|运行|同步|复核)/.test(text)) {
          return true;
        }
        if (/(?:均|都)?已(?:完成|读|确认|定位|补齐|落地|通过|写入|更新|修复|创建|运行|同步|复核)$/.test(text)) {
          return true;
        }
        if (/(?:完成|通过|落地)$/.test(text)) {
          return true;
        }
        return null;
      }

      function stripPlainTaskListStatusText(value) {
        return normalizeParsedTaskListText(value)
          .replace(/^\\s*(?:completed|complete|done|finished|success|succeeded|pending|todo|to[_ -]?do|not[_ -]?started|open|running|in[_ -]?progress)\\s*[:：-]?\\s*/i, "")
          .replace(/\\s*[:：-]?\\s*(?:completed|complete|done|finished|success|succeeded|pending|todo|to[_ -]?do|not[_ -]?started|open|running|in[_ -]?progress)\\s*$/i, "")
          .replace(/^(?:正在|接下来(?:会)?|下一步|随后(?:会|只做)?|最后|现在(?:我会)?|开始|当前进入|进入)/, "")
          .replace(/^已(?:完成|读|确认|定位|补齐|落地|通过|写入|更新|修复|创建|运行|同步|复核)/, "")
          .replace(/(?:均|都)?已(?:完成|读|确认|定位|补齐|落地|通过|写入|更新|修复|创建|运行|同步|复核)$/, "")
          .replace(/(?:完成|通过|落地|进行中|待(?:办|执行|确认|完成|跑|更新)|开始)$/, "")
          .trim();
      }

      function parsePlainTaskListItemFromText(value) {
        const rawText = normalizeParsedTaskListText(value);
        if (!rawText) {
          return null;
        }
        const inferredDone = readTaskListDoneFromPlainText(rawText);
        const text = normalizeParsedTaskListText(stripPlainTaskListStatusText(rawText));
        return text ? { done: inferredDone === null ? false : inferredDone, inferredDone, text } : null;
      }

      function toTaskListItem(parsedItem) {
        return parsedItem ? { done: parsedItem.done, text: parsedItem.text } : null;
      }

      function parsePlainTaskListItemsFromNumberedFragment(source) {
        const markers = [];
        const numberedRegex = /(?:^|[\\s;；。])\\d+[.)、]\\s*/g;
        let match;
        while ((match = numberedRegex.exec(source)) !== null) {
          markers.push({
            markerStart: match.index,
            textStart: numberedRegex.lastIndex,
          });
        }
        if (!markers.length) {
          return [];
        }
        return markers
          .map((marker, index) => {
            const nextMarker = markers[index + 1];
            const textEnd = nextMarker ? nextMarker.markerStart : source.length;
            return toTaskListItem(parsePlainTaskListItemFromText(source.slice(marker.textStart, textEnd)));
          })
          .filter(Boolean);
      }

      function parsePlainTaskListItemsFromFragment(fragment) {
        const source = String(fragment || "").trim();
        if (!source) {
          return [];
        }

        const numberedItems = parsePlainTaskListItemsFromNumberedFragment(source);
        if (numberedItems.length) {
          return numberedItems;
        }

        const bulletMatch = source.match(/^\\s*[-*]\\s+(.*)$/);
        if (bulletMatch) {
          const item = toTaskListItem(parsePlainTaskListItemFromText(bulletMatch[1]));
          return item ? [item] : [];
        }

        const splitParts = source.split(/[;；、，]|,(?=\\s+\\S)/);
        if (splitParts.length <= 1) {
          return [];
        }
        const parsedParts = splitParts
          .map((part) => parsePlainTaskListItemFromText(part.replace(/^\\d+[.)、]\\s*/, "").replace(/^[-*]\\s+/, "")))
          .filter(Boolean);
        const hasInferredStatus = parsedParts.some((item) => item.inferredDone !== null);
        return parsedParts
          .filter((item) => !hasInferredStatus || item.inferredDone !== null)
          .map(toTaskListItem)
          .filter(Boolean);
      }

      function parseTaskListItemsFromFragment(fragment) {
        const source = String(fragment || "");
        const markerRegex = /(?:^|[\\s;；。])(?:[-*]|\\d+[.)])?\\s*\`?\\[([^\\]\\r\\n]*)\\]\`?\\s*/gi;
        const markers = [];
        let match;
        while ((match = markerRegex.exec(source)) !== null) {
          const rawStatus = match[1] || "";
          const done = rawStatus.trim() === "" ? false : readTaskListDoneFromStatus(rawStatus);
          if (done === null) {
            continue;
          }
          markers.push({
            markerStart: match.index,
            textStart: markerRegex.lastIndex,
            done,
          });
        }
        if (!markers.length) {
          return parsePlainTaskListItemsFromFragment(source);
        }
        return markers
          .map((marker, index) => {
            const nextMarker = markers[index + 1];
            const textEnd = nextMarker ? nextMarker.markerStart : source.length;
            const text = normalizeParsedTaskListText(source.slice(marker.textStart, textEnd));
            return text ? { done: marker.done, text } : null;
          })
          .filter(Boolean);
      }

      function collectTaskListSectionsFromText(text) {
        if (!text) {
          return [];
        }
        const lines = String(text).split(/\\r?\\n/);
        const taskListHeaderKeywordRegex = /(?:task\\s*list|tasklist|todo\\s*list|todolist|任务列表|待办列表|任务清单)/i;
        const headerRegex = /(?:^|[\\s;；。])(?:task\\s*list|tasklist|todo\\s*list|todolist|任务列表|待办列表|任务清单)(?:\\s*(?:update|更新|状态|当前|继续|最终修正(?:为[^:：]*)?))?\\s*[:：]\\s*(.*)$/i;
        const sections = [];
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const headerMatch = line.match(headerRegex);
          if (!headerMatch) {
            continue;
          }
          const sectionItems = [];
          let endLine = i;
          const headerStart = headerMatch.index || 0;
          const keywordMatch = String(headerMatch[0] || "").match(taskListHeaderKeywordRegex);
          const stripStartColumn = keywordMatch ? headerStart + keywordMatch.index : headerStart;
          const hideStartLine = !line.slice(0, stripStartColumn).trim();
          const inlinePart = (headerMatch[1] || "").trim();
          if (inlinePart) {
            sectionItems.push(...parseTaskListItemsFromFragment(inlinePart));
          }
          for (let j = i + 1; j < lines.length; j += 1) {
            const nextLine = lines[j];
            if (!nextLine.trim()) {
              endLine = j;
              if (sectionItems.length) {
                break;
              }
              continue;
            }
            const items = parseTaskListItemsFromFragment(nextLine);
            if (!items.length) {
              break;
            }
            sectionItems.push(...items);
            endLine = j;
          }
          if (sectionItems.length) {
            sections.push({ startLine: i, endLine, hideStartLine, stripStartColumn, items: sectionItems });
            i = endLine;
          }
        }
        return sections;
      }

      function parseTaskListFromText(text) {
        const sections = collectTaskListSectionsFromText(text);
        if (!sections.length) {
          return [];
        }
        return sections[sections.length - 1].items;
      }

      function stripParsedTaskListContentFromText(text) {
        const content = String(text || "");
        const sections = collectTaskListSectionsFromText(content);
        if (!sections.length) {
          return content;
        }
        const lines = content.split(/\\r?\\n/);
        sections.forEach((section) => {
          if (section.hideStartLine) {
            for (let lineIndex = section.startLine; lineIndex <= section.endLine; lineIndex += 1) {
              lines[lineIndex] = "";
            }
            return;
          }
          lines[section.startLine] = String(lines[section.startLine] || "")
            .slice(0, section.stripStartColumn)
            .replace(/[ \\t]+$/, "");
          for (let lineIndex = section.startLine + 1; lineIndex <= section.endLine; lineIndex += 1) {
            lines[lineIndex] = "";
          }
        });
        return lines.join("\\n").replace(/(?:[ \\t]*\\n){3,}/g, "\\n\\n").trim();
      }

      function shouldHideParsedTaskListMessage(message) {
        if (!message || message.role !== "assistant") {
          return false;
        }
        const content = typeof message.content === "string" ? message.content : "";
        const sections = collectTaskListSectionsFromText(content);
        if (!sections.length) {
          return false;
        }
        return stripParsedTaskListContentFromText(content).trim() === "";
      }

      function normalizeTaskListItems(items) {
        if (!Array.isArray(items)) {
          return [];
        }
        return items
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const record = item;
            const text =
              typeof record.text === "string"
                ? record.text
                : typeof record.content === "string"
                  ? record.content
                  : typeof record.step === "string"
                    ? record.step
                    : "";
            if (!text.trim()) {
              return null;
            }
            const doneFromStatus = readTaskListDoneFromStatus(record.status);
            const done =
              typeof record.done === "boolean"
                ? record.done
                : typeof record.completed === "boolean"
                  ? record.completed
                  : doneFromStatus === null
                    ? false
                    : doneFromStatus;
            return { text: text.trim(), done: Boolean(done) };
          })
          .filter(Boolean);
      }

      function applyExternalTaskListUpdate(items, tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const taskListState = getTaskListState(targetTabId);
        if (!taskListState) {
          return [];
        }
        const normalized = normalizeTaskListItems(items);
        if (normalized.length) {
          if (!shouldDisplayTaskListForTab(targetTabId)) {
            const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
            const startIndex = runtimeState ? ensureRuntimeStateMessages(runtimeState).length : 0;
            resetTaskListState(taskListState, startIndex);
            if (isRuntimeStateForActiveTab(targetTabId)) {
              renderTaskList(taskListState);
            }
            return normalized;
          }
          setTaskListItems(taskListState, normalized);
          taskListState.source = "external";
        } else {
          const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
          const startIndex = runtimeState ? ensureRuntimeStateMessages(runtimeState).length : 0;
          resetTaskListState(taskListState, startIndex);
        }
        if (isRuntimeStateForActiveTab(targetTabId)) {
          renderTaskList(taskListState);
        }
        return normalized;
      }

      function escapeHtml(value) {
        let text = "";
        if (typeof value === "string") {
          text = value;
        } else if (value && typeof value === "object" && "text" in value) {
          const tokenText = value.text;
          text = typeof tokenText === "string" ? tokenText : tokenText == null ? "" : String(tokenText);
        } else {
          text = value == null ? "" : String(value);
        }
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function showToast(message) {
        if (!elements.toast) {
          return;
        }
        elements.toast.textContent = message;
        elements.toast.classList.add("visible");
        if (toastTimer) {
          clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => {
          elements.toast.classList.remove("visible");
        }, 1600);
      }

      function copyTextToClipboard(value, successMessage = t("toastCopied")) {
        if (!value) {
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(
            () => showToast(successMessage),
            () => fallbackCopyText(value, successMessage)
          );
          return;
        }
        fallbackCopyText(value, successMessage);
      }

      function fallbackCopyText(value, successMessage = t("toastCopied")) {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          showToast(successMessage);
        } catch (error) {
          showToast(t("toastCopyFailed"));
        } finally {
          document.body.removeChild(textarea);
        }
      }

      function syncLongTermMemoryWorkspaceControl() {
        if (elements.longTermMemoryEnabled) {
          elements.longTermMemoryEnabled.checked = Boolean(state.workspaceMemoryEnabled);
          elements.longTermMemoryEnabled.disabled = Boolean(state.isRunning);
        }
        if (elements.longTermMemoryNote) {
          elements.longTermMemoryNote.textContent = i18n.toolSettingsLongTermMemoryHint;
        }
      }

      function updateRunningState(isRunning, options = {}) {
        const wasRunning = state.isRunning;
        const preserveRunArtifacts = Boolean(options.preserveRunArtifacts);
        const startedAt = typeof options.startedAt === "number" ? options.startedAt : 0;
        const shouldResyncRunningClock = isRunning && startedAt > 0 && runWaitStartAt > 0 && runWaitStartAt !== startedAt;
        state.isRunning = isRunning;
        elements.sendPrompt.disabled = false;
        elements.promptInput.disabled = false;
        elements.newSession.disabled = false;
        syncResetSessionAvailability();
        renderConversationTabs();
        elements.stopRun.disabled = !isRunning;
        elements.thinkingMode.disabled = false;
        if (elements.openCodePrimaryThinkingMode) {
          elements.openCodePrimaryThinkingMode.disabled = false;
        }
        if (elements.openCodeSmallThinkingMode) {
          elements.openCodeSmallThinkingMode.disabled = false;
        }
        if (elements.debugMode) {
          elements.debugMode.disabled = isRunning;
        }
        syncLongTermMemoryWorkspaceControl();
        syncInteractiveOptions();
        elements.sendPrompt.style.display = "inline-flex";
        elements.stopRun.style.display = isRunning ? "inline-flex" : "none";
        elements.historyButton.disabled = false;
        if (isRunning && !wasRunning) {
          if (!preserveRunArtifacts) {
            resetRunRawStream();
          }
          startRunWaitTimer(startedAt || Date.now());
        } else if (!isRunning && wasRunning) {
          stopRunWaitTimer();
          closeRunPromptOverlay();
          closeRunStreamOverlay();
        } else if (shouldResyncRunningClock) {
          // When switching between two running tabs, keep the timer bound to the active tab run.
          runWaitStartAt = startedAt;
          updateRunWaitTime(Date.now() - runWaitStartAt);
        }
        updateRunWait();
        updateRunPromptButton();
        updateRunStreamButton();
      }

      function updateRunWait() {
        if (!elements.runWait) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasPrompt = Boolean(runtimeState && String(runtimeState.currentRunPrompt || "").trim().length > 0);
        const hasStreamRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length > 0);
        const hasQueuedPrompts = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
        const hasRunStatusSummary = Boolean(runtimeState && String(runtimeState.lastRunStatusMessage || "").trim().length > 0);
        const hasCurrentLoopGroupChat = typeof getActiveLoopMainTaskId === "function" && Boolean(getActiveLoopMainTaskId());
        const shouldShowRunRow = state.isRunning || hasPrompt || hasStreamRecords || hasQueuedPrompts || hasRunStatusSummary || hasCurrentLoopGroupChat;

        elements.runWait.style.display = shouldShowRunRow ? "flex" : "none";

        const typingNode = elements.runWait.querySelector(".typing");
        if (typingNode) {
          typingNode.style.display = state.isRunning ? "inline-flex" : "none";
        }
        if (elements.runWaitTime) {
          elements.runWaitTime.style.display = state.isRunning ? "inline" : "none";
        }
        if (elements.runStatusText) {
          const isCompacting = Boolean(
            state.isRunning
            && runtimeState
            && runtimeState.activeRunActivity === "contextCompaction"
          );
          const summary = isCompacting
            ? t("runStatusCompacting")
            : !state.isRunning && runtimeState
            ? String(runtimeState.lastRunStatusMessage || "").trim()
            : "";
          elements.runStatusText.textContent = summary;
          elements.runStatusText.classList.toggle("compacting", isCompacting);
          if (summary) {
            elements.runStatusText.setAttribute("aria-label", summary);
          } else {
            elements.runStatusText.removeAttribute("aria-label");
          }
          elements.runStatusText.style.display = summary ? (isCompacting ? "inline-flex" : "inline") : "none";
        }
      }

      function startRunWaitTimer(startAt = Date.now()) {
        if (!elements.runWaitTime) {
          return;
        }
        stopRunWaitTimer();
        runWaitStartAt = startAt;
        updateRunWaitTime(Date.now() - runWaitStartAt);
        runWaitTimer = window.setInterval(() => {
          updateRunWaitTime(Date.now() - runWaitStartAt);
        }, 1000);
      }

      function stopRunWaitTimer() {
        if (runWaitTimer) {
          clearInterval(runWaitTimer);
          runWaitTimer = null;
        }
        runWaitStartAt = 0;
        updateRunWaitTime(0);
      }

      function updateRunWaitTime(elapsedMs) {
        if (!elements.runWaitTime) {
          return;
        }
        elements.runWaitTime.textContent = formatElapsedTime(elapsedMs);
      }

      function formatElapsedTime(elapsedMs) {
        const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }

      function resetTaskListForRunStart(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        const startIndex = runtimeState
          ? ensureRuntimeStateMessages(runtimeState).length
          : isRuntimeStateForActiveTab(targetTabId)
            ? state.messages.length
            : 0;
        const taskListState = getTaskListState(targetTabId);
        resetTaskListState(taskListState, startIndex);
        if (isRuntimeStateForActiveTab(targetTabId)) {
          renderTaskList(taskListState);
        }
      }

      function closeTaskListForRunCompletion(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        const startIndex = runtimeState
          ? ensureRuntimeStateMessages(runtimeState).length
          : isRuntimeStateForActiveTab(targetTabId)
            ? state.messages.length
            : 0;
        const taskListState = getTaskListState(targetTabId);
        resetTaskListState(taskListState, startIndex);
        if (isRuntimeStateForActiveTab(targetTabId)) {
          renderTaskList(taskListState);
        }
      }

      function dispatchPrompt(payload, options = {}) {
        const normalizedPayload = normalizePromptPayload(payload);
        if (!normalizedPayload) {
          return false;
        }
        const prompt = normalizedPayload.prompt;
        const targetTabId = typeof options.tabId === "string" && options.tabId
          ? options.tabId
          : getActiveConversationTabId();
        const activeTabId = getActiveConversationTabId();
        const targetTab = getConversationTabSummary(targetTabId);
        const targetCli = targetTab && targetTab.cli ? targetTab.cli : state.currentCli;
        const isBackgroundDispatch = Boolean(targetTabId && activeTabId && targetTabId !== activeTabId);
        const targetRuntimeState = getConversationRuntimeState(targetTabId, { create: false });
        const shouldSuppressFlush = isTabRunning(targetTabId);
        const hasConfig = isBackgroundDispatch ? true : state.selectedConfigId || state.configState.activeConfigId;
        if (!hasConfig) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: t("toastNoActiveConfig"),
            createdAt: Date.now(),
          });
          return false;
        }
        if (shouldSuppressFlush && targetRuntimeState) {
          targetRuntimeState.suppressQueueFlushOnce = true;
        }
        resetTaskListForRunStart(targetTabId);
        const targetModel = targetCli && cliSupportsManagedModelSelection(targetCli) && state.selectedModelsByCli
          ? state.selectedModelsByCli[targetCli] || ""
          : "";
        const targetInteractiveMode = normalizedPayload.interactiveMode
          || (isBackgroundDispatch ? undefined : state.interactiveMode);
        const targetLoopExecutionMode = targetInteractiveMode === "loop"
          ? getLoopExecutionModeForCli(targetCli)
          : undefined;
        const sendPromptMessage = {
          type: "sendPrompt",
          prompt,
          interactiveMode: targetInteractiveMode,
          contextOptions: normalizedPayload.contextOptions,
          tabId: targetTabId || undefined,
          cli: targetCli,
          model: targetModel || undefined,
          preserveActiveTab: Boolean(options.preserveActiveTab && isBackgroundDispatch),
        };
        if (targetLoopExecutionMode) {
          sendPromptMessage.loopExecutionMode = targetLoopExecutionMode;
        }
        vscode.postMessage(sendPromptMessage);
        return true;
      }

      function syncRunConflictOverlay() {
        if (!elements.runConflictOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const payload = runtimeState ? normalizePromptPayload(runtimeState.pendingRunPrompt) : null;
        const visible = Boolean(runtimeState && runtimeState.overlays.runConflict && payload);
        if (elements.runConflictPrompt) {
          elements.runConflictPrompt.textContent = visible && payload ? payload.prompt : "";
        }
        elements.runConflictOverlay.classList.toggle("visible", visible);
      }

      function openRunConflictOverlay(payload) {
        const normalizedPayload = normalizePromptPayload(payload);
        if (!normalizedPayload) {
          return;
        }
        if (!elements.runConflictOverlay) {
          const sent = dispatchPrompt(normalizedPayload);
          if (sent) {
            resetPromptContextForNextPrompt();
          }
          return;
        }
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        runtimeState.pendingRunPrompt = normalizedPayload;
        runtimeState.overlays.runConflict = true;
        syncRunConflictOverlay();
      }

      function closeRunConflictOverlay(options = {}) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runConflict = false;
          if (options.clearPending !== false) {
            runtimeState.pendingRunPrompt = null;
          }
        }
        syncRunConflictOverlay();
      }

      function isRunArtifactsVisibleForActiveTab() {
        return true;
      }

      function getRunPromptHistory(tabId) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        if (!runtimeState) {
          return [];
        }
        const prompts = ensureRuntimeStateMessages(runtimeState)
          .map((message, index) => ({ message, index }))
          .filter(({ message }) => message && message.role === "user" && String(message.content || "").trim())
          .map(({ message, index }) => ({
            content: String(message.content || "").trim(),
            createdAt: Number.isFinite(message.createdAt) ? message.createdAt : 0,
            index,
          }))
          .sort((left, right) => right.createdAt - left.createdAt || right.index - left.index);
        const currentPrompt = String(runtimeState.currentRunPrompt || "").trim();
        if (currentPrompt && (!prompts[0] || prompts[0].content !== currentPrompt)) {
          prompts.unshift({ content: currentPrompt, createdAt: 0, index: Number.MAX_SAFE_INTEGER });
        }
        return prompts;
      }

      function renderRunPromptHistory(tabId) {
        if (!elements.runPromptContent) {
          return;
        }
        const prompts = getRunPromptHistory(tabId);
        elements.runPromptContent.replaceChildren();
        if (prompts.length === 0) {
          const empty = document.createElement("div");
          empty.className = "run-prompt-empty";
          empty.textContent = t("runPromptEmpty");
          elements.runPromptContent.appendChild(empty);
          return;
        }
        prompts.forEach((prompt, index) => {
          const item = document.createElement("article");
          item.className = "run-prompt-item";

          const meta = document.createElement("div");
          meta.className = "run-prompt-item-meta";
          if (prompt.createdAt > 0) {
            const time = document.createElement("time");
            const date = new Date(prompt.createdAt);
            time.dateTime = date.toISOString();
            time.textContent = date.toLocaleString();
            meta.appendChild(time);
          }
          if (index === 0) {
            const latest = document.createElement("span");
            latest.className = "run-prompt-latest-badge";
            latest.textContent = t("runPromptLatestLabel");
            meta.appendChild(latest);
          }

          const content = document.createElement("div");
          content.className = "run-prompt-item-content";
          content.textContent = prompt.content;
          item.appendChild(meta);
          item.appendChild(content);
          elements.runPromptContent.appendChild(item);
        });
      }

      function updateRunPromptButton() {
        if (!elements.runPromptButton) {
          return;
        }
        const hasPrompt = getRunPromptHistory(getActiveConversationTabId()).length > 0;
        elements.runPromptButton.style.display = hasPrompt && isRunArtifactsVisibleForActiveTab() ? "inline-flex" : "none";
        updateRunWait();
      }

      function syncRunPromptOverlay() {
        if (!elements.runPromptOverlay || !elements.runPromptContent) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasPrompt = getRunPromptHistory(getActiveConversationTabId()).length > 0;
        const visible = Boolean(runtimeState && runtimeState.overlays.runPrompt && hasPrompt && isRunArtifactsVisibleForActiveTab());
        if (visible) {
          renderRunPromptHistory(getActiveConversationTabId());
        } else {
          elements.runPromptContent.replaceChildren();
          if (runtimeState) {
            runtimeState.overlays.runPrompt = false;
          }
        }
        elements.runPromptOverlay.classList.toggle("visible", visible);
      }

      function openRunPromptOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        const hasPrompt = getRunPromptHistory(getActiveConversationTabId()).length > 0;
        if (!hasPrompt || !isRunArtifactsVisibleForActiveTab()) {
          return;
        }
        runtimeState.overlays.runPrompt = true;
        syncRunPromptOverlay();
      }

      function closeRunPromptOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runPrompt = false;
        }
        syncRunPromptOverlay();
      }

`;
