import * as vscode from "vscode";
import { resolveLocale, type AppLocale } from "../i18n";
import { parseLobsterDebateChatTranscript, type LobsterDebateChatSegment } from "../lobsterDebate";

export type LobsterDebateChatPanelParticipant = {
  id: string;
  title: string;
  role: string;
  status: string;
  stance?: string;
  sessionId?: string | null;
  summary?: string;
  updatedAt?: number;
};

export type LobsterDebateChatPanelModeratorDecision = {
  dialogueTurn: number;
  action: string;
  reason: string;
  sessionId?: string | null;
  updatedAt?: number;
};

export type LobsterDebateChatPanelActiveSpeaker = {
  kind: "main" | "subtask" | "participant" | "moderator" | "consensus";
  id: string;
  title: string;
  dialogueTurn?: number;
  finalPass?: boolean;
  updatedAt?: number;
};

export type LobsterDebateChatPanelRound = {
  key: string;
  kind?: "debate" | "execution";
  label?: string;
  lobsterRound: number;
  debateRound: number;
  status: string;
  chatFile?: string;
  participantRosterSessionId?: string | null;
  dialogueTurns?: number;
  activeSpeaker?: LobsterDebateChatPanelActiveSpeaker;
  startedAt: number;
  completedAt?: number;
  participants: LobsterDebateChatPanelParticipant[];
  moderatorDecisions: LobsterDebateChatPanelModeratorDecision[];
  consensusSummary?: string;
  consensusReached?: boolean;
  openDisagreementCount?: number;
};

export type LobsterDebateChatPanelState = {
  mode: "main_sub" | "debate";
  task: {
    id: string;
    cli: string;
    status: string;
    rootPrompt: string;
    taskStoreFile: string;
	    mainCommunicationFile: string;
	    currentRound: number;
	    updatedAt: number;
	    canContinue: boolean;
	    canStop: boolean;
	  };
  rounds: LobsterDebateChatPanelRound[];
  chatMarkdown: string;
  error?: string | null;
};

export type LobsterDebateChatPanelMessage =
  | { type: "lobsterDebateChat:refresh" }
  | { type: "lobsterDebateChat:continueTask"; prompt?: string }
  | { type: "lobsterDebateChat:stopTask" }
  | { type: "lobsterDebateChat:openChatFile" }
  | { type: "lobsterDebateChat:openTaskFile" };

type LobsterDebateChatPanelHandlers = {
  onMessage: (message: LobsterDebateChatPanelMessage) => void;
  onDispose?: () => void;
};

const STRINGS = {
  en: {
    title: "Lobster Group Chat",
    subtitle: "Simulated group chat",
    debateSubtitle: "Red/Blue debate group chat",
    mainSubSubtitle: "Main/subtask group chat",
    executionRound: "Task execution chat",
    continueTask: "Continue",
    continueTaskTitle: "Ask the main task or judge to decide whether to continue",
    continuePromptDefault: "continue",
    continueDialogTitle: "Continue Lobster task",
    continueDialogDescription: "Confirm the message to send to the main task or judge. You can edit or add context before continuing.",
    continuePromptLabel: "Message",
    continuePromptRequired: "Enter a message before continuing.",
    continueConfirm: "Confirm",
    continueCancel: "Cancel",
    stopTask: "Stop",
    stopTaskTitle: "Stop all running tasks for this Lobster group chat",
    refresh: "Refresh",
    openTranscript: "Open transcript",
    openTask: "Open task record",
    task: "Task",
    status: "Status",
    cli: "CLI",
    currentRound: "Current round",
    updatedAt: "Updated",
    participants: "Red/Blue members",
    mainTask: "Main task",
    subtask: "Subtask",
    session: "Session",
    noSession: "No session",
    moderator: "Judge moderator",
    consensus: "Consensus",
    openDisagreements: "Open disagreements",
    noRounds: "No chat records yet.",
    noTranscript: "No transcript is available yet.",
    loadingError: "Unable to load transcript.",
    roundLabel: "Round {round}",
    debateRoundLabel: "Debate {round}",
	    turnLabel: "Turn {turn}",
	    finalStance: "Final stance",
	    system: "System",
    transcriptClosed: "Closed",
    transcriptOpen: "In progress",
    stopped: "Stopped",
    startedAt: "Started",
	    completedAt: "Completed",
	    thinking: "{speaker} is thinking",
	    finalStanceThinking: "{speaker} is preparing a final stance",
	    consensusThinking: "Consensus summarizer is thinking",
	    thinkingTag: "Thinking",
	    scrollToBottomAria: "Jump to latest message",
	  },
  "zh-CN": {
    title: "龙虾群聊",
    subtitle: "模拟群聊",
    debateSubtitle: "红蓝辩论群聊",
    mainSubSubtitle: "主从群聊",
    executionRound: "任务执行群聊",
    continueTask: "继续执行",
    continueTaskTitle: "让主任务或裁判主持人判断是否继续执行",
    continuePromptDefault: "继续",
    continueDialogTitle: "继续龙虾任务",
    continueDialogDescription: "确认后会把这段内容发给主任务或裁判主持人继续判断，可先修改或补充说明。",
    continuePromptLabel: "消息内容",
    continuePromptRequired: "请输入继续消息。",
    continueConfirm: "确认",
    continueCancel: "取消",
    stopTask: "中止",
    stopTaskTitle: "中止这个龙虾群聊关联的所有运行任务",
    refresh: "刷新",
    openTranscript: "打开 transcript",
    openTask: "打开任务记录",
    task: "任务",
    status: "状态",
    cli: "CLI",
    currentRound: "当前轮次",
    updatedAt: "更新时间",
    participants: "红蓝成员",
    mainTask: "主任务",
    subtask: "子任务",
    session: "会话",
    noSession: "无会话",
    moderator: "裁判主持人",
    consensus: "共识",
    openDisagreements: "未解决分歧",
    noRounds: "暂无群聊记录。",
    noTranscript: "当前暂无群聊 transcript。",
    loadingError: "无法读取群聊 transcript。",
    roundLabel: "第 {round} 轮",
    debateRoundLabel: "辩论 {round}",
	    turnLabel: "第 {turn} 轮发言",
	    finalStance: "最终立场",
	    system: "系统",
    transcriptClosed: "已收束",
    transcriptOpen: "进行中",
    stopped: "已停止",
    startedAt: "开始",
	    completedAt: "完成",
	    thinking: "{speaker} 思考中",
	    finalStanceThinking: "{speaker} 正在整理最终立场",
	    consensusThinking: "共识汇总器思考中",
	    thinkingTag: "思考中",
	    scrollToBottomAria: "跳转到最新消息",
	  },
} as const;

type LobsterDebateChatPanelStrings = Record<keyof typeof STRINGS.en, string>;

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

function buildLobsterDebateChatPanelTitle(
  state: LobsterDebateChatPanelState,
  strings: LobsterDebateChatPanelStrings,
): string {
  const taskId = state.task.id.trim();
  if (!taskId) {
    return strings.title;
  }
  const shortTaskId = taskId.length > 12 ? taskId.slice(0, 12) : taskId;
  return `${strings.title}: ${shortTaskId}`;
}

function buildLobsterDebateChatPanelHtml(
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
      :root {
        --radius: 8px;
        --gap: 12px;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        width: 100%;
        height: 100%;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
      }
      button {
        font: inherit;
      }
      .shell {
        width: 100%;
        height: 100vh;
        display: flex;
        flex-direction: column;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--gap);
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
      }
      .title {
        min-width: 0;
      }
      .title h1 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0;
      }
      .title p {
        margin: 2px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .button {
        border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 5px 10px;
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
        cursor: pointer;
      }
      .button:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .button.primary {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      .button.primary:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .button.danger {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        color: var(--vscode-statusBarItem-errorForeground, var(--vscode-button-foreground));
        background: var(--vscode-statusBarItem-errorBackground, var(--vscode-errorForeground));
      }
      .button.danger:hover {
        background: color-mix(
          in srgb,
          var(--vscode-statusBarItem-errorBackground, var(--vscode-errorForeground)) 88%,
          var(--vscode-statusBarItem-errorForeground, var(--vscode-button-foreground)) 12%
        );
      }
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
        z-index: 20;
      }
      .dialog-backdrop.visible {
        display: flex;
      }
      .dialog {
        width: min(560px, 100%);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        box-shadow: 0 12px 30px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
        overflow: hidden;
      }
      .dialog-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .dialog-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .dialog-description {
        margin: 6px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .dialog-body {
        padding: 14px 16px 0;
      }
      .dialog-label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 600;
      }
      .dialog-textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 10px 12px;
        box-sizing: border-box;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        font: inherit;
        line-height: 1.5;
      }
      .dialog-textarea:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 0;
      }
      .dialog-error {
        min-height: 18px;
        padding-top: 8px;
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
        font-size: 12px;
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px 16px;
      }
      .layout {
        width: 100%;
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
        min-height: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }
      .sidebar {
        min-width: 0;
        border-right: 1px solid var(--vscode-widget-border);
        background: var(--vscode-sideBar-background);
        padding: 14px;
        overflow: auto;
      }
	      .main {
	        min-width: 0;
	        width: 100%;
	        position: relative;
	        overflow: auto;
	        padding: 18px;
	      }
	      .scroll-to-bottom-wrap {
	        position: sticky;
	        bottom: 16px;
	        width: 100%;
	        max-width: 960px;
	        height: 0;
	        margin: 0 auto;
	        display: flex;
	        justify-content: flex-end;
	        pointer-events: none;
	        z-index: 3;
	      }
	      .scroll-to-bottom-button {
	        width: 34px;
	        height: 34px;
	        border-radius: 999px;
	        border: 1px solid var(--vscode-button-border, var(--vscode-button-background));
	        background: var(--vscode-button-background, var(--vscode-focusBorder));
	        color: var(--vscode-button-foreground, var(--vscode-editor-background));
	        display: inline-flex;
	        align-items: center;
	        justify-content: center;
	        cursor: pointer;
	        opacity: 0;
	        transform: translateY(6px);
	        pointer-events: none;
	        transition: opacity 0.15s ease, transform 0.15s ease;
	        box-shadow: 0 1px 3px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
	      }
	      .scroll-to-bottom-button.visible {
	        opacity: 1;
	        transform: translateY(0);
	        pointer-events: auto;
	      }
	      .scroll-to-bottom-button:hover {
	        background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
	      }
	      .scroll-to-bottom-button .icon {
	        width: 14px;
	        height: 14px;
	      }
      .panel {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        padding: 12px;
        margin-bottom: 12px;
      }
      .panel h2 {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 600;
      }
      .meta-grid {
        display: grid;
        gap: 8px;
      }
      .meta-row {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 8px;
        font-size: 12px;
      }
      .meta-label {
        color: var(--vscode-descriptionForeground);
      }
      .meta-value {
        overflow-wrap: anywhere;
      }
      .roster {
        display: grid;
        gap: 8px;
      }
      .member {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
      }
      .avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--vscode-badge-foreground);
        background: var(--vscode-badge-background);
        font-size: 12px;
        font-weight: 600;
        flex: 0 0 auto;
      }
      .member-name {
        font-weight: 600;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .member-meta {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .timeline {
        width: 100%;
        max-width: 960px;
        margin: 0 auto;
        display: grid;
        gap: 12px;
      }
      .notice {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-descriptionForeground);
        padding: 14px;
      }
      .message {
        width: 100%;
        min-width: 0;
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }
      .message.no-avatar {
        grid-template-columns: minmax(0, 1fr);
      }
      .bubble {
        min-width: 0;
        width: 100%;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius);
        background: var(--vscode-editorWidget-background);
        overflow: hidden;
      }
      .message.moderator-turn .bubble,
      .message.main-turn .bubble,
      .message.closed .bubble,
      .message.forced-finalize .bubble {
        border-color: var(--vscode-focusBorder);
        background: var(--vscode-peekViewResult-background, var(--vscode-editorWidget-background));
      }
      .message.subtask-joined .bubble {
        background: var(--vscode-sideBar-background);
      }
      .message.final-stance .bubble {
        border-color: var(--vscode-charts-green, var(--vscode-focusBorder));
      }
      .message.error .bubble {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background));
      }
      .message.error .bubble-header {
        color: var(--vscode-errorForeground);
      }
      .message.system .bubble,
      .message.task-event .bubble,
      .message.rules .bubble {
        background: var(--vscode-sideBar-background);
      }
      .bubble-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .speaker {
        font-weight: 600;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .tag {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        white-space: nowrap;
      }
	      .message-text {
	        min-width: 0;
	        margin: 0;
	        padding: 10px;
	        white-space: pre-wrap;
	        word-break: break-word;
	        overflow-wrap: anywhere;
	        font-family: var(--vscode-font-family);
	      }
	      .thinking-text {
	        display: flex;
	        align-items: center;
	        gap: 6px;
	        color: var(--vscode-descriptionForeground);
	      }
	      .typing-dots {
	        display: inline-flex;
	        align-items: center;
	        gap: 3px;
	      }
	      .typing-dots span {
	        width: 4px;
	        height: 4px;
	        border-radius: 50%;
	        background: currentColor;
	        animation: typingPulse 1.2s ease-in-out infinite;
	      }
	      .typing-dots span:nth-child(2) {
	        animation-delay: 0.16s;
	      }
	      .typing-dots span:nth-child(3) {
	        animation-delay: 0.32s;
	      }
	      @keyframes typingPulse {
	        0%,
	        80%,
	        100% {
	          opacity: 0.35;
	          transform: translateY(0);
	        }
	        40% {
	          opacity: 1;
	          transform: translateY(-2px);
	        }
	      }
	      .empty {
	        color: var(--vscode-descriptionForeground);
	        font-style: italic;
	      }
      @media (max-width: 780px) {
        .topbar {
          align-items: stretch;
          flex-direction: column;
        }
        .actions {
          justify-content: flex-start;
        }
        .layout {
          grid-template-columns: 1fr;
        }
        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--vscode-widget-border);
          max-height: 45vh;
        }
        .main {
          padding: 12px;
        }
      }
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
          ${!state.task.canStop && state.task.canContinue ? `<button class="button primary" type="button" data-action="continueTask" title="${escapeAttribute(strings.continueTaskTitle)}">${escapeHtml(strings.continueTask)}</button>` : ""}
          <button class="button${state.task.canStop || state.task.canContinue ? "" : " primary"}" type="button" data-action="refresh">${escapeHtml(strings.refresh)}</button>
          <button class="button" type="button" data-action="openChatFile">${escapeHtml(strings.openTranscript)}</button>
          <button class="button" type="button" data-action="openTaskFile">${escapeHtml(strings.openTask)}</button>
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
	      const stopTaskButton = document.querySelector('[data-action="stopTask"]');
	      const scrollToBottomWrap = document.getElementById("scrollToBottomWrap");
	      const scrollToBottomButton = document.getElementById("scrollToBottomButton");
	      let autoRefreshTimer = undefined;
	      let suppressScrollButtonUntil = 0;
	      let continueDialogOpen = false;

	      function getStoredState() {
	        return vscode.getState() || {};
	      }

	      function getStoredScrollState() {
	        const scroll = getStoredState().scroll;
	        return scroll && typeof scroll === "object" ? scroll : {};
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
	        continueDialogInput.value = "${escapeJsString(strings.continuePromptDefault)}";
	        continueDialogBackdrop.classList.add("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "false");
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
	        continueDialogBackdrop.classList.remove("visible");
	        continueDialogBackdrop.setAttribute("aria-hidden", "true");
	        setContinueDialogError("");
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
	        if (action === "refresh") {
	          requestRefresh();
	          return;
	        }
	        if (action === "continueTask") {
	          saveScrollState();
	          openContinueDialog();
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
	        if (action === "openChatFile") {
	          vscode.postMessage({ type: "lobsterDebateChat:openChatFile" });
	          return;
	        }
	        if (action === "openTaskFile") {
	          vscode.postMessage({ type: "lobsterDebateChat:openTaskFile" });
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
	          submitContinueDialog();
	        });
	      }
	      if (continueDialogInput) {
	        continueDialogInput.addEventListener("keydown", (event) => {
	          if (event.key === "Escape") {
	            event.preventDefault();
	            closeContinueDialog();
	          }
	          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
	            event.preventDefault();
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
	        if (autoRefreshTimer !== undefined) {
	          window.clearInterval(autoRefreshTimer);
	        }
	      });
	      window.requestAnimationFrame(() => {
	        restoreScrollState();
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
  if (state.error) {
    return `<div class="timeline"><div class="notice">${escapeHtml(strings.loadingError)} ${escapeHtml(state.error)}</div></div>`;
  }
  if (state.rounds.length === 0) {
    return `<div class="timeline"><div class="notice">${escapeHtml(strings.noRounds)}</div></div>`;
  }
  const thinkingBubble = renderThinkingBubble(state, strings);
  if (!state.chatMarkdown.trim() || segments.length === 0) {
    return `<div class="timeline"><div class="notice">${escapeHtml(strings.noTranscript)}</div>${thinkingBubble}</div>`;
  }
  return `<div class="timeline">${segments.map((segment) => renderSegment(segment, strings)).join("")}${thinkingBubble}</div>`;
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

function renderSegment(segment: LobsterDebateChatSegment, strings: LobsterDebateChatPanelStrings): string {
  const speaker = getSegmentSpeaker(segment, strings);
  const tag = getSegmentTag(segment, strings);
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

function getStrings(locale: AppLocale): LobsterDebateChatPanelStrings {
  return locale === "zh-CN" ? STRINGS["zh-CN"] : STRINGS.en;
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
