export const CHAT_COPY_SCRIPT = `
      let lastChatCopyText = "";

      function getChatCopyAnchorElement(selection) {
        if (!selection || !selection.anchorNode) {
          return null;
        }
        const anchorNode = selection.anchorNode;
        return anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
      }

      function isChatCopyTarget(element) {
        if (!element || typeof element.closest !== "function") {
          return false;
        }
        if (element.closest("input, textarea, select, button, [contenteditable=\\"true\\"]")) {
          return false;
        }
        return Boolean(element.closest("#messages, #historyMessagesContent, .timeline, #askChatMessages, #filePreviewContent"));
      }

      function readChatCopyText(selection) {
        if (!selection || selection.isCollapsed) {
          return "";
        }
        const anchor = getChatCopyAnchorElement(selection);
        return isChatCopyTarget(anchor) ? String(selection.toString() || "") : "";
      }

      function rememberChatCopySelection() {
        const selection = typeof window !== "undefined" && typeof window.getSelection === "function"
          ? window.getSelection()
          : null;
        const value = readChatCopyText(selection);
        if (value) {
          lastChatCopyText = value;
        }
      }

      function handleChatCopy(event) {
        const selection = typeof window !== "undefined" && typeof window.getSelection === "function"
          ? window.getSelection()
          : null;
        const selectedText = readChatCopyText(selection);
        if (selectedText) {
          lastChatCopyText = selectedText;
        }
        const target = event && event.target;
        const targetTagName = target && typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
        const inputCopyAfterFocusChange = targetTagName === "textarea" || targetTagName === "input";
        if (inputCopyAfterFocusChange && target.selectionStart !== target.selectionEnd) {
          return;
        }
        const value = selectedText || (inputCopyAfterFocusChange ? lastChatCopyText : "");
        if (!value) {
          return;
        }
        if (event && event.clipboardData && typeof event.clipboardData.setData === "function") {
          try {
            event.clipboardData.setData("text/plain", value);
            event.preventDefault();
            return;
          } catch {
          }
        }
        if (
          typeof document !== "undefined"
          && typeof document.execCommand === "function"
        ) {
          try {
            if (document.execCommand("copy")) {
              event.preventDefault();
            }
          } catch {
          }
        }
      }

      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("mouseup", rememberChatCopySelection);
        window.addEventListener("copy", handleChatCopy);
      }
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("selectionchange", rememberChatCopySelection);
      }
`;
