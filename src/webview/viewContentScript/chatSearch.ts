import { buildChatTranscriptSearchRuntimeSource } from "../chatTranscriptSearch";

export const VIEW_CONTENT_SCRIPT_CHAT_SEARCH = `      ${buildChatTranscriptSearchRuntimeSource()}

      const chatSearchState = {
        open: false,
        query: "",
        activeIndex: -1,
        total: 0,
        tabId: "",
      };
      let chatSearchComposing = false;

      function isChatSearchAnchored() {
        return Boolean(
          chatSearchState.open
          && typeof chatSearchState.query === "string"
          && chatSearchState.query.trim()
        );
      }

      function readChatSearchInputValue() {
        if (!elements.chatSearchInput) {
          return "";
        }
        return String(elements.chatSearchInput.value || "");
      }

      function currentChatSearchTabId() {
        try {
          if (typeof getActiveConversationTabId !== "function") {
            return "";
          }
          const value = getActiveConversationTabId();
          return value == null ? "" : String(value);
        } catch (error) {
          return "";
        }
      }

      function syncChatSearchChrome() {
        const open = chatSearchState.open;
        const bar = elements.chatSearchBar;
        const button = elements.chatSearchButton;
        if (bar) {
          bar.hidden = !open;
          if (open && typeof bar.removeAttribute === "function") {
            bar.removeAttribute("hidden");
          } else if (!open && typeof bar.setAttribute === "function") {
            bar.setAttribute("hidden", "");
          }
        }
        if (button) {
          if (typeof button.setAttribute === "function") {
            button.setAttribute("aria-expanded", open ? "true" : "false");
          }
          if (button.classList) {
            if (open) {
              button.classList.add("is-open");
            } else {
              button.classList.remove("is-open");
            }
          }
        }
      }

      function updateChatSearchCount(total) {
        const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
        const label = formatChatSearchCounter(chatSearchState.activeIndex, safeTotal);
        const current = safeTotal > 0 && chatSearchState.activeIndex >= 0
          ? chatSearchState.activeIndex + 1
          : 0;
        if (!elements.chatSearchCount) {
          return;
        }
        elements.chatSearchCount.textContent = label;
        if (typeof elements.chatSearchCount.setAttribute === "function") {
          elements.chatSearchCount.setAttribute(
            "aria-label",
            t("chatSearchCountAria", { current: String(current), total: String(safeTotal) }),
          );
        }
      }

      function clearChatSearchMarks(root) {
        if (!root || typeof root.querySelectorAll !== "function") {
          return;
        }
        const marks = Array.from(root.querySelectorAll("mark.chat-search-hit"));
        for (let index = 0; index < marks.length; index += 1) {
          const mark = marks[index];
          const parent = mark && mark.parentNode;
          if (!parent) {
            continue;
          }
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          if (typeof parent.removeChild === "function") {
            parent.removeChild(mark);
          }
          if (typeof parent.normalize === "function") {
            parent.normalize();
          }
        }
      }

      function wrapChatSearchRange(textNode, start, end) {
        if (!textNode || textNode.nodeType !== 3 || !textNode.parentNode) {
          return null;
        }
        const value = typeof textNode.nodeValue === "string" ? textNode.nodeValue : "";
        if (start < 0 || end > value.length || start >= end) {
          return null;
        }
        let target = textNode;
        if (start > 0 && typeof textNode.splitText === "function") {
          target = textNode.splitText(start);
        }
        const length = end - start;
        if (target && typeof target.splitText === "function" && String(target.nodeValue || "").length > length) {
          target.splitText(length);
        }
        if (!target || !target.parentNode || typeof document.createElement !== "function") {
          return null;
        }
        const mark = document.createElement("mark");
        mark.className = "chat-search-hit";
        target.parentNode.insertBefore(mark, target);
        mark.appendChild(target);
        return mark;
      }

      function applyChatSearchMarks(hits, activeIndex) {
        let activeMark = null;
        for (let hitIndex = hits.length - 1; hitIndex >= 0; hitIndex -= 1) {
          const ranges = hits[hitIndex] && hits[hitIndex].ranges ? hits[hitIndex].ranges : [];
          for (let rangeIndex = ranges.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
            const range = ranges[rangeIndex];
            const mark = wrapChatSearchRange(range.node, range.start, range.end);
            if (!mark) {
              continue;
            }
            if (typeof mark.setAttribute === "function") {
              mark.setAttribute("data-chat-search-index", String(hitIndex));
            }
            if (hitIndex === activeIndex) {
              mark.className = "chat-search-hit is-active";
              if (rangeIndex === 0 || !activeMark) {
                activeMark = mark;
              }
            }
          }
        }
        return activeMark;
      }

      function revealChatSearchMark(mark, scroll) {
        let current = mark ? (mark.parentElement || mark.parentNode) : null;
        const root = elements.messages;
        while (
          current
          && current !== root
          && (!document || (current !== document.body && current !== document.documentElement))
        ) {
          if (String(current.tagName || "").toUpperCase() === "DETAILS") {
            current.open = true;
            if (typeof current.setAttribute === "function") {
              current.setAttribute("open", "");
            }
          }
          const next = current.parentElement || current.parentNode;
          if (!next || next === current) {
            break;
          }
          current = next;
        }
        if (!scroll || !mark || typeof mark.scrollIntoView !== "function") {
          return;
        }
        try {
          mark.scrollIntoView({ block: "center", inline: "nearest" });
        } catch (error) {
          return;
        }
      }

      function refreshChatSearchHighlights(options) {
        try {
          const root = elements.messages;
          clearChatSearchMarks(root);
          if (!chatSearchState.open) {
            chatSearchState.total = 0;
            chatSearchState.activeIndex = -1;
            updateChatSearchCount(0);
            return;
          }
          chatSearchState.query = readChatSearchInputValue();
          const query = chatSearchState.query;
          const tabId = currentChatSearchTabId();
          const tabChanged = tabId !== chatSearchState.tabId;
          chatSearchState.tabId = tabId;
          if (!query.trim() || !root) {
            chatSearchState.total = 0;
            chatSearchState.activeIndex = -1;
            updateChatSearchCount(0);
            return;
          }
          const hits = findChatSearchHits(collectChatSearchBlocks(root), query);
          const resetIndex = Boolean(options && options.resetIndex);
          let activeIndex = chatSearchState.activeIndex;
          if (resetIndex || tabChanged || !Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= hits.length) {
            activeIndex = hits.length > 0 ? 0 : -1;
          }
          chatSearchState.total = hits.length;
          chatSearchState.activeIndex = activeIndex;
          const activeMark = applyChatSearchMarks(hits, activeIndex);
          updateChatSearchCount(hits.length);
          if (activeMark && (Boolean(options && options.reveal) || tabChanged)) {
            revealChatSearchMark(activeMark, true);
          } else if (activeMark) {
            revealChatSearchMark(activeMark, false);
          }
        } catch (error) {
          if (typeof reportWebviewFailure === "function") {
            reportWebviewFailure("chat-search-failed", error, {});
          }
        }
      }

      function openChatSearch() {
        const wasOpen = chatSearchState.open;
        chatSearchState.open = true;
        chatSearchState.query = readChatSearchInputValue();
        syncChatSearchChrome();
        if (elements.chatSearchInput) {
          if (typeof elements.chatSearchInput.focus === "function") {
            elements.chatSearchInput.focus();
          }
          if (typeof elements.chatSearchInput.select === "function") {
            elements.chatSearchInput.select();
          }
        }
        refreshChatSearchHighlights({ reveal: true, resetIndex: !wasOpen });
      }

      function closeChatSearch() {
        chatSearchState.open = false;
        chatSearchState.total = 0;
        chatSearchState.activeIndex = -1;
        syncChatSearchChrome();
        clearChatSearchMarks(elements.messages);
        updateChatSearchCount(0);
      }

      function stepChatSearch(direction) {
        if (!chatSearchState.open || chatSearchState.total <= 0) {
          return;
        }
        chatSearchState.activeIndex = moveChatSearchIndex(
          chatSearchState.activeIndex,
          chatSearchState.total,
          direction,
        );
        refreshChatSearchHighlights({ reveal: true });
      }

      function bindChatSearchControls() {
        syncChatSearchChrome();
        updateChatSearchCount(0);
        if (elements.chatSearchButton && typeof elements.chatSearchButton.addEventListener === "function") {
          elements.chatSearchButton.addEventListener("click", () => {
            if (chatSearchState.open) {
              closeChatSearch();
              return;
            }
            openChatSearch();
          });
        }
        if (elements.chatSearchInput && typeof elements.chatSearchInput.addEventListener === "function") {
          elements.chatSearchInput.addEventListener("compositionstart", () => {
            chatSearchComposing = true;
          });
          elements.chatSearchInput.addEventListener("compositionend", () => {
            chatSearchComposing = false;
            chatSearchState.query = readChatSearchInputValue();
            refreshChatSearchHighlights({ reveal: true, resetIndex: true });
          });
          elements.chatSearchInput.addEventListener("input", () => {
            if (chatSearchComposing) {
              return;
            }
            chatSearchState.query = readChatSearchInputValue();
            refreshChatSearchHighlights({ reveal: true, resetIndex: true });
          });
          elements.chatSearchInput.addEventListener("keydown", (event) => {
            if (!event) {
              return;
            }
            if (event.key === "Escape") {
              if (typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              closeChatSearch();
              return;
            }
            if (event.key === "Enter") {
              if (typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              stepChatSearch(event.shiftKey ? -1 : 1);
            }
          });
        }
        [elements.chatSearchPrev, elements.chatSearchNext, elements.chatSearchClose].forEach((button) => {
          if (!button || typeof button.addEventListener !== "function") {
            return;
          }
          button.addEventListener("mousedown", (event) => {
            if (event && typeof event.preventDefault === "function") {
              event.preventDefault();
            }
          });
        });
        if (elements.chatSearchPrev && typeof elements.chatSearchPrev.addEventListener === "function") {
          elements.chatSearchPrev.addEventListener("click", () => {
            stepChatSearch(-1);
          });
        }
        if (elements.chatSearchNext && typeof elements.chatSearchNext.addEventListener === "function") {
          elements.chatSearchNext.addEventListener("click", () => {
            stepChatSearch(1);
          });
        }
        if (elements.chatSearchClose && typeof elements.chatSearchClose.addEventListener === "function") {
          elements.chatSearchClose.addEventListener("click", () => {
            closeChatSearch();
          });
        }
        const shortcutTarget = typeof window !== "undefined" && window && typeof window.addEventListener === "function"
          ? window
          : null;
        if (shortcutTarget) {
          shortcutTarget.addEventListener("keydown", (event) => {
            if (!event || event.repeat) {
              return;
            }
            const key = event.key || "";
            const findShortcut = (event.ctrlKey || event.metaKey)
              && !event.altKey
              && !event.shiftKey
              && (key === "f" || key === "F" || event.code === "KeyF");
            if (findShortcut) {
              if (typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              openChatSearch();
              return;
            }
            if (
              chatSearchState.open
              && !event.ctrlKey
              && !event.metaKey
              && !event.altKey
              && (key === "F3" || event.code === "F3")
            ) {
              if (typeof event.preventDefault === "function") {
                event.preventDefault();
              }
              stepChatSearch(event.shiftKey ? -1 : 1);
            }
          });
        }
      }

      bindChatSearchControls();
`;
