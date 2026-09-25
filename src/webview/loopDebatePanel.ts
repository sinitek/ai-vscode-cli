import * as vscode from "vscode";
import { renderContinueModelChoiceHtml } from "../continueModelChoice";
import { LOOP_DEBATE_PANEL_STYLES } from "./loopDebatePanelStyles";
import { resolveLocale, type AppLocale } from "../i18n";
import { renderLoopGroupChatMessageText } from "../loopCommunicationFilePreview";
import { parseLoopDebateChatTranscript, type LoopDebateChatSegment } from "../loopDebate";
import {
  buildLoopDebateChatPanelTitle,
  getStrings,
  type LoopDebateChatPanelStrings,
} from "./loopDebatePanelRenderer";
import type {
  LoopCommunicationFilePreviewMessage,
  LoopDebateChatPanelActiveSpeaker,
  LoopDebateChatPanelMessage,
  LoopDebateChatPanelParticipant,
  LoopDebateChatPanelRound,
  LoopDebateChatPanelState,
  LoopPlusPanelExecutionItem,
  LoopPlusPanelProjection,
  LoopPlusPanelReviewItem,
  LoopPlusPanelSeenAttempt,
} from "./loopDebatePanelTypes";
export type {
  LoopCommunicationFilePreviewMessage,
  LoopDebateChatPanelActiveSpeaker,
  LoopDebateChatPanelMessage,
  LoopDebateChatPanelModeratorDecision,
  LoopDebateChatPanelParticipant,
  LoopDebateChatPanelRound,
  LoopDebateChatPanelState,
  LoopPlusPanelActivity,
  LoopPlusPanelExecutionItem,
  LoopPlusPanelPhase,
  LoopPlusPanelProjection,
  LoopPlusPanelReviewItem,
  LoopPlusPanelSeenAttempt,
} from "./loopDebatePanelTypes";

type LoopDebateChatPanelHandlers = {
  onMessage: (message: LoopDebateChatPanelMessage) => void;
  onDispose?: () => void;
};

export class LoopDebateChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: LoopDebateChatPanelState | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: LoopDebateChatPanelHandlers,
  ) {}

  public show(state: LoopDebateChatPanelState): void {
    const locale = resolveLocale();
    const strings = getStrings(locale);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "sinitek-cli-tools.loopDebateChat",
        buildLoopDebateChatPanelTitle(state, strings),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      this.panel.webview.onDidReceiveMessage((message: LoopDebateChatPanelMessage) => {
        this.handlers.onMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.state = undefined;
        this.handlers.onDispose?.();
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, true);
    }
    this.update(state);
  }

  public update(state: LoopDebateChatPanelState): void {
    this.state = state;
    if (!this.panel) {
      return;
    }
    const locale = resolveLocale();
    this.panel.title = buildLoopDebateChatPanelTitle(state, getStrings(locale));
    this.panel.webview.html = buildLoopDebateChatPanelHtml(this.panel.webview, state, locale);
  }

  public getState(): LoopDebateChatPanelState | undefined {
    return this.state;
  }

  public postCommunicationFilePreview(message: LoopCommunicationFilePreviewMessage): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    void panel.webview.postMessage(message);
  }
}

export function buildLoopDebateChatPanelHtml(
  webview: vscode.Webview,
  state: LoopDebateChatPanelState,
  locale: AppLocale,
): string {
  const nonce = getNonce();
  const strings = getStrings(locale);
  const transcript = parseLoopDebateChatTranscript(state.chatMarkdown);
  const heading = state.loopPlus ? strings.titleLoopPlus : strings.title;

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)}</title>
    <style>
${LOOP_DEBATE_PANEL_STYLES}
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="title">
          <h1>${escapeHtml(heading)}</h1>
          <p>${escapeHtml(getPanelSubtitle(state, strings))} · ${escapeHtml(state.task.id)}</p>
        </div>
        <div class="actions">
          ${state.task.canStop ? `<button class="button danger" type="button" data-action="stopTask" title="${escapeAttribute(strings.stopTaskTitle)}">${escapeHtml(strings.stopTask)}</button>` : ""}
          ${state.task.canSupplement ? `<button class="button" type="button" data-action="supplementTask" title="${escapeAttribute(strings.supplementTaskTitle)}">${escapeHtml(strings.supplementTask)}</button>` : ""}
          ${state.task.canContinue && !state.task.canStop ? `<button class="button primary" type="button" data-action="continueTask" title="${escapeAttribute(strings.continueTaskTitle)}">${escapeHtml(strings.continueTask)}</button>` : ""}
        </div>
      </header>
      <div id="continueDialogBackdrop" class="dialog-backdrop" aria-hidden="true">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="continueDialogTitle" aria-describedby="continueDialogDescription">
          <div class="dialog-header">
            <h2 id="continueDialogTitle" class="dialog-title">${escapeHtml(strings.continueDialogTitle)}</h2>
            <p id="continueDialogDescription" class="dialog-description">${escapeHtml(strings.continueDialogDescription)}</p>
          </div>
          <div class="dialog-body">
            ${renderContinueModelChoice(state, strings)}
            <label class="dialog-label" for="continueDialogInput">${escapeHtml(strings.continuePromptLabel)}</label>
            <textarea id="continueDialogInput" class="dialog-textarea" spellcheck="true">${escapeHtml(strings.continuePromptDefault)}</textarea>
            <div id="continueDialogError" class="dialog-error" aria-live="polite"></div>
          </div>
          <div class="dialog-actions">
            <button id="continueDialogCancel" class="button" type="button">${escapeHtml(strings.continueCancel)}</button>
            <button id="continueDialogConfirm" class="button primary" type="button">${escapeHtml(strings.continueConfirm)}</button>
          </div>
        </div>
      </div>
      <div id="filePreviewBackdrop" class="dialog-backdrop file-preview-backdrop" aria-hidden="true">
        <div class="dialog file-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="filePreviewTitle">
          <div class="dialog-header">
            <h2 id="filePreviewTitle" class="dialog-title">${escapeHtml(strings.communicationFileDialogTitle)}</h2>
            <p id="filePreviewPath" class="dialog-description"></p>
          </div>
          <div class="dialog-body file-preview-body">
            <div id="filePreviewError" class="dialog-error" aria-live="polite"></div>
            <div id="filePreviewContent" class="markdown-body"></div>
          </div>
          <div class="dialog-actions">
            <button id="filePreviewClose" class="button" type="button">${escapeHtml(strings.communicationFileClose)}</button>
          </div>
        </div>
      </div>
      <div class="layout">
        <aside class="sidebar">
          ${renderTaskPanel(state, strings, locale)}
          ${renderRosterPanel(state, strings, locale)}
        </aside>
        <main class="main">
          ${renderTimeline(state, transcript.segments, strings)}
	          <div id="scrollToBottomWrap" class="scroll-to-bottom-wrap" aria-hidden="true">
	            <button id="scrollToBottomButton" class="scroll-to-bottom-button" type="button" data-action="scrollToBottom" aria-label="${escapeAttribute(strings.scrollToBottomAria)}" title="${escapeAttribute(strings.scrollToBottomAria)}" aria-hidden="true">
	              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	                <line x1="12" y1="6" x2="12" y2="18" />
	                <polyline points="7 13 12 18 17 13" />
	              </svg>
	            </button>
	          </div>
	        </main>
	      </div>
	    </div>
	    <script nonce="${nonce}">
	      const vscode = acquireVsCodeApi();
	      const AUTO_REFRESH_INTERVAL_MS = 5000;
	      const SCROLL_BOTTOM_THRESHOLD = 50;
	      const SCROLL_BUTTON_SUPPRESS_MS = 400;
	      const sidebarElement = document.querySelector(".sidebar");
	      const mainElement = document.querySelector(".main");
	      const continueDialogBackdrop = document.getElementById("continueDialogBackdrop");
	      const continueDialogInput = document.getElementById("continueDialogInput");
	      const continueDialogError = document.getElementById("continueDialogError");
	      const continueDialogConfirm = document.getElementById("continueDialogConfirm");
	      const continueDialogCancel = document.getElementById("continueDialogCancel");
	      const continueTaskButton = document.querySelector('[data-action="continueTask"]');
	      const supplementTaskButton = document.querySelector('[data-action="supplementTask"]');
	      const stopTaskButton = document.querySelector('[data-action="stopTask"]');
	      const scrollToBottomWrap = document.getElementById("scrollToBottomWrap");
	      const scrollToBottomButton = document.getElementById("scrollToBottomButton");
	      const filePreviewBackdrop = document.getElementById("filePreviewBackdrop");
	      const filePreviewPath = document.getElementById("filePreviewPath");
	      const filePreviewError = document.getElementById("filePreviewError");
	      const filePreviewContent = document.getElementById("filePreviewContent");
	      const filePreviewClose = document.getElementById("filePreviewClose");
	      let autoRefreshTimer = undefined;
	      let suppressScrollButtonUntil = 0;
	      let continueDialogOpen = false;
	      let continueDialogMode = undefined;
	      let communicationPreviewOpen = false;
	      let communicationPreviewSeq = 0;

	      function getStoredState() {
	        return vscode.getState() || {};
	      }

	      function getStoredScrollState() {
	        const scroll = getStoredState().scroll;
	        return scroll && typeof scroll === "object" ? scroll : {};
	      }

	      function getStoredDialogState() {
	        const dialog = getStoredState().dialog;
	        return dialog && typeof dialog === "object" ? dialog : {};
	      }

	      function saveDialogState() {
	        const existingDialog = getStoredDialogState();
	        vscode.setState({
	          ...getStoredState(),
	          dialog: {
	            ...existingDialog,
	            open: continueDialogOpen,
	            mode: continueDialogMode,
	            prompt: continueDialogInput ? continueDialogInput.value : existingDialog.prompt,
	            modelSource: readContinueModelSource(),
	          },
	        });
	      }

	      function clearDialogState() {
	        const { dialog: _dialog, ...rest } = getStoredState();
	        vscode.setState(rest);
	      }

	      function getDistanceToBottom() {
	        if (!mainElement) {
	          return 0;
	        }
	        return mainElement.scrollHeight - mainElement.scrollTop - mainElement.clientHeight;
	      }

	      function isNearBottom() {
	        return getDistanceToBottom() <= SCROLL_BOTTOM_THRESHOLD;
	      }

	      function updateScrollToBottomButton(forceHide = false) {
	        if (!mainElement || !scrollToBottomButton) {
	          return;
	        }
	        const hasOverflow = mainElement.scrollHeight > mainElement.clientHeight + 1;
	        const suppressed = Date.now() < suppressScrollButtonUntil;
	        const shouldShow = !forceHide && !suppressed && hasOverflow && getDistanceToBottom() > SCROLL_BOTTOM_THRESHOLD;
	        scrollToBottomButton.classList.toggle("visible", shouldShow);
	        scrollToBottomButton.setAttribute("aria-hidden", String(!shouldShow));
	        if (scrollToBottomWrap) {
	          scrollToBottomWrap.setAttribute("aria-hidden", String(!shouldShow));
	        }
	      }

	      function scrollMainToBottom(behavior = "auto") {
	        if (!mainElement) {
	          return;
	        }
	        suppressScrollButtonUntil = Date.now() + SCROLL_BUTTON_SUPPRESS_MS;
	        mainElement.scrollTo({ top: mainElement.scrollHeight, behavior });
	        const existingScroll = getStoredScrollState();
	        vscode.setState({
	          ...getStoredState(),
	          scroll: {
	            ...existingScroll,
	            top: mainElement.scrollHeight,
	            sidebarTop: sidebarElement ? sidebarElement.scrollTop : existingScroll.sidebarTop,
	            stickToBottom: true,
	          },
	        });
	        updateScrollToBottomButton(true);
	        window.requestAnimationFrame(() => updateScrollToBottomButton());
	        window.setTimeout(() => updateScrollToBottomButton(), SCROLL_BUTTON_SUPPRESS_MS + 20);
	      }

	      function saveScrollState() {
	        if (!mainElement && !sidebarElement) {
	          return;
	        }
	        const existingScroll = getStoredScrollState();
	        vscode.setState({
	          ...getStoredState(),
	          scroll: {
	            ...existingScroll,
	            top: mainElement ? mainElement.scrollTop : existingScroll.top,
	            sidebarTop: sidebarElement ? sidebarElement.scrollTop : existingScroll.sidebarTop,
	            stickToBottom: mainElement ? isNearBottom() : existingScroll.stickToBottom,
	          },
	        });
	      }

	      function restoreScrollState() {
	        if (!mainElement) {
	          return;
	        }
	        const scroll = getStoredState().scroll;
	        if (!scroll || typeof scroll !== "object") {
	          updateScrollToBottomButton();
	          return;
	        }
	        if (scroll.stickToBottom) {
	          mainElement.scrollTop = mainElement.scrollHeight;
	        } else if (typeof scroll.top === "number" && Number.isFinite(scroll.top)) {
	          mainElement.scrollTop = Math.min(scroll.top, mainElement.scrollHeight);
	        }
	        if (sidebarElement && typeof scroll.sidebarTop === "number" && Number.isFinite(scroll.sidebarTop)) {
	          sidebarElement.scrollTop = Math.min(scroll.sidebarTop, sidebarElement.scrollHeight);
	        }
	        updateScrollToBottomButton();
	      }

	      function requestRefresh() {
	        saveScrollState();
	        saveDialogState();
	        vscode.postMessage({ type: "loopDebateChat:refresh" });
	      }

	      function readContinueModelSource() {
	        const selected = document.querySelector('input[name="continueModelSource"]:checked');
	        if (!selected || selected.disabled || selected.value !== "original") {
	          return "current";
	        }
	        return "original";
	      }

	      function setContinueModelChoiceVisible(visible) {
	        const choice = document.getElementById("continueModelChoice");
	        if (choice) {
	          choice.hidden = !visible;
	        }
	      }

	      function setContinueDialogError(message) {
	        if (!continueDialogError) {
	          return;
	        }
	        continueDialogError.textContent = message || "";
	      }

	      function openContinueDialog() {
	        if (!continueDialogBackdrop || !continueDialogInput) {
	          return;
	        }
	        setContinueDialogError("");
	        continueDialogOpen = true;
	        continueDialogMode = "continue";
	        continueDialogInput.value = "${escapeJsString(strings.continuePromptDefault)}";
	        continueDialogBackdrop.classList.add("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "false");
	        continueDialogConfirm && (continueDialogConfirm.dataset.mode = "continue");
	        setContinueModelChoiceVisible(true);
	        saveDialogState();
	        window.setTimeout(() => {
	          continueDialogInput.focus();
	          continueDialogInput.select();
	        }, 0);
	      }

	      function closeContinueDialog() {
	        if (!continueDialogBackdrop) {
	          return;
	        }
	        continueDialogOpen = false;
	        continueDialogMode = undefined;
	        continueDialogBackdrop.classList.remove("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "true");
	        setContinueDialogError("");
	        clearDialogState();
	      }

	      function submitContinueDialog() {
	        if (!continueDialogInput) {
	          return;
	        }
	        const prompt = continueDialogInput.value.trim();
	        if (!prompt) {
	          setContinueDialogError("${escapeJsString(strings.continuePromptRequired)}");
	          continueDialogInput.focus();
	          return;
	        }
	        closeContinueDialog();
	        if (continueTaskButton) {
	          continueTaskButton.disabled = true;
	        }
	        vscode.postMessage({ type: "loopDebateChat:continueTask", prompt, modelSource: readContinueModelSource() });
	      }

	      function submitSupplementDialog() {
	        if (!continueDialogInput) {
	          return;
	        }
	        const prompt = continueDialogInput.value.trim();
	        if (!prompt) {
	          setContinueDialogError("${escapeJsString(strings.supplementPromptRequired)}");
	          continueDialogInput.focus();
	          return;
	        }
	        closeContinueDialog();
	        if (supplementTaskButton) {
	          supplementTaskButton.disabled = true;
	        }
	        vscode.postMessage({ type: "loopDebateChat:supplementTask", prompt });
	      }

	      function openSupplementDialog() {
	        if (!continueDialogBackdrop || !continueDialogInput) {
	          return;
	        }
	        setContinueDialogError("");
	        continueDialogOpen = true;
	        continueDialogMode = "supplement";
	        const titleElement = document.getElementById("continueDialogTitle");
	        const descriptionElement = document.getElementById("continueDialogDescription");
	        const labelElement = document.querySelector('label[for="continueDialogInput"]');
	        if (titleElement) {
	          titleElement.textContent = "${escapeJsString(strings.supplementDialogTitle)}";
	        }
	        if (descriptionElement) {
	          descriptionElement.textContent = "${escapeJsString(strings.supplementDialogDescription)}";
	        }
	        if (labelElement) {
	          labelElement.textContent = "${escapeJsString(strings.supplementPromptLabel)}";
	        }
	        continueDialogInput.value = "${escapeJsString(strings.supplementPromptDefault)}";
	        setContinueModelChoiceVisible(false);
	        continueDialogBackdrop.classList.add("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "false");
	        continueDialogConfirm && (continueDialogConfirm.dataset.mode = "supplement");
	        saveDialogState();
	        window.setTimeout(() => {
	          continueDialogInput.focus();
	          continueDialogInput.select();
	        }, 0);
	      }

	      function restoreDialogState() {
	        const dialog = getStoredDialogState();
	        if (!dialog.open || !continueDialogInput) {
	          return;
	        }
	        if (dialog.mode === "supplement") {
	          openSupplementDialog();
	        } else if (dialog.mode === "continue") {
	          openContinueDialog();
	        } else {
	          return;
	        }
	        if (typeof dialog.prompt === "string") {
	          continueDialogInput.value = dialog.prompt;
	        }
	        if (dialog.modelSource === "original" || dialog.modelSource === "current") {
	          const radio = document.querySelector('input[name="continueModelSource"][value="' + dialog.modelSource + '"]');
	          if (radio && !radio.disabled) {
	            radio.checked = true;
	          }
	        }
	        saveDialogState();
	      }

	      function getStoredCommunicationFile() {
	        const stored = getStoredState().communicationFile;
	        return stored && typeof stored === "object" ? stored : null;
	      }

	      function communicationPreviewErrorText(code) {
	        if (code === "missing") {
	          return "${escapeJsString(strings.communicationFileMissing)}";
	        }
	        if (code === "forbidden" || code === "invalid") {
	          return "${escapeJsString(strings.communicationFileForbidden)}";
	        }
	        if (code === "empty") {
	          return "${escapeJsString(strings.communicationFileEmpty)}";
	        }
	        if (code === "too_large") {
	          return "${escapeJsString(strings.communicationFileTooLarge)}";
	        }
	        return "${escapeJsString(strings.communicationFileUnreadable)}";
	      }

	      function showCommunicationFilePreview(filePath, html, errorText) {
	        if (!filePreviewBackdrop) {
	          return;
	        }
	        communicationPreviewOpen = true;
	        filePreviewBackdrop.classList.add("visible");
	        filePreviewBackdrop.setAttribute("aria-hidden", "false");
	        if (filePreviewPath) {
	          filePreviewPath.textContent = filePath || "";
	        }
	        if (filePreviewError) {
	          filePreviewError.textContent = errorText || "";
	        }
	        if (filePreviewContent) {
	          filePreviewContent.innerHTML = html || "";
	        }
	      }

	      function rememberCommunicationFilePreview(filePath, requestId, html) {
	        const cachedHtml = typeof html === "string" && html.length <= 200000 ? html : "";
	        vscode.setState({
	          ...getStoredState(),
	          communicationFile: {
	            open: true,
	            path: filePath,
	            requestId: requestId,
	            html: cachedHtml,
	          },
	        });
	        return cachedHtml;
	      }

	      function openCommunicationFilePreview(filePath, focusClose) {
	        communicationPreviewSeq += 1;
	        const requestId = String(Date.now()) + "-" + String(communicationPreviewSeq);
	        const existing = getStoredCommunicationFile();
	        const cachedHtml = existing && existing.path === filePath && typeof existing.html === "string" ? existing.html : "";
	        showCommunicationFilePreview(filePath, cachedHtml, cachedHtml ? "" : "${escapeJsString(strings.communicationFileLoading)}");
	        rememberCommunicationFilePreview(filePath, requestId, cachedHtml);
	        vscode.postMessage({ type: "loopDebateChat:openCommunicationFile", requestId: requestId, path: filePath });
	        if (focusClose !== false && filePreviewClose) {
	          filePreviewClose.focus();
	        }
	      }

	      function closeCommunicationFilePreview() {
	        communicationPreviewOpen = false;
	        if (filePreviewBackdrop) {
	          filePreviewBackdrop.classList.remove("visible");
	          filePreviewBackdrop.setAttribute("aria-hidden", "true");
	        }
	        if (filePreviewError) {
	          filePreviewError.textContent = "";
	        }
	        if (filePreviewContent) {
	          filePreviewContent.innerHTML = "";
	        }
	        const stored = Object.assign({}, getStoredState());
	        delete stored.communicationFile;
	        vscode.setState(stored);
	        if (!continueDialogOpen) {
	          requestRefresh();
	        }
	      }

	      function restoreCommunicationFilePreview() {
	        const stored = getStoredCommunicationFile();
	        if (!stored || !stored.open || typeof stored.path !== "string" || !stored.path) {
	          return;
	        }
	        openCommunicationFilePreview(stored.path, false);
	      }

	      function applyCommunicationFilePreview(message) {
	        const stored = getStoredCommunicationFile();
	        if (!message || message.type !== "loopDebateChat:communicationFile" || !stored || !stored.open) {
	          return;
	        }
	        if (stored.requestId !== message.requestId) {
	          return;
	        }
	        if (!message.ok) {
	          showCommunicationFilePreview(message.path || stored.path, "", communicationPreviewErrorText(message.error));
	          rememberCommunicationFilePreview(stored.path, stored.requestId, "");
	          return;
	        }
	        const html = typeof message.html === "string" ? message.html : "";
	        showCommunicationFilePreview(message.path || stored.path, html, "");
	        rememberCommunicationFilePreview(message.path || stored.path, stored.requestId, html);
	      }

	      function startAutoRefresh() {
	        if (autoRefreshTimer !== undefined) {
	          return;
	        }
	        autoRefreshTimer = window.setInterval(() => {
	          if (document.visibilityState === "visible" && !continueDialogOpen && !communicationPreviewOpen) {
	            requestRefresh();
	          }
	        }, AUTO_REFRESH_INTERVAL_MS);
	      }

	      document.addEventListener("click", (event) => {
	        const target = event.target.closest("[data-action]");
	        if (!target) {
	          return;
	        }
	        const action = target.getAttribute("data-action");
	        if (action === "continueTask") {
	          saveScrollState();
	          const titleElement = document.getElementById("continueDialogTitle");
	          const descriptionElement = document.getElementById("continueDialogDescription");
	          const labelElement = document.querySelector('label[for="continueDialogInput"]');
	          if (titleElement) {
	            titleElement.textContent = "${escapeJsString(strings.continueDialogTitle)}";
	          }
	          if (descriptionElement) {
	            descriptionElement.textContent = "${escapeJsString(strings.continueDialogDescription)}";
	          }
	          if (labelElement) {
	            labelElement.textContent = "${escapeJsString(strings.continuePromptLabel)}";
	          }
	          continueDialogConfirm && (continueDialogConfirm.dataset.mode = "continue");
	          openContinueDialog();
	          return;
	        }
	        if (action === "supplementTask") {
	          saveScrollState();
	          openSupplementDialog();
	          return;
	        }
	        if (action === "stopTask") {
	          saveScrollState();
	          if (stopTaskButton) {
	            stopTaskButton.disabled = true;
	          }
	          vscode.postMessage({ type: "loopDebateChat:stopTask" });
	          return;
	        }
	        if (action === "scrollToBottom") {
	          scrollMainToBottom("smooth");
	          return;
	        }
	        if (action === "openCommunicationFile") {
	          const filePath = target.getAttribute("data-file-path");
	          if (filePath) {
	            openCommunicationFilePreview(filePath, true);
	          }
	          return;
	        }
	      });
	      window.addEventListener("message", (event) => {
	        applyCommunicationFilePreview(event.data);
	      });
	      if (mainElement) {
	        mainElement.addEventListener("scroll", () => {
	          saveScrollState();
	          updateScrollToBottomButton();
	        }, { passive: true });
	      }
	      if (continueDialogBackdrop) {
	        continueDialogBackdrop.addEventListener("click", (event) => {
	          if (event.target === continueDialogBackdrop) {
	            closeContinueDialog();
	          }
	        });
	      }
	      if (continueDialogCancel) {
	        continueDialogCancel.addEventListener("click", () => {
	          closeContinueDialog();
	        });
	      }
	      if (continueDialogConfirm) {
	        continueDialogConfirm.addEventListener("click", () => {
	          if (continueDialogConfirm.dataset.mode === "supplement") {
	            submitSupplementDialog();
	            return;
	          }
	          submitContinueDialog();
	        });
	      }
	      if (continueDialogInput) {
	        continueDialogInput.addEventListener("input", () => {
	          if (continueDialogOpen) {
	            saveDialogState();
	          }
	        });
	        continueDialogInput.addEventListener("keydown", (event) => {
	          if (event.key === "Escape") {
	            event.preventDefault();
	            closeContinueDialog();
	          }
	          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
	            event.preventDefault();
	            if (continueDialogConfirm && continueDialogConfirm.dataset.mode === "supplement") {
	              submitSupplementDialog();
	              return;
	            }
	            submitContinueDialog();
	          }
	        });
	      }
	      if (filePreviewBackdrop) {
	        filePreviewBackdrop.addEventListener("click", (event) => {
	          if (event.target === filePreviewBackdrop) {
	            closeCommunicationFilePreview();
	          }
	        });
	      }
	      if (filePreviewClose) {
	        filePreviewClose.addEventListener("click", () => {
	          closeCommunicationFilePreview();
	        });
	      }
	      document.addEventListener("keydown", (event) => {
	        if (event.key === "Escape" && communicationPreviewOpen) {
	          event.preventDefault();
	          closeCommunicationFilePreview();
	        }
	      });
	      if (sidebarElement) {
	        sidebarElement.addEventListener("scroll", () => {
	          saveScrollState();
	        }, { passive: true });
	      }
	      document.addEventListener("visibilitychange", () => {
	        if (document.visibilityState === "visible" && !continueDialogOpen && !communicationPreviewOpen) {
	          requestRefresh();
	        }
	      });
	      window.addEventListener("beforeunload", () => {
	        saveScrollState();
	        saveDialogState();
	        if (autoRefreshTimer !== undefined) {
	          window.clearInterval(autoRefreshTimer);
	        }
	      });
	      window.requestAnimationFrame(() => {
	        restoreScrollState();
	        restoreDialogState();
	        restoreCommunicationFilePreview();
	        window.requestAnimationFrame(() => updateScrollToBottomButton());
	      });
	      startAutoRefresh();
	    </script>
  </body>
</html>`;
}

function renderTaskPanel(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
  locale: AppLocale,
): string {
  const currentRound = state.loopPlus
    ? ""
    : renderMetaRow(strings.currentRound, String(state.task.currentRound));
  return `<section class="panel">
    <h2>${escapeHtml(strings.task)}</h2>
    <div class="meta-grid">
      ${renderMetaRow(strings.status, state.task.status)}
      ${renderMetaRow(strings.cli, state.task.cli)}
      ${currentRound}
      ${renderMetaRow(strings.updatedAt, formatTimestamp(state.task.updatedAt, locale))}
    </div>
  </section>
  ${renderLoopPlusPanels(state, strings)}`;
}

function getPanelSubtitle(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
): string {
  if (state.loopPlus) {
    return strings.subtitleLoopPlus;
  }
  return state.mode === "debate" ? strings.debateSubtitle : strings.mainSubSubtitle;
}

function renderLoopPlusPanels(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
): string {
  const projection = state.loopPlus;
  if (!projection) {
    return "";
  }
  if (!projection.ok) {
    return `<section class="panel" data-loop-plus-mode="event_driven" data-loop-plus-status="invalid" data-loop-plus-phase="invalid">
      <h2>${escapeHtml(strings.titleLoopPlus)}</h2>
      <div class="notice" data-loop-plus-error="${escapeAttribute(projection.error)}">${escapeHtml(formatTemplate(strings.loopPlusInvalid, { reason: projection.error }))}</div>
    </section>`;
  }
  const activity = loopPlusActivityText(state, projection, strings);
  return `<section class="panel" data-loop-plus-mode="event_driven" data-loop-plus-status="${escapeAttribute(projection.activity)}" data-loop-plus-phase="${escapeAttribute(projection.phase)}">
    <h2>${escapeHtml(strings.titleLoopPlus)}</h2>
    <div class="meta-grid">
      ${renderLoopPlusField("mode", strings.loopPlusMode, strings.loopPlusModeValue)}
      ${renderLoopPlusField("phase", strings.loopPlusPhase, projection.phase)}
      ${renderLoopPlusField("activity", strings.status, activity)}
      ${renderLoopPlusField("wake", strings.loopPlusWake, projection.wakePending ? strings.loopPlusWakeYes : strings.loopPlusWakeNo)}
      ${renderLoopPlusCount("current", strings.loopPlusCurrentCount, projection.currentReviewCount)}
      ${renderLoopPlusCount("queue", strings.loopPlusQueueCount, projection.reviewQueueCount)}
      ${renderLoopPlusCount("visible", strings.loopPlusVisibleCount, projection.visibleReviewCount)}
      ${renderLoopPlusCount("running", strings.loopPlusRunningCount, projection.runningCount)}
      ${renderLoopPlusCount("pending", strings.loopPlusPendingCount, projection.pendingCount)}
      ${renderLoopPlusCount("reviewed", strings.loopPlusReviewedCount, projection.seenAttempts.filter((item) => item.disposition === "reviewed").length)}
    </div>
    <div class="member-meta" data-loop-plus-activity="${escapeAttribute(projection.activity)}">${escapeHtml(activity)}</div>
  </section>
  ${renderLoopPlusReviewSection(state, "current", strings.loopPlusCurrentHeading, projection.currentReview ? [projection.currentReview] : [], strings.loopPlusEmptyCurrent, strings)}
  ${renderLoopPlusReviewSection(state, "queue", strings.loopPlusQueueHeading, projection.reviewQueue, strings.loopPlusEmptyQueue, strings)}
  ${renderLoopPlusExecutionSection("running", strings.loopPlusRunningHeading, projection.running, strings.loopPlusEmptyRunning, strings)}
  ${renderLoopPlusExecutionSection("pending", strings.loopPlusPendingHeading, projection.pending, strings.loopPlusEmptyPending, strings)}
  ${renderLoopPlusSeenSection(state, projection.seenAttempts, strings)}`;
}

function loopPlusActivityText(
  state: LoopDebateChatPanelState,
  projection: Extract<LoopPlusPanelProjection, { ok: true }>,
  strings: LoopDebateChatPanelStrings,
): string {
  switch (projection.activity) {
    case "waiting":
      return strings.loopPlusActivityWaiting;
    case "review_pending":
      return strings.loopPlusActivityReviewPending;
    case "reviewing":
      return formatTemplate(strings.loopPlusActivityReviewing, {
        subtask: loopPlusSubtaskLabel(state, projection.currentReview?.subtaskId ?? ""),
      });
    case "stopped":
      return strings.loopPlusActivityStopped;
    case "completed":
      return strings.loopPlusActivityCompleted;
    case "idle":
      return strings.loopPlusActivityIdle;
    case "paused":
      return strings.loopPlusActivityPaused;
  }
}

function loopPlusSubtaskLabel(state: LoopDebateChatPanelState, subtaskId: string): string {
  const normalized = subtaskId.trim();
  if (!normalized) {
    return "";
  }
  for (const round of state.rounds) {
    const participant = round.participants.find((item) => item.role === "subtask" && item.id === normalized);
    const title = participant?.title.trim();
    if (title) {
      return title;
    }
  }
  return normalized;
}

function renderLoopPlusReviewSection(
  state: LoopDebateChatPanelState,
  role: "current" | "queue",
  heading: string,
  items: readonly LoopPlusPanelReviewItem[],
  emptyText: string,
  strings: LoopDebateChatPanelStrings,
): string {
  const body = items.length > 0
    ? items.map((item) => renderLoopPlusReviewItem(state, role === "current" ? "current" : "queued", item, strings)).join("")
    : `<div class="member-meta">${escapeHtml(emptyText)}</div>`;
  return `<section class="panel" data-loop-plus-list="${escapeAttribute(role)}">
    <h2>${escapeHtml(heading)}</h2>
    ${body}
  </section>`;
}

function renderLoopPlusReviewItem(
  state: LoopDebateChatPanelState,
  role: "current" | "queued",
  item: LoopPlusPanelReviewItem,
  strings: LoopDebateChatPanelStrings,
): string {
  const text = [
    loopPlusSubtaskLabel(state, item.subtaskId),
    loopPlusOutcomeLabel(item.outcome, strings),
    item.detail ? `${strings.loopPlusDetail} ${item.detail}` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="member-meta" data-loop-plus-role="${escapeAttribute(role)}" data-loop-plus-subtask="${escapeAttribute(item.subtaskId)}" data-loop-plus-attempt="${escapeAttribute(item.attemptId)}" data-loop-plus-event="${escapeAttribute(item.eventId)}">${escapeHtml(text)}</div>`;
}

function renderLoopPlusExecutionSection(
  role: "running" | "pending",
  heading: string,
  items: readonly LoopPlusPanelExecutionItem[],
  emptyText: string,
  strings: LoopDebateChatPanelStrings,
): string {
  const body = items.length > 0
    ? items.map((item) => renderLoopPlusExecutionItem(role, item)).join("")
    : `<div class="member-meta">${escapeHtml(emptyText)}</div>`;
  return `<section class="panel" data-loop-plus-list="${escapeAttribute(role)}">
    <h2>${escapeHtml(heading)}</h2>
    ${body}
  </section>`;
}

function renderLoopPlusExecutionItem(
  role: "running" | "pending",
  item: LoopPlusPanelExecutionItem,
): string {
  const text = [
    item.title ?? "",
    item.subtaskId,
  ].filter(Boolean).join(" · ");
  return `<div class="member-meta" data-loop-plus-role="${escapeAttribute(role)}" data-loop-plus-subtask="${escapeAttribute(item.subtaskId)}" data-loop-plus-attempt="${escapeAttribute(item.attemptId)}">${escapeHtml(text)}</div>`;
}

function renderLoopPlusSeenSection(
  state: LoopDebateChatPanelState,
  attempts: readonly LoopPlusPanelSeenAttempt[],
  strings: LoopDebateChatPanelStrings,
): string {
  const reviewed = attempts.filter((item) => item.disposition === "reviewed");
  const body = reviewed.length > 0
    ? reviewed.map((item) => {
      const acceptance = item.acceptance === "failed" ? "failed" : "passed";
      const result = acceptance === "failed" ? strings.loopPlusAcceptanceFailed : strings.loopPlusAcceptancePassed;
      const text = `${loopPlusSubtaskLabel(state, item.subtaskId)} · ${result}`;
      return `<div class="member-meta" data-loop-plus-role="reviewed" data-loop-plus-subtask="${escapeAttribute(item.subtaskId)}" data-loop-plus-attempt="${escapeAttribute(item.attemptId)}" data-loop-plus-acceptance="${acceptance}">${escapeHtml(text)}</div>`;
    }).join("")
    : `<div class="member-meta">${escapeHtml(strings.loopPlusEmptyReviewed)}</div>`;
  return `<section class="panel" data-loop-plus-list="reviewed">
    <h2>${escapeHtml(strings.loopPlusReviewedHeading)}</h2>
    ${body}
  </section>`;
}

function renderLoopPlusField(field: string, label: string, value: string): string {
  return `<div class="meta-row" data-loop-plus-field="${escapeAttribute(field)}">
    <div class="meta-label">${escapeHtml(label)}</div>
    <div class="meta-value">${escapeHtml(value)}</div>
  </div>`;
}

function renderLoopPlusCount(field: string, label: string, value: number): string {
  return `<div class="meta-row" data-loop-plus-count="${escapeAttribute(field)}">
    <div class="meta-label">${escapeHtml(label)}</div>
    <div class="meta-value">${escapeHtml(String(value))}</div>
  </div>`;
}

function loopPlusOutcomeLabel(
  outcome: LoopPlusPanelReviewItem["outcome"],
  strings: LoopDebateChatPanelStrings,
): string {
  switch (outcome) {
    case "completed":
      return strings.loopPlusOutcomeCompleted;
    case "failed":
      return strings.loopPlusOutcomeFailed;
    case "stopped":
      return strings.loopPlusOutcomeStopped;
  }
}

function formatParticipantStatus(
  state: LoopDebateChatPanelState,
  status: string,
  strings: LoopDebateChatPanelStrings,
): string {
  if (!state.loopPlus) {
    return status;
  }
  switch (status) {
    case "running":
      return strings.loopPlusStatusRunning;
    case "pending":
      return strings.loopPlusStatusPending;
    case "reviewing":
      return strings.loopPlusStatusReviewing;
    case "queued_review":
      return strings.loopPlusStatusQueued;
    case "reviewed":
    case "acceptance_passed":
      return strings.loopPlusAcceptancePassed;
    case "acceptance_failed":
      return strings.loopPlusAcceptanceFailed;
    case "review_pending":
      return strings.loopPlusStatusReviewPending;
    case "waiting":
      return strings.loopPlusStatusWaiting;
    case "stopped":
      return strings.loopPlusStatusStopped;
    case "completed":
      return strings.loopPlusStatusCompleted;
    case "idle":
      return strings.loopPlusStatusIdle;
    case "paused":
      return strings.loopPlusStatusPaused;
    case "invalid":
      return strings.loopPlusStatusInvalid;
    case "execution_completed":
      return strings.loopPlusStatusExecutionCompleted;
    case "held_review":
      return strings.loopPlusStatusHeldReview;
    case "not_in_snapshot":
      return strings.loopPlusStatusNotInSnapshot;
    default:
      return status;
  }
}

function renderRosterPanel(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
  locale: AppLocale,
): string {
  if (state.rounds.length === 0) {
    return "";
  }
  const debateRound = findLatestPanelRound(state.rounds, "debate");
  const moderator = state.mode === "debate" && debateRound
    ? renderModeratorMember(debateRound, strings, locale)
    : "";
  const rosterParticipants = collectRosterParticipants(state.rounds);
  const participants = rosterParticipants.map((participant) => `<div class="member">
    <span class="avatar">${escapeHtml(getAvatarLabel(participant.title, participant.id))}</span>
    <div>
      <div class="member-name">${escapeHtml(participant.title)}</div>
      <div class="member-meta">${escapeHtml(formatParticipantStatus(state, participant.status, strings))}${participant.stance ? ` · ${escapeHtml(participant.stance)}` : ""}</div>
      ${renderMemberLastStarted(memberLastStartedAt(participant), strings, locale)}
    </div>
  </div>`).join("");
  const consensusRound = state.rounds.slice().reverse().find((round) => Boolean(round.consensusSummary));
  const consensus = consensusRound?.consensusSummary
    ? `<div class="member-meta">${escapeHtml(strings.consensus)}：${escapeHtml(consensusRound.consensusSummary)}</div>`
    : "";
  const openDisagreementCount = state.rounds.reduce((total, round) => (
    total + (typeof round.openDisagreementCount === "number" ? round.openDisagreementCount : 0)
  ), 0);
  const openDisagreements = openDisagreementCount > 0
    ? `<div class="member-meta">${escapeHtml(strings.openDisagreements)}：${openDisagreementCount}</div>`
    : "";
  return `<section class="panel">
    <h2>${escapeHtml(strings.participants)}</h2>
    <div class="roster">${moderator}${participants}</div>
    ${consensus}
    ${openDisagreements}
  </section>`;
}

function findLatestPanelRound(
  rounds: readonly LoopDebateChatPanelRound[],
  kind: LoopDebateChatPanelRound["kind"],
): LoopDebateChatPanelRound | null {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (round?.kind === kind) {
      return round;
    }
  }
  return null;
}

function collectRosterParticipants(
  rounds: readonly LoopDebateChatPanelRound[],
): LoopDebateChatPanelParticipant[] {
  const participantsByKey = new Map<string, LoopDebateChatPanelParticipant>();
  rounds.forEach((round) => {
    round.participants.forEach((participant) => {
      const key = `${participant.role}:${participant.id}`;
      const existing = participantsByKey.get(key);
      if (!existing || (participant.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
        participantsByKey.set(key, participant);
      }
    });
  });
  return Array.from(participantsByKey.values());
}

function memberLastStartedAt(participant: LoopDebateChatPanelParticipant): number | undefined {
  if (participant.lastStartedAt === null) {
    return undefined;
  }
  if (typeof participant.lastStartedAt === "number" && Number.isFinite(participant.lastStartedAt)) {
    return participant.lastStartedAt;
  }
  if (participant.status === "pending" || participant.status === "skipped") {
    return undefined;
  }
  if (typeof participant.updatedAt === "number" && Number.isFinite(participant.updatedAt)) {
    return participant.updatedAt;
  }
  return undefined;
}

function renderMemberLastStarted(
  startedAt: number | undefined,
  strings: LoopDebateChatPanelStrings,
  locale: AppLocale,
): string {
  const formatted = formatTimestamp(startedAt, locale);
  return `<div class="member-meta" data-member-last-started="${escapeAttribute(formatted)}">${escapeHtml(strings.lastStarted)}：${escapeHtml(formatted || strings.notStarted)}</div>`;
}

function renderModeratorMember(
  round: LoopDebateChatPanelRound,
  strings: LoopDebateChatPanelStrings,
  locale: AppLocale,
): string {
  const decisionStartedAt = round.moderatorDecisions
    .slice()
    .reverse()
    .find((decision) => typeof decision.updatedAt === "number" && Number.isFinite(decision.updatedAt))
    ?.updatedAt;
  const startedAt = typeof decisionStartedAt === "number" ? decisionStartedAt : round.startedAt;
  return `<div class="member">
    <span class="avatar">${escapeHtml(getAvatarLabel(strings.moderator, "M"))}</span>
    <div>
      <div class="member-name">${escapeHtml(strings.moderator)}</div>
      ${renderMemberLastStarted(startedAt, strings, locale)}
    </div>
  </div>`;
}

function renderTimeline(
  state: LoopDebateChatPanelState,
  segments: LoopDebateChatSegment[],
  strings: LoopDebateChatPanelStrings,
): string {
  const initialPromptBubble = renderInitialTaskPromptBubble(state.task.rootPrompt, strings);
  if (state.error) {
    return `<div class="timeline">${initialPromptBubble}<div class="notice">${escapeHtml(strings.loadingError)} ${escapeHtml(state.error)}</div></div>`;
  }
  if (state.rounds.length === 0) {
    return `<div class="timeline">${initialPromptBubble}<div class="notice">${escapeHtml(strings.noRounds)}</div></div>`;
  }
  const thinkingBubble = renderThinkingBubble(state, strings);
  if (!state.chatMarkdown.trim() || segments.length === 0) {
    return `<div class="timeline">${initialPromptBubble}<div class="notice">${escapeHtml(strings.noTranscript)}</div>${thinkingBubble}</div>`;
  }
  return `<div class="timeline">${initialPromptBubble}${segments.map((segment) => renderSegment(segment, strings)).join("")}${thinkingBubble}</div>`;
}

function renderInitialTaskPromptBubble(
  rootPrompt: string,
  strings: LoopDebateChatPanelStrings,
): string {
  if (!rootPrompt.trim()) {
    return "";
  }
  return renderSegment({
    kind: "user-message",
    heading: strings.initialTaskPrompt,
    body: rootPrompt,
    actorId: "user",
  }, strings, strings.initialTaskPrompt);
}

function renderThinkingBubble(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
): string {
  const speaker = getActiveSpeaker(state);
  if (!speaker) {
    return "";
  }
  const isParticipant = speaker.kind === "participant" || speaker.kind === "main" || speaker.kind === "subtask";
  const isModerator = speaker.kind === "moderator";
  const hasAvatar = isParticipant || isModerator;
  const messageKind = isParticipant ? "participant-turn" : isModerator ? "moderator-turn" : "system";
  const layoutClass = hasAvatar ? "with-avatar" : "no-avatar";
  const tag = getThinkingTag(speaker, strings);
  const text = getThinkingText(speaker, strings);
  const avatar = hasAvatar
    ? `<span class="avatar">${escapeHtml(getAvatarLabel(speaker.title, speaker.id))}</span>`
    : "";
  return `<article class="message ${messageKind} thinking ${layoutClass}">
    ${avatar}
    <section class="bubble">
      <header class="bubble-header">
        <span class="speaker">${escapeHtml(speaker.title)}</span>
        <span class="tag">${escapeHtml(tag)}</span>
      </header>
      <div class="message-text thinking-text">
        <span>${escapeHtml(text)}</span>
        <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </div>
    </section>
  </article>`;
}

function getActiveSpeaker(state: LoopDebateChatPanelState): LoopDebateChatPanelActiveSpeaker | null {
  if (state.loopPlus || state.task.status !== "running") {
    return null;
  }
  for (let index = state.rounds.length - 1; index >= 0; index -= 1) {
    const speaker = getActiveSpeakerFromRound(state.rounds[index]);
    if (speaker) {
      return speaker;
    }
  }
  return null;
}

function getActiveSpeakerFromRound(
  round: LoopDebateChatPanelRound,
): LoopDebateChatPanelActiveSpeaker | null {
  if (round.status !== "running") {
    return null;
  }
  if (round.activeSpeaker) {
    return round.activeSpeaker;
  }
  const runningParticipant = round.participants.find((participant) => participant.status === "running");
  if (!runningParticipant) {
    return null;
  }
  const kind = runningParticipant.id === "main"
    ? "main"
    : (runningParticipant.role === "subtask" ? "subtask" : "participant");
  return {
    kind,
    id: runningParticipant.id,
    title: runningParticipant.title,
    updatedAt: runningParticipant.updatedAt,
  };
}

function getThinkingTag(
  speaker: LoopDebateChatPanelActiveSpeaker,
  strings: LoopDebateChatPanelStrings,
): string {
  if (speaker.finalPass) {
    return strings.finalStance;
  }
  if (typeof speaker.dialogueTurn === "number") {
    const turn = formatTemplate(strings.turnLabel, { turn: speaker.dialogueTurn });
    return speaker.kind === "moderator" ? `${strings.moderator} · ${turn}` : turn;
  }
  if (speaker.kind === "main") {
    return strings.mainTask;
  }
  if (speaker.kind === "subtask") {
    return strings.subtask;
  }
  return speaker.kind === "consensus" ? strings.consensus : strings.thinkingTag;
}

function getThinkingText(
  speaker: LoopDebateChatPanelActiveSpeaker,
  strings: LoopDebateChatPanelStrings,
): string {
  if (speaker.kind === "consensus") {
    return strings.consensusThinking;
  }
  if (speaker.finalPass) {
    return formatTemplate(strings.finalStanceThinking, { speaker: speaker.title });
  }
  return formatTemplate(strings.thinking, { speaker: speaker.title });
}

function renderSegment(
  segment: LoopDebateChatSegment,
  strings: LoopDebateChatPanelStrings,
  tagOverride?: string,
): string {
  const speaker = getSegmentSpeaker(segment, strings);
  const tag = tagOverride ?? getSegmentTag(segment, strings);
  const hasAvatar = segment.kind === "main-turn"
    || segment.kind === "subtask-joined"
    || segment.kind === "subtask-turn"
    || segment.kind === "participant-joined"
    || segment.kind === "participant-turn"
    || segment.kind === "moderator-turn"
    || segment.kind === "final-stance"
    || segment.kind === "error";
  const avatar = hasAvatar
    ? `<span class="avatar">${escapeHtml(getAvatarLabel(speaker, segment.actorId ?? ""))}</span>`
    : "";
  const layoutClass = hasAvatar ? "with-avatar" : "no-avatar";
  return `<article class="message ${escapeAttribute(segment.kind)} ${layoutClass}">
    ${avatar}
    <section class="bubble">
      <header class="bubble-header">
        <span class="speaker">${escapeHtml(speaker)}</span>
        <span class="tag">${escapeHtml(tag)}</span>
      </header>
      ${renderMessageBody(segment.body, strings)}
    </section>
  </article>`;
}

function getSegmentSpeaker(segment: LoopDebateChatSegment, strings: LoopDebateChatPanelStrings): string {
  if (segment.kind === "user-message") {
    return strings.user;
  }
  if (segment.kind === "main-turn") {
    return segment.actorTitle ?? strings.mainTask;
  }
  if (segment.kind === "subtask-joined" || segment.kind === "subtask-turn") {
    return segment.actorTitle ?? segment.actorId ?? strings.subtask;
  }
  if (segment.kind === "moderator-turn" || segment.kind === "forced-finalize" || segment.kind === "closed" || segment.kind === "error") {
    return segment.actorTitle ?? strings.moderator;
  }
  if (segment.kind === "participant-joined" || segment.kind === "participant-turn" || segment.kind === "final-stance") {
    return segment.actorTitle ?? segment.actorId ?? segment.heading;
  }
  return segment.heading || strings.system;
}

function getSegmentTag(segment: LoopDebateChatSegment, strings: LoopDebateChatPanelStrings): string {
  if (segment.kind === "user-message") {
    return strings.supplementalRequirement;
  }
  if (segment.kind === "main-turn" && typeof segment.dialogueTurn === "number") {
    return `${strings.mainTask} · ${formatTemplate(strings.roundLabel, { round: segment.dialogueTurn })}`;
  }
  if (segment.kind === "subtask-joined") {
    return strings.subtask;
  }
  if (segment.kind === "subtask-turn") {
    return strings.subtask;
  }
  if (segment.kind === "participant-joined") {
    return strings.participants;
  }
  if (segment.kind === "participant-turn" && typeof segment.dialogueTurn === "number") {
    return formatTemplate(strings.turnLabel, { turn: segment.dialogueTurn });
  }
  if (segment.kind === "participant-turn") {
    return strings.participants;
  }
  if (segment.kind === "error") {
    return strings.stopped;
  }
  if (segment.kind === "moderator-turn" && typeof segment.dialogueTurn === "number") {
    return `${strings.moderator} · ${formatTemplate(strings.turnLabel, { turn: segment.dialogueTurn })}`;
  }
  if (segment.kind === "moderator-turn") {
    return strings.moderator;
  }
  if (segment.kind === "final-stance") {
    return strings.finalStance;
  }
  if (segment.kind === "closed") {
    return strings.transcriptClosed;
  }
  return strings.system;
}

function renderMessageBody(body: string, strings: LoopDebateChatPanelStrings): string {
  if (!body.trim()) {
    return `<pre class="message-text empty">(empty)</pre>`;
  }
  return `<pre class="message-text">${renderLoopGroupChatMessageText(body, strings.communicationFileOpen)}</pre>`;
}

function renderMetaRow(label: string, value: string): string {
  return `<div class="meta-row">
    <div class="meta-label">${escapeHtml(label)}</div>
    <div class="meta-value">${escapeHtml(value)}</div>
  </div>`;
}

function getAvatarLabel(title: string, fallback: string): string {
  const normalized = title.trim() || fallback.trim();
  if (!normalized) {
    return "?";
  }
  const first = Array.from(normalized)[0];
  return first.toUpperCase();
}

function formatTimestamp(value: number | undefined, locale: AppLocale): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

function formatTemplate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function renderContinueModelChoice(
  state: LoopDebateChatPanelState,
  strings: LoopDebateChatPanelStrings,
): string {
  return renderContinueModelChoiceHtml({
    choice: state.continueModels,
    strings: {
      label: strings.continueModelChoiceLabel,
      originalTitle: strings.continueModelOriginal,
      originalHint: strings.continueModelOriginalHint,
      originalUnavailable: strings.continueModelOriginalUnavailable,
      currentTitle: strings.continueModelCurrent,
      currentHint: strings.continueModelCurrentHint,
      summary: strings.continueModelSummary,
      unrecorded: strings.continueModelUnrecorded,
    },
    escapeHtml,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function escapeJsString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
