// Run stream overlays, queue overlay, and queued prompt flow.
export const VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE = `      function updateCurrentRunPrompt(prompt, tabId) {
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        runtimeState.currentRunPrompt = typeof prompt === "string" ? prompt : "";
        if (!isRuntimeStateForActiveTab(tabId)) {
          return;
        }
        updateRunPromptButton();
        syncRunPromptOverlay();
      }

      function resolveRunStreamSourceLabel(source) {
        if (source === "stderr") {
          return t("runStreamSourceStderr");
        }
        if (source === "event") {
          return t("runStreamSourceEvent");
        }
        return t("runStreamSourceStdout");
      }

      function normalizeRunStreamSource(source) {
        if (source === "stderr" || source === "event") {
          return source;
        }
        return "stdout";
      }

      function normalizeRunStreamRecordContent(content) {
        if (typeof content === "string") {
          return content;
        }
        if (content === null || content === undefined) {
          return "";
        }
        return String(content);
      }

      function getRunStreamContentByteLength(content) {
        const normalized = normalizeRunStreamRecordContent(content);
        if (!normalized) {
          return 0;
        }
        if (typeof TextEncoder !== "undefined") {
          return new TextEncoder().encode(normalized).length;
        }
        return normalized.length;
      }

      function trimRunStreamContentToMaxBytes(content, maxBytes) {
        if (maxBytes <= 0) {
          return "";
        }
        let normalized = normalizeRunStreamRecordContent(content);
        if (getRunStreamContentByteLength(normalized) <= maxBytes) {
          return normalized;
        }
        while (normalized && getRunStreamContentByteLength(normalized) > maxBytes) {
          const overflowBytes = getRunStreamContentByteLength(normalized) - maxBytes;
          const charsToDrop = Math.max(1, Math.ceil(overflowBytes / 4));
          normalized = normalized.slice(charsToDrop);
        }
        return normalized;
      }

      function normalizeRunStreamRecordForStorage(content) {
        const originalContent = normalizeRunStreamRecordContent(content);
        const originalBytes = getRunStreamContentByteLength(originalContent);
        if (originalBytes <= RUN_STREAM_MAX_RECORD_BYTES) {
          return {
            content: originalContent,
            discardedBytes: 0,
            truncated: false,
          };
        }
        const truncationNotice = t("runStreamRecordBytesTruncated", {
          count: originalBytes - RUN_STREAM_MAX_RECORD_BYTES,
        }) + "\\n";
        const noticeBytes = getRunStreamContentByteLength(truncationNotice);
        const retainedBudget = Math.max(0, RUN_STREAM_MAX_RECORD_BYTES - noticeBytes);
        const retainedContent = trimRunStreamContentToMaxBytes(originalContent, retainedBudget);
        const retainedBytes = getRunStreamContentByteLength(retainedContent);
        return {
          content: truncationNotice + retainedContent,
          discardedBytes: Math.max(0, originalBytes - retainedBytes),
          truncated: true,
        };
      }

      function buildRunStreamPreview(content) {
        const normalized = String(content || "")
          .replace(/\\r\\n/g, "\\n")
          .replace(/\\n/g, " ↵ ")
          .replace(/\\s+/g, " ")
          .trim();
        if (!normalized) {
          return t("runStreamRecordEmpty");
        }
        if (normalized.length <= RUN_STREAM_PREVIEW_MAX_LENGTH) {
          return normalized;
        }
        return normalized.slice(0, RUN_STREAM_PREVIEW_MAX_LENGTH - 3) + "...";
      }

      function tryFormatRunStreamJsonContent(content) {
        const normalized = normalizeRunStreamRecordContent(content);
        const trimmed = normalized.trim();
        if (!trimmed) {
          return null;
        }
        const firstChar = trimmed.charAt(0);
        if (firstChar !== "{" && firstChar !== "[") {
          return null;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (!parsed || typeof parsed !== "object") {
            return null;
          }
          if (!Array.isArray(parsed) && Object.prototype.toString.call(parsed) !== "[object Object]") {
            return null;
          }
          return JSON.stringify(parsed, null, 2);
        } catch {
          return null;
        }
      }

      function formatRunStreamExpandedContent(content) {
        const normalized = normalizeRunStreamRecordContent(content);
        if (!normalized) {
          return t("runStreamRecordEmpty");
        }
        return tryFormatRunStreamJsonContent(normalized) || normalized;
      }

      function captureOpenRunStreamRecordIds(runtimeState) {
        if (!runtimeState) {
          return;
        }
        runtimeState.runStreamOpenRecordIds.clear();
        if (!elements.runStreamContent) {
          return;
        }
        const openNodes = elements.runStreamContent.querySelectorAll("details.run-stream-item[data-stream-record-id]");
        openNodes.forEach((node) => {
          if (!node.open) {
            return;
          }
          const recordId = node.getAttribute("data-stream-record-id");
          if (recordId) {
            runtimeState.runStreamOpenRecordIds.add(recordId);
          }
        });
      }

      function getRunStreamBottomDistance() {
        if (!elements.runStreamContent) {
          return 0;
        }
        return elements.runStreamContent.scrollHeight - (
          elements.runStreamContent.scrollTop + elements.runStreamContent.clientHeight
        );
      }

      function isRunStreamNearBottom(threshold = 50) {
        return getRunStreamBottomDistance() <= threshold;
      }

      function stickRunStreamToBottom() {
        if (!elements.runStreamContent) {
          return;
        }
        elements.runStreamContent.scrollTop = elements.runStreamContent.scrollHeight;
      }

      function getLatestRunStreamRecordTimestamp(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.runStreamRecords) || !runtimeState.runStreamRecords.length) {
          return 0;
        }
        const latestRecord = runtimeState.runStreamRecords[runtimeState.runStreamRecords.length - 1];
        return latestRecord && typeof latestRecord.createdAt === "number" ? latestRecord.createdAt : 0;
      }

      function resolveRunStreamButtonStaleLevel(runtimeState, now = Date.now()) {
        const latestTimestamp = getLatestRunStreamRecordTimestamp(runtimeState);
        if (!latestTimestamp || now <= latestTimestamp) {
          return "normal";
        }
        const idleMs = now - latestTimestamp;
        if (idleMs >= RUN_STREAM_STALE_CRITICAL_MS) {
          return "critical";
        }
        if (idleMs >= RUN_STREAM_STALE_WARNING_MS) {
          return "warning";
        }
        return "normal";
      }

      function getRunStreamStaleBadgeLabel(staleLevel) {
        if (staleLevel === "critical") {
          return t("runStreamVerySlowLabel");
        }
        if (staleLevel === "warning") {
          return t("runStreamSlowLabel");
        }
        return "";
      }

      function applyRunStreamButtonStaleLevel(runtimeState) {
        if (!elements.runStreamStaleBadge) {
          return;
        }
        const staleLevel = resolveRunStreamButtonStaleLevel(runtimeState);
        const isVisible = staleLevel !== "normal";
        elements.runStreamStaleBadge.textContent = getRunStreamStaleBadgeLabel(staleLevel);
        elements.runStreamStaleBadge.style.display = isVisible ? "inline-flex" : "none";
        elements.runStreamStaleBadge.classList.toggle("run-stream-stale-badge-warning", staleLevel === "warning");
        elements.runStreamStaleBadge.classList.toggle("run-stream-stale-badge-critical", staleLevel === "critical");
      }

      function stopRunStreamStaleTimer() {
        if (runStreamStaleTimer) {
          window.clearInterval(runStreamStaleTimer);
          runStreamStaleTimer = null;
        }
      }

      function ensureRunStreamStaleTimer(shouldRun) {
        if (!shouldRun) {
          stopRunStreamStaleTimer();
          return;
        }
        if (runStreamStaleTimer) {
          return;
        }
        runStreamStaleTimer = window.setInterval(() => {
          const runtimeState = getActiveConversationRuntimeState({ create: false });
          applyRunStreamButtonStaleLevel(runtimeState);
        }, RUN_STREAM_STALE_REFRESH_INTERVAL_MS);
      }

      function getRunStreamButtonLabel(recordCount) {
        const baseLabel = t("runStreamViewLabel");
        if (!recordCount) {
          return baseLabel;
        }
        return baseLabel + "(" + recordCount + ")";
      }

      function renderRunStreamRecord(record, index, runtimeState) {
        const details = document.createElement("details");
        details.className = "run-stream-item";
        details.setAttribute("data-stream-record-id", record.id);
        if (runtimeState && runtimeState.runStreamOpenRecordIds.has(record.id)) {
          details.open = true;
        }

        const summary = document.createElement("summary");
        summary.className = "run-stream-item-summary";

        const indexNode = document.createElement("span");
        indexNode.className = "run-stream-item-index";
        indexNode.textContent = t("runStreamRecordIndex", { index: index + 1 });

        const sourceNode = document.createElement("span");
        sourceNode.className = "run-stream-item-source";
        sourceNode.textContent = resolveRunStreamSourceLabel(record.source);

        const timeNode = document.createElement("span");
        timeNode.className = "run-stream-item-time";
        timeNode.textContent = formatDateTimeWithMs(record.createdAt);

        const previewNode = document.createElement("span");
        previewNode.className = "run-stream-item-preview";
        previewNode.textContent = buildRunStreamPreview(record.content);

        summary.appendChild(indexNode);
        summary.appendChild(sourceNode);
        summary.appendChild(timeNode);
        summary.appendChild(previewNode);

        const contentNode = document.createElement("pre");
        contentNode.className = "run-stream-item-content";
        contentNode.textContent = formatRunStreamExpandedContent(record.content);

        details.appendChild(summary);
        details.appendChild(contentNode);
        return details;
      }

      function updateRunStreamContent() {
        if (!elements.runStreamContent) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length) {
          elements.runStreamContent.classList.add("run-stream-empty");
          elements.runStreamContent.textContent = t("runStreamEmpty");
          updateRunStreamExportButton();
          return;
        }

        const shouldAutoStick = isRunStreamNearBottom(RUN_STREAM_AUTO_SCROLL_THRESHOLD_PX);
        captureOpenRunStreamRecordIds(runtimeState);
        elements.runStreamContent.classList.remove("run-stream-empty");
        elements.runStreamContent.innerHTML = "";

        const list = document.createElement("div");
        list.className = "run-stream-list";
        const discardedCount = runtimeState.runStreamDiscardedRecordCount || 0;
        const truncatedRecordCount = runtimeState.runStreamTruncatedRecordCount || 0;
        if (discardedCount > 0 || truncatedRecordCount > 0) {
          const notice = document.createElement("div");
          notice.className = "run-stream-truncation";
          const noticeParts = [];
          if (discardedCount > 0) {
            noticeParts.push(t("runStreamTruncated", { count: discardedCount }));
          }
          if (truncatedRecordCount > 0) {
            noticeParts.push(t("runStreamRecordsShortened", { count: truncatedRecordCount }));
          }
          notice.textContent = noticeParts.join(" ");
          list.appendChild(notice);
        }
        runtimeState.runStreamRecords.forEach((record, index) => {
          list.appendChild(renderRunStreamRecord(record, index, runtimeState));
        });

        const bottomGap = document.createElement("div");
        bottomGap.className = "run-stream-bottom-gap";

        elements.runStreamContent.appendChild(list);
        elements.runStreamContent.appendChild(bottomGap);
        if (shouldAutoStick) {
          stickRunStreamToBottom();
        }
        updateRunStreamExportButton();
      }

      function resetRunRawStream(tabId, options = {}) {
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        runtimeState.runStreamRecordCounter = 0;
        runtimeState.runStreamRecords.length = 0;
        runtimeState.runStreamRetainedBytes = 0;
        runtimeState.runStreamDiscardedRecordCount = 0;
        runtimeState.runStreamDiscardedBytes = 0;
        runtimeState.runStreamTruncatedRecordCount = 0;
        runtimeState.runStreamOpenRecordIds.clear();
        runtimeState.overlays.runStream = false;
        runStreamExportPending = false;
        if (isRuntimeStateForActiveTab(tabId)) {
          updateRunStreamContent();
          updateRunStreamButton();
          if (options.syncOverlay !== false) {
            syncRunStreamOverlay();
          }
        }
      }

      function appendRunRawStream(content, source, tabId) {
        const normalizedRecord = normalizeRunStreamRecordForStorage(content);
        if (!normalizedRecord.content) {
          return;
        }
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        const contentBytes = getRunStreamContentByteLength(normalizedRecord.content);
        if (normalizedRecord.truncated) {
          runtimeState.runStreamTruncatedRecordCount = (runtimeState.runStreamTruncatedRecordCount || 0) + 1;
          runtimeState.runStreamDiscardedBytes = (runtimeState.runStreamDiscardedBytes || 0) + normalizedRecord.discardedBytes;
        }
        runtimeState.runStreamRecordCounter += 1;
        runtimeState.runStreamRecords.push({
          id: "stream-record-" + runtimeState.runStreamRecordCounter,
          content: normalizedRecord.content,
          source: normalizeRunStreamSource(source),
          createdAt: Date.now(),
        });
        runtimeState.runStreamRetainedBytes = (runtimeState.runStreamRetainedBytes || 0) + contentBytes;
        while (
          runtimeState.runStreamRecords.length > RUN_STREAM_MAX_RECORDS
          || runtimeState.runStreamRetainedBytes > RUN_STREAM_MAX_BYTES
        ) {
          const removed = runtimeState.runStreamRecords.shift();
          if (!removed) {
            runtimeState.runStreamRetainedBytes = 0;
            break;
          }
          const removedBytes = getRunStreamContentByteLength(removed.content);
          runtimeState.runStreamRetainedBytes = Math.max(0, (runtimeState.runStreamRetainedBytes || 0) - removedBytes);
          runtimeState.runStreamDiscardedRecordCount = (runtimeState.runStreamDiscardedRecordCount || 0) + 1;
          runtimeState.runStreamDiscardedBytes = (runtimeState.runStreamDiscardedBytes || 0) + removedBytes;
          runtimeState.runStreamOpenRecordIds.delete(removed.id);
        }
        if (isRuntimeStateForActiveTab(tabId)) {
          updateRunStreamButton();
          if (runtimeState.overlays.runStream) {
            syncRunStreamOverlay();
          } else {
            updateRunStreamExportButton();
          }
        }
      }

      function updateRunStreamButton() {
        if (!elements.runStreamButton) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const recordCount = runtimeState && Array.isArray(runtimeState.runStreamRecords)
          ? runtimeState.runStreamRecords.length
          : 0;
        const hasRecords = recordCount > 0;
        const canShowForActiveTab = isRunArtifactsVisibleForActiveTab();
        const isButtonVisible = canShowForActiveTab && (state.isRunning || hasRecords);
        const activeTab = getConversationTabSummary(getActiveConversationTabId());
        const shouldHighlightStale = state.isRunning && hasRecords && !isLoopMainTab(activeTab);
        elements.runStreamButton.textContent = getRunStreamButtonLabel(recordCount);
        elements.runStreamButton.style.display = isButtonVisible ? "inline-flex" : "none";
        applyRunStreamButtonStaleLevel(shouldHighlightStale ? runtimeState : null);
        ensureRunStreamStaleTimer(isButtonVisible && shouldHighlightStale);
        updateRunStreamExportButton();
        updateRunWait();
      }

      function syncRunStreamOverlay() {
        if (!elements.runStreamOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length > 0);
        const visible = Boolean(runtimeState && runtimeState.overlays.runStream && hasRecords && isRunArtifactsVisibleForActiveTab());
        if (visible) {
          updateRunStreamContent();
          elements.runStreamOverlay.classList.add("visible");
          return;
        }
        if (runtimeState) {
          runtimeState.overlays.runStream = false;
        }
        elements.runStreamOverlay.classList.remove("visible");
      }

      function openRunStreamOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length || !isRunArtifactsVisibleForActiveTab()) {
          return;
        }
        runtimeState.overlays.runStream = true;
        syncRunStreamOverlay();
        window.requestAnimationFrame(() => {
          stickRunStreamToBottom();
        });
        updateRunStreamExportButton();
      }

      function closeRunStreamOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runStream = false;
        }
        syncRunStreamOverlay();
        updateRunStreamExportButton();
      }

      function openConfigApplyErrorOverlay(detail) {
        if (!elements.configApplyErrorOverlay || !elements.configApplyErrorContent) {
          return;
        }
        const content = typeof detail === "string" && detail.trim()
          ? detail.trim()
          : t("commonUnknownError");
        elements.configApplyErrorContent.textContent = content;
        elements.configApplyErrorOverlay.classList.add("visible");
      }

      function closeConfigApplyErrorOverlay() {
        if (!elements.configApplyErrorOverlay || !elements.configApplyErrorContent) {
          return;
        }
        elements.configApplyErrorOverlay.classList.remove("visible");
        elements.configApplyErrorContent.textContent = "";
      }

      function updateRunStreamExportButton() {
        if (!elements.exportRunStream) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length);
        elements.exportRunStream.disabled = runStreamExportPending || !hasRecords;
        elements.exportRunStream.textContent = runStreamExportPending
          ? t("runStreamExporting")
          : t("runStreamExportLabel");
      }

      function buildRunStreamExportPayload(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.runStreamRecords)) {
          return [];
        }
        const records = runtimeState.runStreamRecords.map((record) => ({
          id: record.id,
          content: record.content,
          source: record.source,
          createdAt: record.createdAt,
        }));
        const discardedRecordCount = runtimeState.runStreamDiscardedRecordCount || 0;
        const discardedBytes = runtimeState.runStreamDiscardedBytes || 0;
        const truncatedRecordCount = runtimeState.runStreamTruncatedRecordCount || 0;
        if (!discardedRecordCount && !discardedBytes && !truncatedRecordCount) {
          return records;
        }
        return [{
          id: "stream-truncation-metadata",
          content: JSON.stringify({
            type: "runStreamTruncation",
            retainedRecordCount: records.length,
            retainedBytes: runtimeState.runStreamRetainedBytes || 0,
            discardedRecordCount,
            discardedBytes,
            truncatedRecordCount,
            maxRecords: RUN_STREAM_MAX_RECORDS,
            maxBytes: RUN_STREAM_MAX_BYTES,
            maxRecordBytes: RUN_STREAM_MAX_RECORD_BYTES,
          }, null, 2),
          source: "event",
          createdAt: records.length && typeof records[0].createdAt === "number" ? records[0].createdAt : Date.now(),
        }].concat(records);
      }

      function requestRunStreamExport() {
        if (runStreamExportPending) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length) {
          showToast(t("toastRunStreamExportEmpty"));
          updateRunStreamExportButton();
          return;
        }
        runStreamExportPending = true;
        updateRunStreamExportButton();
        vscode.postMessage({
          type: "exportRunStream",
          records: buildRunStreamExportPayload(runtimeState),
          tabId: getActiveConversationTabId(),
          cli: state.currentCli,
        });
      }

      function handleRunStreamExportResult(data) {
        runStreamExportPending = false;
        updateRunStreamExportButton();
        if (!shouldHandleTabScopedEvent(data)) {
          return;
        }
        const errorMessage = typeof data.error === "string" ? data.error.trim() : "";
        if (errorMessage) {
          showToast(t("toastRunStreamExportFailed", { error: errorMessage }));
          return;
        }
        const exportPath = typeof data.path === "string" && data.path
          ? data.path
          : typeof data.fileName === "string"
            ? data.fileName
            : "";
        showToast(t("toastRunStreamExportSuccess", { path: exportPath }));
      }

      function updateQueueIndicator() {
        if (!elements.queueIndicator || !elements.queueCount) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const count = runtimeState ? runtimeState.pendingPromptQueue.length : 0;
        elements.queueCount.textContent = String(count);
        elements.queueIndicator.style.display = count > 0 ? "inline-flex" : "none";
        updateRunWait();
        if (runtimeState && runtimeState.overlays.queue) {
          renderQueueOverlay();
        }
      }

      function normalizeQueueEditingState(runtimeState) {
        if (!runtimeState || runtimeState.queueEditingIndex < 0) {
          return;
        }
        if (runtimeState.queueEditingIndex >= runtimeState.pendingPromptQueue.length) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        }
      }

      function startQueuedPromptEdit(index) {
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        if (index < 0 || index >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        const payload = normalizePromptPayload(runtimeState.pendingPromptQueue[index]);
        if (!payload) {
          return;
        }
        runtimeState.queueEditingIndex = index;
        runtimeState.queueEditingDraft = payload.prompt;
        renderQueueOverlay();
      }

      function cancelQueuedPromptEdit() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || runtimeState.queueEditingIndex < 0) {
          return;
        }
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        renderQueueOverlay();
      }

      function saveQueuedPromptEdit() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (runtimeState.queueEditingIndex < 0 || runtimeState.queueEditingIndex >= runtimeState.pendingPromptQueue.length) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        const nextPrompt = String(runtimeState.queueEditingDraft || "").trim();
        if (!nextPrompt) {
          showToast(t("toastQueueEmptyPrompt"));
          return;
        }
        const currentPayload = normalizePromptPayload(runtimeState.pendingPromptQueue[runtimeState.queueEditingIndex]);
        if (!currentPayload) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        if (nextPrompt === currentPayload.prompt) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        runtimeState.pendingPromptQueue[runtimeState.queueEditingIndex] = {
          ...currentPayload,
          prompt: nextPrompt,
        };
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        updateQueueIndicator();
        showToast(t("toastQueueUpdated"));
      }

      function renderQueueOverlay() {
        if (!elements.queueBody) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const activeTabId = getActiveConversationTabId();
        if (elements.continueQueue) {
          const hasQueue = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
          elements.continueQueue.disabled = !hasQueue || isConversationTabBusy(activeTabId);
        }
        if (!runtimeState) {
          elements.queueBody.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "queue-empty";
          empty.textContent = t("queueEmpty");
          elements.queueBody.appendChild(empty);
          return;
        }
        normalizeQueueEditingState(runtimeState);
        elements.queueBody.innerHTML = "";
        if (!runtimeState.pendingPromptQueue.length) {
          const empty = document.createElement("div");
          empty.className = "queue-empty";
          empty.textContent = t("queueEmpty");
          elements.queueBody.appendChild(empty);
          return;
        }
        let editInputToFocus = null;
        runtimeState.pendingPromptQueue.forEach((item, index) => {
          const payload = normalizePromptPayload(item);
          const promptText = payload ? payload.prompt : "";
          const isEditing = runtimeState.queueEditingIndex === index;
          const row = document.createElement("div");
          row.className = "queue-item";

          if (isEditing) {
            const editor = document.createElement("textarea");
            editor.className = "queue-edit-input";
            editor.placeholder = t("queueEditPlaceholder");
            editor.value = runtimeState.queueEditingDraft;
            editor.addEventListener("input", () => {
              runtimeState.queueEditingDraft = editor.value;
            });
            editor.addEventListener("keydown", (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                saveQueuedPromptEdit();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelQueuedPromptEdit();
              }
            });
            editInputToFocus = editor;
            row.appendChild(editor);
          } else {
            const textNode = document.createElement("div");
            textNode.className = "queue-text";
            const previewText =
              promptText.length > queuePromptPreviewLimit
                ? promptText.slice(0, Math.max(0, queuePromptPreviewLimit - queuePromptPreviewSuffix.length)) +
                  queuePromptPreviewSuffix
                : promptText;
            textNode.textContent = previewText;
            if (previewText !== promptText) {
              textNode.title = promptText;
            }
            row.appendChild(textNode);
          }

          const actions = document.createElement("div");
          actions.className = "queue-actions";

          if (isEditing) {
            const cancelButton = document.createElement("button");
            cancelButton.className = "ghost queue-edit-button";
            cancelButton.textContent = t("queueCancelEditLabel");
            cancelButton.addEventListener("click", () => {
              cancelQueuedPromptEdit();
            });

            const saveButton = document.createElement("button");
            saveButton.className = "secondary queue-edit-button";
            saveButton.textContent = t("queueSaveLabel");
            saveButton.addEventListener("click", () => {
              saveQueuedPromptEdit();
            });

            actions.appendChild(cancelButton);
            actions.appendChild(saveButton);
          } else {
            const editButton = document.createElement("button");
            editButton.className = "secondary queue-edit-button";
            editButton.textContent = t("queueEditLabel");
            editButton.addEventListener("click", () => {
              startQueuedPromptEdit(index);
            });
            actions.appendChild(editButton);
          }

          const moveUpButton = document.createElement("button");
          moveUpButton.className = "icon-button queue-order-button";
          moveUpButton.setAttribute("aria-label", t("queueMoveUpLabel"));
          moveUpButton.setAttribute("title", t("queueMoveUpLabel"));
          moveUpButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="18" x2="12" y2="6" />' +
            '<polyline points="6 12 12 6 18 12" />' +
            "</svg>";
          moveUpButton.disabled = index === 0;
          moveUpButton.addEventListener("click", () => {
            moveQueuedPrompt(index, index - 1);
          });

          const moveDownButton = document.createElement("button");
          moveDownButton.className = "icon-button queue-order-button";
          moveDownButton.setAttribute("aria-label", t("queueMoveDownLabel"));
          moveDownButton.setAttribute("title", t("queueMoveDownLabel"));
          moveDownButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="6" x2="12" y2="18" />' +
            '<polyline points="6 12 12 18 18 12" />' +
            "</svg>";
          moveDownButton.disabled = index === runtimeState.pendingPromptQueue.length - 1;
          moveDownButton.addEventListener("click", () => {
            moveQueuedPrompt(index, index + 1);
          });

          const removeButton = document.createElement("button");
          removeButton.className = "icon-button queue-remove-button";
          removeButton.setAttribute("aria-label", t("queueRemoveLabel"));
          removeButton.setAttribute("title", t("queueRemoveLabel"));
          removeButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="6" y1="6" x2="18" y2="18" />' +
            '<line x1="18" y1="6" x2="6" y2="18" />' +
            "</svg>";
          removeButton.addEventListener("click", () => {
            clearQueuedPromptIndex(index);
          });

          actions.appendChild(moveUpButton);
          actions.appendChild(moveDownButton);
          actions.appendChild(removeButton);
          row.appendChild(actions);
          elements.queueBody.appendChild(row);
        });
        if (editInputToFocus) {
          setTimeout(() => {
            editInputToFocus.focus();
            const length = editInputToFocus.value.length;
            editInputToFocus.setSelectionRange(length, length);
          }, 0);
        }
      }

      function syncQueueOverlay() {
        if (!elements.queueOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const visible = Boolean(runtimeState && runtimeState.overlays.queue);
        if (visible) {
          renderQueueOverlay();
        }
        elements.queueOverlay.classList.toggle("visible", visible);
      }

      function openQueueOverlay() {
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        runtimeState.overlays.queue = true;
        syncQueueOverlay();
      }

      function closeQueueOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.queue = false;
        }
        syncQueueOverlay();
      }

      function queuePromptForLater(payload) {
        const normalizedPayload = snapshotPromptPayloadForQueue(payload);
        if (!normalizedPayload) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        const queuedPayload = {
          ...normalizedPayload,
          interactiveMode: normalizeInteractiveMode(state.interactiveMode),
          skipPromptHistory: true,
        };
        runtimeState.pendingPromptQueue.push(queuedPayload);
        const activeTab = getConversationTabSummary(getActiveConversationTabId());
        vscode.postMessage({
          type: "recordPromptHistory",
          prompt: queuedPayload.prompt,
          cli: activeTab && activeTab.cli ? activeTab.cli : state.currentCli,
        });
        updateQueueIndicator();
        showToast(t("toastQueueAdded"));
      }

      function moveQueuedPrompt(fromIndex, toIndex) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (fromIndex < 0 || fromIndex >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        if (toIndex < 0 || toIndex >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        if (fromIndex === toIndex) {
          return;
        }
        const moved = runtimeState.pendingPromptQueue.splice(fromIndex, 1);
        if (!moved.length) {
          return;
        }
        runtimeState.pendingPromptQueue.splice(toIndex, 0, moved[0]);

        if (runtimeState.queueEditingIndex === fromIndex) {
          runtimeState.queueEditingIndex = toIndex;
        } else if (fromIndex < runtimeState.queueEditingIndex && runtimeState.queueEditingIndex <= toIndex) {
          runtimeState.queueEditingIndex -= 1;
        } else if (toIndex <= runtimeState.queueEditingIndex && runtimeState.queueEditingIndex < fromIndex) {
          runtimeState.queueEditingIndex += 1;
        }

        updateQueueIndicator();
      }

      function clearQueuedPromptIndex(index) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (index < 0 || index >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        runtimeState.pendingPromptQueue.splice(index, 1);
        if (runtimeState.queueEditingIndex === index) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        } else if (runtimeState.queueEditingIndex > index) {
          runtimeState.queueEditingIndex -= 1;
        }
        updateQueueIndicator();
      }

      function flushPendingPromptQueue(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        if (isConversationTabBusy(targetTabId)) {
          return false;
        }
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        if (!runtimeState || !runtimeState.pendingPromptQueue.length) {
          return false;
        }
        const nextPromptPayload = runtimeState.pendingPromptQueue.shift();
        if (runtimeState.queueEditingIndex === 0) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        } else if (runtimeState.queueEditingIndex > 0) {
          runtimeState.queueEditingIndex -= 1;
        }
        if (isRuntimeStateForActiveTab(targetTabId)) {
          updateQueueIndicator();
        }
        const sent = dispatchPrompt(nextPromptPayload, {
          tabId: targetTabId,
          preserveActiveTab: !isRuntimeStateForActiveTab(targetTabId),
        });
        if (!sent && isRuntimeStateForActiveTab(targetTabId)) {
          showToast(t("toastQueueSendFailed"));
        }
        return sent;
      }

      function continueQueuedPrompts(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const sent = flushPendingPromptQueue(targetTabId);
        if (sent) {
          closeQueueOverlay();
        } else {
          syncQueueOverlay();
        }
      }

      function sendPrompt() {
        const prompt = elements.promptInput.value.trim();
        if (!prompt) {
          return;
        }
        const promptPayload = buildPromptPayload(prompt);
        const activeTabId = getActiveConversationTabId();
        if (isLoopMainConversationTabRunning(activeTabId)) {
          queuePromptForLater(promptPayload);
          elements.promptInput.value = "";
          resetPromptContextForNextPrompt();
          return;
        }
        if (isConversationTabBusy(activeTabId)) {
          openRunConflictOverlay(promptPayload);
          return;
        }
        elements.promptInput.value = "";
        const sent = dispatchPrompt(promptPayload);
        if (sent) {
          resetPromptContextForNextPrompt();
        }
      }

      function insertPromptText(text) {
        const input = elements.promptInput;
        const value = input.value || "";
        const selectionStart = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
        const selectionEnd = typeof input.selectionEnd === "number" ? input.selectionEnd : value.length;
        input.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
        const nextPos = selectionStart + text.length;
        input.selectionStart = nextPos;
        input.selectionEnd = nextPos;
        input.focus();
      }

      function buildInsertText(paths, prefix = "@") {
        if (!Array.isArray(paths) || paths.length === 0) {
          return "";
        }
        return paths.map((item) => prefix + item).join(" ") + " ";
      }

      function requestWorkspacePathPick() {
        vscode.postMessage({ type: "pickWorkspacePath" });
      }

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
              return;
            }
            reject(new Error(t("toastFileReadFailed")));
          };
          reader.onerror = () => {
            reject(new Error(t("toastFileReadFailed")));
          };
          reader.readAsDataURL(file);
        });
      }

      function formatUploadLimitBytes(bytes) {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value <= 0) {
          return "0 MB";
        }
        const megaBytes = value / (1024 * 1024);
        if (megaBytes >= 1) {
          return megaBytes.toFixed(megaBytes >= 10 ? 0 : 1).replace(/\\.0$/, "") + " MB";
        }
        const kiloBytes = value / 1024;
        return Math.max(1, Math.ceil(kiloBytes)) + " KB";
      }

      function validateUploadFiles(files) {
        if (!Array.isArray(files) || files.length === 0) {
          return "";
        }
        if (files.length > UPLOAD_MAX_FILES) {
          return t("toastUploadTooManyFiles", {
            count: files.length,
            max: UPLOAD_MAX_FILES,
          });
        }
        for (const file of files) {
          const size = file && typeof file.size === "number" && Number.isFinite(file.size)
            ? Math.max(0, file.size)
            : 0;
          if (size > UPLOAD_MAX_FILE_BYTES) {
            return t("toastUploadFileTooLarge", {
              name: file && file.name ? file.name : t("attachmentFallbackName"),
              size: formatUploadLimitBytes(size),
              max: formatUploadLimitBytes(UPLOAD_MAX_FILE_BYTES),
            });
          }
        }
        return "";
      }

      async function handleFileSelection(fileList) {
        if (!fileList || fileList.length === 0) {
          return;
        }
        const files = Array.from(fileList);
        const validationError = validateUploadFiles(files);
        if (validationError) {
          showToast(validationError);
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: validationError,
          });
          return;
        }
        try {
          const payloadFiles = [];
          for (const file of files) {
            const dataUrl = await readFileAsDataUrl(file);
            payloadFiles.push({ name: file.name, type: file.type || "", dataUrl });
          }
          vscode.postMessage({ type: "uploadFiles", files: payloadFiles });
        } catch (error) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: t("toastReadFileFailed"),
          });
        }
      }

      function getClipboardFiles(event) {
        const items = event.clipboardData && event.clipboardData.items
          ? Array.from(event.clipboardData.items)
          : [];
        const files = items
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file) => file);
        return files;
      }

      function getDropUris(event) {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) {
          return [];
        }
        const uriLines = (dataTransfer.getData("text/uri-list") || "")
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        const uris = new Set(uriLines);
        const textData = (dataTransfer.getData("text/plain") || "").trim();
        if (textData.startsWith("file://")) {
          uris.add(textData);
        }
        return Array.from(uris);
      }

`;
