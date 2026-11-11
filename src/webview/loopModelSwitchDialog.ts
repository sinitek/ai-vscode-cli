import type { LoopModelSwitchState } from "../loopModelSwitch";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderLoopModelSwitchFields(state?: LoopModelSwitchState): string {
  return `<div id="modelSwitchFields" data-error="${escapeHtml(state?.error ?? "")}">${(state?.fields ?? []).map((field) => {
    const available = field.options.some((option) => option.value === field.model);
    return `<div class="model-switch-field"><label class="dialog-label" for="modelSwitch-${field.role}">${escapeHtml(field.label)} · ${escapeHtml(field.cli)}</label><select id="modelSwitch-${field.role}" class="model-switch-select" data-model-role="${field.role}" data-config-id="${escapeHtml(field.configId ?? "")}" aria-required="true">${available ? "" : '<option value="" disabled selected>请选择模型</option>'}${field.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === field.model ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></div>`;
  }).join("")}</div>`;
}

export const LOOP_MODEL_SWITCH_SCRIPT = `
      (() => {
        const backdrop = document.getElementById("modelSwitchBackdrop");
        const confirm = document.getElementById("modelSwitchConfirm");
        const error = document.getElementById("modelSwitchError");
        let pending = false;
        let generation = PANEL_GENERATION;
        let opener = null;
        function close() {
          if (pending) return;
          backdrop.classList.remove("visible");
          backdrop.setAttribute("aria-hidden", "true");
          if (opener && opener.isConnected) opener.focus();
          else document.querySelector('[data-action="switchModels"]')?.focus();
        }
        function updateError() {
          const fields = document.getElementById("modelSwitchFields");
          error.textContent = fields.dataset.error || "";
          confirm.disabled = pending || !!fields.dataset.error;
          fields.querySelectorAll("select").forEach((select) => { select.disabled = pending; });
        }
        document.addEventListener("click", (event) => {
          const button = event.target.closest('[data-action="switchModels"]');
          if (!button || button.disabled) return;
          opener = button;
          updateError();
          backdrop.classList.add("visible");
          backdrop.setAttribute("aria-hidden", "false");
          document.querySelector("#modelSwitchFields select")?.focus();
          vscode.postMessage({ type: "loopGroupChatChat:refresh" });
        });
        document.getElementById("modelSwitchCancel").addEventListener("click", close);
        backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
        backdrop.addEventListener("keydown", (event) => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
          if (event.key === "Tab") {
            const controls = Array.from(backdrop.querySelectorAll("select, button")).filter((control) => !control.disabled);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        });
        confirm.addEventListener("click", () => {
          if (pending) return;
          const models = {};
          for (const select of document.querySelectorAll("#modelSwitchFields select")) {
            if (!select.selectedOptions.length || select.selectedOptions[0].disabled) {
              error.textContent = "请为每个角色选择当前配置中的模型。";
              select.focus();
              return;
            }
            models[select.dataset.modelRole] = select.value;
          }
          pending = true;
          document.querySelectorAll("#modelSwitchFields select").forEach((select) => { select.disabled = true; });
          confirm.disabled = true;
          confirm.textContent = "提交中…";
          error.textContent = "";
          vscode.postMessage({ type: "loopGroupChatChat:switchModels", models });
        });
        window.addEventListener("message", (event) => {
          const message = event.data;
          if (message?.type === "loopGroupChatChat:switchModelsSettled") {
            pending = false;
            confirm.textContent = "提交";
            confirm.disabled = false;
            document.querySelectorAll("#modelSwitchFields select").forEach((select) => { select.disabled = false; });
            if (message.ok) close();
            else error.textContent = message.error || "切换失败，请重试。";
          }
          if (message?.type !== "loopGroupChatChat:contentPatch" || typeof message.modelSwitchHtml !== "string") return;
          if (typeof message.generation !== "number" || message.generation < generation) return;
          generation = message.generation;
          const current = document.getElementById("modelSwitchFields");
          const holder = document.createElement("div");
          holder.innerHTML = message.modelSwitchHtml;
          const next = holder.firstElementChild;
          if (!current || !next) return;
          const focusedRole = document.activeElement?.dataset.modelRole;
          if (backdrop.classList.contains("visible")) {
            current.querySelectorAll("select").forEach((select) => {
              const replacement = next.querySelector('[data-model-role="' + select.dataset.modelRole + '"]');
              if (replacement && replacement.dataset.configId === select.dataset.configId
                && Array.from(replacement.options).some((option) => !option.disabled && option.value === select.value)) {
                replacement.value = select.value;
              }
            });
          }
          current.replaceWith(next);
          updateError();
          if (focusedRole) next.querySelector('[data-model-role="' + focusedRole + '"]')?.focus();
        });
      })();
`;
