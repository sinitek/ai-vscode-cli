import { renderPanelDialog } from "./modalComponents";
import type { DepartmentGroupChatModalTarget } from "./loopGroupChatPanelTypes";

export function renderDepartmentGroupChatModal(): string {
  return renderPanelDialog({
    backdropId: "departmentChatBackdrop", backdropClassName: "dialog-backdrop department-chat-backdrop",
    backdropAttributes: [["aria-hidden", "true"]], dialogClassName: "dialog department-chat-dialog",
    labelledBy: "departmentChatTitle", extraDialogAttributes: [["tabindex", "-1"]],
    titleHtml: '<h2 id="departmentChatTitle" class="dialog-title">组长群聊</h2>',
    close: { id: "departmentChatClose", label: "关闭组长群聊", className: "icon-button" },
    afterHeaderHtml: '<div id="departmentChatStatus" class="department-chat-status" role="status"></div><button id="departmentChatRetry" class="button" type="button" hidden>重试</button><div id="departmentChatContent" class="department-chat-content"></div>',
  });
}

/** VS Code aliases window.parent to window, but delivers messages from its owning shell. */
export const LOOP_GROUP_CHAT_HOST_MESSAGE_SCRIPT = `
      function isLoopGroupChatHostMessage(event) {
        if (!event.source || event.source === window) return true;
        try {
          return event.origin === window.location.origin && event.source.document.getElementById("active-frame")?.contentWindow === window;
        } catch { return false; }
      }
`;

/** No URLs or browser-supplied HTML enter this bridge. The host generates srcdoc locally. */
export const DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT = `
${LOOP_GROUP_CHAT_HOST_MESSAGE_SCRIPT}
      const departmentModal = (() => {
        const backdrop = document.getElementById("departmentChatBackdrop");
        if (!backdrop) return null;
        const title = document.getElementById("departmentChatTitle");
        const close = document.getElementById("departmentChatClose");
        const retry = document.getElementById("departmentChatRetry");
        const status = document.getElementById("departmentChatStatus");
        const content = document.getElementById("departmentChatContent");
        const shell = document.querySelector(".shell");
        const viewStates = new Map();
        let active = null;
        let frame = null;
        let opener = null;
        let openerKey = null;
        function matches(message) {
          return active && message.taskId === active.taskId && message.instanceId === active.instanceId;
        }
        function send(message) { vscode.postMessage(message); }
        function child(message) {
          if (frame) frame.contentWindow.postMessage({ channel: "department-host", ...active, message }, "*");
        }
        const themeAttributes = ["data-vscode-theme-kind", "data-vscode-theme-name", "data-vscode-theme-id"];
        const themeClasses = ["vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light"];
        function readTheme() {
          // VS Code puts tokens on body; computed body also includes inherited root tokens.
          const computed = getComputedStyle(document.body);
          const variables = {};
          for (let i = 0; i < computed.length; i++) {
            const key = computed[i];
            if (/^--vscode-[a-zA-Z0-9_-]+$/.test(key)) variables[key] = computed.getPropertyValue(key);
          }
          const metadata = (element) => ({
            classes: themeClasses.filter((name) => element.classList.contains(name)),
            attributes: Object.fromEntries(themeAttributes.filter((name) => element.hasAttribute(name)).map((name) => [name, element.getAttribute(name)])),
          });
          return { variables, root: metadata(document.documentElement), body: metadata(document.body), colorScheme: computed.colorScheme };
        }
        let lastTheme = "";
        function syncTheme(force = false) {
          if (!active || !frame) return;
          const theme = readTheme();
          const serialized = JSON.stringify(theme);
          if (force || serialized !== lastTheme) {
            lastTheme = serialized;
            child({ control: "theme", theme });
          }
        }
        // Observe only theme carriers, not timeline/drawer/focus mutations. No polling.
        const themeObserver = new MutationObserver(() => syncTheme());
        for (const element of [document.documentElement, document.body]) {
          themeObserver.observe(element, { attributes: true, attributeFilter: ["class", "style", ...themeAttributes] });
        }
        themeObserver.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["media", "disabled"] });
        function closeModal(notify = true) {
          if (!active) return;
          const target = active;
          active = null;
          frame = null;
          content.replaceChildren();
          backdrop.classList.remove("visible");
          backdrop.setAttribute("aria-hidden", "true");
          shell.inert = false;
          const liveOpener = opener && opener.isConnected ? opener : Array.from(document.querySelectorAll("[data-department-nav-key]"))
            .find((element) => element.getAttribute("data-department-nav-key") === openerKey && !element.disabled);
          if (liveOpener) liveOpener.focus({ preventScroll: true });
          else document.getElementById("panelHeading").focus({ preventScroll: true });
          if (notify) send({ type: "loopGroupChatChat:departmentModal", ...target, action: "close" });
        }
        function open(taskId, label, source) {
          if (!taskId || !taskId.trim()) return;
          if (taskId === ${"PARENT_TASK_ID"}) { closeModal(); return; }
          if (active && active.taskId === taskId) return;
          if (!active) {
            opener = source || document.activeElement;
            openerKey = opener && opener.getAttribute("data-department-nav-key");
          }
          active = { taskId, instanceId: crypto.randomUUID() };
          frame = null;
          content.replaceChildren();
          title.textContent = label || "组长";
          title.title = title.textContent;
          status.textContent = "正在加载组长群聊…";
          status.hidden = false;
          retry.hidden = true;
          backdrop.classList.add("visible");
          backdrop.setAttribute("aria-hidden", "false");
          shell.inert = true;
          close.focus({ preventScroll: true });
          send({ type: "loopGroupChatChat:departmentModal", ...active, action: "load" });
          send({ type: "loopGroupChatChat:openDepartmentTask", taskId });
        }
        close.addEventListener("click", () => closeModal());
        retry.addEventListener("click", () => {
          const taskId = active.taskId;
          active = { taskId, instanceId: crypto.randomUUID() };
          status.textContent = "正在加载组长群聊…";
          retry.hidden = true;
          send({ type: "loopGroupChatChat:departmentModal", ...active, action: "retry" });
          send({ type: "loopGroupChatChat:openDepartmentTask", taskId });
        });
        document.addEventListener("keydown", (event) => {
          if (!active) return;
          if (event.key === "Escape") {
            event.preventDefault(); event.stopImmediatePropagation(); closeModal();
          } else if (event.key === "Tab") {
            const buttons = [close, ...(retry.hidden ? [] : [retry])];
            if (event.shiftKey && document.activeElement === buttons[0]) {
              event.preventDefault();
              if (frame) {
                frame.contentWindow.focus();
                child({ control: "focusLast" });
              }
              else buttons[buttons.length - 1].focus();
            } else if (!frame && (buttons.length === 1 || document.activeElement === buttons[buttons.length - 1])) {
              event.preventDefault(); buttons[0].focus();
            }
          }
        }, true);
        window.addEventListener("message", (event) => {
          const data = event.data;
          if (!data) return;
          if (!isLoopGroupChatHostMessage(event)) {
            event.stopImmediatePropagation();
            if (!active || !frame || event.source !== frame.contentWindow || event.origin !== "null" || data.channel !== "department-child" || !matches(data)) return;
            if (data.control === "state") { viewStates.set(active.taskId, data.state); return; }
            if (data.control === "outerFocus") { close.focus(); return; }
            if (data.control === "close") { closeModal(); return; }
            const message = data.message;
            if (!message || typeof message.type !== "string") return;
            if (message.type === "loopGroupChatChat:openDepartmentTask") {
              open(message.taskId, "", null); return;
            }
            send({ type: "loopGroupChatChat:departmentTaskMessage", ...active, message });
            return;
          }
          // Only the owning same-origin VS Code shell (or this window) reaches the host path.
          if (!matches(data)) return;
          if (data.type === "loopGroupChatChat:departmentModalClose") { closeModal(false); return; }
          if (data.type === "loopGroupChatChat:departmentModalMessage") { child(data.message); return; }
          if (data.type !== "loopGroupChatChat:departmentModalContent") return;
          if (typeof data.title === "string") { title.textContent = data.title; title.title = data.title; }
          if (typeof data.error === "string") {
            frame = null; content.replaceChildren();
            status.hidden = false; status.textContent = data.error;
            retry.hidden = false; close.focus(); return;
          }
          if (typeof data.html !== "string" || frame) return;
          frame = document.createElement("iframe");
          frame.title = title.textContent;
          frame.setAttribute("sandbox", "allow-scripts");
          frame.setAttribute("referrerpolicy", "no-referrer");
          frame.name = JSON.stringify({ viewState: viewStates.get(active.taskId) || {}, theme: readTheme() });
          const installedFrame = frame;
          const installedTarget = active;
          frame.addEventListener("load", () => {
            if (frame !== installedFrame || active !== installedTarget) return;
            // Theme mutations can race srcdoc parsing: always resend the latest snapshot on load.
            syncTheme(true);
          });
          frame.srcdoc = data.html;
          content.replaceChildren(frame);
          status.hidden = true; retry.hidden = true;
        }, true);
        return { open };
      })();
`;

/** Runs before the incumbent renderer. Opaque sandbox origin + source + instance bind both directions. */
export function buildDepartmentChildBridge(target: DepartmentGroupChatModalTarget): string {
  const binding = JSON.stringify(target).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `(() => {
    const binding = ${binding};
    let initial;
    try { initial = JSON.parse(window.name) || {}; } catch { initial = {}; }
    let saved = initial.viewState || {};
    const themeAttributes = ["data-vscode-theme-kind", "data-vscode-theme-name", "data-vscode-theme-id"];
    const themeClasses = ["vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light"];
    let appliedVariables = new Set();
    function applyTheme(theme) {
      if (!theme || typeof theme !== "object") return;
      const variables = new Map(Object.entries(theme.variables || {}).filter(([key, value]) => /^--vscode-[a-zA-Z0-9_-]+$/.test(key) && typeof value === "string"));
      for (const key of appliedVariables) if (!variables.has(key)) document.documentElement.style.removeProperty(key);
      for (const [key, value] of variables) document.documentElement.style.setProperty(key, value);
      appliedVariables = new Set(variables.keys());
      for (const [element, metadata] of [[document.documentElement, theme.root], [document.body, theme.body]]) {
        if (!element) continue;
        for (const name of themeClasses) element.classList.toggle(name, Array.isArray(metadata?.classes) && metadata.classes.includes(name));
        for (const name of themeAttributes) {
          const value = metadata?.attributes?.[name];
          if (typeof value === "string") element.setAttribute(name, value);
          else element.removeAttribute(name);
        }
      }
      if (["normal", "light", "dark", "light dark", "dark light"].includes(theme.colorScheme)) document.documentElement.style.colorScheme = theme.colorScheme;
      else document.documentElement.style.removeProperty("color-scheme");
    }
    applyTheme(initial.theme);
    window.name = "";
    const send = (payload) => parent.postMessage({ channel: "department-child", ...binding, ...payload }, "*");
    window.acquireVsCodeApi = () => ({
      postMessage: (message) => send({ message }), getState: () => saved,
      setState: (state) => { saved = state; send({ control: "state", state }); return state; },
    });
    const controls = () => Array.from(document.querySelectorAll('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'))
      .filter((element) => element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]'));
    let lastFocused = null;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (event.source !== parent || !data || data.channel !== "department-host" || data.taskId !== binding.taskId || data.instanceId !== binding.instanceId) {
        event.stopImmediatePropagation(); return;
      }
      const message = data.message;
      if (message && message.control) {
        event.stopImmediatePropagation();
        if (message.control === "theme") {
          applyTheme(message.theme);
        }
        if (message.control === "focusLast") {
          const list = controls();
          const target = lastFocused?.isConnected && list.includes(lastFocused) ? lastFocused : list[list.length - 1];
          target?.focus({ preventScroll: true });
        }
        return;
      }
      Object.defineProperty(event, "data", { value: message });
    }, true);
    document.addEventListener("DOMContentLoaded", () => {
      let stack = [];
      const dialogOpeners = new Map();
      document.addEventListener("focusin", (event) => {
        if (controls().includes(event.target)) lastFocused = event.target;
      }, true);
      const sync = () => {
        const visible = Array.from(document.querySelectorAll(".dialog-backdrop.visible, .overlay.visible"));
        stack = stack.filter((item) => visible.includes(item));
        visible.forEach((item) => { if (!stack.includes(item)) stack.push(item); });
        const top = stack[stack.length - 1];
        document.querySelectorAll(".topbar, .layout").forEach((element) => { element.inert = Boolean(top); });
        visible.forEach((element) => { element.inert = element !== top; element.style.zIndex = element === top ? "102" : "101"; });
      };
      window.__departmentDialogOpened = (element, opener) => {
        if (element && opener?.isConnected) dialogOpeners.set(element, opener);
        sync();
      };
      window.__departmentDialogClosed = (element, restoreFocus = true) => {
        const wasTop = stack[stack.length - 1] === element;
        sync();
        const opener = dialogOpeners.get(element);
        dialogOpeners.delete(element);
        if (restoreFocus && wasTop && !element.classList.contains("visible") && opener?.isConnected && !opener.closest("[inert]")) {
          opener.focus({ preventScroll: true });
        }
      };
      new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
      sync();
      document.addEventListener("keydown", (event) => {
        sync();
        const top = stack[stack.length - 1];
        if (event.key === "Escape") {
          if (top) {
            const closeIds = { continueDialogBackdrop: "continueDialogCancel", modelSwitchBackdrop: "modelSwitchCancel", askChatBackdrop: "askChatClose", filePreviewBackdrop: "filePreviewClose" };
            const close = document.getElementById(closeIds[top.id]);
            if (close) { event.preventDefault(); event.stopImmediatePropagation(); close.click(); }
          } else if (!document.querySelector(".sidebar-open")) {
            event.preventDefault(); event.stopImmediatePropagation(); send({ control: "close" });
          }
        }
        if (event.key !== "Tab") return;
        const list = controls().filter((element) => !top || top.contains(element));
        if (!list.length) { event.preventDefault(); return; }
        const edge = event.shiftKey ? list[0] : list[list.length - 1];
        if (document.activeElement === edge || !list.includes(document.activeElement)) {
          event.preventDefault(); event.stopImmediatePropagation();
          if (top) list[event.shiftKey ? list.length - 1 : 0].focus();
          else send({ control: "outerFocus" });
        }
      }, true);
    });
  })();`;
}
