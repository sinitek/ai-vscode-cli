// Assistant, trace, markdown, and diff rendering helpers.
export const VIEW_CONTENT_SCRIPT_TRACE_RENDERING = `        }
        return "";
      }

      function getMessageCollapseThreshold() {
        return 50;
      }

      function normalizeCollapsePreviewText(content) {
        const normalized = String(content || "")
          .replace(/\\s+/g, " ")
          .trim();
        return normalized;
      }

      function shouldCollapseByContentLength(content) {
        return normalizeCollapsePreviewText(content).length >= getMessageCollapseThreshold();
      }

      function buildBubbleCollapseSummaryText(content) {
        const normalized = normalizeCollapsePreviewText(content);
        if (!normalized) {
          return "";
        }
        const limit = getMessageCollapseThreshold();
        if (normalized.length <= limit) {
          return normalized;
        }
        return normalized.slice(0, limit) + "…";
      }

      function renderCollapsibleBubbleContent(summaryText, bodyHtml, traceKey, options = {}) {
        const keyAttr = traceKey ? ' data-trace-key="' + escapeHtml(traceKey) + '"' : "";
        const extraClass = options.extraClass ? ' ' + options.extraClass : "";
        const allowRestoreOpen = options.allowRestoreOpen !== false;
        const openAttr = allowRestoreOpen && traceKey && traceCollapsibleOpenKeys.has(traceKey) ? " open" : "";
        return '<details class="trace-collapsible' + extraClass + '"' + keyAttr + openAttr + '><summary>' + escapeHtml(summaryText) + '</summary>' + bodyHtml + '</details>';
      }

      function isThinkingLikeMessage(message, presentation) {
        if (!message) {
          return false;
        }
        return message.kind === "thinking" || (presentation && presentation.type === "thinking");
      }

      function isCodexReasoningStyleMessage(message) {
        const content = String(message && message.content ? message.content : "");
        if (!content) {
          return false;
        }
        const trimmed = content.trimStart();
        if (!trimmed.startsWith("**")) {
          return false;
        }
        const titleEndIndex = trimmed.indexOf("**", 2);
        if (titleEndIndex <= 2) {
          return false;
        }
        const title = trimmed.slice(2, titleEndIndex).trim();
        if (!title || !/[A-Za-z]/.test(title)) {
          return false;
        }
        const firstWord = title.split(/\s+/)[0] || "";
        if (!/ing$/i.test(firstWord)) {
          return false;
        }
        const rest = trimmed.slice(titleEndIndex + 2);
        return /\S/.test(rest);
      }

      function isTransparentBubbleMessage(message, presentation, messageIndex) {
        if (!message) {
          return false;
        }
        if (message.role === "assistant") {
          // Assistant bubbles use the transparent style in current UI.
          return true;
        }
        if (message.role === "trace") {
          return isThinkingLikeMessage(message, presentation);
        }
        if (message.role === "system") {
          return true;
        }
        return false;
      }

      function isFileUpdateMessage(message) {
        if (!message) {
          return false;
        }
        const firstLine = getFirstNonEmptyLine(message.content || "");
        return firstLine.startsWith("file update");
      }

      function normalizeAssistantKind(kind) {
        return kind === "thinking" ? "thinking" : "normal";
      }

      function isSameAssistantKind(left, right) {
        const leftKind = left && typeof left === "object" ? left.kind : left;
        const rightKind = right && typeof right === "object" ? right.kind : right;
        return normalizeAssistantKind(leftKind) === normalizeAssistantKind(rightKind);
      }

      function appendMessage(message) {
        if (!message) {
          return;
        }
        if ((message.role === "user" || message.role === "system" || message.role === "trace") && !message.createdAt) {
          message.createdAt = Date.now();
        }
        if (hasExistingMessageId(message)) {
          return;
        }
        const last = state.messages[state.messages.length - 1];
        if (isNearDuplicateWarningOrErrorMessage(message, last)) {
          return;
        }
        const isFileUpdate = isFileUpdateMessage(message);
        const lastIsFileUpdate = last && isFileUpdateMessage(last);
        if (message.role === "assistant") {
          const canMergeAssistant = last
            && last.role === "assistant"
            && message.merge !== false
            && last.merge !== false
            && message.loopAnswerConclusion !== true
            && last.loopAnswerConclusion !== true
            && message.loopFinalSummary !== true
            && last.loopFinalSummary !== true
            && message.codexFinalAnswer !== true
            && last.codexFinalAnswer !== true
            && isSameAssistantKind(last, message)
            && last.taskRole === message.taskRole
            && !isFileUpdate
            && !lastIsFileUpdate;
          if (canMergeAssistant) {
            assistantRedirects[message.id] = last.id;
            if (message.kind === "thinking") {
              last.kind = "thinking";
            }
            if (message.content) {
              const prefix = last.content ? "\\n" : "";
              last.content = last.content + prefix + message.content;
            }
            renderMessages();
            return;
          }
          state.messages.push(message);
          assistantRedirects[message.id] = message.id;
          renderMessages();
          return;
        }
        const sameRole = last && last.role === message.role;
        const sameTraceKind = message.role !== "trace" || last.kind === message.kind;
        const isToolUseTrace = message.role === "trace" && message.kind === "tool-use";
        const allowMerge = message.merge !== false && (!last || last.merge !== false) && !isToolUseTrace;
        if (sameRole && sameTraceKind && allowMerge) {
          const prefix = last.content ? "\\n" : "";
          last.content = last.content + prefix + (message.content || "");
          renderMessages();
          return;
        }
        state.messages.push(message);
        renderMessages();
      }

      function isDuplicateSystemStatusMessage(content) {
        const normalized = typeof content === "string" ? content.trim() : "";
        if (!normalized) {
          return false;
        }
        const last = state.messages[state.messages.length - 1];
        return Boolean(
          last
          && last.role === "system"
          && typeof last.content === "string"
          && last.content.trim() === normalized
        );
      }

      function appendAssistantDelta(id, content, kind, options) {
        const shouldAutoScroll = !elements.messages.childElementCount || shouldFollowLatestMessagesForActiveTab() || isChatNearBottom();
        const resolvedId = assistantRedirects[id] || id;
        let targetIndex = state.messages.findIndex((item) => item.id === resolvedId);
        const last = state.messages[state.messages.length - 1];
        const marksCodexFinalAnswer = Boolean(options && options.codexFinalAnswer === true);
        const hasContent = Boolean(content);
        const isLastAssistant = last
          && last.role === "assistant"
          && last.id === resolvedId
          && isSameAssistantKind(last, kind);
        const existingTarget = targetIndex === -1 ? null : state.messages[targetIndex];
        const canUpdateDetachedSubagent = Boolean(
          existingTarget
          && existingTarget.role === "assistant"
          && existingTarget.subagentId
        );
        let requiresFullRender = false;
        if (targetIndex !== -1 && !hasContent && marksCodexFinalAnswer) {
          const target = state.messages[targetIndex];
          target.codexFinalAnswer = true;
          if (!updateRenderedAssistantMessage(target, targetIndex)) {
            renderMessages();
          }
          return;
        }
        if (targetIndex === -1 && !hasContent && marksCodexFinalAnswer) {
          return;
        }
        if (targetIndex === -1 || (!isLastAssistant && !canUpdateDetachedSubagent)) {
          const newId = createMessageId();
          assistantRedirects[id] = newId;
          state.messages.push({
            id: newId,
            role: "assistant",
            content: "",
            ...(kind === "thinking" ? { kind: "thinking" } : {}),
            ...(marksCodexFinalAnswer ? { codexFinalAnswer: true } : {}),
          });
          targetIndex = state.messages.length - 1;
          requiresFullRender = true;
        }
        const target = state.messages[targetIndex];
        if (marksCodexFinalAnswer) {
          target.codexFinalAnswer = true;
        }
        if (kind === "thinking") {
          target.kind = "thinking";
        }
        target.content += content || "";
        if (requiresFullRender || !updateRenderedAssistantMessage(target, targetIndex)) {
          renderMessages();
          return;
        }
        elements.emptyState.style.display = state.messages.length === 0 ? "block" : "none";
        updateRunWait();
        if (shouldAutoScroll) {
          stickChatToBottom("auto");
        } else {
          updateScrollToBottomButton();
        }
      }

      function applyTraceSegment(data) {
        if (Array.isArray(data.taskListItems)) {
          applyExternalTaskListUpdate(data.taskListItems, data.tabId);
        }
        const messageId = typeof data.id === "string" && data.id ? data.id : "";
        const existingIndex = findExistingMessageIndexById(messageId);
        if (existingIndex !== -1) {
          const existing = state.messages[existingIndex];
          if (!existing || existing.role !== "trace") {
            return;
          }
          let changed = false;
          if (typeof data.content === "string" && existing.content !== data.content) {
            existing.content = data.content;
            changed = true;
          }
          if (typeof data.createdAt === "number" && existing.createdAt !== data.createdAt) {
            existing.createdAt = data.createdAt;
            changed = true;
          }
          if (typeof data.sequence === "number" && existing.sequence !== data.sequence) {
            existing.sequence = data.sequence;
            changed = true;
          }
          if (existing.kind !== data.kind) {
            existing.kind = data.kind;
            changed = true;
          }
          if (existing.merge !== data.merge) {
            existing.merge = data.merge;
            changed = true;
          }
          if (changed) {
            renderMessages();
          }
          return;
        }
        appendMessage({
          id: messageId || createMessageId(),
          role: "trace",
          content: data.content,
          ...(typeof data.createdAt === "number" ? { createdAt: data.createdAt } : {}),
          ...(typeof data.sequence === "number" ? { sequence: data.sequence } : {}),
          kind: data.kind,
          merge: data.merge,
        });
      }

      function renderUserMessageContent(message) {
        const content = escapeHtml(message.content || "");
        const tags = Array.isArray(message.contextTags)
          ? message.contextTags.filter((tag) => typeof tag === "string" && tag.trim())
          : [];
        if (!tags.length) {
          return content;
        }
        const tagsHtml = tags
          .map((tag) => '<span class="user-context-tag" title="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</span>')
          .join("");
        return '<div class="user-message-content">' + content + '</div>' +
          '<div class="user-context-tags">' + tagsHtml + '</div>';
      }

      function getAssistantMessageContentForDisplay(message) {
        let content = String(message && message.content ? message.content : "");
        if (!message || message.role !== "assistant") {
          return content;
        }
        const marker = "\${FINAL_ANSWER_TEXT_MARKER}";
        if (content.includes(marker)) {
          const markerStartsResponse = content.trimStart().startsWith(marker);
          content = content.split(marker).join("");
          content = markerStartsResponse ? content.trimStart() : content;
        }
        if (typeof stripParsedTaskListContentFromText === "function") {
          return stripParsedTaskListContentFromText(content);
        }
        return content;
      }

      function isToolResultLikeMessage(message) {
        if (!message || message.role === "user") {
          return false;
        }
        const presentation = getTracePresentation(message.content || "");
        return presentation.type === "tool-result";
      }

      function renderToolResultLikeMessage(message) {
        const displayMessage = message && message.role === "assistant"
          ? { ...message, content: getAssistantMessageContentForDisplay(message) }
          : message;
        const content = renderTraceContent(displayMessage);
        const time = message.createdAt ? formatDateTimeWithMs(message.createdAt) : "";
        if (time) {
          return content + '<div class="trace-time">' + escapeHtml(time) + "</div>";
        }
        return content;
      }

      function renderAssistantMessageContent(message, messageIndex) {
        const content = getAssistantMessageContentForDisplay(message);
        const presentation = getTracePresentation(content);
        if (isFinalAssistantSummaryMessage(messageIndex)) {
          return '<div class="assistant-message-content assistant-message-content-final">' + renderMarkdown(content) + '</div>';
        }
        if (
          isTransparentBubbleMessage(message, presentation, messageIndex)
          || isThinkingLikeMessage(message, presentation)
          || isCodexReasoningStyleMessage(message)
        ) {
          return renderMarkdown(content);
        }
        const bodyHtml = '<div class="assistant-message-content">' + renderMarkdown(content) + '</div>';
        if (!shouldCollapseByContentLength(content)) {
          return bodyHtml;
        }
        return renderCollapsibleBubbleContent(
          buildBubbleCollapseSummaryText(content),
          bodyHtml,
          message && message.id ? message.id : "",
          { extraClass: "message-collapsible-generic" }
        );
      }

      function renderTraceMessageContent(message) {
        const content = renderTraceContent(message);
        const time = message.createdAt ? formatDateTimeWithMs(message.createdAt) : "";
        if (time) {
          return content + '<div class="trace-time">' + escapeHtml(time) + "</div>";
        }
        return content;
      }

      function renderMessageContent(message, messageIndex) {
        if (isToolResultLikeMessage(message)) {
          return renderToolResultLikeMessage(message);
        }
        if (message.role === "system") {
          const content = escapeHtml(message.content || "");
          const time = message.createdAt ? formatDateTime(message.createdAt) : "";
          if (time) {
            return (
              '<div class="system-line">' +
              '<span class="system-text">' +
              content +
              '</span>' +
              '<span class="system-time">' +
              time +
              "</span>" +
              "</div>"
            );
          }
          return content;
        }
        if (message.role === "user") {
          return renderUserMessageContent(message);
        }
        if (message.role === "trace") {
          return renderTraceMessageContent(message);
        }
        return renderAssistantMessageContent(message, messageIndex);
      }

      function safelyRenderMessageContent(message, messageIndex) {
        try {
          return renderMessageContent(message, messageIndex);
        } catch (error) {
          const reason = error && error.message ? String(error.message) : String(error);
          reportWebviewFailure("render-message-failed", error, {
            role: message && message.role ? message.role : null,
            id: message && message.id ? message.id : null,
            kind: message && message.kind ? message.kind : null,
            preview: message && typeof message.content === "string" ? message.content.slice(0, 300) : null,
          });
          return '<pre class="trace-content">render-message-failed: ' + escapeHtml(reason) + '</pre>';
        }
      }

      function getTraceExpandedLines(content, presentation) {
        const lines = Array.isArray(presentation && presentation.lines)
          ? presentation.lines.filter((line) => String(line || "").trim().length > 0)
          : [];
        if (lines.length > 0) {
          return lines;
        }
        if (presentation && typeof presentation.detail === "string" && presentation.detail.trim()) {
          return [presentation.detail];
        }
        return String(content || "")
          .split(/\\r?\\n/)
          .filter((line) => String(line || "").trim().length > 0);
      }

      function renderTraceContent(message) {
        const content = message && typeof message.content === "string" ? message.content : "";
        if (!content) {
          return "";
        }
        const traceKey = message && typeof message.id === "string" ? message.id : "";
        const presentation = getTracePresentation(content);
        const expandedLines = getTraceExpandedLines(content, presentation);
        const bodyHtml = renderTraceBodyLines(expandedLines);
        const shouldCollapse = shouldCollapseTraceContent(message, presentation);
        const showDetailSummary = shouldCollapse;
        const header = presentation.title
          ? '<div class="trace-header">' +
            '<div class="trace-tag-row">' +
            '<span class="trace-title">' +
            escapeHtml(presentation.title) +
            "</span>" +
            (presentation.commandTag
              ? '<span class="trace-command-tag cmd-purpose-' +
                escapeHtml(presentation.commandTag.type) +
                '">' +
                escapeHtml(presentation.commandTag.label) +
                "</span>"
              : "") +
            "</div>" +
            (showDetailSummary && presentation.detail
              ? '<span class="trace-detail">' + escapeHtml(presentation.detail) + "</span>"
              : "") +
            "</div>"
          : "";
        if (shouldCollapse) {
          const isToolResult = presentation.type === "tool-result";
          return header + renderCollapsibleBubbleContent(
            getTraceCollapseSummaryText(message, presentation),
            bodyHtml,
            traceKey,
            {
              extraClass: isToolResult ? "trace-collapsible-tool-result" : "message-collapsible-generic",
              allowRestoreOpen: !isToolResult,
            }
          );
        }
        return header + bodyHtml;
      }
      function renderTraceBodyLines(lines) {
        const htmlLines = lines.map((line) => {
          const cleanLine = stripAnsi(line);
          const trimmed = cleanLine.trimStart();
          const kind = getDiffLineKind(trimmed);
          const prefixed = kind ? ensureDiffPrefix(cleanLine, trimmed, kind) : cleanLine;
          const safeText = escapeHtml(prefixed || "");
          const isLineNumbered = isLineNumberedLine(trimmed);
          const className = (kind ? "trace-line diff-" + kind : "trace-line") + (isLineNumbered ? " line-numbered" : "");
          return '<div class="' + className + '">' + (safeText || "&nbsp;") + "</div>";
        });
        return '<div class="trace-content">' + htmlLines.join("") + "</div>";
      }

      function shouldCollapseTraceContent(message, presentation) {
        if (!presentation) {
          return false;
        }
        if (isTransparentBubbleMessage(message, presentation, -1)) {
          return false;
        }
        if (isThinkingLikeMessage(message, presentation)) {
          return false;
        }
        const sourceContent = message && typeof message.content === "string"
          ? message.content
          : (Array.isArray(presentation.lines) ? presentation.lines.join("\\n") : "");
        if (!shouldCollapseByContentLength(sourceContent)) {
          return false;
        }
        const expandedLines = getTraceExpandedLines(sourceContent, presentation);
        const expandedText = normalizeCollapsePreviewText(expandedLines.join("\\n"));
        const detailText = normalizeCollapsePreviewText(presentation && presentation.detail ? presentation.detail : "");
        if (detailText && expandedText === detailText) {
          return false;
        }
        return true;
      }

      function getTraceCollapseSummaryText(message, presentation) {
        if (presentation && presentation.type === "file-update") {
          return t("traceExpandChanges");
        }
        if (presentation && presentation.type === "thinking") {
          return t("traceExpandThinking");
        }
        if (presentation && presentation.type === "tool-result") {
          return getToolResultCollapseSummaryText(presentation);
        }
        const isToolTrace = presentation
          && String(presentation.type || "").startsWith("tool-use-");
        if (isToolTrace) {
          return buildBubbleCollapseSummaryText(message && message.content ? message.content : presentation.lines.join("\\n"));
        }
        return buildBubbleCollapseSummaryText(message && message.content ? message.content : presentation.lines.join("\\n"));
      }

      function getToolResultCollapseSummaryText(presentation) {
        const tool = String(presentation && presentation.detail ? presentation.detail : "").trim()
          || t("traceToolResult");
        return t("traceExpandToolResult", { tool });
      }

      function hasDiffLikeLines(lines) {
        return lines.some((line) => {
          const value = String(line || "").trim();
          return value.startsWith("diff --git")
            || value.startsWith("@@")
            || (value.startsWith("+") && !value.startsWith("+++"))
            || (value.startsWith("-") && !value.startsWith("---"));
        });
      }

      function getTracePresentation(content) {
        const expanded = expandFileChangeTraceContent(String(content || ""));
        const lines = expanded.split(/\\r?\\n/);
        const normalizedLines = lines.slice();
        const firstIndex = normalizedLines.findIndex((line) => line.trim());
        if (firstIndex === -1) {
          return { type: "", title: "", detail: "", lines: normalizedLines, commandTag: null };
        }
        const firstLine = normalizedLines[firstIndex].trim();
        const definition = getTraceTypeDefinition(firstLine);
        if (!definition) {
          return { type: "", title: "", detail: "", lines: normalizedLines, commandTag: null };
        }
        const detail = definition.detail ? definition.detail(firstLine) : "";
        const bodyLines = normalizedLines.slice(0, firstIndex).concat(normalizedLines.slice(firstIndex + 1));
        return {
          type: definition.type,
          title: definition.title,
          detail,
          lines: stripLeadingEmptyLines(bodyLines),
          commandTag: definition.type === "exec" ? classifyCommandPurposeTag(detail) : null,
        };
      }

      function stripLeadingEmptyLines(lines) {
        const next = lines.slice();
        while (next.length && !next[0].trim()) {
          next.shift();
        }
        return next;
      }

      function classifyCommandPurposeTag(rawCommand) {
        const command = unwrapShellCommand(rawCommand);
        const normalized = normalizeCommandForMatching(command);
        if (!normalized) {
          return null;
        }

        const has = (pattern) => pattern.test(normalized);

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?test\\b/) || has(/(?:^|[;&|()\\s])node\\s+--test\\b/) || has(/(?:^|[;&|()\\s])(vitest|jest|ava|mocha|pytest|go\\s+test|cargo\\s+test)\\b/) || has(/(?:^|[;&|()\\s])mvn\\b[^\\n]*\\btest\\b/) || has(/(?:^|[;&|()\\s])gradle\\b[^\\n]*\\btest\\b/)) {
          return { type: "test", label: t("traceExecTagTest") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?build\\b/) || has(/(?:^|[;&|()\\s])tsc\\b/) || has(/(?:^|[;&|()\\s])mvn\\b[^\\n]*\\bcompile\\b/) || has(/(?:^|[;&|()\\s])gradle\\b[^\\n]*\\bbuild\\b/) || has(/(?:^|[;&|()\\s])(go\\s+build|cargo\\s+build)\\b/)) {
          return { type: "build", label: t("traceExecTagBuild") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+run\\s+typecheck\\b/) || has(/(?:^|[;&|()\\s])(typecheck|tsc\\s+--noemit|mypy|pyright)\\b/)) {
          return { type: "typecheck", label: t("traceExecTagTypeCheck") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+run\\s+lint\\b/) || has(/(?:^|[;&|()\\s])(eslint|stylelint|biome\\s+check|ruff|golangci-lint)\\b/)) {
          return { type: "lint", label: t("traceExecTagLint") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun|pip|pip3|poetry|brew|apt|apt-get|yum|dnf|pacman)\\s+(install|add)\\b/) || has(/(?:^|[;&|()\\s])mvn\\s+dependency:/)) {
          return { type: "install", label: t("traceExecTagInstall") };
        }

        if (has(/(?:^|[;&|()\\s])git\\b/)) {
          if (has(/(?:^|[;&|()\\s])git\\s+(add|commit|push|pull|merge|rebase|cherry-pick|reset|checkout|switch|restore|stash|revert|tag)\\b/)) {
            return { type: "git-write", label: t("traceExecTagGitWrite") };
          }
          return { type: "git-read", label: t("traceExecTagGitRead") };
        }

        if (has(/(?:^|[;&|()\\s])(rg|grep|find|ack|ag)\\b/)) {
          return { type: "search", label: t("traceExecTagSearch") };
        }

        if (has(/(?:^|[;&|()\\s])(cat|sed|head|tail|less|more|ls|tree|wc|nl|stat)\\b/)) {
          return { type: "file-read", label: t("traceExecTagFileRead") };
        }
        if (has(/(?:^|[;&|()\\s])(cp|mv|rm|mkdir|touch|chmod|chown|tee|truncate)\\b/) || has(/>\\s*[^&]/)) {
          return { type: "file-write", label: t("traceExecTagFileWrite") };
        }

        if (has(/(?:^|[;&|()\\s'"])python(?:3|2)?\\b/) || has(/(?:^|[;&|()\\s'"])(uv\\s+run\\s+python|poetry\\s+run\\s+python)\\b/)) {
          return { type: "python", label: t("traceExecTagPython") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?(dev|start|serve)\\b/) || has(/(?:^|[;&|()\\s])(node|java|go\\s+run|cargo\\s+run|docker)\\b/)) {
          return { type: "run", label: t("traceExecTagRun") };
        }

        return { type: "other", label: t("traceExecTagOther") };
      }

      function unwrapShellCommand(rawCommand) {
        if (!rawCommand) {
          return "";
        }
        let command = String(rawCommand || "").trim();
        const shellMatch = command.match(/^(bash|zsh|sh)\\s+-lc\\s+([\\s\\S]+)$/i);
        if (!shellMatch) {
          return command;
        }
        const script = shellMatch[2] ? shellMatch[2].trim() : "";
        return stripWrappedQuotes(script);
      }

      function stripWrappedQuotes(value) {
        if (!value || value.length < 2) {
          return value;
        }
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
          return value.slice(1, -1);
        }
        return value;
      }

      function normalizeCommandForMatching(command) {
        return String(command || "")
          .replace(/\\r?\\n/g, " ")
          .replace(/\\s+/g, " ")
          .trim()
          .toLowerCase();
      }

      function getToolStyleBucket(name) {
        if (!name) {
          return 0;
        }
        let hash = 0;
        for (let i = 0; i < name.length; i += 1) {
          hash = (hash + name.charCodeAt(i) * (i + 1)) % 1024;
        }
        return hash % 4;
      }

      function getLocalizedToolTitle(toolName) {
        const rawName = String(toolName || "").trim();
        if (!rawName) {
          return t("traceToolFallback");
        }
        const normalizedName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const titleKeys = {
          read: "traceToolReadFile",
          glob: "traceToolFindFiles",
          grep: "traceToolSearchText",
          search: "traceToolSearchText",
          bash: "traceExec",
          shell: "traceExec",
          applypatch: "traceApplyPatch",
          todowrite: "traceToolUpdateTaskList",
          webfetch: "traceToolFetchWebPage",
          websearch: "traceWebSearch",
          write: "traceToolWriteFile",
          edit: "traceToolEditFile",
          multiedit: "traceToolEditFile",
          task: "traceToolRunTask",
          taskcreate: "traceToolCreateTask",
          taskupdate: "traceToolUpdateTask",
          tasklist: "traceToolTaskList",
          taskget: "traceToolViewTask",
          taskstop: "traceToolStopTask",
        };
        const titleKey = titleKeys[normalizedName];
        return titleKey ? t(titleKey) : rawName;
      }

      function getTraceTypeDefinition(line) {
        const trimmed = line.trim();
        const toolMatch = trimmed.match(/^(?:tool|调用工具)[:：]?\\s*(.+)?$/i);
        if (toolMatch) {
          const toolName = toolMatch[1] ? toolMatch[1].trim() : "";
          const bucket = getToolStyleBucket(toolName);
          return {
            type: "tool-use-" + bucket,
            title: getLocalizedToolTitle(toolName),
            match: /^(?:tool|调用工具)[:：]?\\s*(.+)?$/i,
            detail: () => "",
          };
        }
        const definitions = [
          {
            type: "git-update",
            title: t("traceGitUpdate"),
            match: /^git\\s+update\\b/i,
            detail: (value) => value.replace(/^git\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "exec",
            title: t("traceExec"),
            match: /^(?:exec\\b|【执行命令】)/i,
            detail: (value) => value.replace(/^(?:exec\\b|【执行命令】)[:：]?\\s*/i, "").trim(),
          },
          {
            type: "file-update",
            title: t("traceFileUpdate"),
            match: /^file\\s+update\\b/i,
            detail: (value) => value.replace(/^file\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "apply-patch",
            title: t("traceApplyPatch"),
            match: /^apply_patch\\b/i,
            detail: (value) => value.replace(/^apply_patch\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "tool-result",
            title: t("traceToolResult"),
            match: /^(?:tool\\s*result|工具结果)\\b/i,
            detail: (value) => value.replace(/^(?:tool\\s*result|工具结果)[:：]?\\s*/i, "").trim(),
          },
          {
            type: "warning",
            title: t("traceWarning"),
            match: /^(?:warning|警告)\\b/i,
            detail: (value) => value.replace(/^(?:warning|警告)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "error",
            title: t("traceError"),
            match: /^(?:error|错误)\\b/i,
            detail: (value) => value.replace(/^(?:error|错误)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "thinking",
            title: t("traceThinking"),
            match: /^(?:thinking|思考)\\b/i,
            detail: (value) => value.replace(/^(?:thinking|思考)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "web-search",
            title: t("traceWebSearch"),
            match: /^(?:web\\s*search\\b|【网络查询】)/i,
            detail: (value) => value.replace(/^(?:web\\s*search\\b|【网络查询】)[:：]?\\s*/i, "").trim(),
          },
        ];
        return definitions.find((definition) => definition.match.test(trimmed)) || null;
      }

      function expandFileChangeTraceContent(content) {
        const toolMatch = content.match(/^(?:tool|调用工具)[:：]\\s*(\\S+)/i);
        if (!toolMatch) {
          return content;
        }
        const toolName = toolMatch[1];
        const inputMarker = traceMarkers.input.find((label) =>
          content.includes("\\n" + label + ":\\n")
        );
        if (!inputMarker) {
          return content;
        }
        const inputIndex = content.indexOf("\\n" + inputMarker + ":\\n");
        const rawJson = content.slice(inputIndex + ("\\n" + inputMarker + ":\\n").length).trim();
        if (!rawJson) {
          return content;
        }
        let input;
        try {
          input = JSON.parse(rawJson);
        } catch {
          return content;
        }
        const diffLines = buildToolInputDiffLines(toolName, input);
        if (!diffLines.length) {
          return content;
        }
        return content + "\\n\\n" + t("traceFileChangesLabel") + ":\\n" + diffLines.join("\\n");
      }

      function buildToolInputDiffLines(toolName, input) {
        const maxLines = 200;
        if (!input || typeof input !== "object") {
          return [];
        }
        const tool = String(toolName || "").toLowerCase();
        if (tool === "write" && typeof input.content === "string") {
          return formatDiffLines(input.content, "added", maxLines);
        }
        if (tool === "edit") {
          const oldText = typeof input.old_string === "string" ? input.old_string : "";
          const newText = typeof input.new_string === "string" ? input.new_string : "";
          return [
            ...formatDiffLines(oldText, "removed", maxLines),
            ...formatDiffLines(newText, "added", maxLines),
          ].filter((line) => line);
        }
        if (tool === "multiedit" && Array.isArray(input.edits)) {
          const lines = [];
          input.edits.forEach((edit) => {
            if (!edit || typeof edit !== "object") {
              return;
            }
            const oldText = typeof edit.old_string === "string" ? edit.old_string : "";
            const newText = typeof edit.new_string === "string" ? edit.new_string : "";
            lines.push(...formatDiffLines(oldText, "removed", maxLines));
            lines.push(...formatDiffLines(newText, "added", maxLines));
          });
          return lines.filter((line) => line);
        }
        return [];
      }

      function formatDiffLines(text, kind, maxLines) {
        if (!text) {
          return [];
        }
        const prefix = kind === "removed" ? "-" : "+";
        const lines = String(text).split(/\\r?\\n/);
        const limited = lines.slice(0, maxLines);
        const formatted = limited.map((line) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
            return line;
          }
          return prefix + " " + line;
        });
        if (lines.length > maxLines) {
          formatted.push(prefix + " ...");
        }
        return formatted;
      }

      function stripAnsi(value) {
        if (!value) {
          return "";
        }
        return String(value).replace(/\\u001b\\[[0-9;]*m/g, "");
      }

      function getDiffLineKind(trimmed) {
        if (!trimmed) {
          return "";
        }
        if (trimmed.startsWith("+++") || trimmed.startsWith("---")) {
          return "";
        }
        if (trimmed.startsWith("+")) {
          return "added";
        }
        if (trimmed.startsWith("-")) {
          return "removed";
        }
        if (new RegExp("^(?:added|add|新增|添加)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "added";
        }
        if (new RegExp("^(?:removed|remove|deleted|delete|删除|移除)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "removed";
        }
        return "";
      }

      function ensureDiffPrefix(line, trimmed, kind) {
        if (!trimmed) {
          return line;
        }
        const prefix = kind === "added" ? "+" : "-";
        if (trimmed.startsWith(prefix)) {
          return line;
        }
        return prefix + " " + line;
      }

      function renderMarkdown(content) {
        if (!content) {
          return "";
        }
        const normalized = wrapLineNumberedBlocks(content);
        if (typeof marked === "undefined" || !marked.parse) {
          return escapeHtml(normalized);
        }
        const renderer = new marked.Renderer();
        renderer.html = (html) => escapeHtml(html);
        return marked.parse(normalized, { breaks: true, renderer });
      }

      function isLineNumberedLine(value) {
        return /^\\s*\\d+\\s*(?:→|->)\\s*/.test(value);
      }

      function wrapLineNumberedBlocks(content) {
        const lines = String(content).split(/\\r?\\n/);
        const output = [];
        let inFence = false;
        let inNumberBlock = false;
        let numberBlock = [];
        const flushNumberBlock = () => {
          if (!inNumberBlock) {
            return;
          }
          output.push("\`\`\`text", ...numberBlock, "\`\`\`");
          numberBlock = [];
          inNumberBlock = false;
        };
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("\`\`\`")) {
            flushNumberBlock();
            inFence = !inFence;
            output.push(line);
            return;
          }
          if (!inFence && isLineNumberedLine(line)) {
            inNumberBlock = true;
            numberBlock.push(line);
            return;
          }
          flushNumberBlock();
          output.push(line);
        });
        flushNumberBlock();
        return output.join("\\n");
      }

`;
