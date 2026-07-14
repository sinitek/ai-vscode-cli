import * as vscode from "vscode";
import { LOBSTER_DEBATE_PANEL_STYLES } from "./lobsterDebatePanelStyles";
import { resolveLocale, type AppLocale } from "../i18n";
import { parseLobsterDebateChatTranscript, type LobsterDebateChatSegment } from "../lobsterDebate";
import {
  buildLobsterDebateChatPanelTitle,
  getStrings,
  type LobsterDebateChatPanelStrings,
} from "./lobsterDebatePanelRenderer";
import type {
  LobsterDebateChatPanelActiveSpeaker,
  LobsterDebateChatPanelMessage,
  LobsterDebateChatPanelParticipant,
  LobsterDebateChatPanelRound,
  LobsterDebateChatPanelState,
} from "./lobsterDebatePanelTypes";
export type {
  LobsterDebateChatPanelActiveSpeaker,
  LobsterDebateChatPanelMessage,
  LobsterDebateChatPanelModeratorDecision,
  LobsterDebateChatPanelParticipant,
  LobsterDebateChatPanelRound,
  LobsterDebateChatPanelState,
} from "./lobsterDebatePanelTypes";

type LobsterDebateChatPanelHandlers = {
  onMessage: (message: LobsterDebateChatPanelMessage) => void;
  onDispose?: () => void;
};

export class LobsterDebateChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: LobsterDebateChatPanelState | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: LobsterDebateChatPanelHandlers,
  ) {}

  public show(state: LobsterDebateChatPanelState): void {
    const locale = resolveLocale();
    const strings = getStrings(locale);
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "sinitek-cli-tools.lobsterDebateChat",
        buildLobsterDebateChatPanelTitle(state, strings),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      this.panel.webview.onDidReceiveMessage((message: LobsterDebateChatPanelMessage) => {
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

  public update(state: LobsterDebateChatPanelState): void {
    this.state = state;
    if (!this.panel) {
      return;
    }
    const locale = resolveLocale();
    this.panel.title = buildLobsterDebateChatPanelTitle(state, getStrings(locale));
    this.panel.webview.html = buildLobsterDebateChatPanelHtml(this.panel.webview, state, locale);
  }

  public getState(): LobsterDebateChatPanelState | undefined {
    return this.state;
  }
}

export function buildLobsterDebateChatPanelHtml(
  webview: vscode.Webview,
  state: LobsterDebateChatPanelState,
  locale: AppLocale,
): string {
  const nonce = getNonce();
  const strings = getStrings(locale);
  const transcript = parseLobsterDebateChatTranscript(state.chatMarkdown);

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(strings.title)}</title>
    <style>
${LOBSTER_DEBATE_PANEL_STYLES}
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="title">
          <h1>${escapeHtml(strings.title)}</h1>
          <p>${escapeHtml(getPanelSubtitle(state, strings))} · ${escapeHtml(state.task.id)}</p>
        </div>
        <div class="actions">
          ${state.task.canStop ? `<button class="button danger" type="button" data-action="stopTask" title="${escapeAttribute(strings.stopTaskTitle)}">${escapeHtml(strings.stopTask)}</button>` : ""}
          ${state.task.canSupplement ? `<button class="button" type="button" data-action="supplementTask" title="${escapeAttribute(strings.supplementTaskTitle)}">${escapeHtml(strings.supplementTask)}</button>` : ""}
          ${!state.task.canStop && state.task.canContinue ? `<button class="button primary" type="button" data-action="continueTask" title="${escapeAttribute(strings.continueTaskTitle)}">${escapeHtml(strings.continueTask)}</button>` : ""}
        </div>
      </header>
      <div id="continueDialogBackdrop" class="dialog-backdrop" aria-hidden="true">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="continueDialogTitle" aria-describedby="continueDialogDescription">
          <div class="dialog-header">
            <h2 id="continueDialogTitle" class="dialog-title">${escapeHtml(strings.continueDialogTitle)}</h2>
            <p id="continueDialogDescription" class="dialog-description">${escapeHtml(strings.continueDialogDescription)}</p>
          </div>
          <div class="dialog-body">
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
      <div class="layout">
	        <aside class="sidebar">
	          ${renderTaskPanel(state, strings, locale)}
	          ${renderRosterPanel(state, strings)}
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
	      let autoRefreshTimer = undefined;
	      let suppressScrollButtonUntil = 0;
	      let continueDialogOpen = false;
	      let continueDialogMode = undefined;

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
	        vscode.postMessage({ type: "lobsterDebateChat:refresh" });
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
	        vscode.postMessage({ type: "lobsterDebateChat:continueTask", prompt });
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
	        vscode.postMessage({ type: "lobsterDebateChat:supplementTask", prompt });
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
	        saveDialogState();
	      }

	      function startAutoRefresh() {
	        if (autoRefreshTimer !== undefined) {
	          return;
	        }
	        autoRefreshTimer = window.setInterval(() => {
	          if (document.visibilityState === "visible" && !continueDialogOpen) {
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
	          vscode.postMessage({ type: "lobsterDebateChat:stopTask" });
	          return;
	        }
	        if (action === "scrollToBottom") {
	          scrollMainToBottom("smooth");
	          return;
	        }
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
	      if (sidebarElement) {
	        sidebarElement.addEventListener("scroll", () => {
	          saveScrollState();
	        }, { passive: true });
	      }
	      document.addEventListener("visibilitychange", () => {
	        if (document.visibilityState === "visible" && !continueDialogOpen) {
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
	        window.requestAnimationFrame(() => updateScrollToBottomButton());
	      });
	      startAutoRefresh();
	    </script>
  </body>
</html>`;
}

function renderTaskPanel(
  state: LobsterDebateChatPanelState,
  strings: LobsterDebateChatPanelStrings,
  locale: AppLocale,
): string {
  return `<section class="panel">
    <h2>${escapeHtml(strings.task)}</h2>
    <div class="meta-grid">
      ${renderMetaRow(strings.status, state.task.status)}
      ${renderMetaRow(strings.cli, state.task.cli)}
      ${renderMetaRow(strings.currentRound, String(state.task.currentRound))}
      ${renderMetaRow(strings.updatedAt, formatTimestamp(state.task.updatedAt, locale))}
    </div>
  </section>`;
}

function getPanelSubtitle(
  state: LobsterDebateChatPanelState,
  strings: LobsterDebateChatPanelStrings,
): string {
  return state.mode === "debate" ? strings.debateSubtitle : strings.mainSubSubtitle;
}

function renderRosterPanel(
  state: LobsterDebateChatPanelState,
  strings: LobsterDebateChatPanelStrings,
): string {
  if (state.rounds.length === 0) {
    return "";
  }
  const debateRound = findLatestPanelRound(state.rounds, "debate");
  const moderator = state.mode === "debate" && debateRound
    ? renderModeratorMember(debateRound, strings)
    : "";
  const rosterParticipants = collectRosterParticipants(state.rounds);
  const participants = rosterParticipants.map((participant) => `<div class="member">
    <span class="avatar">${escapeHtml(getAvatarLabel(participant.title, participant.id))}</span>
    <div>
      <div class="member-name">${escapeHtml(participant.title)}</div>
      <div class="member-meta">${escapeHtml(participant.status)}${participant.stance ? ` · ${escapeHtml(participant.stance)}` : ""}</div>
      <div class="member-meta">${escapeHtml(strings.session)}：${escapeHtml(participant.sessionId ?? strings.noSession)}</div>
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
  rounds: readonly LobsterDebateChatPanelRound[],
  kind: LobsterDebateChatPanelRound["kind"],
): LobsterDebateChatPanelRound | null {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (round?.kind === kind) {
      return round;
    }
  }
  return null;
}

function collectRosterParticipants(
  rounds: readonly LobsterDebateChatPanelRound[],
): LobsterDebateChatPanelParticipant[] {
  const participantsByKey = new Map<string, LobsterDebateChatPanelParticipant>();
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

function renderModeratorMember(
  round: LobsterDebateChatPanelRound,
  strings: LobsterDebateChatPanelStrings,
): string {
  const moderatorSession = round.moderatorDecisions
    .slice()
    .reverse()
    .find((decision) => decision.sessionId)?.sessionId ?? round.participantRosterSessionId ?? null;
  return `<div class="member">
    <span class="avatar">${escapeHtml(getAvatarLabel(strings.moderator, "M"))}</span>
    <div>
      <div class="member-name">${escapeHtml(strings.moderator)}</div>
      <div class="member-meta">${escapeHtml(strings.session)}：${escapeHtml(moderatorSession ?? strings.noSession)}</div>
    </div>
  </div>`;
}

function renderTimeline(
  state: LobsterDebateChatPanelState,
  segments: LobsterDebateChatSegment[],
  strings: LobsterDebateChatPanelStrings,
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
  strings: LobsterDebateChatPanelStrings,
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
  state: LobsterDebateChatPanelState,
  strings: LobsterDebateChatPanelStrings,
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

function getActiveSpeaker(state: LobsterDebateChatPanelState): LobsterDebateChatPanelActiveSpeaker | null {
  if (state.task.status !== "running") {
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
  round: LobsterDebateChatPanelRound | undefined,
): LobsterDebateChatPanelActiveSpeaker | null {
  if (!round) {
    return null;
  }
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
  speaker: LobsterDebateChatPanelActiveSpeaker,
  strings: LobsterDebateChatPanelStrings,
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
  speaker: LobsterDebateChatPanelActiveSpeaker,
  strings: LobsterDebateChatPanelStrings,
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
  segment: LobsterDebateChatSegment,
  strings: LobsterDebateChatPanelStrings,
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
      ${renderMessageBody(segment.body)}
    </section>
  </article>`;
}

function getSegmentSpeaker(segment: LobsterDebateChatSegment, strings: LobsterDebateChatPanelStrings): string {
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
  if (segment.kind === "rules" || segment.kind === "preamble" || segment.kind === "task-event" || segment.kind === "section") {
    return segment.heading || strings.system;
  }
  return strings.system;
}

function getSegmentTag(segment: LobsterDebateChatSegment, strings: LobsterDebateChatPanelStrings): string {
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

function renderMessageBody(body: string): string {
  if (!body.trim()) {
    return `<pre class="message-text empty">(empty)</pre>`;
  }
  return `<pre class="message-text">${escapeHtml(body)}</pre>`;
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
  const first = Array.from(normalized)[0] ?? "?";
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
