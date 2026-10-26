export const CHAT_COPY_SCRIPT = `
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

      function copyChatSelectionWithFallback(value) {
        if (!value) {
          return false;
        }
        if (typeof copyTextToClipboard === "function") {
          copyTextToClipboard(value);
          return true;
        }
        if (
          typeof navigator !== "undefined"
          && navigator.clipboard
          && typeof navigator.clipboard.writeText === "function"
        ) {
          try {
            navigator.clipboard.writeText(value);
            return true;
          } catch {
          }
        }
        if (
          typeof document === "undefined"
          || !document.body
          || typeof document.createElement !== "function"
        ) {
          return false;
        }
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          return document.execCommand("copy") !== false;
        } catch {
          return false;
        } finally {
          document.body.removeChild(textarea);
        }
      }

      function handleChatCopy(event) {
        const selection = typeof window !== "undefined" && typeof window.getSelection === "function"
          ? window.getSelection()
          : null;
        if (!selection || selection.isCollapsed) {
          return;
        }
        const anchor = getChatCopyAnchorElement(selection);
        if (!isChatCopyTarget(anchor)) {
          return;
        }
        const value = String(selection.toString() || "");
        if (!value) {
          return;
        }
        if (
          event
          && event.clipboardData
          && typeof event.clipboardData.setData === "function"
        ) {
          try {
            event.clipboardData.setData("text/plain", value);
            event.preventDefault();
            return;
          } catch {
          }
        }
        if (copyChatSelectionWithFallback(value) && event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
      }

      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("copy", handleChatCopy);
      }
`;
