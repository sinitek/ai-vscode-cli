// Session, loop group chat, and prompt history overlays.
export const VIEW_CONTENT_SCRIPT_HISTORY_PANELS = `      function buildHistorySessionKey(cli, sessionId) {
        return String(cli || "") + ":" + String(sessionId || "");
      }

      function isHistorySessionExportPending(session) {
        return Boolean(
          session
          && historySessionExportPendingKey
          && historySessionExportPendingKey === buildHistorySessionKey(session.cli, session.id)
        );
      }

      function resetHistorySessionMessagesState() {
        state.historySessionMessages = {
          cli: "",
          sessionId: "",
          resolvedSessionId: "",
          label: "",
          createdAt: 0,
          messages: [],
          loading: false,
          error: "",
        };
      }

      function normalizeHistorySessionMessages(messages) {
        const ordered = normalizeMessageOrder(Array.isArray(messages) ? messages : []);
        return ordered.filter((message) => {
          return message
            && typeof message === "object"
            && typeof message.content === "string"
            && message.content.trim();
        });
      }

      function resolveHistoryMessageRoleLabel(role) {
        if (role === "user") {
          return t("historySessionMessageUser");
        }
        if (role === "assistant") {
          return t("historySessionMessageAssistant");
        }
        if (role === "trace") {
          return t("historySessionMessageTrace");
        }
        return t("historySessionMessageSystem");
      }

      function resolveHistoryMessageKindLabel(kind) {
        if (kind === "thinking") {
          return t("historySessionMessageThinking");
        }
        if (kind === "tool-use") {
          return t("historySessionMessageToolUse");
        }
        return "";
      }

      function renderHistoryMessage(message, index) {
        const item = document.createElement("div");
        item.className = "history-message-item";

        const header = document.createElement("div");
        header.className = "history-message-header";

        const role = document.createElement("span");
        role.className = "history-message-role";
        role.textContent = (index + 1) + ". " + resolveHistoryMessageRoleLabel(message.role);
        header.appendChild(role);

        const kindLabel = resolveHistoryMessageKindLabel(message.kind);
        if (kindLabel) {
          const kind = document.createElement("span");
          kind.className = "history-message-kind";
          kind.textContent = kindLabel;
          header.appendChild(kind);
        }

        if (typeof message.createdAt === "number") {
          const time = document.createElement("span");
          time.className = "history-message-time";
          time.textContent = formatDateTimeWithMs(message.createdAt);
          header.appendChild(time);
        }

        const content = document.createElement("pre");
        content.className = "history-message-content";
        content.textContent = message.content || "";

        item.appendChild(header);
        item.appendChild(content);
        return item;
      }

      function updateHistoryMessagesExportButton() {
        if (!elements.exportHistoryMessages) {
          return;
        }
        const active = state.historySessionMessages || {};
        const key = buildHistorySessionKey(active.cli, active.sessionId);
        const isPending = Boolean(historySessionExportPendingKey && historySessionExportPendingKey === key);
        const hasPendingExport = Boolean(historySessionExportPendingKey);
        const hasMessages = Array.isArray(active.messages) && active.messages.length > 0;
        elements.exportHistoryMessages.disabled = Boolean(active.loading || hasPendingExport || !active.sessionId || !hasMessages);
        elements.exportHistoryMessages.textContent = isPending
          ? t("historySessionExporting")
          : t("historySessionExportLabel");
      }

      function renderHistorySessionMessages() {
        if (!elements.historyMessagesContent) {
          return;
        }
        const active = state.historySessionMessages || {};
        const label = active.label || t("historySessionMessagesUnknown");
        if (elements.historyMessagesTitle) {
          elements.historyMessagesTitle.textContent = t("historySessionMessagesTitle");
        }
        if (elements.historyMessagesSubtitle) {
          const timeLabel = active.createdAt ? formatDateTime(active.createdAt) : "";
          elements.historyMessagesSubtitle.textContent = active.cli
            ? t("historySessionMessagesMeta", { cli: active.cli, time: timeLabel || "-" }) + " · " + label
            : label;
        }
        if (elements.historyMessagesStatus) {
          elements.historyMessagesStatus.textContent = active.error
            ? active.error
            : active.loading
              ? t("historySessionMessagesLoading")
              : "";
        }

        elements.historyMessagesContent.innerHTML = "";
        const messages = Array.isArray(active.messages) ? active.messages : [];
        if (active.loading || !messages.length) {
          elements.historyMessagesContent.classList.add("history-messages-empty");
          elements.historyMessagesContent.textContent = active.loading
            ? t("historySessionMessagesLoading")
            : t("historySessionMessagesEmpty");
          updateHistoryMessagesExportButton();
          return;
        }

        elements.historyMessagesContent.classList.remove("history-messages-empty");
        const list = document.createElement("div");
        list.className = "history-message-list";
        messages.forEach((message, index) => {
          list.appendChild(renderHistoryMessage(message, index));
        });
        elements.historyMessagesContent.appendChild(list);
        updateHistoryMessagesExportButton();
      }

      function openHistorySessionMessages(session) {
        if (!session || !session.id || !session.cli) {
          return;
        }
        const label = session.firstPrompt || session.label || t("sessionDefaultLabel");
        state.historySessionMessages = {
          cli: session.cli,
          sessionId: session.id,
          resolvedSessionId: "",
          label,
          createdAt: session.createdAt || 0,
          messages: [],
          loading: true,
          error: "",
        };
        if (elements.historyMessagesOverlay) {
          elements.historyMessagesOverlay.classList.add("visible");
        }
        renderHistorySessionMessages();
        vscode.postMessage({
          type: "loadHistorySessionMessages",
          cli: session.cli,
          sessionId: session.id,
        });
      }

      function closeHistorySessionMessages() {
        if (elements.historyMessagesOverlay) {
          elements.historyMessagesOverlay.classList.remove("visible");
        }
        resetHistorySessionMessagesState();
        updateHistoryMessagesExportButton();
      }

      function requestHistorySessionExport(session) {
        const target = session || state.historySessionMessages;
        if (!target || !target.cli || !target.sessionId && !target.id) {
          return;
        }
        const sessionId = target.sessionId || target.id;
        const cli = target.cli;
        const key = buildHistorySessionKey(cli, sessionId);
        if (historySessionExportPendingKey) {
          return;
        }
        historySessionExportPendingKey = key;
        renderSessionList();
        updateHistoryMessagesExportButton();
        vscode.postMessage({
          type: "exportHistorySessionMessages",
          cli,
          sessionId,
        });
      }

      function handleHistorySessionMessages(data) {
        const active = state.historySessionMessages || {};
        const incomingKey = buildHistorySessionKey(data.cli, data.sessionId);
        const activeKey = buildHistorySessionKey(active.cli, active.sessionId);
        if (incomingKey !== activeKey) {
          return;
        }
        const error = typeof data.error === "string" ? data.error.trim() : "";
        state.historySessionMessages = Object.assign({}, active, {
          resolvedSessionId: typeof data.resolvedSessionId === "string" ? data.resolvedSessionId : "",
          messages: normalizeHistorySessionMessages(data.messages),
          loading: false,
          error,
        });
        if (error) {
          showToast(t("toastHistorySessionLoadFailed", { error }));
        }
        renderHistorySessionMessages();
      }

      function handleHistorySessionExportResult(data) {
        const resultKey = buildHistorySessionKey(data.cli, data.sessionId);
        if (historySessionExportPendingKey && historySessionExportPendingKey !== resultKey) {
          return;
        }
        historySessionExportPendingKey = "";
        renderSessionList();
        updateHistoryMessagesExportButton();
        const error = typeof data.error === "string" ? data.error.trim() : "";
        if (error) {
          const isEmpty = error === t("toastHistorySessionExportEmpty");
          showToast(isEmpty
            ? t("toastHistorySessionExportEmpty")
            : t("toastHistorySessionExportFailed", { error }));
          return;
        }
        const exportPath = typeof data.path === "string" && data.path
          ? data.path
          : typeof data.fileName === "string"
            ? data.fileName
            : "";
        showToast(t("toastHistorySessionExportSuccess", { path: exportPath }));
      }

      function getHistorySearchQuery() {
        return String(state.historySearchQuery || "").trim().toLocaleLowerCase();
      }

      function historySearchMatches(query, values) {
        if (!query) {
          return true;
        }
        return values.some((value) => String(value || "").toLocaleLowerCase().includes(query));
      }

      function renderSessionList() {
        elements.sessionList.innerHTML = "";
        const allSessions = state.sessionState && Array.isArray(state.sessionState.sessions)
          ? state.sessionState.sessions
          : [];
        const query = getHistorySearchQuery();
        const sessions = allSessions.filter((session) => historySearchMatches(query, [
          session.firstPrompt,
          session.label,
          session.cli,
          session.id,
        ]));
        if (!sessions.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = query && allSessions.length
            ? t("historyNoMatchingSessions")
            : t("historyEmptySessions");
          elements.sessionList.appendChild(empty);
          return;
        }
        sessions.forEach((session) => {
          const item = document.createElement("div");
          item.className = "session-item";

          const info = document.createElement("div");
          info.className = "session-info";

          const titleRow = document.createElement("div");
          titleRow.className = "session-title-row";

          const label = document.createElement("div");
          label.className = "session-label";
          const cliLabel = session.cli ? "[" + session.cli + "] " : "";
          const sessionPromptPreview = buildPromptPreview(session.firstPrompt || session.label || t("sessionDefaultLabel"));
          label.textContent = cliLabel + sessionPromptPreview;
          if (session.firstPrompt) {
            label.title = session.firstPrompt;
          } else {
            label.title = session.label || t("sessionDefaultLabel");
          }

          titleRow.appendChild(label);
          if (session.isLoopSession) {
            const badge = document.createElement("span");
            badge.className = "session-status-badge";
            badge.textContent = t("sessionLoopLabel");
            titleRow.appendChild(badge);
          }
          if (session.isGraphSession) {
            const badge = document.createElement("span");
            badge.className = "session-status-badge";
            badge.textContent = t("sessionGraphLabel");
            titleRow.appendChild(badge);
          }
          if (session.isOpenInConversationTabs) {
            const badge = document.createElement("span");
            badge.className = "session-status-badge";
            badge.textContent = t("sessionOpenInTabsLabel");
            titleRow.appendChild(badge);
          }

          const subtitle = document.createElement("div");
          subtitle.className = "session-subtitle";
          subtitle.textContent = session.createdAt ? formatDateTime(session.createdAt) : "";

          info.appendChild(titleRow);
          info.appendChild(subtitle);

          const actions = document.createElement("div");
          actions.className = "session-actions";

          const messagesButton = document.createElement("button");
          messagesButton.className = "secondary";
          messagesButton.textContent = t("historySessionViewLabel");
          messagesButton.addEventListener("click", () => {
            openHistorySessionMessages(session);
          });

          const loadButton = document.createElement("button");
          loadButton.className = "secondary";
          loadButton.textContent = t("sessionLoadLabel");
          loadButton.addEventListener("click", () => {
            closeHistory();
            armPromptContextForConversationStart();
            if (session.openConversationTabId) {
              vscode.postMessage({
                type: "selectConversationTab",
                tabId: session.openConversationTabId,
                cli: session.cli,
              });
              return;
            }
            vscode.postMessage({ type: "selectSession", sessionId: session.id, cli: session.cli });
          });

          const exportButton = document.createElement("button");
          exportButton.className = "secondary";
          exportButton.textContent = isHistorySessionExportPending(session)
            ? t("historySessionExporting")
            : t("historySessionExportLabel");
          exportButton.disabled = Boolean(historySessionExportPendingKey);
          exportButton.addEventListener("click", () => {
            requestHistorySessionExport(session);
          });

          const deleteButton = document.createElement("button");
          deleteButton.className = "ghost";
          deleteButton.textContent = t("sessionDeleteLabel");
          deleteButton.addEventListener("click", () => {
            vscode.postMessage({ type: "deleteSession", sessionId: session.id, cli: session.cli });
          });

          actions.appendChild(messagesButton);
          actions.appendChild(loadButton);
          actions.appendChild(exportButton);
          actions.appendChild(deleteButton);
          item.appendChild(info);
          item.appendChild(actions);
          elements.sessionList.appendChild(item);
        });
      }

      function renderPromptHistoryList() {
        if (!elements.promptHistoryList) {
          return;
        }
        elements.promptHistoryList.innerHTML = "";
        const allItems = Array.isArray(state.promptHistory) ? state.promptHistory : [];
        const favoriteCount = allItems.filter((item) => isPromptHistoryFavorite(item)).length;
        syncPromptHistoryToolbar(allItems.length, favoriteCount);
        const query = getHistorySearchQuery();
        const searchedItems = allItems.filter((item) => historySearchMatches(query, [
          item.prompt,
          item.cli,
          item.id,
        ]));
        const items = state.promptHistoryFavoritesOnly
          ? searchedItems.filter((item) => isPromptHistoryFavorite(item))
          : searchedItems;
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = query && allItems.length
            ? t("historyNoMatchingPrompts")
            : state.promptHistoryFavoritesOnly
            ? t("historyEmptyFavoritePrompts")
            : t("historyEmptyPrompts");
          elements.promptHistoryList.appendChild(empty);
          return;
        }
        const expandedId = state.promptHistoryExpandedId;
        if (expandedId && !items.some((item) => item.id === expandedId)) {
          state.promptHistoryExpandedId = null;
        }
        items.forEach((item) => {
          const wrapper = document.createElement("div");
          wrapper.className = "prompt-item";
          const isFavorite = isPromptHistoryFavorite(item);
          if (isFavorite) {
            wrapper.classList.add("favorite");
          }
          if (state.promptHistoryExpandedId === item.id) {
            wrapper.classList.add("expanded");
          }

          const header = document.createElement("div");
          header.className = "prompt-header";

          const info = document.createElement("div");
          info.className = "prompt-info";

          const preview = document.createElement("div");
          preview.className = "prompt-preview";
          preview.textContent = buildPromptPreview(item.prompt);
          preview.title = item.prompt || "";

          const meta = document.createElement("div");
          meta.className = "prompt-meta";
          const cliLabel = item.cli ? "[" + item.cli + "] " : "";
          const timeLabel = item.createdAt ? formatDateTime(item.createdAt) : "";
          meta.textContent = cliLabel + timeLabel;

          info.appendChild(preview);
          info.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "prompt-actions";

          const favoriteButton = document.createElement("button");
          favoriteButton.className = isFavorite
            ? "ghost icon-button prompt-favorite-button is-favorite"
            : "ghost icon-button prompt-favorite-button";
          favoriteButton.textContent = isFavorite ? "\\u2605" : "\\u2606";
          favoriteButton.title = isFavorite
            ? t("promptFavoriteRemoveLabel")
            : t("promptFavoriteAddLabel");
          favoriteButton.setAttribute("aria-label", favoriteButton.title);
          favoriteButton.setAttribute("aria-pressed", String(isFavorite));
          favoriteButton.addEventListener("click", (event) => {
            event.stopPropagation();
            setPromptHistoryFavorite(item.id, !isFavorite);
          });

          const viewButton = document.createElement("button");
          viewButton.className = "ghost";
          viewButton.textContent = state.promptHistoryExpandedId === item.id
            ? t("promptCollapseLabel")
            : t("promptViewLabel");
          viewButton.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePromptHistoryExpanded(item.id);
          });

          const useButton = document.createElement("button");
          useButton.className = "secondary";
          useButton.textContent = t("promptReuseLabel");
          useButton.addEventListener("click", (event) => {
            event.stopPropagation();
            applyPromptHistory(item.prompt || "");
          });

          actions.appendChild(favoriteButton);
          actions.appendChild(viewButton);
          actions.appendChild(useButton);

          header.appendChild(info);
          header.appendChild(actions);

          const full = document.createElement("div");
          full.className = "prompt-full";
          full.textContent = item.prompt || "";

          wrapper.appendChild(header);
          wrapper.appendChild(full);

          wrapper.addEventListener("click", () => {
            togglePromptHistoryExpanded(item.id);
          });

          elements.promptHistoryList.appendChild(wrapper);
        });
      }

      function isPromptHistoryFavorite(item) {
        return Boolean(item && item.favorite === true);
      }

      function syncPromptHistoryToolbar(totalCount, favoriteCount) {
        if (elements.promptHistoryFavoritesOnly) {
          elements.promptHistoryFavoritesOnly.checked = Boolean(state.promptHistoryFavoritesOnly);
          elements.promptHistoryFavoritesOnly.disabled = totalCount === 0;
        }
        if (elements.promptHistorySummary) {
          elements.promptHistorySummary.textContent = t("historyPromptFavoriteSummary", {
            favorite: favoriteCount,
            total: totalCount,
          });
        }
      }

      function setPromptHistoryFavorite(id, favorite) {
        const normalizedId = typeof id === "string" ? id.trim() : "";
        if (!normalizedId) {
          return;
        }
        const items = Array.isArray(state.promptHistory) ? state.promptHistory : [];
        const target = items.find((item) => item && item.id === normalizedId);
        if (target) {
          target.favorite = Boolean(favorite);
        }
        renderPromptHistoryList();
        vscode.postMessage({
          type: "togglePromptHistoryFavorite",
          id: normalizedId,
          favorite: Boolean(favorite),
        });
      }

      function buildPromptPreview(prompt) {
        const normalized = String(prompt || "").replace(/\\s+/g, " ").trim();
        if (!normalized) {
          return t("promptEmptyLabel");
        }
        return normalized;
      }

      function togglePromptHistoryExpanded(id) {
        state.promptHistoryExpandedId = state.promptHistoryExpandedId === id ? null : id;
        renderPromptHistoryList();
      }

      function applyPromptHistory(prompt) {
        const content = String(prompt || "");
        elements.promptInput.value = content;
        const end = content.length;
        elements.promptInput.selectionStart = end;
        elements.promptInput.selectionEnd = end;
        elements.promptInput.focus();
        closeHistory();
      }

      function getFirstNonEmptyLine(text) {
        if (!text || typeof text !== "string") {
          return "";
        }
        const lines = text.split("\\n");
        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim();
          if (trimmed) {
            return trimmed;
          }
`;
