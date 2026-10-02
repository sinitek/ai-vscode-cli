import type { HumanInteractionFormField } from "../humanInteraction";
import type { OrchestratorClarification } from "../orchestratorClarification";
import { renderModalActions, renderPanelDialog } from "./modalComponents";

export type OrchestratorClarificationDialogCopy = {
  requiredTemplate: string;
};

export function renderOrchestratorClarificationDialog(
  request: OrchestratorClarification | null | undefined,
  copy: OrchestratorClarificationDialogCopy,
  messageTypes: { submit: string; reject: string },
): string {
  if (!request) {
    return "";
  }
  const fields = request.formFields.map((field) => renderField(field)).join("");
  return renderPanelDialog({
    backdropId: "clarificationDialogBackdrop",
    backdropClassName: "dialog-backdrop visible",
    backdropAttributes: [
      ["aria-hidden", "false"],
      ["data-submit-type", messageTypes.submit],
      ["data-reject-type", messageTypes.reject],
      ["data-interaction-id", request.interactionId],
      ["data-required-template", copy.requiredTemplate],
    ],
    dialogClassName: "dialog clarification-dialog",
    labelledBy: "clarificationDialogTitle",
    describedBy: "clarificationDialogDescription",
    titleHtml: `<h2 id="clarificationDialogTitle" class="dialog-title">${escapeHtml(request.title)}</h2>`,
    descriptionHtml: `<p id="clarificationDialogDescription" class="dialog-description">${escapeHtml(request.instruction)}</p>`,
    bodyHtml: `<div class="dialog-body"><form id="clarificationDialogForm">${fields}</form><div id="clarificationDialogError" class="dialog-error" aria-live="polite"></div></div>`,
    actionsHtml: renderModalActions(
      "dialog-actions",
      `<button id="clarificationDialogReject" class="button" type="button">${escapeHtml(request.cancelLabel)}</button><button id="clarificationDialogSubmit" class="button primary" type="button">${escapeHtml(request.submitLabel)}</button>`,
    ),
  });
}

export function orchestratorClarificationDialogScript(): string {
  return `
      function bindOrchestratorClarificationDialog() {
        const backdrop = document.getElementById("clarificationDialogBackdrop");
        const form = document.getElementById("clarificationDialogForm");
        if (!backdrop || !form) {
          return;
        }
        const error = document.getElementById("clarificationDialogError");
        const submitButton = document.getElementById("clarificationDialogSubmit");
        const rejectButton = document.getElementById("clarificationDialogReject");
        const submitType = backdrop.getAttribute("data-submit-type");
        const rejectType = backdrop.getAttribute("data-reject-type");
        const interactionId = backdrop.getAttribute("data-interaction-id");
        const requiredTemplate = backdrop.getAttribute("data-required-template") || "{label}";
        function setError(message) {
          if (error) {
            error.textContent = message || "";
          }
        }
        function isEmpty(value) {
          if (Array.isArray(value)) {
            return value.length === 0;
          }
          if (typeof value === "boolean") {
            return value !== true;
          }
          return !String(value || "").trim();
        }
        function collect() {
          const values = {};
          const controls = Array.from(form.querySelectorAll("[data-clarify-field]"));
          const ids = [];
          controls.forEach((control) => {
            const id = control.getAttribute("data-clarify-field");
            if (id && ids.indexOf(id) < 0) {
              ids.push(id);
            }
          });
          ids.forEach((id) => {
            const group = controls.filter((control) => control.getAttribute("data-clarify-field") === id);
            const kind = group[0] ? group[0].getAttribute("data-clarify-kind") : "";
            if (kind === "checkbox-boolean") {
              values[id] = Boolean(group[0] && group[0].checked);
              return;
            }
            if (kind === "multiselect") {
              const control = group[0];
              values[id] = control && control.selectedOptions
                ? Array.from(control.selectedOptions).map((option) => option.value)
                : [];
              return;
            }
            if (kind === "checkbox") {
              values[id] = group.filter((control) => control.checked).map((control) => control.value);
              return;
            }
            if (kind === "radio") {
              const checked = group.find((control) => control.checked);
              values[id] = checked ? checked.value : "";
              return;
            }
            values[id] = group[0] ? group[0].value : "";
          });
          return values;
        }
        function missingLabel(values) {
          const required = Array.from(form.querySelectorAll("[data-clarify-required='true']"));
          const seen = {};
          for (let index = 0; index < required.length; index += 1) {
            const control = required[index];
            const id = control.getAttribute("data-clarify-field");
            if (!id || seen[id]) {
              continue;
            }
            seen[id] = true;
            if (isEmpty(values[id])) {
              return control.getAttribute("data-clarify-label") || id;
            }
          }
          return "";
        }
        function lock() {
          if (submitButton) {
            submitButton.disabled = true;
          }
          if (rejectButton) {
            rejectButton.disabled = true;
          }
        }
        if (submitButton) {
          submitButton.addEventListener("click", () => {
            const values = collect();
            const label = missingLabel(values);
            if (label) {
              setError(requiredTemplate.replace("{label}", label));
              return;
            }
            lock();
            vscode.postMessage({ type: submitType, interactionId, values });
          });
        }
        if (rejectButton) {
          rejectButton.addEventListener("click", () => {
            lock();
            vscode.postMessage({ type: rejectType, interactionId });
          });
        }
        const first = form.querySelector("[data-clarify-field]");
        if (first && typeof first.focus === "function") {
          first.focus();
        }
      }
      bindOrchestratorClarificationDialog();
`;
}

function renderField(field: HumanInteractionFormField): string {
  const required = field.required !== false;
  const label = `${field.label}${required ? " *" : ""}`;
  const description = field.description
    ? `<div class="clarification-description">${escapeHtml(field.description)}</div>`
    : "";
  return `<div class="clarification-field">
    <label class="dialog-label">${escapeHtml(label)}</label>
    ${description}
    ${renderControl(field, required)}
  </div>`;
}

function renderControl(field: HumanInteractionFormField, required: boolean): string {
  const shared = `data-clarify-field="${escapeAttribute(field.id)}" data-clarify-label="${escapeAttribute(field.label)}" data-clarify-required="${required ? "true" : "false"}"`;
  if (field.type === "textarea") {
    return `<textarea class="dialog-textarea clarification-input" ${shared} data-clarify-kind="text" placeholder="${escapeAttribute(field.placeholder ?? "")}">${escapeHtml(defaultText(field))}</textarea>`;
  }
  if (field.type === "radio") {
    return `<div class="clarification-options">${(field.options ?? []).map((option) => `<label class="clarification-option"><input type="radio" ${shared} data-clarify-kind="radio" name="clarify-${escapeAttribute(field.id)}" value="${escapeAttribute(option.value)}"${defaultText(field) === option.value ? " checked" : ""} /><span>${escapeHtml(option.label)}${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></label>`).join("")}</div>`;
  }
  if (field.type === "checkbox" && field.options && field.options.length > 0) {
    const defaults = new Set(defaultList(field));
    return `<div class="clarification-options">${field.options.map((option) => `<label class="clarification-option"><input type="checkbox" ${shared} data-clarify-kind="checkbox" value="${escapeAttribute(option.value)}"${defaults.has(option.value) ? " checked" : ""} /><span>${escapeHtml(option.label)}</span></label>`).join("")}</div>`;
  }
  if (field.type === "checkbox") {
    const checked = field.defaultValue === true || field.defaultValue === "true";
    return `<label class="clarification-option"><input type="checkbox" ${shared} data-clarify-kind="checkbox-boolean"${checked ? " checked" : ""} /><span>${escapeHtml(field.placeholder || field.label)}</span></label>`;
  }
  if (field.type === "select" || field.type === "multiselect") {
    const multiple = field.type === "multiselect";
    const defaults = new Set(multiple ? defaultList(field) : [defaultText(field)]);
    const options = (field.options ?? []).map((option) => `<option value="${escapeAttribute(option.value)}"${defaults.has(option.value) ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
    return `<select class="clarification-input" ${shared} data-clarify-kind="${multiple ? "multiselect" : "select"}"${multiple ? " multiple" : ""}>${options}</select>`;
  }
  const inputType = field.type === "password" ? "password" : "text";
  return `<input class="clarification-input" type="${inputType}" ${shared} data-clarify-kind="text" value="${escapeAttribute(defaultText(field))}" placeholder="${escapeAttribute(field.placeholder ?? "")}" />`;
}

function defaultText(field: HumanInteractionFormField): string {
  return typeof field.defaultValue === "string" ? field.defaultValue : "";
}

function defaultList(field: HumanInteractionFormField): string[] {
  if (Array.isArray(field.defaultValue)) {
    return field.defaultValue.filter((item): item is string => typeof item === "string");
  }
  return typeof field.defaultValue === "string" && field.defaultValue ? [field.defaultValue] : [];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
