export type ModalAttribute = readonly [string, string | null];

export type ModalCloseButtonOptions = {
  id: string;
  label: string;
  className?: string;
  title?: string;
  type?: string;
  extraAttributes?: readonly ModalAttribute[];
};

export type ModalHeaderOptions = {
  className: string;
  titleHtml: string;
  descriptionHtml?: string;
  closeHtml?: string;
  titleGroupClassName?: string;
  wrapTitle?: boolean;
};

export type ModalShellOptions = {
  backdropId?: string;
  backdropClassName: string;
  backdropAttributes?: readonly ModalAttribute[];
  dialogId?: string;
  dialogClassName: string;
  dialogAttributes?: readonly ModalAttribute[];
  headerHtml?: string;
  afterHeaderHtml?: string;
  bodyHtml?: string;
  actionsHtml?: string;
};

export type ChatModalCloseOptions = {
  id: string;
  label: string;
  className?: string;
  wrapperClassName?: string;
};

export type ChatModalOptions = {
  id: string;
  className: string;
  titleHtml: string;
  labelledBy?: string;
  describedBy?: string;
  close?: ChatModalCloseOptions;
  contentHtml?: string;
  actionsHtml?: string;
  extraDialogAttributes?: readonly ModalAttribute[];
};

export type PanelDialogOptions = {
  backdropId: string;
  backdropClassName?: string;
  backdropAttributes?: readonly ModalAttribute[];
  dialogId?: string;
  dialogClassName?: string;
  labelledBy?: string;
  describedBy?: string;
  extraDialogAttributes?: readonly ModalAttribute[];
  headerClassName?: string;
  titleHtml: string;
  descriptionHtml?: string;
  closeHtml?: string;
  titleGroupClassName?: string;
  wrapTitle?: boolean;
  bodyHtml?: string;
  afterHeaderHtml?: string;
  actionsHtml?: string;
};

export const DIALOG_SHELL_STYLES = `
      .overlay,
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0;
        background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
        backdrop-filter: blur(2px);
      }
      .overlay.visible,
      .dialog-backdrop.visible {
        display: flex;
        animation: modal-shell-fade-in 0.2s;
      }
      @keyframes modal-shell-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .modal,
      .dialog {
        box-sizing: border-box;
        width: min(520px, 90vw);
        max-width: 90vw;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-lg, 12px);
        background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
        color: var(--vscode-editor-foreground);
        box-shadow: 0 8px 32px color-mix(in srgb, var(--vscode-editor-foreground) 24%, transparent);
      }
      .modal-header,
      .dialog-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        flex: 0 0 auto;
        padding: 16px 16px 12px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .modal-header > .title,
      .modal-header .history-messages-title,
      .modal-heading,
      .dialog-heading {
        min-width: 0;
        flex: 1 1 auto;
      }
      .modal-header .title,
      .dialog-title {
        margin: 0;
        min-width: 0;
        flex: 1 1 auto;
        font-size: 14px;
        font-weight: 600;
      }
      .dialog-description,
      .modal-header .history-messages-subtitle {
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .modal-header > .icon-button,
      .modal-header > .session-actions,
      .dialog-header > .icon-button,
      .dialog-header > .node-detail-close-icon {
        flex: 0 0 auto;
      }
      .modal-body,
      .dialog-body {
        box-sizing: border-box;
        min-height: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: auto;
        padding: 12px 16px 16px;
      }
      .modal:has(.modal-actions, .rules-actions, .queue-footer, .run-conflict-actions, .add-model-actions, .config-error-actions, .human-interaction-actions) > .modal-body,
      .dialog:has(.dialog-actions) > .dialog-body {
        padding-bottom: 0;
      }
      .modal-actions,
      .dialog-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
        flex: 0 0 auto;
        padding: 12px 16px 16px;
      }
      .modal .icon-button,
      .dialog .icon-button {
        box-sizing: border-box;
        width: 26px;
        height: 26px;
        padding: 4px;
        border: none;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--vscode-icon-foreground, var(--vscode-foreground));
        background: transparent;
        opacity: 0.85;
        flex: 0 0 auto;
      }
      .modal .icon-button .icon,
      .dialog .icon-button .icon {
        width: 16px;
        height: 16px;
      }
      .modal .icon-button:hover,
      .dialog .icon-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
      }
      .modal .icon-button:focus-visible,
      .modal .action-button:focus-visible,
      .modal .secondary:focus-visible,
      .dialog .button:focus-visible,
      .dialog .icon-button:focus-visible,
      .dialog-textarea:focus,
      .dialog-textarea:focus-visible,
      .clarification-input:focus,
      .modal input:focus-visible,
      .modal textarea:focus-visible,
      .modal select:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }
      .modal button:disabled,
      .modal .icon-button:disabled,
      .modal .action-button:disabled,
      .dialog .button:disabled,
      .dialog .icon-button:disabled,
      .dialog-textarea:disabled,
      .modal input:disabled,
      .modal textarea:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .modal button.is-loading,
      .dialog .button.is-loading,
      .dialog .icon-button.is-loading,
      .modal .icon-button.is-loading {
        cursor: wait;
        opacity: 0.55;
        pointer-events: none;
      }
      .dialog-error,
      .scheduled-task-error,
      .add-model-error,
      .human-interaction-error {
        color: var(--vscode-errorForeground);
      }
      .scheduled-task-empty,
      .queue-empty,
      .model-manager-empty,
      .run-prompt-empty,
      .run-stream-empty,
      .history-messages-empty,
      .ask-chat-empty,
      .modal-empty,
      .dialog-empty {
        color: var(--vscode-descriptionForeground);
      }
      @media (max-width: 560px) {
        .modal,
        .dialog {
          width: 90vw;
          max-width: 90vw;
          max-height: 85vh;
        }
        .modal-actions,
        .dialog-actions,
        .rules-actions,
        .queue-footer,
        .run-conflict-actions,
        .add-model-actions,
        .config-error-actions,
        .scheduled-task-actions,
        .human-interaction-actions {
          gap: 8px;
          flex-wrap: wrap;
        }
      }
`;

export const CLARIFICATION_DIALOG_STYLES = `
      .clarification-dialog {
        width: min(640px, 90vw);
        max-height: min(85vh, 760px);
        display: flex;
        flex-direction: column;
      }
      .clarification-dialog .dialog-body {
        overflow: auto;
      }
      .clarification-field {
        margin-bottom: 12px;
      }
      .clarification-description {
        margin: -4px 0 8px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .clarification-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .clarification-option {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        color: var(--vscode-foreground);
        font-size: 13px;
      }
      .clarification-option small {
        display: block;
        color: var(--vscode-descriptionForeground);
      }
      .clarification-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 8px 10px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        font: inherit;
      }
      .clarification-input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 0;
      }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAttributes(attributes: readonly ModalAttribute[] | undefined): string {
  if (!attributes || attributes.length === 0) {
    return "";
  }
  return attributes.map(([name, value]) => (
    value === null ? name : `${name}="${escapeHtml(value)}"`
  )).join(" ");
}

function renderDiv(
  id: string | undefined,
  className: string | undefined,
  attributes: readonly ModalAttribute[] | undefined,
  html: string,
): string {
  const parts: string[] = [];
  if (id) {
    parts.push(`id="${escapeHtml(id)}"`);
  }
  if (className) {
    parts.push(`class="${escapeHtml(className)}"`);
  }
  const extra = renderAttributes(attributes);
  if (extra) {
    parts.push(extra);
  }
  return `<div${parts.length ? ` ${parts.join(" ")}` : ""}>${html}</div>`;
}

export function renderModalCloseIcon(): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>`;
}

export function renderModalCloseButton(options: ModalCloseButtonOptions): string {
  const className = options.className ?? "secondary icon-button";
  const type = options.type ?? "button";
  const label = escapeHtml(options.label);
  const title = escapeHtml(options.title ?? options.label);
  const extra = renderAttributes(options.extraAttributes);
  return `<button id="${escapeHtml(options.id)}" class="${escapeHtml(className)}" type="${escapeHtml(type)}" title="${title}" aria-label="${label}"${extra ? ` ${extra}` : ""}>${renderModalCloseIcon()}</button>`;
}

export function renderModalHeader(options: ModalHeaderOptions): string {
  const description = options.descriptionHtml ?? "";
  let heading = `${options.titleHtml}${description}`;
  if (options.wrapTitle || options.titleGroupClassName || description) {
    const classes = ["modal-heading"];
    if (options.titleGroupClassName) {
      classes.push(options.titleGroupClassName);
    }
    heading = `<div class="${escapeHtml(classes.join(" "))}">${heading}</div>`;
  }
  return `<div class="${escapeHtml(options.className)}">${heading}${options.closeHtml ?? ""}</div>`;
}

export function renderModalActions(className: string, buttonsHtml: string): string {
  return `<div class="${escapeHtml(className)}">${buttonsHtml}</div>`;
}

export function renderModalShell(options: ModalShellOptions): string {
  const inner = [
    options.headerHtml,
    options.afterHeaderHtml,
    options.bodyHtml,
    options.actionsHtml,
  ].filter((part): part is string => Boolean(part)).join("");
  const dialog = renderDiv(options.dialogId, options.dialogClassName, options.dialogAttributes, inner);
  return renderDiv(options.backdropId, options.backdropClassName, options.backdropAttributes, dialog);
}

function dialogSemantics(
  labelledBy: string | undefined,
  describedBy: string | undefined,
  extra: readonly ModalAttribute[] | undefined,
): ModalAttribute[] {
  const attributes: ModalAttribute[] = [
    ["role", "dialog"],
    ["aria-modal", "true"],
  ];
  if (labelledBy) {
    attributes.push(["aria-labelledby", labelledBy]);
  }
  if (describedBy) {
    attributes.push(["aria-describedby", describedBy]);
  }
  if (extra) {
    attributes.push(...extra);
  }
  return attributes;
}

export function renderChatModal(options: ChatModalOptions): string {
  let closeHtml = "";
  if (options.close) {
    closeHtml = renderModalCloseButton({
      id: options.close.id,
      label: options.close.label,
      className: options.close.className,
    });
    if (options.close.wrapperClassName) {
      closeHtml = `<div class="${escapeHtml(options.close.wrapperClassName)}">${closeHtml}</div>`;
    }
  }
  return renderModalShell({
    backdropId: options.id,
    backdropClassName: "overlay",
    dialogClassName: `modal ${options.className}`.trim(),
    dialogAttributes: dialogSemantics(options.labelledBy, options.describedBy, options.extraDialogAttributes),
    headerHtml: renderModalHeader({
      className: "modal-header",
      titleHtml: options.titleHtml,
      closeHtml,
    }),
    bodyHtml: options.contentHtml
      ? `<div class="modal-body">${options.contentHtml}</div>`
      : undefined,
    actionsHtml: options.actionsHtml,
  });
}

export function renderPanelDialog(options: PanelDialogOptions): string {
  return renderModalShell({
    backdropId: options.backdropId,
    backdropClassName: options.backdropClassName ?? "dialog-backdrop",
    backdropAttributes: options.backdropAttributes,
    dialogId: options.dialogId,
    dialogClassName: options.dialogClassName ?? "dialog",
    dialogAttributes: dialogSemantics(options.labelledBy, options.describedBy, options.extraDialogAttributes),
    headerHtml: renderModalHeader({
      className: options.headerClassName ?? "dialog-header",
      titleHtml: options.titleHtml,
      descriptionHtml: options.descriptionHtml,
      closeHtml: options.closeHtml,
      titleGroupClassName: options.titleGroupClassName,
      wrapTitle: options.wrapTitle,
    }),
    afterHeaderHtml: options.afterHeaderHtml,
    bodyHtml: options.bodyHtml,
    actionsHtml: options.actionsHtml,
  });
}
