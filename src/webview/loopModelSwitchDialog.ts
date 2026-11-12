import type { LoopModelSwitchState } from "../loopModelSwitch";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderLoopModelSwitchFields(state?: LoopModelSwitchState): string {
  return `<div id="modelSwitchFields" data-error="${escapeHtml(state?.error ?? "")}">${(state?.fields ?? []).map((field) => {
    const available = field.options.some((option) => option.value === field.model);
    const thinkingOptions = field.thinkingOptionsByModel?.[field.model] ?? [];
    const thinkingMode = thinkingOptions.some((option) => option.value === field.thinkingMode)
      ? field.thinkingMode : thinkingOptions.some((option) => option.value === "high") ? "high" : thinkingOptions[0]?.value;
    return `<div class="model-switch-field"><label class="dialog-label" for="modelSwitch-${field.role}">${escapeHtml(field.label)} · ${escapeHtml(field.cli)}</label><select id="modelSwitch-${field.role}" class="model-switch-select" data-model-role="${field.role}" data-config-id="${escapeHtml(field.configId ?? "")}" aria-required="true">${available ? "" : '<option value="" disabled selected>请选择模型</option>'}${field.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === field.model ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select><label class="dialog-label" for="modelSwitchThinking-${field.role}">${escapeHtml(field.label)}思考力度</label><select id="modelSwitchThinking-${field.role}" class="model-switch-select" data-thinking-role="${field.role}" data-thinking-options="${escapeHtml(JSON.stringify(field.thinkingOptionsByModel ?? {}))}"${thinkingOptions.length ? ' aria-required="true"' : ' disabled'}>${thinkingOptions.length ? thinkingOptions.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === thinkingMode ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("") : '<option value="">当前模型不支持思考力度</option>'}</select></div>`;
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
        function syncThinking(fields, role, preferred) {
          const model = fields.querySelector('[data-model-role="' + role + '"]');
          const thinking = fields.querySelector('[data-thinking-role="' + role + '"]');
          const options = JSON.parse(thinking.dataset.thinkingOptions)[model.value] || [];
          const selected = preferred || thinking.value;
          thinking.replaceChildren();
          if (!options.length) {
            thinking.add(new Option("当前模型不支持思考力度", ""));
          } else {
            options.forEach((option) => thinking.add(new Option(option.label, option.value)));
            thinking.value = options.some((option) => option.value === selected) ? selected
              : options.some((option) => option.value === "high") ? "high" : options[0].value;
          }
          thinking.disabled = pending || !options.length;
        }
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
          fields.querySelectorAll("[data-model-role]").forEach((select) => {
            select.disabled = pending;
            syncThinking(fields, select.dataset.modelRole);
          });
        }
        backdrop.addEventListener("change", (event) => {
          if (event.target.dataset.modelRole) syncThinking(document.getElementById("modelSwitchFields"), event.target.dataset.modelRole);
        });
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
          const thinkingModes = {};
          for (const select of document.querySelectorAll("#modelSwitchFields [data-model-role]")) {
            if (!select.selectedOptions.length || select.selectedOptions[0].disabled) {
              error.textContent = "请为每个角色选择当前配置中的模型。";
              select.focus();
              return;
            }
            models[select.dataset.modelRole] = select.value;
          }
          for (const select of document.querySelectorAll("#modelSwitchFields [data-thinking-role]")) {
            if (!select.disabled) thinkingModes[select.dataset.thinkingRole] = select.value;
          }
          pending = true;
          document.querySelectorAll("#modelSwitchFields select").forEach((select) => { select.disabled = true; });
          confirm.disabled = true;
          confirm.textContent = "提交中…";
          error.textContent = "";
          vscode.postMessage({ type: "loopGroupChatChat:switchModels", models, thinkingModes });
        });
        window.addEventListener("message", (event) => {
          const message = event.data;
          if (message?.type === "loopGroupChatChat:switchModelsSettled") {
            pending = false;
            confirm.textContent = "提交";
            confirm.disabled = false;
            updateError();
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
          const focusedId = document.activeElement?.id;
          if (backdrop.classList.contains("visible")) {
            current.querySelectorAll("[data-model-role]").forEach((select) => {
              const replacement = next.querySelector('[data-model-role="' + select.dataset.modelRole + '"]');
              if (replacement && replacement.dataset.configId === select.dataset.configId
                && Array.from(replacement.options).some((option) => !option.disabled && option.value === select.value)) {
                replacement.value = select.value;
                const thinking = current.querySelector('[data-thinking-role="' + select.dataset.modelRole + '"]');
                syncThinking(next, select.dataset.modelRole, thinking.value);
              }
            });
          }
          current.replaceWith(next);
          updateError();
          if (focusedId) document.getElementById(focusedId)?.focus();
        });
      })();
`;
