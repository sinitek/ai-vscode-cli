import { DEPARTMENT_EMPLOYEE_ALLOCATION_SCRIPT, renderDepartmentEmployeeAllocationDialog, renderDepartmentEmployeeAllocationRows, renderDepartmentEmployeeAllocationSummary } from "./departmentEmployeeAllocation";
import * as vscode from "vscode";
import { buildDepartmentChildBridge, DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT, renderDepartmentGroupChatModal } from "./departmentGroupChatModal";
import { DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES } from "./loopGroupChatPanelTypes";
import { renderAcceptancePlanDialogs } from "./acceptancePlanDialog";
import { VIEW_CONTENT_SCRIPT_ACCEPTANCE_PLAN } from "./viewContentScript/acceptancePlan";
import { getWebviewStrings } from "./viewContentStrings";
import { LOOP_MODEL_SWITCH_SCRIPT, renderLoopModelSwitchFields } from "./loopModelSwitchDialog";
import { renderModalActions, renderModalCloseButton, renderPanelDialog } from "./modalComponents";
import { LOOP_GROUP_CHAT_PANEL_STYLES } from "./loopGroupChatPanelStyles";
import { selectLoopGroupChatBubbles, type LoopGroupChatBubbleWindow } from "./loopGroupChatBubbleRetention";
import { CHAT_MARKDOWN_SCRIPT } from "./chatMarkdown";
import { CHAT_COPY_SCRIPT } from "./chatCopy";
import { ChatImageHost, isChatImageMessage } from "./chatImageHost";
import { isChatLinkMessage, openChatLink } from "./chatLinkHost";
import { getMarkedScript, getJsonFormatterScript } from "./markdownAssets";
import { neutralizeInlineScriptEndTags } from "./viewContentHtml";
import { getMarkdownStyles } from "./viewContentStyles/markdown";
import { orchestratorClarificationDialogScript, renderOrchestratorClarificationDialog } from "./orchestratorClarificationDialog";
import { createEmptyLoopAskThread, type LoopAskThread } from "../loopAskThread";
import { formatDepartmentLeaderLabel, formatDepartmentMemberTitle, getDepartmentLeaderCode, type DepartmentRole } from "../department";
import { renderLoopGroupChatMessageText } from "../loopCommunicationFilePreview";
import { parseLoopGroupChatTranscript, type LoopGroupChatSegment } from "../loopGroupChat";
import { buildLoopGroupChatAcceptanceAnchors, stripLoopGroupChatAcceptanceMetadata } from "../loopGroupChatAcceptance";
import {
  buildLoopGroupChatPanelTitle,
  buildLoopGroupChatPanelHeading,
  buildLoopGroupChatPanelSubtitle,
  getStrings,
  type LoopGroupChatPanelStrings,
} from "./loopGroupChatPanelRenderer";
import type {
  DepartmentGroupChatModalTarget,
  LoopCommunicationFilePreviewMessage,
  LoopGroupChatPanelActiveSpeaker,
  LoopGroupChatPanelMessage,
  LoopGroupChatPanelParticipant,
  LoopGroupChatPanelRound,
  LoopGroupChatPanelState,
  LoopPlusPanelProjection,
  LoopPlusPanelReviewItem,
} from "./loopGroupChatPanelTypes";
export type {
  DepartmentGroupChatProjection,
  DepartmentGroupChatModalTarget,
  DepartmentGroupChatTaskMessage,
  LoopCommunicationFilePreviewMessage,
  LoopGroupChatPanelActiveSpeaker,
  LoopGroupChatPanelMessage,
  LoopGroupChatPanelParticipant,
  LoopGroupChatPanelRound,
  LoopGroupChatPanelState,
  LoopPlusPanelActivity,
  LoopPlusPanelExecutionItem,
  LoopPlusPanelPhase,
  LoopPlusPanelProjection,
  LoopPlusPanelReviewItem,
  LoopPlusPanelSeenAttempt,
} from "./loopGroupChatPanelTypes";

type LoopGroupChatPanelHandlers = {
  onMessage: (message: LoopGroupChatPanelMessage) => void;
  onDispose?: () => void;
};

export class LoopGroupChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: LoopGroupChatPanelState | undefined;
  private askThread: LoopAskThread = createEmptyLoopAskThread();
  private domReady = false;
  private htmlInstalled = false;
  private renderGeneration = 0;
  private loadingReady: Promise<boolean> | undefined;
  private resolveLoadingReady: ((ready: boolean) => void) | undefined;
  private readonly bubbleWindow: LoopGroupChatBubbleWindow = { start: 0 };
  private documentNonce = getNonce();
  private departmentModal: {
    target: DepartmentGroupChatModalTarget;
    state?: LoopGroupChatPanelState;
    thread: LoopAskThread;
    generation: number;
    ready: boolean;
    bubbleWindow: LoopGroupChatBubbleWindow;
  } | undefined;
  private readonly departmentBubbleWindows = new Map<string, LoopGroupChatBubbleWindow>();
  private readonly imageHost = new ChatImageHost(() => this.panel?.webview);

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: LoopGroupChatPanelHandlers,
  ) {}

  private revealOrCreate(title: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "sinitek-cli-tools.loopGroupChatChat",
        title,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      const panel = this.panel;
      this.panel.webview.onDidReceiveMessage(async (message: LoopGroupChatPanelMessage) => {
        if (this.panel !== panel) return;
        if (message?.type === "loopGroupChatChat:departmentModal") {
          if (typeof message.taskId !== "string" || !message.taskId.trim() || typeof message.instanceId !== "string" || !message.instanceId || this.state?.department?.role !== "director") return;
          if (message.action === "close") {
            if (!this.matchesDepartmentModal(message)) return;
            this.departmentModal = undefined;
          } else if (message.action === "load" || message.action === "retry") {
            const bubbleWindow = this.departmentBubbleWindows.get(message.taskId) ?? { start: 0 };
            this.departmentBubbleWindows.set(message.taskId, bubbleWindow);
            this.departmentModal = { target: { taskId: message.taskId, instanceId: message.instanceId }, thread: createEmptyLoopAskThread(), generation: 0, ready: false, bubbleWindow };
          } else return;
          this.handlers.onMessage(message);
          return;
        }
        if (message?.type === "loopGroupChatChat:departmentTaskMessage") {
          if (!this.matchesDepartmentModal(message) || !message.message || !DEPARTMENT_GROUP_CHAT_TASK_MESSAGE_TYPES.has(message.message.type)) return;
          if (message.message.type === "loopGroupChatChat:domReady") {
            this.departmentModal!.ready = true;
            this.publishDepartmentModalState();
            return;
          }
          this.handlers.onMessage(message);
          return;
        }
        if (message?.type === "loopGroupChatChat:loadingReady") {
          this.resolveLoadingReady?.(true);
          this.resolveLoadingReady = undefined;
          return;
        }
        if (isChatImageMessage(message)) {
          return this.imageHost.handleMessage(message);
        }
        if (isChatLinkMessage(message)) {
          return openChatLink(message.source, (source) => this.imageHost.handleMessage({ type: "previewChatImage", source }));
        }
        if (message?.type === "loopGroupChatChat:domReady") {
          this.handleDomReady(typeof message.generation === "number" ? message.generation : 0);
          return;
        }
        this.handlers.onMessage(message);
      });
      this.panel.onDidDispose(() => {
        if (this.panel !== panel) return;
        this.resolveLoadingReady?.(false);
        this.resolveLoadingReady = undefined;
        this.loadingReady = undefined;
        this.imageHost.invalidate();
        this.panel = undefined;
        this.state = undefined;
        this.domReady = false;
        this.htmlInstalled = false;
        this.renderGeneration = 0;
        this.bubbleWindow.start = 0;
        this.departmentModal = undefined;
        this.departmentBubbleWindows.clear();
        this.handlers.onDispose?.();
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active, true);
    }
  }

  public showLoading(taskId: string, loopPlus: boolean): Promise<boolean> {
    const title = loopPlus ? getStrings().titleLoopPlus : getStrings().title;
    this.revealOrCreate(`${title}: ${taskId.slice(0, 12)}`);
    if (this.htmlInstalled) return Promise.resolve(true);
    if (!this.loadingReady) {
      this.loadingReady = new Promise((resolve) => { this.resolveLoadingReady = resolve; });
      this.panel!.webview.html = buildLoopGroupChatLoadingHtml(this.panel!.webview, taskId, title);
    }
    return this.loadingReady;
  }

  public showLoadingError(error: unknown): void {
    this.post({ type: "loopGroupChatChat:loadingError", error: error instanceof Error ? error.message : String(error) });
  }

  public show(state: LoopGroupChatPanelState): void {
    this.revealOrCreate(buildLoopGroupChatPanelTitle(state, getStrings()));
    this.update(state);
  }

  public update(state: LoopGroupChatPanelState): void {
    if (this.state?.task.id !== state.task.id) {
      this.closeDepartmentModal();
      this.departmentBubbleWindows.clear();
      this.bubbleWindow.start = 0;
    }
    this.state = state;
    if (this.departmentModal?.state) {
      this.departmentModal.state = { ...this.departmentModal.state, acceptancePlan: state.acceptancePlan };
      this.publishDepartmentModalState();
    }
    if (!this.panel) {
      return;
    }
    this.panel.title = buildLoopGroupChatPanelTitle(state, getStrings());
    this.renderGeneration += 1;
    if (!this.htmlInstalled) {
      this.panel.webview.html = buildLoopGroupChatPanelHtml(
        this.panel.webview,
        state,
        this.askThread,
        this.renderGeneration,
        this.bubbleWindow,
        { nonce: this.documentNonce },
      );
      this.htmlInstalled = true;
      return;
    }
    if (!this.domReady) {
      return;
    }
    this.postContentPatch();
  }

  private handleDomReady(generation: number): void {
    if (!this.panel) {
      return;
    }
    this.domReady = true;
    if (this.renderGeneration !== generation) {
      this.postContentPatch();
    }
    this.publishAskThread();
  }

  private postContentPatch(): void {
    if (!this.panel || !this.state) {
      return;
    }
    void this.panel.webview.postMessage(
      buildLoopGroupChatPanelContentPatch(this.state, this.renderGeneration, this.bubbleWindow),
    );
  }

  public getDepartmentModalTarget(): DepartmentGroupChatModalTarget | undefined {
    return this.departmentModal ? { ...this.departmentModal.target } : undefined;
  }

  private matchesDepartmentModal(target: DepartmentGroupChatModalTarget): boolean {
    return this.departmentModal?.target.taskId === target.taskId && this.departmentModal.target.instanceId === target.instanceId;
  }

  /** Caller must authorize same-department membership before injecting any task state. */
  public setDepartmentModalState(target: DepartmentGroupChatModalTarget, state: LoopGroupChatPanelState, thread?: LoopAskThread): boolean {
    target = { taskId: target.taskId, instanceId: target.instanceId };
    if (!this.panel || !this.matchesDepartmentModal(target) || state.task.id !== target.taskId || state.department?.role !== "leader") return false;
    const modal = this.departmentModal!;
    const initial = !modal.state;
    modal.state = { ...state, acceptancePlan: state.acceptancePlanReadOnly ? state.acceptancePlan : this.state?.acceptancePlan };
    if (thread) modal.thread = thread;
    modal.generation += 1;
    if (initial) {
      this.post({ type: "loopGroupChatChat:departmentModalContent", ...target, title: buildLoopGroupChatPanelTitle(state, getStrings()),
        html: buildLoopGroupChatPanelHtml(this.panel.webview, modal.state, modal.thread, modal.generation, modal.bubbleWindow, { nonce: this.documentNonce, embedded: target }) });
    } else if (modal.ready) this.publishDepartmentModalState();
    return true;
  }

  private publishDepartmentModalState(): void {
    const modal = this.departmentModal;
    if (!modal?.state || !modal.ready) return;
    this.post({ type: "loopGroupChatChat:departmentModalContent", ...modal.target, title: buildLoopGroupChatPanelTitle(modal.state, getStrings()) });
    this.postDepartmentModalMessage(modal.target, buildLoopGroupChatPanelContentPatch(modal.state, modal.generation, modal.bubbleWindow));
    this.publishDepartmentModalAskThread(modal.target, modal.thread);
  }

  public setDepartmentModalError(target: DepartmentGroupChatModalTarget, error: string): boolean {
    target = { taskId: target.taskId, instanceId: target.instanceId };
    if (!this.matchesDepartmentModal(target)) return false;
    this.departmentModal!.state = undefined;
    this.departmentModal!.ready = false;
    this.post({ type: "loopGroupChatChat:departmentModalContent", ...target, error });
    return true;
  }

  /** Bound host responses, e.g. model/continue settlements and chatImageResolved. */
  public postDepartmentModalMessage(target: DepartmentGroupChatModalTarget, message: { type: string; [key: string]: unknown }): boolean {
    target = { taskId: target.taskId, instanceId: target.instanceId };
    if (!this.matchesDepartmentModal(target)) return false;
    this.post({ type: "loopGroupChatChat:departmentModalMessage", ...target, message });
    return true;
  }

  public publishDepartmentModalAskThread(target: DepartmentGroupChatModalTarget, thread: LoopAskThread): boolean {
    if (!this.matchesDepartmentModal(target)) return false;
    this.departmentModal!.thread = thread;
    return this.postDepartmentModalMessage(target, { type: "loopGroupChatChat:askThread", thread });
  }

  public postDepartmentModalCommunicationFilePreview(target: DepartmentGroupChatModalTarget, message: LoopCommunicationFilePreviewMessage): boolean {
    return this.postDepartmentModalMessage(target, message);
  }

  public closeDepartmentModal(target?: DepartmentGroupChatModalTarget): boolean {
    if (!this.departmentModal || (target && !this.matchesDepartmentModal(target))) return false;
    const binding = this.departmentModal.target;
    this.departmentModal = undefined;
    this.post({ type: "loopGroupChatChat:departmentModalClose", ...binding });
    return true;
  }

  public setAskThread(thread: LoopAskThread): void {
    this.askThread = thread;
  }

  public getAskThread(): LoopAskThread {
    return this.askThread;
  }

  public publishAskThread(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "loopGroupChatChat:askThread",
      thread: this.askThread,
    });
  }

  public getState(): LoopGroupChatPanelState | undefined {
    return this.state;
  }

  public postCommunicationFilePreview(message: LoopCommunicationFilePreviewMessage): void {
    this.post(message);
  }

  public post(message: unknown): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    void panel.webview.postMessage(message);
  }
}

function renderGroupChatLoading(): string {
  return `<div id="groupChatLoading" class="group-chat-loading" role="status" aria-live="polite">
    <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    <span id="groupChatLoadingText">正在加载群聊…</span>
    <button id="groupChatLoadingRetry" class="button" type="button" hidden>重试</button>
  </div>`;
}

export function buildLoopGroupChatLoadingHtml(webview: vscode.Webview, taskId: string, title: string): string {
  const nonce = getNonce();
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title><style>${LOOP_GROUP_CHAT_PANEL_STYLES}</style></head>
    <body><header class="topbar"><div class="title"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(taskId)}</p></div></header>
    ${renderGroupChatLoading()}
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const retry = document.getElementById("groupChatLoadingRetry");
      window.addEventListener("message", ({ data }) => {
        if (data?.type !== "loopGroupChatChat:loadingError") return;
        document.getElementById("groupChatLoadingText").textContent = "群聊加载失败：" + data.error;
        document.querySelector(".typing-dots").hidden = true;
        retry.hidden = false;
      });
      retry.addEventListener("click", () => {
        retry.hidden = true;
        document.querySelector(".typing-dots").hidden = false;
        document.getElementById("groupChatLoadingText").textContent = "正在加载群聊…";
        vscode.postMessage({ type: "loopGroupChatChat:refresh" });
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(() => vscode.postMessage({ type: "loopGroupChatChat:loadingReady" }), 0);
      }));
    </script></body></html>`;
}

export type LoopGroupChatPanelContentPatch = {
  type: "loopGroupChatChat:contentPatch";
  mainModelBusy: boolean;
  generation: number;
  headingText: string;
  tabTitle: string;
  subtitleText: string;
  actionsHtml: string;
  taskPanelHtml: string;
  rosterPanelHtml: string;
  statusBarHtml: string;
  employeeAllocationHtml: string;
  timelineHtml: string;
  clarificationHtml: string;
  clarificationInteractionId: string;
  modelSwitchHtml: string;
};

export function buildLoopGroupChatPanelContentPatch(
  state: LoopGroupChatPanelState,
  generation: number,
  bubbleWindow?: LoopGroupChatBubbleWindow,
): LoopGroupChatPanelContentPatch {
  const strings = getStrings();
  const transcript = parseLoopGroupChatTranscript(state.chatMarkdown);
  const roster = collectRosterParticipants(state.rounds);
  const acceptanceAnchors = buildLoopGroupChatAcceptanceAnchors(
    transcript.segments,
    roster.filter((participant) => participant.role === "subtask"),
    !state.error && state.loopPlus?.ok ? state.loopPlus.seenAttempts : undefined,
  );
  return {
    type: "loopGroupChatChat:contentPatch",
    mainModelBusy: state.mainModelBusy === true,
    generation,
    headingText: buildLoopGroupChatPanelHeading(state, strings),
    tabTitle: buildLoopGroupChatPanelTitle(state, strings),
    subtitleText: buildLoopGroupChatPanelSubtitle(state),
    actionsHtml: renderPanelActions(state, strings),
    taskPanelHtml: renderTaskPanel(state, strings),
    rosterPanelHtml: renderRosterPanel(state, strings, roster, acceptanceAnchors.byParticipantId),
    statusBarHtml: renderStatusBar(state, strings, roster),
    employeeAllocationHtml: renderDepartmentEmployeeAllocationRows(state.department, escapeAttribute),
    timelineHtml: renderTimeline(state, transcript.segments, strings, bubbleWindow, acceptanceAnchors.bySegmentIndex),
    clarificationHtml: renderOrchestratorClarificationDialog(
      state.clarification,
      { requiredTemplate: strings.clarificationRequired },
      { submit: "loopGroupChatChat:submitClarification", reject: "loopGroupChatChat:rejectClarification" },
    ),
    clarificationInteractionId: state.clarification?.interactionId ?? "",
    modelSwitchHtml: renderLoopModelSwitchFields(state.modelSwitch),
  };
}

export function buildLoopGroupChatPanelHtml(
  webview: vscode.Webview,
  state: LoopGroupChatPanelState,
  askThread: LoopAskThread = createEmptyLoopAskThread(),
  generation = 0,
  bubbleWindow?: LoopGroupChatBubbleWindow,
  options: { nonce?: string; embedded?: DepartmentGroupChatModalTarget } = {},
): string {
  const nonce = options.nonce ?? getNonce();
  const strings = getStrings();
  const patch = buildLoopGroupChatPanelContentPatch(state, generation, bubbleWindow);
  const heading = state.department ? patch.tabTitle : patch.headingText;

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';${state.department?.role === "director" ? " frame-src 'self';" : ""} img-src ${webview.cspSource} https: http: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(heading)}</title>
    <style>
${LOOP_GROUP_CHAT_PANEL_STYLES}
${getMarkdownStyles(".markdown-body")}
      .message-text.markdown-body, .ask-chat-bubble.markdown-body { white-space: normal; --radius-md: var(--radius); }
    </style>
  </head>
  <body${state.department ? ' class="department-chat-page"' : ""}>
    ${renderGroupChatLoading()}
    <div class="shell">
      <header class="topbar">
        <div class="title">
          <h1 id="panelHeading"${state.department ? ` title="${escapeAttribute(patch.headingText)}"` : ""}>${escapeHtml(patch.headingText)}</h1>
          <p id="panelSubtitle"${state.department ? ` title="${escapeAttribute(patch.subtitleText)}"` : ""}>${escapeHtml(patch.subtitleText)}</p>
        </div>
        <div class="actions" id="panelActions">
          ${patch.actionsHtml}
        </div>
      </header>
${renderPanelDialog({
        backdropId: "continueDialogBackdrop",
        backdropAttributes: [["aria-hidden", "true"]],
        labelledBy: "continueDialogTitle",
        describedBy: "continueDialogDescription",
        titleHtml: `<h2 id="continueDialogTitle" class="dialog-title">${escapeHtml(strings.continueDialogTitle)}</h2>`,
        descriptionHtml: `<p id="continueDialogDescription" class="dialog-description">${escapeHtml(strings.continueDialogDescription)}</p>`,
        bodyHtml: `<div class="dialog-body"><label class="dialog-label" for="continueDialogInput">${escapeHtml(strings.continuePromptLabel)}</label><textarea id="continueDialogInput" class="dialog-textarea" spellcheck="true">${escapeHtml(strings.continuePromptDefault)}</textarea><div id="continueDialogError" class="dialog-error" aria-live="polite"></div></div>`,
        actionsHtml: renderModalActions("dialog-actions", `<button id="continueDialogCancel" class="button" type="button">${escapeHtml(strings.continueCancel)}</button><button id="continueDialogConfirm" class="button primary" type="button">${escapeHtml(strings.continueConfirm)}</button>`),
      })}
${renderPanelDialog({
        backdropId: "modelSwitchBackdrop",
        backdropAttributes: [["aria-hidden", "true"]],
        labelledBy: "modelSwitchTitle",
        describedBy: "modelSwitchDescription",
        titleHtml: '<h2 id="modelSwitchTitle" class="dialog-title">切模型</h2>',
        descriptionHtml: '<p id="modelSwitchDescription" class="dialog-description">在各角色所在 CLI 的当前配置中选择模型和思考力度。提交后，下一次主、子模型执行使用新设置；正在执行的调用不受影响，已暂停的任务直接继续。</p>',
        bodyHtml: `<div class="dialog-body">${patch.modelSwitchHtml}<div id="modelSwitchError" class="dialog-error" aria-live="polite"></div></div>`,
        actionsHtml: renderModalActions("dialog-actions", '<button id="modelSwitchCancel" class="button" type="button">取消</button><button id="modelSwitchConfirm" class="button primary" type="button">提交</button>'),
      })}
      ${renderPanelDialog({
        backdropId: "askChatBackdrop",
        backdropClassName: `dialog-backdrop ask-chat-backdrop${askThread.dialogOpen ? " visible" : ""}`,
        backdropAttributes: [["aria-hidden", askThread.dialogOpen ? "false" : "true"]],
        dialogClassName: "dialog ask-chat-dialog",
        labelledBy: "askChatTitle",
        describedBy: "askChatDescription",
        headerClassName: "dialog-header ask-chat-header",
        titleGroupClassName: "ask-chat-heading",
        titleHtml: `<h2 id="askChatTitle" class="dialog-title">${escapeHtml(strings.askDialogTitle)}</h2>`,
        descriptionHtml: `<p id="askChatDescription" class="dialog-description">${escapeHtml(strings.askDialogDescription)}</p>`,
        closeHtml: renderModalCloseButton({
          id: "askChatClose",
          label: strings.askAnswerClose,
          className: "icon-button ask-chat-close",
        }),
        afterHeaderHtml: `<div id="askChatMessages" class="ask-chat-log" aria-live="polite"></div><form id="askChatForm" class="ask-chat-composer"><label class="dialog-label" for="askChatInput">${escapeHtml(strings.askPromptLabel)}</label><textarea id="askChatInput" class="dialog-textarea" spellcheck="true" placeholder="${escapeAttribute(strings.askChatPlaceholder)}"></textarea><div class="ask-chat-actions"><span id="askChatBusy" class="ask-chat-busy" role="status"${state.mainModelBusy && !askThread.running ? "" : " hidden"}>${escapeHtml(strings.askChatBusy)}</span><button id="askChatAbort" class="icon-button stop-button" type="button" title="${escapeAttribute(strings.askChatAbort)}" aria-label="${escapeAttribute(strings.askChatAbort)}"${askThread.running ? "" : " hidden"}><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg></button><button id="askChatSend" class="icon-button send-icon-button" type="${options.embedded ? "button" : "submit"}" title="${escapeAttribute(strings.askChatSend)}" aria-label="${escapeAttribute(strings.askChatSend)}"${state.mainModelBusy && !askThread.running ? ' aria-describedby="askChatBusy"' : ""}><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg></button></div></form>`,
      })}
      <div id="clarificationSlot">${patch.clarificationHtml}</div>
      ${hasGroupAcceptancePlan(state) ? renderGroupAcceptancePlanDialogs() : ""}
      ${renderPanelDialog({
        backdropId: "filePreviewBackdrop",
        backdropClassName: "dialog-backdrop file-preview-backdrop",
        backdropAttributes: [["aria-hidden", "true"]],
        dialogClassName: "dialog file-preview-dialog",
        labelledBy: "filePreviewTitle",
        titleHtml: `<h2 id="filePreviewTitle" class="dialog-title">${escapeHtml(strings.communicationFileDialogTitle)}</h2>`,
        descriptionHtml: `<p id="filePreviewPath" class="dialog-description"></p>`,
        bodyHtml: `<div class="dialog-body file-preview-body"><div id="filePreviewError" class="dialog-error" aria-live="polite"></div><div id="filePreviewContent" class="markdown-body"></div></div>`,
        actionsHtml: renderModalActions("dialog-actions", `<button id="filePreviewClose" class="button" type="button">${escapeHtml(strings.communicationFileClose)}</button>`),
      })}
      <div class="layout">
        <button id="sidebarBackdrop" class="sidebar-backdrop" type="button" aria-label="${escapeAttribute(strings.hideSidebar)}" tabindex="-1" hidden></button>
        <aside id="panelSidebar" class="sidebar" aria-label="${escapeAttribute(strings.sidebarLabel)}" tabindex="-1">
          <div id="taskPanelSlot">${patch.taskPanelHtml}</div>
          <div id="rosterPanelSlot">${patch.rosterPanelHtml}</div>
        </aside>
        <button id="sidebarToggle" class="sidebar-toggle" type="button" aria-controls="panelSidebar" aria-expanded="false" aria-label="${escapeAttribute(strings.showSidebar)}" title="${escapeAttribute(strings.showSidebar)}">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19" /></svg>
        </button>
        <main class="main">
          <div id="timelineSlot">${patch.timelineHtml}</div>
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
      ${state.department ? "" : `<footer id="statusBarSlot" class="chat-status-bar" role="group" aria-label="子任务状态汇总">${patch.statusBarHtml}</footer>`}
	    </div>
	    ${state.department?.role === "director" ? renderDepartmentGroupChatModal() : ""}
    ${state.department?.role === "director" ? renderDepartmentEmployeeAllocationDialog(patch.employeeAllocationHtml) : ""}
    ${options.embedded ? `<script nonce="${nonce}">${neutralizeInlineScriptEndTags(buildDepartmentChildBridge(options.embedded))}</script>` : ""}
    <script nonce="${nonce}">${neutralizeInlineScriptEndTags(getMarkedScript())}</script>
	    <script nonce="${nonce}">${neutralizeInlineScriptEndTags(getJsonFormatterScript())}</script>
	    <script nonce="${nonce}">
	      const vscode = acquireVsCodeApi();
          const escapeHtml = askEscape;
${DEPARTMENT_EMPLOYEE_ALLOCATION_SCRIPT}
${neutralizeInlineScriptEndTags(CHAT_MARKDOWN_SCRIPT)}
${neutralizeInlineScriptEndTags(CHAT_COPY_SCRIPT)}
	      const PANEL_GENERATION = ${Math.max(0, Math.floor(generation))};
	      const AUTO_REFRESH_INTERVAL_MS = 5000;
	      const SCROLL_BOTTOM_THRESHOLD = 50;
	      const SCROLL_BUTTON_SUPPRESS_MS = 400;
	      const sidebarElement = document.querySelector(".sidebar");
	      const layoutElement = document.querySelector(".layout");
	      const sidebarToggle = document.getElementById("sidebarToggle");
	      const sidebarBackdrop = document.getElementById("sidebarBackdrop");
	      const narrowSidebarQuery = window.matchMedia("(max-width: 780px)");
	      let sidebarOpen = false;
	      const mainElement = document.querySelector(".main");
	      const renderedSlotHtml = new WeakMap();
	      document.querySelectorAll("#panelActions, #taskPanelSlot, #rosterPanelSlot, #timelineSlot, #statusBarSlot, #departmentAllocationSlot").forEach((slot) => {
	        renderedSlotHtml.set(slot, { initial: slot.innerHTML });
	      });
	      const continueDialogBackdrop = document.getElementById("continueDialogBackdrop");
	      const continueDialogInput = document.getElementById("continueDialogInput");
	      const continueDialogError = document.getElementById("continueDialogError");
	      const continueDialogConfirm = document.getElementById("continueDialogConfirm");
	      const continueDialogCancel = document.getElementById("continueDialogCancel");
	      let appliedPatchGeneration = PANEL_GENERATION;
	      function actionButton(action) {
	        return document.querySelector('[data-action="' + action + '"]');
	      }
	      const askChatBackdrop = document.getElementById("askChatBackdrop");
	      const askChatMessages = document.getElementById("askChatMessages");
	      const askChatForm = document.getElementById("askChatForm");
	      const askChatInput = document.getElementById("askChatInput");
	      const askChatSend = document.getElementById("askChatSend");
	      const askChatBusy = document.getElementById("askChatBusy");
	      const askChatAbort = document.getElementById("askChatAbort");
	      const askChatClose = document.getElementById("askChatClose");
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
	      let continueRequestPending = false;
	      let continueRequestId = null;
	      let continueDialogMode = undefined;
	      let continueDialogOpener = null;
	      let dialogStateRestored = false;
	      let askDialogOpen = ${askThread.dialogOpen ? "true" : "false"};
	      let askDialogOpener = null;
	      let askThread = ${embedJson(askThread)};
	      const pendingAskTurns = new Map();
	      let askSubmissionError = "";
	      const requestSessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
	      let requestSequence = 0;
	      let mainModelBusy = ${state.mainModelBusy === true};
	      let communicationPreviewOpen = false;
	      let communicationPreviewOpener = null;
	      let communicationPreviewSeq = 0;

	      function setSidebarOpen(open, restoreFocus = false) {
	        sidebarOpen = narrowSidebarQuery.matches && open;
	        layoutElement.classList.toggle("sidebar-open", sidebarOpen);
	        sidebarToggle.setAttribute("aria-expanded", String(sidebarOpen));
	        const label = sidebarOpen ? "${escapeJsString(strings.hideSidebar)}" : "${escapeJsString(strings.showSidebar)}";
	        sidebarToggle.setAttribute("aria-label", label);
	        sidebarToggle.title = label;
	        sidebarBackdrop.hidden = !sidebarOpen;
	        sidebarElement.inert = narrowSidebarQuery.matches && !sidebarOpen;
	        sidebarElement.setAttribute("aria-hidden", String(sidebarElement.inert));
	        if (sidebarOpen) {
	          sidebarElement.focus({ preventScroll: true });
	        } else if (restoreFocus && narrowSidebarQuery.matches) {
	          sidebarToggle.focus({ preventScroll: true });
	        }
	      }

	      function syncSidebarMode() {
	        const restoreFocus = narrowSidebarQuery.matches && sidebarElement.contains(document.activeElement);
	        setSidebarOpen(false, restoreFocus);
	      }

	      function handleSidebarKeydown(event) {
	        if (event.key === "Escape" && sidebarOpen && !event.defaultPrevented && !document.querySelector(".dialog-backdrop.visible")) {
	          event.preventDefault();
	          setSidebarOpen(false, true);
	        }
	      }

	      sidebarToggle.addEventListener("click", () => setSidebarOpen(!sidebarOpen, true));
	      sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false, true));
	      narrowSidebarQuery.addEventListener("change", syncSidebarMode);
	      document.addEventListener("keydown", handleSidebarKeydown);
	      syncSidebarMode();

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
	        if (!dialogStateRestored) {
	          return;
	        }
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
	        vscode.postMessage({ type: "loopGroupChatChat:refresh" });
	      }

	      function setContinueDialogError(message) {
	        if (!continueDialogError) {
	          return;
	        }
	        continueDialogError.textContent = message || "";
	      }

	      function openContinueDialog(preservedPrompt, focusInput = true) {
	        if (!continueDialogBackdrop || !continueDialogInput || continueRequestPending) {
	          return;
	        }
	        const dialogOpener = focusInput ? document.activeElement : null;
	        continueDialogOpener = dialogOpener;
	        setContinueDialogError("");
	        continueDialogOpen = true;
	        continueDialogMode = "continue";
	        continueDialogInput.value = typeof preservedPrompt === "string" ? preservedPrompt : "${escapeJsString(strings.continuePromptDefault)}";
	        continueDialogBackdrop.classList.add("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "false");
	        window.__departmentDialogOpened && window.__departmentDialogOpened(continueDialogBackdrop, dialogOpener);
	        continueDialogConfirm && (continueDialogConfirm.dataset.mode = "continue");
	        saveDialogState();
	        requestRefresh();
	        if (focusInput) {
	          continueDialogInput.focus();
	          continueDialogInput.select();
	        }
	      }

	      function closeContinueDialog() {
	        if (!continueDialogBackdrop) {
	          return;
	        }
	        continueDialogOpen = false;
	        continueDialogMode = undefined;
	        continueDialogBackdrop.classList.remove("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "true");
	        const lifecycleManaged = typeof window.__departmentDialogClosed === "function";
	        if (lifecycleManaged) window.__departmentDialogClosed(continueDialogBackdrop);
	        else if (continueDialogOpener?.isConnected) continueDialogOpener.focus({ preventScroll: true });
	        continueDialogOpener = null;
	        setContinueDialogError("");
	        clearDialogState();
	      }

	      function nextRequestId(prefix) {
	        return prefix + '-client-' + requestSessionId + '-' + (++requestSequence).toString(36);
	      }

	      function setContinueButtonPending(button, pending) {
	        button.setAttribute("aria-busy", String(pending));
	        if (pending) button.setAttribute("aria-label", "${escapeJsString(`${strings.continueTask}，${strings.continueTaskStarting}`)}");
	        else button.removeAttribute("aria-label");
	        button.querySelector(".continue-loading").hidden = !pending;
	      }

	      function submitContinueDialog() {
	        if (!continueDialogInput || !continueDialogOpen || continueDialogMode !== "continue" || continueRequestPending) {
	          return;
	        }
	        const prompt = continueDialogInput.value.trim();
	        if (!prompt) {
	          setContinueDialogError("${escapeJsString(strings.continuePromptRequired)}");
	          continueDialogInput.focus();
	          return;
	        }
	        continueRequestPending = true;
	        continueRequestId = nextRequestId("continue");
	        closeContinueDialog();
	        const liveContinueButton = actionButton("continueTask");
	        if (liveContinueButton) {
	          liveContinueButton.disabled = true;
	          setContinueButtonPending(liveContinueButton, true);
	        }
	        vscode.postMessage({ type: "loopGroupChatChat:continueTask", prompt, requestId: continueRequestId });
	      }

	      function applyContinueTaskSettled(message) {
	        if (!continueRequestId || message.requestId !== continueRequestId) return;
	        if (message.type === "loopGroupChatChat:continueTaskSettled") continueRequestId = null;
	        continueRequestPending = false;
	        const liveContinueButton = actionButton("continueTask");
	        if (liveContinueButton) {
	          if (liveContinueButton.hasAttribute("data-continue-fallback") && message.canContinue !== true) {
	            liveContinueButton.remove();
	            return;
	          }
	          liveContinueButton.removeAttribute("data-continue-fallback");
	          liveContinueButton.disabled = message.canContinue !== true;
	          setContinueButtonPending(liveContinueButton, false);
	        }
	      }

	      function submitSupplementDialog() {
	        if (!continueDialogInput || !continueDialogOpen || continueDialogMode !== "supplement") {
	          return;
	        }
	        const prompt = continueDialogInput.value.trim();
	        if (!prompt) {
	          setContinueDialogError("${escapeJsString(strings.supplementPromptRequired)}");
	          continueDialogInput.focus();
	          return;
	        }
	        closeContinueDialog();
	        vscode.postMessage({ type: "loopGroupChatChat:supplementTask", prompt });
	      }

	      function openSupplementDialog(preservedPrompt, focusInput = true) {
	        if (!continueDialogBackdrop || !continueDialogInput) {
	          return;
	        }
	        const dialogOpener = focusInput ? document.activeElement : null;
	        continueDialogOpener = dialogOpener;
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
	        continueDialogInput.value = typeof preservedPrompt === "string" ? preservedPrompt : "${escapeJsString(strings.supplementPromptDefault)}";
	        continueDialogBackdrop.classList.add("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "false");
	        window.__departmentDialogOpened && window.__departmentDialogOpened(continueDialogBackdrop, dialogOpener);
	        continueDialogConfirm && (continueDialogConfirm.dataset.mode = "supplement");
	        saveDialogState();
	        if (focusInput) {
	          continueDialogInput.focus();
	          continueDialogInput.select();
	        }
	      }

	      const ASK_WAITING_LABEL = "${escapeJsString(strings.askChatWaiting)}";
	      const ASK_QUEUED_LABEL = "${escapeJsString(strings.askChatQueued)}";
	      const ASK_EMPTY_LABEL = "${escapeJsString(strings.askChatEmpty)}";

	      function askEscape(value) {
	        return String(value == null ? "" : value)
	          .replace(/&/g, "&amp;")
	          .replace(/</g, "&lt;")
	          .replace(/>/g, "&gt;")
	          .replace(/"/g, "&quot;")
	          .replace(/'/g, "&#39;");
	      }

          function mountGroupChatMarkdown(root, onComplete) {
            const elements = Array.from(root.querySelectorAll("[data-markdown-source]"));
            let index = 0;
            function mountElement(element) {
              if (element.isConnected === false) return;
              const links = Array.from(element.querySelectorAll(".communication-file-link"));
              element.innerHTML = renderMarkdown(element.getAttribute("data-markdown-source") || "");
              element.removeAttribute("data-markdown-source");
              links.forEach((link) => {
                const filePath = link.getAttribute("data-file-path");
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                const matches = [];
                while (walker.nextNode()) {
                  const text = walker.currentNode;
                  if (filePath && text.textContent.includes(filePath) && !text.parentElement.closest("pre, a, button, script")) {
                    matches.push(text);
                  }
                }
                matches.forEach((text) => {
                  const fragment = document.createDocumentFragment();
                  text.textContent.split(filePath).forEach((part, index) => {
                    if (index) {
                      fragment.appendChild(link.cloneNode(true));
                    }
                    fragment.appendChild(document.createTextNode(part));
                  });
                  text.replaceWith(fragment);
                });
              });
              mountJsonTreeHosts(element);
            }
            function mountBatch() {
              const start = onComplete ? performance.now() : 0;
              do {
                if (index >= elements.length) break;
                mountElement(elements[index++]);
              } while (!onComplete || performance.now() - start < 8);
              if (index < elements.length) {
                window.setTimeout(mountBatch, 0);
              } else {
                if (onComplete) onComplete();
              }
            }
            mountBatch();
          }

	      function renderAskBubble(message) {
	        if (!message || message.role === "thinking") {
	          return "";
	        }
	        const role = message.role === "user"
	          ? "user"
	          : message.role === "system"
	            ? "system"
	            : "assistant";
	        const content = askEscape(message.content || "");
	        return '<article class="ask-chat-message ' + role + '"><div class="ask-chat-bubble markdown-body" data-markdown-source="' + content + '">' +
	          content +
	          "</div>" + (role === "user" && message.queued === true
	            ? '<div class="ask-chat-queued" role="status"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span><span>' + askEscape(ASK_QUEUED_LABEL) + '</span></div>'
	            : "") + "</article>";
	      }

	      function renderAskWaiting(label) {
	        return '<article class="ask-chat-message waiting"><div class="ask-chat-bubble ask-chat-waiting" role="status" aria-label="' +
	          askEscape(label) +
	          '"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span></div></article>';
	      }

	      function updateAskAnimationVisibility() {
	        if (askChatBackdrop) {
	          askChatBackdrop.classList.toggle("page-hidden", document.visibilityState !== "visible");
	        }
	      }

	      function scrollAskToBottom() {
	        if (askDialogOpen && askChatMessages) {
	          askChatMessages.scrollTop = askChatMessages.scrollHeight;
	        }
	      }

	      function renderAskThread(forceScroll = false) {
	        if (!askChatMessages) {
	          return;
	        }
	        const messages = askThread && Array.isArray(askThread.messages)
	          ? askThread.messages.filter((message) => message && message.role !== "thinking")
	          : [];
	        messages.push(...pendingAskTurns.values());
	        if (askSubmissionError) messages.push({ role: "system", content: askSubmissionError });
	        const waiting = askThread && askThread.running && !askThread.queued
	          ? renderAskWaiting(ASK_WAITING_LABEL)
	          : pendingAskTurns.size > 0 ? renderAskWaiting("${escapeJsString(strings.askChatSubmitting)}") : "";
	        const html = messages.length || waiting
	          ? messages.map(renderAskBubble).join("") + waiting
	          : '<div class="ask-chat-empty">' + askEscape(ASK_EMPTY_LABEL) + "</div>";
	        const previous = renderedSlotHtml.get(askChatMessages);
	        const contentChanged = !previous || previous.source !== html;
	        replaceHtml(askChatMessages, html);
	        if (askDialogOpen && (contentChanged || forceScroll)) {
	          scrollAskToBottom();
	          window.requestAnimationFrame(scrollAskToBottom);
	        }
	        updateAskAvailability();
	      }

	      function updateAskAvailability() {
	        const running = pendingAskTurns.size > 0 || Boolean(askThread && askThread.running);
	        const showBusyNotice = mainModelBusy && !running;
	        if (askChatSend) {
	          askChatSend.disabled = false;
	          if (showBusyNotice) {
	            askChatSend.setAttribute("aria-describedby", "askChatBusy");
	          } else {
	            askChatSend.removeAttribute("aria-describedby");
	          }
	        }
	        if (askChatBusy) {
	          askChatBusy.hidden = !showBusyNotice;
	        }
	        if (askChatAbort) {
	          askChatAbort.hidden = !running;
	        }
	        if (askChatInput) {
	          askChatInput.disabled = false;
	        }
	      }

	      function applyAskThread(thread) {
	        if (!thread || typeof thread !== "object" || !Array.isArray(thread.messages)) {
	          return;
	        }
	        for (const message of thread.messages) {
	          if (message?.role === "user") pendingAskTurns.delete(message.id);
	        }
	        askThread = thread;
	        renderAskThread();
	      }

	      function rejectAskSubmission(message) {
	        const pending = pendingAskTurns.get(message.requestId);
	        if (!pending) return;
	        pendingAskTurns.delete(message.requestId);
	        askSubmissionError = message.error;
	        if (askChatInput && !askChatInput.value) {
	          askChatInput.value = pending.content;
	          saveAskDialogState();
	        }
	        renderAskThread();
	      }

	      function getStoredAskDialogState() {
	        const dialog = getStoredState().askDialog;
	        return dialog && typeof dialog === "object" ? dialog : {};
	      }

	      function saveAskDialogState() {
	        if (!dialogStateRestored) {
	          return;
	        }
	        vscode.setState({
	          ...getStoredState(),
	          askDialog: {
	            open: askDialogOpen,
	            draft: askChatInput ? askChatInput.value : "",
	          },
	        });
	      }

	      function showAskDialog() {
	        askDialogOpen = true;
	        if (askChatBackdrop) {
	          askChatBackdrop.classList.add("visible");
	          askChatBackdrop.setAttribute("aria-hidden", "false");
	        }
	        renderAskThread(true);
	      }

	      function hideAskDialog() {
	        askDialogOpen = false;
	        if (askChatBackdrop) {
	          askChatBackdrop.classList.remove("visible");
	          askChatBackdrop.setAttribute("aria-hidden", "true");
	        }
	      }

	      function openAskDialog(focusInput = true) {
	        const dialogOpener = focusInput ? document.activeElement : null;
	        askDialogOpener = dialogOpener;
	        showAskDialog();
	        if (focusInput && askChatBackdrop) {
	          window.__departmentDialogOpened && window.__departmentDialogOpened(askChatBackdrop, dialogOpener);
	        }
	        saveAskDialogState();
	        vscode.postMessage({ type: "loopGroupChatChat:openAskDialog" });
	        if (focusInput && askChatInput) askChatInput.focus();
	      }

	      function closeAskDialog() {
	        hideAskDialog();
	        const lifecycleManaged = typeof window.__departmentDialogClosed === "function";
	        if (lifecycleManaged) window.__departmentDialogClosed(askChatBackdrop);
	        else if (askDialogOpener?.isConnected) askDialogOpener.focus({ preventScroll: true });
	        askDialogOpener = null;
	        saveAskDialogState();
	        vscode.postMessage({ type: "loopGroupChatChat:closeAskDialog" });
	      }

	      function submitAskChat() {
	        if (!askChatInput) {
	          return;
	        }
	        const prompt = askChatInput.value.trim();
	        if (!prompt) {
	          askChatInput.focus();
	          return;
	        }
	        const requestId = nextRequestId("ask");
	        askSubmissionError = "";
	        pendingAskTurns.set(requestId, { id: requestId, role: "user", content: prompt });
	        askChatInput.value = "";
	        saveAskDialogState();
	        renderAskThread();
	        vscode.postMessage({ type: "loopGroupChatChat:askMainModel", prompt: prompt, requestId });
	      }

	      function restoreAskDialogState() {
	        const stored = getStoredAskDialogState();
            ${options.embedded ? 'if (typeof stored.draft === "string" && askChatInput) askChatInput.value = stored.draft;' : ""}
	        if (!stored || stored.open !== true && stored.open !== false) {
	          return;
	        }
	        if (stored.open) {
	          showAskDialog();
	          if (typeof stored.draft === "string" && askChatInput) {
	            askChatInput.value = stored.draft;
	          }
	          return;
	        }
	        hideAskDialog();
	      }

	      function restoreDialogState() {
	        restoreAskDialogState();
	        const dialog = getStoredDialogState();
	        dialogStateRestored = true;
	        if (!dialog.open || !continueDialogInput) {
	          return;
	        }
	        if (dialog.mode === "ask") {
	          showAskDialog();
	          if (typeof dialog.prompt === "string" && askChatInput) {
	            askChatInput.value = dialog.prompt;
	          }
	          saveAskDialogState();
	          return;
	        }
	        const preservedPrompt = typeof dialog.prompt === "string" ? dialog.prompt : undefined;
	        if (dialog.mode === "supplement") {
	          openSupplementDialog(preservedPrompt, false);
	        } else if (dialog.mode === "continue") {
	          openContinueDialog(preservedPrompt, false);
	        } else {
	          return;
	        }
	        saveDialogState();
	      }

	      renderAskThread();
	      restoreDialogState();

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
	        if (focusClose !== false) {
	          communicationPreviewOpener = document.activeElement;
	          window.__departmentDialogOpened && window.__departmentDialogOpened(filePreviewBackdrop, communicationPreviewOpener);
	        }
	        rememberCommunicationFilePreview(filePath, requestId, cachedHtml);
	        vscode.postMessage({ type: "loopGroupChatChat:openCommunicationFile", requestId: requestId, path: filePath });
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
	        const lifecycleManaged = typeof window.__departmentDialogClosed === "function";
	        if (lifecycleManaged) window.__departmentDialogClosed(filePreviewBackdrop);
	        else if (communicationPreviewOpener?.isConnected) communicationPreviewOpener.focus({ preventScroll: true });
	        communicationPreviewOpener = null;
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
	        if (!message || message.type !== "loopGroupChatChat:communicationFile" || !stored || !stored.open) {
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

	      function shouldAutoRefresh() {
	        return document.visibilityState === "visible" && !document.getElementById("clarificationDialogBackdrop");
	      }

	      function captureNestedScrollState(slot) {
	        const positions = [];
	        slot.querySelectorAll("*").forEach((element) => {
	          if (!element.scrollTop && !element.scrollLeft) {
	            return;
	          }
	          const path = [];
	          let current = element;
	          while (current !== slot) {
	            const parent = current.parentElement;
	            path.unshift(Array.prototype.indexOf.call(parent.children, current));
	            current = parent;
	          }
	          positions.push({ path, tagName: element.tagName, top: element.scrollTop, left: element.scrollLeft });
	        });
	        return positions;
	      }

	      function restoreNestedScrollState(slot, positions) {
	        positions.forEach((position) => {
	          const element = position.path.reduce((parent, index) => parent && parent.children[index], slot);
	          if (element && element.tagName === position.tagName) {
	            element.scrollTop = position.top;
	            element.scrollLeft = position.left;
	          }
	        });
	      }

	      function replaceHtml(slot, html) {
	        if (!slot || typeof html !== "string") {
	          return;
	        }
	        const previous = renderedSlotHtml.get(slot);
	        if (previous && previous.source === html) {
	          return;
	        }
	        if (previous && typeof previous.initial === "string") {
	          const holder = document.createElement("div");
	          holder.innerHTML = html;
	          if (holder.innerHTML === previous.initial) {
	            renderedSlotHtml.set(slot, { source: html });
	            return;
	          }
	        }
	        const positions = captureNestedScrollState(slot);
	        slot.innerHTML = html;
            mountGroupChatMarkdown(slot);
	        restoreNestedScrollState(slot, positions);
	        renderedSlotHtml.set(slot, { source: html });
	      }

	      function replaceRosterHtml(html) {
        const slot = document.getElementById("rosterPanelSlot");
        const focused = document.activeElement;
        const focusKey = slot && focused && slot.contains(focused)
          ? focused.getAttribute("data-department-nav-key") : null;
        const sidebarTop = sidebarElement ? sidebarElement.scrollTop : 0;
        replaceHtml(slot, html);
        if (focusKey && slot) {
          const replacement = Array.from(slot.querySelectorAll("[data-department-nav-key]"))
            .find((element) => element.getAttribute("data-department-nav-key") === focusKey && !element.disabled);
          if (replacement) replacement.focus({ preventScroll: true });
        }
        if (sidebarElement) sidebarElement.scrollTop = sidebarTop;
      }

      function applyClarificationPatch(html, interactionId) {
	        const slot = document.getElementById("clarificationSlot");
	        if (!slot || typeof html !== "string") {
	          return;
	        }
	        const existing = slot.querySelector("#clarificationDialogBackdrop");
	        const existingId = existing ? existing.getAttribute("data-interaction-id") || "" : "";
	        const nextId = interactionId || "";
	        if (existing && existingId && existingId === nextId) {
	          return;
	        }
	        slot.innerHTML = html;
	        if (typeof bindOrchestratorClarificationDialog === "function") {
	          bindOrchestratorClarificationDialog({
	            focus: !continueDialogOpen && !askDialogOpen && !communicationPreviewOpen,
	          });
	        }
	      }

	      function applyContentPatch(message) {
	        if (!message || message.type !== "loopGroupChatChat:contentPatch") {
	          return false;
	        }
	        const generation = typeof message.generation === "number" ? message.generation : 0;
	        if (generation < appliedPatchGeneration) {
	          return true;
	        }
	        appliedPatchGeneration = generation;
	        mainModelBusy = message.mainModelBusy === true;
	        updateAskAvailability();
	        const heading = document.getElementById("panelHeading");
	        if (heading && typeof message.headingText === "string") {
	          heading.textContent = message.headingText;
              heading.title = message.headingText;
	        }
	        const subtitle = document.getElementById("panelSubtitle");
	        if (subtitle && typeof message.subtitleText === "string") {
	          subtitle.textContent = message.subtitleText;
              subtitle.title = message.subtitleText;
	        }
	        if (typeof message.tabTitle === "string") document.title = message.tabTitle;
	        const panelActions = document.getElementById("panelActions");
	        const pendingButton = continueRequestPending ? actionButton("continueTask") : null;
	        replaceHtml(panelActions, message.actionsHtml);
	        if (continueRequestPending) {
	          let liveContinueButton = actionButton("continueTask");
	          if (!liveContinueButton && pendingButton && panelActions) {
	            pendingButton.setAttribute("data-continue-fallback", "");
	            panelActions.append(pendingButton);
	            liveContinueButton = pendingButton;
	          }
	          if (liveContinueButton) {
	            liveContinueButton.disabled = true;
	            setContinueButtonPending(liveContinueButton, true);
	          }
	        }
	        replaceHtml(document.getElementById("taskPanelSlot"), message.taskPanelHtml);
	        replaceRosterHtml(message.rosterPanelHtml);
          departmentEmployeeAllocation?.sync((slot) => replaceHtml(slot, message.employeeAllocationHtml));
	        const shouldStick = isNearBottom();
	        const previousTop = mainElement ? mainElement.scrollTop : 0;
	        replaceHtml(document.getElementById("statusBarSlot"), message.statusBarHtml);
	        replaceHtml(document.getElementById("timelineSlot"), message.timelineHtml);
	        if (mainElement) {
	          mainElement.scrollTop = shouldStick ? mainElement.scrollHeight : previousTop;
	          updateScrollToBottomButton();
	        }
	        applyClarificationPatch(message.clarificationHtml, message.clarificationInteractionId);
	        return true;
	      }

	      function startAutoRefresh() {
	        if (autoRefreshTimer !== undefined) {
	          return;
	        }
	        autoRefreshTimer = window.setInterval(() => {
	          if (shouldAutoRefresh()) {
	            requestRefresh();
	          }
	        }, AUTO_REFRESH_INTERVAL_MS);
	      }

	      document.addEventListener("click", (event) => {
            if (handleChatImageClick(event)) {
              return;
            }
            if (handleChatLinkClick(event)) {
              return;
            }
	        const target = event.target.closest("[data-action]");
	        if (!target) {
	          return;
	        }
	        if (target.disabled) return;
        const action = target.getAttribute("data-action");
        if (action === "allocateEmployees") {
          departmentEmployeeAllocation?.open();
          return;
        }
        if (action === "openDepartmentTask") {
          const taskId = target.getAttribute("data-department-task-id");
          if (taskId && taskId.trim()) {
            saveScrollState();
            if (departmentModal) departmentModal.open(taskId, target.getAttribute("data-department-title"), target);
            else vscode.postMessage({ type: "loopGroupChatChat:openDepartmentTask", taskId });
          }
          return;
        }
        if (action === "refresh") {
          requestRefresh();
          return;
        }
	        if (action === "openSubtaskConversation") {
	          const subtaskId = target.getAttribute("data-subtask-id");
	          if (!subtaskId) return;
	          saveScrollState();
	          setSidebarOpen(false);
	          vscode.postMessage({ type: "loopGroupChatChat:openSubtaskConversation", subtaskId });
	          return;
	        }
	        if (action === "cancelSubtask") {
	          vscode.postMessage({ type: "loopGroupChatChat:cancelSubtask", subtaskId: target.getAttribute("data-subtask-id") ?? undefined });
	          return;
	        }
	        if (action === "jumpToAcceptance") {
	          const anchor = document.getElementById(target.getAttribute("data-acceptance-target"));
	          if (!anchor || !mainElement || !mainElement.contains(anchor)) return;
	          setSidebarOpen(false);
	          anchor.focus({ preventScroll: true });
	          anchor.scrollIntoView({
	            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
	            block: "center",
	          });
	          return;
	        }
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
	        if (action === "askMainModel") {
	          saveScrollState();
	          openAskDialog();
	          return;
	        }
	        if (action === "acceptancePlan") {
	          saveScrollState();
	          if (typeof openAcceptancePlanDialog === "function") {
	            const currentPlan = state.taskAcceptancePlan || {
	              id: "system_default",
	              name: acceptancePlanStrings.acceptancePlanSystemDefault,
	              checks: [],
	              otherText: "",
	              systemDefault: true,
	            };
	            openAcceptancePlanDialog({ prompt: "验收方案" }, "group-chat", currentPlan);
	          }
	          return;
	        }
	        if (action === "stopTask") {
	          const liveStopButton = actionButton("stopTask");
	          if (!liveStopButton || liveStopButton.disabled) return;
	          saveScrollState();
	          liveStopButton.disabled = true;
	          ${state.department?.role === "director" ? 'liveStopButton.textContent = "正在停止…";' : ""}
	          vscode.postMessage({ type: "loopGroupChatChat:stopTask" });
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
            ${options.embedded ? "" : "if (!isLoopGroupChatHostMessage(event)) return;"}
	        const message = event.data;
        if (departmentEmployeeAllocation?.settled(message)) return;
	        if (message && (message.type === "loopGroupChatChat:continueTaskStarted" || message.type === "loopGroupChatChat:continueTaskSettled")) {
	          applyContinueTaskSettled(message);
	          return;
	        }
            if (message && message.type === "chatImageResolved") {
              applyChatImageSource(message);
              return;
            }
	        if (applyContentPatch(message)) {
	          return;
	        }
	        if (message && message.type === "loopGroupChatChat:askThread") {
	          applyAskThread(message.thread);
	          return;
	        }
	        if (message && message.type === "loopGroupChatChat:askSubmissionRejected") {
	          rejectAskSubmission(message);
	          return;
	        }
	        if (message && message.type === "loopPlusAcceptancePlanSaved" && typeof handleAcceptancePlanSavedMessage === "function") {
	          handleAcceptancePlanSavedMessage(message);
	          return;
	        }
	        if (message && message.type === "loopPlusAcceptancePlanSelected" && typeof handleAcceptancePlanSelectedMessage === "function") {
	          handleAcceptancePlanSelectedMessage(message);
	          return;
	        }
	        if (message && message.type === "loopGroupChatChat:acceptancePlanUpdated") {
	          if (typeof state !== "undefined" && state) {
	            state.taskAcceptancePlan = message.plan || null;
	          }
	          if (typeof showToast === "function") {
	            showToast(message.error || (typeof t === "function" ? t("acceptancePlanUpdated") : ""));
	          }
	          return;
	        }
	        applyCommunicationFilePreview(message);
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
	        continueDialogInput.addEventListener("compositionend", () => {
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
	      if (askChatMessages) {
	        askChatMessages.addEventListener("load", scrollAskToBottom, true);
	      }
	      if (askChatBackdrop) {
	        askChatBackdrop.addEventListener("click", (event) => {
	          if (event.target === askChatBackdrop) {
	            closeAskDialog();
	          }
	        });
	      }
	      if (askChatClose) {
	        askChatClose.addEventListener("click", () => {
	          closeAskDialog();
	        });
	      }
	      if (askChatAbort) {
	        askChatAbort.addEventListener("click", () => {
	          vscode.postMessage({ type: "loopGroupChatChat:abortMainModelQuestion" });
	        });
	      }
          ${options.embedded ? `if (askChatSend) askChatSend.addEventListener("click", (event) => { event.preventDefault(); submitAskChat(); });` : ""}
	      if (askChatForm) {
	        askChatForm.addEventListener("submit", (event) => {
	          event.preventDefault();
	          submitAskChat();
	        });
	      }
	      if (askChatInput) {
	        askChatInput.addEventListener("input", () => {
	          if (askDialogOpen) {
	            saveAskDialogState();
	          }
	        });
	        askChatInput.addEventListener("keydown", (event) => {
	          if (event.key === "Escape") {
	            event.preventDefault();
	            closeAskDialog();
	            return;
	          }
	          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
	            event.preventDefault();
	            submitAskChat();
	          }
	        });
	      }
	      document.addEventListener("keydown", (event) => {
	        if (event.key === "Escape" && askDialogOpen) {
	          event.preventDefault();
	          closeAskDialog();
	          return;
	        }
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
	        updateAskAnimationVisibility();
	      });
	      document.addEventListener("visibilitychange", () => {
	        if (shouldAutoRefresh()) {
	          requestRefresh();
	        }
	      });
	      window.addEventListener("beforeunload", () => {
	        saveScrollState();
	        saveDialogState();
	        saveAskDialogState();
	        if (autoRefreshTimer !== undefined) {
	          window.clearInterval(autoRefreshTimer);
	        }
	      });
	      function finishInitialRender() {
	        document.getElementById("groupChatLoading").hidden = true;
	        restoreScrollState();
	        restoreCommunicationFilePreview();
	        window.requestAnimationFrame(() => updateScrollToBottomButton());
	        startAutoRefresh();
	        vscode.postMessage({ type: "loopGroupChatChat:domReady", generation: PANEL_GENERATION });
	      }
	      updateAskAnimationVisibility();
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            window.setTimeout(() => mountGroupChatMarkdown(document, finishInitialRender), 0);
          }));
${orchestratorClarificationDialogScript()}
${LOOP_MODEL_SWITCH_SCRIPT}
${hasGroupAcceptancePlan(state) ? renderGroupAcceptancePlanScript(state) : ""}
${DEPARTMENT_GROUP_CHAT_MODAL_SCRIPT.replace("PARENT_TASK_ID", embedJson(state.task.id))}
	    </script>
  </body>
</html>`;
}

function hasGroupAcceptancePlan(state: LoopGroupChatPanelState): boolean {
  return state.acceptancePlanReadOnly ? false : state.department ? state.department.role === "director" : Boolean(state.loopPlus);
}

function renderPanelActions(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
): string {
  const progressPercent = state.task.progressPercent ?? 0;
  const progressBand = Math.min(4, Math.floor(progressPercent / 20));
  const continueBlocked = state.department?.role === "director" && !state.task.canContinue
    && state.task.status !== "running" && state.task.status !== "completed" && state.task.departmentStopState === "unconfirmed";
  return [
    state.department?.role === "leader" ? '<button class="button" type="button" data-action="refresh">刷新</button>' : "",
    `<div class="progress-controls"><span class="task-progress" data-progress-band="${progressBand}" role="progressbar" aria-label="总体进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">${progressPercent}%</span>`,
    state.task.canStop
      ? `<button class="button danger" type="button" data-action="stopTask" title="${escapeAttribute(state.department?.role === "director" ? strings.stopDepartmentTitle : strings.stopTaskTitle)}"${state.task.departmentStopState === "stopping" ? " disabled" : ""}>${escapeHtml(state.task.departmentStopState === "stopping" ? strings.stoppingTask : strings.stopTask)}</button>`
      : "",
    "</div>",
    state.task.canSupplement
      ? `<button class="button" type="button" data-action="supplementTask" title="${escapeAttribute(strings.supplementTaskTitle)}">${escapeHtml(strings.supplementTask)}</button>`
      : "",
    state.task.canSupplement
      ? `<button class="button" type="button" data-action="askMainModel" title="${escapeAttribute(strings.askMainModelTitle)}">${escapeHtml(strings.askMainModel)}</button>`
      : "",
    state.department?.role === "director" ? '<button class="button" type="button" data-action="allocateEmployees" aria-haspopup="dialog" aria-controls="departmentAllocationDialog">分配员工</button>' : "",
    hasGroupAcceptancePlan(state) && state.task.status !== "completed"
      ? `<button class="button" type="button" data-action="acceptancePlan" title="${escapeAttribute(strings.acceptancePlanTitle)}">${escapeHtml(state.department?.role === "director" ? "统一验收方案" : strings.acceptancePlan)}</button>`
      : "",
    state.task.status !== "completed"
      ? '<button class="button" type="button" data-action="switchModels" title="切换当前任务的主、子模型">切模型</button>'
      : "",
    state.task.canContinue || continueBlocked
      ? `<button class="button primary" type="button" data-action="continueTask" title="${escapeAttribute(strings.continueTaskTitle)}"${continueBlocked ? ' disabled aria-describedby="departmentContinueBlocked"' : ""}>${escapeHtml(strings.continueTask)}<span class="continue-loading typing-dots" role="status" aria-label="${escapeAttribute(strings.continueTaskStarting)}" hidden><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></span></button>`
      : "",
    continueBlocked ? `<span id="departmentContinueBlocked" role="status">${state.task.status === "stopped" ? "已中止。" : ""}仍有原执行退出未确认，暂不能继续</span>` : "",
  ].join("");
}

function renderTaskPanel(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
): string {
  const currentRound = state.loopPlus
    ? ""
    : renderMetaRow(strings.currentRound, String(state.task.currentRound));
  const status = state.department?.role === "director" && state.task.status === "stopped" ? "已中止" : state.task.status;
  return `<section class="panel">
    <h2>${escapeHtml(strings.task)}</h2>
    <div class="meta-grid">
      ${renderMetaRow(strings.status, status)}
      ${renderMetaRow(strings.cli, state.task.cli)}
      ${currentRound}
      ${renderMetaRow(strings.updatedAt, formatTimestamp(state.task.updatedAt))}
    </div>
  </section>
  ${state.department?.role === "leader" ? `<section class="panel"><h2>继承产研部统一验收方案</h2><div class="member-name" title="${escapeAttribute(state.acceptancePlan?.name ?? "尚未同步统一验收方案")}">${escapeHtml(state.acceptancePlan?.name ?? "尚未同步统一验收方案")}</div></section>` : ""}
  ${renderLoopPlusPanels(state, strings)}`;
}

function renderLoopPlusPanels(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
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
      ${renderLoopPlusCount("queue", strings.loopPlusQueueCount, projection.reviewQueueCount)}
      ${renderLoopPlusCount("visible", strings.loopPlusVisibleCount, projection.visibleReviewCount)}
      ${renderLoopPlusCount("running", strings.loopPlusRunningCount, projection.runningCount)}
      ${renderLoopPlusCount("pending", strings.loopPlusPendingCount, projection.pendingCount)}
    </div>
  </section>`;
}

function loopPlusActivityText(
  state: LoopGroupChatPanelState,
  projection: Extract<LoopPlusPanelProjection, { ok: true }>,
  strings: LoopGroupChatPanelStrings,
): string {
  switch (projection.activity) {
    case "running":
      return strings.loopPlusActivityRunning;
    case "waiting":
      return projection.running.some((item) => item.interrupted)
        ? strings.loopPlusActivityAwaitingContinuation
        : strings.loopPlusActivityWaiting;
    case "review_pending":
      return strings.loopPlusActivityReviewPending;
    case "reviewing":
      return formatTemplate(strings.loopPlusActivityReviewing, {
        subtask: [projection.currentReview, ...projection.reviewQueue]
          .filter((item): item is LoopPlusPanelReviewItem => item !== null && (projection.activeReviewEventIds ?? []).includes(item.eventId))
          .map((item) => loopPlusSubtaskLabel(state, item.subtaskId))
          .join("、"),
      });
    case "stopped":
      return strings.loopPlusActivityStopped;
    case "completed":
      return strings.loopPlusActivityCompleted;
    case "idle":
      return strings.loopPlusActivityIdle;
    case "decomposing":
      return strings.loopPlusActivityDecomposing;
    case "paused":
      return strings.loopPlusActivityPaused;
  }
}

function loopPlusSubtaskLabel(state: LoopGroupChatPanelState, subtaskId: string): string {
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

function participantStatusClass(status: string): string {
  switch (status) {
    case "running":
      return "member-status-running";
    case "reviewing":
      return "member-status-reviewing";
    case "completed":
    case "acceptance_passed":
    case "reviewed":
      return "member-status-passed";
    case "acceptance_cancelled":
    case "closed":
    case "no_acceptance":
      return "member-status-inactive";
    case "pending":
    case "blocked":
    case "needs-review":
      return "member-status-pending";
    case "error":
    case "failed":
    case "acceptance_failed":
      return "member-status-failed";
    case "stopped":
    case "skipped":
      return "member-status-inactive";
    default:
      return "";
  }
}

function renderParticipantStatus(
  state: LoopGroupChatPanelState,
  status: string,
  strings: LoopGroupChatPanelStrings,
): string {
  const label = escapeHtml(formatParticipantStatus(state, status, strings));
  const statusClass = participantStatusClass(status);
  if (!statusClass) {
    return label;
  }
  return `<span class="${statusClass}">${label}</span>`;
}

function formatParticipantStatus(
  state: LoopGroupChatPanelState,
  status: string,
  strings: LoopGroupChatPanelStrings,
): string {
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
    case "acceptance_cancelled":
      return "验收已撤销";
    case "closed":
      return "已关闭";
    case "acceptance_passed":
      return strings.loopPlusAcceptancePassed;
    case "acceptance_failed":
      return strings.loopPlusAcceptanceFailed;
    case "no_acceptance":
      return strings.loopPlusStatusNoAcceptance;
    case "review_pending":
      return strings.loopPlusStatusReviewPending;
    case "waiting":
      return strings.loopPlusStatusWaiting;
    case "stopped":
      return strings.loopPlusStatusStopped;
    case "waiting_continuation":
      return strings.loopPlusStatusAwaitingContinuation;
    case "completed":
      return state.loopPlus ? strings.loopPlusStatusCompleted : strings.participantStatusCompleted;
    case "error":
    case "failed":
      return strings.participantStatusFailed;
    case "needs-review":
      return strings.participantStatusNeedsReview;
    case "blocked":
      return strings.participantStatusBlocked;
    case "skipped":
      return strings.participantStatusSkipped;
    case "idle":
      return strings.loopPlusStatusIdle;
    case "decomposing":
      return strings.loopPlusStatusDecomposing;
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

function renderStatusBar(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
  roster: readonly LoopGroupChatPanelParticipant[],
): string {
  if (state.department || state.error || state.loopPlus?.ok === false) {
    return "";
  }
  const counts = new Map<string, number>();
  for (const participant of roster) {
    if (participant.role === "subtask") {
      counts.set(participant.status, (counts.get(participant.status) ?? 0) + 1);
    }
  }
  const count = (status: string) => counts.get(status) ?? 0;
  const renderItem = (kind: string, label: string, total: number) =>
    `<span class="chat-status-item chat-status-${kind}"><span>${escapeHtml(label)}</span> <strong>${total}</strong></span>`;
  const running = renderItem("running", strings.loopPlusStatusRunning, count("running"));
  return state.loopPlus
    ? running
      + renderItem("pending", strings.loopPlusStatusQueued, count("queued_review") + count("held_review"))
      + renderItem("reviewing", "验收中", count("reviewing"))
      + renderItem("completed", "已验收", count("acceptance_passed") + count("acceptance_failed"))
    : running
      + renderItem("pending", strings.loopPlusStatusPending, count("pending"))
      + renderItem("completed", strings.participantStatusCompleted, count("completed"));
}

function renderRosterPanel(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
  roster: readonly LoopGroupChatPanelParticipant[],
  acceptanceAnchors: ReadonlyMap<string, string>,
): string {
  if (state.department) return renderDepartmentRosterPanel(state, strings, acceptanceAnchors);
  if (state.rounds.length === 0) {
    return "";
  }
  const blockingLabelsBySubtask = new Map(state.loopPlus?.ok
    ? state.loopPlus.pending.map((item) => [item.subtaskId, item.blockingDependencyLabels] as const)
    : []);
  const participants = roster.map((participant) => {
    const anchor = participant.role === "subtask" ? acceptanceAnchors.get(participant.id) : undefined;
    const opensConversation = participant.role === "subtask" && participant.status === "running";
    const blockingLabels = participant.role === "subtask" && participant.status === "pending"
      ? blockingLabelsBySubtask.get(participant.id)
      : undefined;
    const dependencyStatus = blockingLabels?.length ? ` 依赖[${escapeHtml(blockingLabels.join("、"))}]` : "";
    const openTag = opensConversation
      ? `<button class="member member-conversation-link" type="button" data-action="openSubtaskConversation" data-subtask-id="${escapeAttribute(participant.id)}" title="在 AI 对话面板打开此子任务" aria-label="${escapeAttribute(participant.title)}：在 AI 对话面板打开此子任务">`
      : anchor
      ? `<button class="member member-acceptance-link" type="button" data-action="jumpToAcceptance" data-acceptance-target="${escapeAttribute(anchor)}" title="定位到最近一次验收结果" aria-label="${escapeAttribute(participant.title)}：查看最近一次验收结果">`
      : '<div class="member">';
    const cancelButton = participant.role === "subtask" && ["running", "blocked", "error", "failed"].includes(participant.status) && !state.department && !state.loopPlus
      ? `<button class="button" type="button" data-action="cancelSubtask" data-subtask-id="${escapeAttribute(participant.id)}" title="取消子任务" aria-label="取消${escapeAttribute(participant.title)}">取消</button>` : "";
    return `<div class="roster-member-row">${openTag}
    <span class="avatar">${escapeHtml(getAvatarLabel(participant.title, participant.id))}</span>
    <div>
      <div class="member-name">${escapeHtml(participant.title)}</div>
      <div class="member-meta">${renderParticipantStatus(state, participant.status, strings)}${dependencyStatus}</div>
      ${renderMemberLastStarted(memberLastStartedAt(participant), strings)}
    </div>
  ${opensConversation || anchor ? "</button>" : "</div>"}${cancelButton}</div>`;
  }).join("");
  return `<section class="panel">
    <h2>${escapeHtml(strings.participants)}</h2>
    <div class="roster">${participants}</div>
  </section>`;
}

/** Navigation availability comes from an actual task ID, never a module title or CLI session. */
function renderDepartmentNavigation(taskId: string | undefined, label: string, key: string, title = ""): string {
  const available = Boolean(taskId?.trim());
  const description = available ? label : `${label}：群聊尚未创建`;
  return `<button class="button department-navigation" type="button" data-action="openDepartmentTask" data-department-nav-key="${escapeAttribute(key)}" data-department-title="${escapeAttribute(title)}" data-department-task-id="${escapeAttribute(available ? taskId! : "")}" title="${escapeAttribute(description)}" aria-label="${escapeAttribute(description)}"${available ? "" : " disabled"}>${escapeHtml(label)}</button>${available ? "" : '<div class="member-meta">群聊尚未创建</div>'}`;
}

function renderDepartmentRosterPanel(
  state: LoopGroupChatPanelState,
  strings: LoopGroupChatPanelStrings,
  acceptanceAnchors: ReadonlyMap<string, string>,
): string {
  const department = state.department!;
  const member = (participant: LoopGroupChatPanelParticipant, role: DepartmentRole, leaderCode = "", navigation = "", anchor?: string, progressPercent?: number): string => {
    const label = formatDepartmentMemberTitle(role, participant.title, leaderCode, participant.employeeName);
    const avatarLabel = { director: "总", leader: "组", employee: "员" }[role];
    const progress = progressPercent === undefined ? "" : `&nbsp;<span class="department-leader-progress">${escapeHtml(String(progressPercent))}%</span>`;
    const content = `<span class="avatar">${avatarLabel}</span><div>
      <div class="member-name" title="${escapeAttribute(label)}">${escapeHtml(label)}</div>
      <div class="member-meta">${renderParticipantStatus(state, participant.status, strings)}${progress}</div>
      ${renderMemberLastStarted(memberLastStartedAt(participant), strings)}${navigation}</div>`;
    return anchor
      ? `<button class="member member-acceptance-link" type="button" data-action="jumpToAcceptance" data-acceptance-target="${escapeAttribute(anchor)}" title="定位到最近一次验收结果" aria-label="${escapeAttribute(label)}：查看最近一次验收结果">${content}</button>`
      : `<div class="member">${content}</div>`;
  };
  const visibleLeaders = department.role === "leader"
    ? department.leaders.filter((leader) => Boolean(state.task.id) && leader.taskId === state.task.id)
    : department.leaders;
  const leaders = visibleLeaders.map((leader) => {
    const leaderCode = getDepartmentLeaderCode(leader.leaderNumber, department.maxLeaders);
    const leaderChatTitle = formatDepartmentLeaderLabel(leaderCode);
    const navigation = department.role === "director"
      ? renderDepartmentNavigation(leader.taskId, "打开组长群聊", `leader:${leader.taskId || leader.participant.id}`, leaderChatTitle)
      : "";
    const allocationSummary = department.role === "leader" ? renderDepartmentEmployeeAllocationSummary(department, leader.taskId, escapeHtml) : "";
    const employees = leader.employees.map((employee) => `<li>${member(employee, "employee", "", "",
      department.role === "leader" && state.loopPlus ? acceptanceAnchors.get(employee.subtaskId ?? employee.id) : undefined)}</li>`).join("");
    const employeeStatusCounts = department.role === "director" ? [
      ["运行中", leader.employees.filter((employee) => employee.status === "running").length],
      ["验收中", leader.employees.filter((employee) => employee.status === "reviewing").length],
      ["待验收", leader.employees.filter((employee) => employee.status === "queued_review").length],
    ].map(([label, count]) => `<span class="department-status-tag">${label} ${count}</span>`).join("") : "";
    const progressPercent = department.role === "director" && leader.taskId ? leader.progressPercent : undefined;
    return `<li class="department-group" data-department-leader-task-id="${escapeAttribute(leader.taskId)}">
      <div class="department-group-header">
        ${member(leader.participant, "leader", leaderCode, navigation + allocationSummary, undefined, progressPercent)}
      </div>
      ${department.role === "director" ? `<div class="department-status-summary" aria-label="${leaderChatTitle}员工状态汇总">${employeeStatusCounts}</div>`
        : `<ul class="department-employees" aria-label="${escapeAttribute(`${leaderChatTitle} · ${leader.participant.title}的员工`)}">${employees || '<li class="member-meta department-empty">尚未分配员工</li>'}</ul>`}
    </li>`;
  }).join("");
  const departmentTree = department.role === "director"
    ? `<li>${member(department.director, "director")}
      <ul class="department-leaders" aria-label="组长">${leaders || '<li class="member-meta department-empty">尚未分配组长</li>'}</ul>
    </li>`
    : leaders || '<li class="member-meta department-empty">尚未分配组长</li>';
  return `<section class="panel department-roster" aria-label="部门成员">
    <h2>${escapeHtml(strings.participants)}</h2>
    ${department.role === "leader" ? renderDepartmentNavigation(department.rootTaskId, "返回总监群聊", `director:${department.rootTaskId}`) : ""}
    <p class="member-meta department-occupancy">组长 ${escapeHtml(department.activeLeaders === null ? "未知" : String(department.activeLeaders))}/${escapeHtml(String(department.maxLeaders))} · 员工 ${escapeHtml(department.activeEmployees === null ? "未知" : String(department.activeEmployees))}/${escapeHtml(String(department.maxEmployees))}（全部门共享）</p>
    <ul class="roster department-tree">${departmentTree}</ul>
  </section>`;
}

function collectRosterParticipants(
  rounds: readonly LoopGroupChatPanelRound[],
): LoopGroupChatPanelParticipant[] {
  const participantsByKey = new Map<string, LoopGroupChatPanelParticipant>();
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

function memberLastStartedAt(participant: LoopGroupChatPanelParticipant): number | undefined {
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
  strings: LoopGroupChatPanelStrings,
): string {
  const formatted = formatTimestamp(startedAt);
  return `<div class="member-meta" data-member-last-started="${escapeAttribute(formatted)}">${escapeHtml(strings.lastStarted)}：${escapeHtml(formatted || strings.notStarted)}</div>`;
}

function renderTimeline(
  state: LoopGroupChatPanelState,
  segments: LoopGroupChatSegment[],
  strings: LoopGroupChatPanelStrings,
  bubbleWindow?: LoopGroupChatBubbleWindow,
  acceptanceAnchors: ReadonlyMap<number, string> = new Map(),
): string {
  const initialPromptBubble = renderInitialTaskPromptBubble(state.task.rootPrompt, strings);
  if (state.error) {
    return `<div class="timeline">${initialPromptBubble}<div class="notice">${escapeHtml(strings.loadingError)} ${escapeHtml(state.error)}</div></div>`;
  }
  if (state.rounds.length === 0) {
    return `<div class="timeline">${initialPromptBubble}<div class="notice">${escapeHtml(strings.noRounds)}</div></div>`;
  }
  const bubbles: Array<{ render: () => string; preserve?: boolean }> = initialPromptBubble
    ? [{ render: () => initialPromptBubble, preserve: true }]
    : [];
  const thinkingBubbles: typeof bubbles = getThinkingSpeakers(state).map((speaker) => ({ render: () => renderThinkingBubble(speaker, strings) }));
  if (!state.chatMarkdown.trim() || segments.length === 0) {
    const retained = selectLoopGroupChatBubbles(
      [...bubbles, ...thinkingBubbles],
      state.messageLimit,
      bubbleWindow,
      (bubble) => bubble.preserve === true,
    );
    return `<div class="timeline"><div class="notice">${escapeHtml(strings.noTranscript)}</div>${retained.map((bubble) => bubble.render()).join("")}</div>`;
  }
  const timelineBubbles = bubbles.concat(segments.map((segment, index) => ({
    render: () => renderSegment(segment, strings, undefined, acceptanceAnchors.get(index)),
    preserve: segment.kind === "user-message" || acceptanceAnchors.has(index),
  })), thinkingBubbles);
  const retained = selectLoopGroupChatBubbles(timelineBubbles, state.messageLimit, bubbleWindow, (bubble) => bubble.preserve === true);
  return `<div class="timeline">${retained.map((bubble) => bubble.render()).join("")}</div>`;
}

function renderInitialTaskPromptBubble(
  rootPrompt: string,
  strings: LoopGroupChatPanelStrings,
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

type RuntimeThinkingSpeaker = LoopGroupChatPanelActiveSpeaker & {
  attemptId?: string;
};

function renderThinkingBubble(
  speaker: RuntimeThinkingSpeaker,
  strings: LoopGroupChatPanelStrings,
): string {
  const messageKind = speaker.kind === "main" ? "main-turn" : "subtask-turn";
  const layoutClass = "with-avatar";
  const tag = getThinkingTag(speaker, strings);
  const text = getThinkingText(speaker, strings);
  const avatar = `<span class="avatar">${escapeHtml(getAvatarLabel(speaker.title, speaker.id))}</span>`;
  const attemptAttribute = speaker.attemptId
    ? ` data-thinking-attempt="${escapeAttribute(speaker.attemptId)}"`
    : "";
  return `<article class="message ${messageKind} thinking ${layoutClass}" data-thinking-kind="${escapeAttribute(speaker.kind)}" data-thinking-id="${escapeAttribute(speaker.id)}"${attemptAttribute}>
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

function getThinkingSpeakers(state: LoopGroupChatPanelState): RuntimeThinkingSpeaker[] {
  if (state.loopPlus) {
    return getLoopPlusRuntimeSpeakers(state);
  }
  const speaker = getActiveSpeaker(state);
  return speaker ? [speaker] : [];
}

function getLoopPlusRuntimeSpeakers(state: LoopGroupChatPanelState): RuntimeThinkingSpeaker[] {
  const projection = state.loopPlus;
  if (!projection?.ok || projection.activity === "completed") {
    return [];
  }
  const speakers: RuntimeThinkingSpeaker[] = [];
  for (const item of projection.running) {
    if (item.interrupted) {
      continue;
    }
    const id = item.subtaskId.trim();
    if (!id) {
      continue;
    }
    const attemptId = item.attemptId.trim();
    speakers.push({
      kind: "subtask",
      id,
      title: loopPlusRunningTitle(state, item),
      ...(attemptId ? { attemptId } : {}),
    });
  }
  if (projection.activity === "running" || projection.activity === "reviewing" || projection.activity === "decomposing") {
    speakers.push({
      kind: "main",
      id: "main",
      title: loopPlusMainTitle(state),
    });
  }
  return speakers;
}

function loopPlusRunningTitle(
  state: LoopGroupChatPanelState,
  item: Extract<LoopPlusPanelProjection, { ok: true }>["running"][number],
): string {
  const label = loopPlusSubtaskLabel(state, item.subtaskId);
  if (label && label !== item.subtaskId) {
    return label;
  }
  const snapshotTitle = item.title?.trim() ?? "";
  return snapshotTitle || label || item.subtaskId;
}

function loopPlusMainTitle(state: LoopGroupChatPanelState): string {
  for (let index = state.rounds.length - 1; index >= 0; index -= 1) {
    const main = state.rounds[index]?.participants.find((participant) => (
      participant.role === "main" || participant.id === "main"
    ));
    const title = main?.title.trim();
    if (title) {
      return title;
    }
  }
  return "主任务";
}

function getActiveSpeaker(state: LoopGroupChatPanelState): LoopGroupChatPanelActiveSpeaker | null {
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
  round: LoopGroupChatPanelRound,
): LoopGroupChatPanelActiveSpeaker | null {
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
    : "subtask";
  return {
    kind,
    id: runningParticipant.id,
    title: runningParticipant.title,
    updatedAt: runningParticipant.updatedAt,
  };
}

function getThinkingTag(speaker: LoopGroupChatPanelActiveSpeaker, strings: LoopGroupChatPanelStrings): string {
  return speaker.kind === "main" ? strings.mainTask : strings.subtask;
}

function getThinkingText(speaker: LoopGroupChatPanelActiveSpeaker, strings: LoopGroupChatPanelStrings): string {
  return formatTemplate(strings.thinking, { speaker: speaker.title });
}

function renderSegment(
  segment: LoopGroupChatSegment,
  strings: LoopGroupChatPanelStrings,
  tagOverride?: string,
  acceptanceAnchor?: string,
): string {
  const speaker = getSegmentSpeaker(segment, strings);
  const tag = tagOverride ?? getSegmentTag(segment, strings);
  const hasAvatar = segment.kind === "main-turn"
    || segment.kind === "subtask-joined"
    || segment.kind === "subtask-turn"
    || segment.kind === "error";
  const avatar = hasAvatar
    ? `<span class="avatar">${escapeHtml(getAvatarLabel(speaker, segment.actorId ?? ""))}</span>`
    : "";
  const layoutClass = hasAvatar ? "with-avatar" : "no-avatar";
  const anchorAttributes = acceptanceAnchor ? ` id="${escapeAttribute(acceptanceAnchor)}" tabindex="-1"` : "";
  const body = segment.heading === "验收结果" ? stripLoopGroupChatAcceptanceMetadata(segment.body) : segment.body;
  return `<article class="message ${escapeAttribute(segment.kind)} ${layoutClass}${acceptanceAnchor ? " acceptance-anchor" : ""}"${anchorAttributes}>
    ${avatar}
    <section class="bubble">
      <header class="bubble-header">
        <span class="speaker">${escapeHtml(speaker)}</span>
        <span class="tag">${escapeHtml(tag)}</span>
      </header>
      ${renderMessageBody(body, strings)}
    </section>
  </article>`;
}

function getSegmentSpeaker(segment: LoopGroupChatSegment, strings: LoopGroupChatPanelStrings): string {
  if (segment.kind === "user-message") {
    return strings.user;
  }
  if (segment.kind === "main-turn") {
    return segment.actorTitle ?? strings.mainTask;
  }
  if (segment.kind === "subtask-joined" || segment.kind === "subtask-turn") {
    return segment.actorTitle ?? segment.actorId ?? strings.subtask;
  }
  if (segment.kind === "closed" || segment.kind === "error") {
    return segment.actorTitle ?? strings.mainTask;
  }
  return segment.heading || strings.system;
}

function getSegmentTag(segment: LoopGroupChatSegment, strings: LoopGroupChatPanelStrings): string {
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
  if (segment.kind === "error") {
    return strings.stopped;
  }
  if (segment.kind === "closed") {
    return strings.transcriptClosed;
  }
  return strings.system;
}

function renderMessageBody(body: string, strings: LoopGroupChatPanelStrings): string {
  if (!body.trim()) {
    return `<pre class="message-text empty">(empty)</pre>`;
  }
  return `<div class="message-text markdown-body" data-markdown-source="${escapeAttribute(body)}">${renderLoopGroupChatMessageText(body, strings.communicationFileOpen)}</div>`;
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

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toLocaleString("zh-CN");
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

function renderGroupAcceptancePlanDialogs(): string {
  const strings = getWebviewStrings();
  return renderAcceptancePlanDialogs({
    title: strings.acceptancePlanTitle,
    close: strings.acceptancePlanClose,
    planAria: strings.acceptancePlanPlanAria,
    savePlan: strings.acceptancePlanSavePlan,
    deletePlan: strings.acceptancePlanDeletePlan,
    deleteTitle: strings.acceptancePlanDeleteTitle,
    deleteDesc: strings.acceptancePlanDeleteDesc,
    deleteConfirm: strings.acceptancePlanDeleteConfirm,
    namePlaceholder: strings.acceptancePlanNamePlaceholder,
    baselineTitle: strings.acceptancePlanBaselineTitle,
    baselineHint: strings.acceptancePlanBaselineHint,
    maintainability: strings.acceptancePlanCheckMaintainability,
    security: strings.acceptancePlanCheckSecurity,
    performance: strings.acceptancePlanCheckPerformance,
    ui: strings.acceptancePlanCheckUiAesthetics,
    other: strings.acceptancePlanOtherLabel,
    otherTextPlaceholder: strings.acceptancePlanOtherTextPlaceholder,
    cancel: strings.acceptancePlanCancel,
    confirm: strings.acceptancePlanApply,
    saveNameTitle: strings.acceptancePlanSaveNameTitle,
    saveNameDesc: strings.acceptancePlanSaveNameDesc,
    saveNameLabel: strings.acceptancePlanSaveNameLabel,
    saveNamePlaceholder: strings.acceptancePlanSaveNamePlaceholder,
    saveNameConfirm: strings.acceptancePlanSaveNameConfirm,
  });
}

function renderGroupAcceptancePlanScript(panelState: LoopGroupChatPanelState): string {
  const dictionary = Object.fromEntries(
    Object.entries(getWebviewStrings()).filter(([key]) => key.startsWith("acceptancePlan")),
  );
  return `
      const acceptancePlanStrings = ${embedJson(dictionary)};
      const state = {
        loopPlusAcceptancePlans: ${embedJson(panelState.acceptancePlans ?? [])},
        loopPlusAcceptancePlanSelection: ${embedJson(panelState.acceptancePlanSelection || "system_default")},
        taskAcceptancePlan: ${embedJson(panelState.acceptancePlan ?? null)},
        interactiveMode: "loop_plus",
      };
      function t(key) {
        return acceptancePlanStrings[key] || key;
      }
      const elements = { promptInput: { value: "", focus() {} } };
      function showToast(message) {
        const toast = document.getElementById("acceptancePlanToast");
        if (!toast) {
          return;
        }
        toast.hidden = !message;
        toast.textContent = message || "";
      }
      function getActiveConversationTabId() {
        return "group-chat";
      }
      function getConversationTabSummary() {
        return { id: "group-chat" };
      }
      function resolveDispatchInteractiveMode() {
        return "loop_plus";
      }
      function sendPromptWithAcceptancePlan(payload) {
        vscode.postMessage({
          type: "loopGroupChatChat:updateAcceptancePlan",
          plan: payload && payload.loopPlusAcceptancePlan,
        });
        return "sent";
      }
${VIEW_CONTENT_SCRIPT_ACCEPTANCE_PLAN}
      bindAcceptancePlanDialogEvents();
`;
}

function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
