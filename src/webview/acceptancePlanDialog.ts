import { renderChatModal } from "./modalComponents";

export type AcceptancePlanDialogLabels = {
  title: string;
  close: string;
  planAria: string;
  savePlan: string;
  deletePlan: string;
  deleteTitle: string;
  deleteDesc: string;
  deleteConfirm: string;
  namePlaceholder: string;
  baselineTitle: string;
  baselineHint: string;
  maintainability: string;
  security: string;
  performance: string;
  ui: string;
  other: string;
  otherTextPlaceholder: string;
  cancel: string;
  confirm: string;
  saveNameTitle: string;
  saveNameDesc: string;
  saveNameLabel: string;
  saveNamePlaceholder: string;
  saveNameConfirm: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 主对话和 Loop 群聊共用的验收方案弹窗。确认按钮文案由调用方决定。 */
export function renderAcceptancePlanDialogs(labels: AcceptancePlanDialogLabels): string {
  const title = escapeHtml(labels.title);
  const close = escapeHtml(labels.close);
  const planAria = escapeHtml(labels.planAria);
  const savePlan = escapeHtml(labels.savePlan);
  const deletePlan = escapeHtml(labels.deletePlan);
  const deleteTitle = escapeHtml(labels.deleteTitle);
  const deleteDesc = escapeHtml(labels.deleteDesc);
  const deleteConfirm = escapeHtml(labels.deleteConfirm);
  const namePlaceholder = escapeHtml(labels.namePlaceholder);
  const baselineTitle = escapeHtml(labels.baselineTitle);
  const baselineHint = escapeHtml(labels.baselineHint);
  const maintainability = escapeHtml(labels.maintainability);
  const security = escapeHtml(labels.security);
  const performance = escapeHtml(labels.performance);
  const ui = escapeHtml(labels.ui);
  const other = escapeHtml(labels.other);
  const otherTextPlaceholder = escapeHtml(labels.otherTextPlaceholder);
  const cancel = escapeHtml(labels.cancel);
  const confirm = escapeHtml(labels.confirm);
  const saveNameTitle = escapeHtml(labels.saveNameTitle);
  const saveNameDesc = escapeHtml(labels.saveNameDesc);
  const saveNameLabel = escapeHtml(labels.saveNameLabel);
  const saveNamePlaceholder = escapeHtml(labels.saveNamePlaceholder);
  const saveNameConfirm = escapeHtml(labels.saveNameConfirm);
  return `${renderChatModal({
    id: "acceptancePlanOverlay",
    className: "acceptance-plan-modal",
    labelledBy: "acceptancePlanTitle",
    titleHtml: `<div id="acceptancePlanTitle" class="title">${title}</div>`,
    close: {
      id: "closeAcceptancePlan",
      label: close,
    },
    contentHtml: `          <div class="acceptance-plan-body">
            <div class="acceptance-plan-plan-row">
              <select id="acceptancePlanSelect" class="acceptance-plan-select" aria-label="${planAria}"></select>
              <button id="saveAcceptancePlan" type="button" class="action-button acceptance-plan-save">${savePlan}</button>
              <button id="deleteAcceptancePlan" type="button" class="secondary action-button acceptance-plan-delete" hidden>${deletePlan}</button>
            </div>
            <div id="acceptancePlanNameField" class="acceptance-plan-field" style="display: none;">
              <input id="acceptancePlanNameInput" class="acceptance-plan-input" type="text" maxlength="60" autocomplete="off" placeholder="${namePlaceholder}" aria-label="${namePlaceholder}" />
            </div>
            <div id="acceptancePlanChecks" class="acceptance-plan-checks" role="group" aria-label="${title}">
              <div class="acceptance-plan-check acceptance-plan-check-baseline">
                <input id="acceptancePlanBaselineCheck" type="checkbox" checked disabled />
                <div class="acceptance-plan-check-text">
                  <label for="acceptancePlanBaselineCheck">${baselineTitle}</label>
                  <span class="acceptance-plan-check-hint">${baselineHint}</span>
                </div>
              </div>
              <div class="acceptance-plan-check">
                <input id="acceptancePlanCheckMaintainability" type="checkbox" data-acceptance-check="maintainability" />
                <label for="acceptancePlanCheckMaintainability">${maintainability}</label>
              </div>
              <div class="acceptance-plan-check">
                <input id="acceptancePlanCheckSecurity" type="checkbox" data-acceptance-check="security" />
                <label for="acceptancePlanCheckSecurity">${security}</label>
              </div>
              <div class="acceptance-plan-check">
                <input id="acceptancePlanCheckPerformance" type="checkbox" data-acceptance-check="performance" />
                <label for="acceptancePlanCheckPerformance">${performance}</label>
              </div>
              <div class="acceptance-plan-check">
                <input id="acceptancePlanCheckUi" type="checkbox" data-acceptance-check="ui_aesthetics" />
                <label for="acceptancePlanCheckUi">${ui}</label>
              </div>
              <div class="acceptance-plan-check">
                <input id="acceptancePlanCheckOther" type="checkbox" data-acceptance-check="other" aria-controls="acceptancePlanOtherField" aria-expanded="false" />
                <label for="acceptancePlanCheckOther">${other}</label>
              </div>
            </div>
            <div id="acceptancePlanOtherField" class="acceptance-plan-field acceptance-plan-other-field" style="display: none;">
              <textarea id="acceptancePlanOtherText" class="acceptance-plan-textarea" rows="3" placeholder="${otherTextPlaceholder}" aria-label="${otherTextPlaceholder}"></textarea>
            </div>
            <div id="acceptancePlanError" class="acceptance-plan-error" role="alert" style="display: none;"></div>
            <div id="acceptancePlanToast" class="acceptance-plan-error" role="status" hidden></div>
          </div>`,
    actionsHtml: `<div class="modal-actions acceptance-plan-actions">
            <button id="cancelAcceptancePlan" type="button" class="secondary action-button">${cancel}</button>
            <button id="confirmAcceptancePlan" type="button" class="action-button">${confirm}</button>
          </div>`,
  })}

${renderChatModal({
    id: "acceptancePlanNameOverlay",
    className: "acceptance-plan-name-modal",
    labelledBy: "acceptancePlanNameTitle",
    describedBy: "acceptancePlanNameDesc",
    titleHtml: `<div id="acceptancePlanNameTitle" class="title">${saveNameTitle}</div>`,
    close: {
      id: "closeAcceptancePlanName",
      label: close,
    },
    contentHtml: `          <div class="acceptance-plan-name-body">
            <p id="acceptancePlanNameDesc" class="acceptance-plan-name-desc">${saveNameDesc}</p>
            <div class="acceptance-plan-field">
              <label for="acceptancePlanNewName">${saveNameLabel}</label>
              <input id="acceptancePlanNewName" class="acceptance-plan-input" type="text" maxlength="60" autocomplete="off" placeholder="${saveNamePlaceholder}" />
            </div>
            <div id="acceptancePlanNameError" class="acceptance-plan-error" role="alert" style="display: none;"></div>
          </div>`,
    actionsHtml: `<div class="modal-actions acceptance-plan-name-actions">
            <button id="cancelAcceptancePlanName" type="button" class="secondary action-button">${cancel}</button>
            <button id="confirmAcceptancePlanName" type="button" class="action-button">${saveNameConfirm}</button>
          </div>`,
  })}

${renderChatModal({
    id: "acceptancePlanDeleteOverlay",
    className: "acceptance-plan-name-modal",
    labelledBy: "acceptancePlanDeleteTitle",
    describedBy: "acceptancePlanDeleteDesc",
    titleHtml: `<div id="acceptancePlanDeleteTitle" class="title">${deleteTitle}</div>`,
    close: {
      id: "closeAcceptancePlanDelete",
      label: close,
    },
    contentHtml: `          <div class="acceptance-plan-name-body">
            <p id="acceptancePlanDeleteDesc" class="acceptance-plan-name-desc">${deleteDesc}</p>
          </div>`,
    actionsHtml: `<div class="modal-actions acceptance-plan-name-actions">
            <button id="cancelAcceptancePlanDelete" type="button" class="secondary action-button">${cancel}</button>
            <button id="confirmAcceptancePlanDelete" type="button" class="action-button">${deleteConfirm}</button>
          </div>`,
  })}`;
}
