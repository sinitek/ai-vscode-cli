import { DEPARTMENT_EXECUTION_CLIS, DEPARTMENT_EXECUTION_CLI_REQUIREMENT } from "../../department";
// The same runtime is exercised by the DOM harness and the real Webview.
export const VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION = `
      const departmentRoleUi = { scope: "", sequence: 0, mode: "", modeGeneration: 0, rows: {}, saved: {}, director: null, workspaceScope: undefined, hostIssue: "", syncingPanelState: false, controlLocations: new Map() };
      const departmentExecutionClis = ${JSON.stringify(DEPARTMENT_EXECUTION_CLIS)};
      function departmentRoleCliIssue(role, cli) {
        if (departmentExecutionClis.includes(cli)) return "";
        return (role === "leader" ? "组长" : "员工") + "所选 CLI（" + (typeof cli === "string" ? cli : "未选择")
          + "）暂不支持。" + ${JSON.stringify(DEPARTMENT_EXECUTION_CLI_REQUIREMENT)};
      }
      function departmentRoleControl(role, field) {
        return document.getElementById("department-" + role + "-" + field);
      }
      function departmentRoleOptions(select, choices, selected, placeholder, includePlaceholder = true) {
        if (!select) return;
        select.replaceChildren();
        const items = includePlaceholder ? [{ value: "__missing__", label: placeholder }].concat(choices) : choices;
        items.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.label;
          select.appendChild(option);
        });
        select.value = items.some((item) => item.value === selected) ? selected : includePlaceholder ? "__missing__" : "";
      }
      function departmentRoleEffort(row) {
        const draft = row.draft;
        const model = draft.model === null ? row.candidates?.defaultModel || "" : draft.model;
        const isOpenCode = draft.cli === "opencode";
        const choices = (isOpenCode ? row.candidates?.variantsByModel : row.candidates?.thinkingByModel)?.[model] || [];
        const preferred = isOpenCode ? draft.openCodeVariant : draft.thinkingMode || state.thinkingModeByCli?.[draft.cli];
        const selected = choices.includes(preferred) ? preferred : choices.includes("medium") ? "medium" : choices[0] || "";
        return { choices, selected };
      }
      function createDepartmentRoleDraft(preference) {
        const draft = preference ? { ...preference } : { cli: state.currentCli, configId: null, model: undefined, thinkingMode: null, openCodeVariant: null };
        return { draft, candidates: null, loading: false, requestId: "", saving: "", error: "", dirty: false };
      }
      function currentDepartmentRoleConfigId(cli) {
        const configId = cli === departmentRoleUi.director?.cli
          ? departmentRoleUi.director?.configId
          : state.activeConfigIdByCli?.[cli];
        return typeof configId === "string" && configId.trim() ? configId.trim() : null;
      }
      function currentDepartmentRoleBindingKey(cli) {
        const configId = currentDepartmentRoleConfigId(cli);
        const configState = state.configStateByCli?.[cli] || (cli === state.currentCli ? state.configState : null);
        return JSON.stringify([cli, configId, configState?.revision || ""]);
      }
      function invalidateDepartmentRoleWork(row, message) {
        const hadSave = Boolean(row.saving);
        row.requestId = "";
        row.loading = false;
        row.candidates = null;
        row.saving = "";
        row.savingBindingKey = "";
        row.savingMode = "";
        row.requestModeGeneration = -1;
        row.savingModeGeneration = -1;
        if (hadSave) {
          row.dirty = true;
          row.error = message || "配置或模式已变化，保存结果未确认，请检查后重试。";
        }
      }
      function invalidateDepartmentRoleMode(nextMode) {
        if (nextMode === departmentRoleUi.mode) return;
        departmentRoleUi.modeGeneration++;
        departmentRoleUi.mode = nextMode;
        ["leader", "employee"].forEach((role) => {
          const row = departmentRoleUi.rows[role];
          if (row) invalidateDepartmentRoleWork(row, "模式已切换，保存结果未确认，请检查并重试。");
        });
      }
      function applyLocalInteractiveModeChange(nextMode) {
        invalidateDepartmentRoleMode(nextMode);
        state.interactiveMode = nextMode;
        renderDepartmentConfiguration();
      }
      function syncDepartmentConfigurationState(panelState) {
        const director = panelState.departmentDirector || null;
        const scope = director ? JSON.stringify([panelState.departmentConfigurationScope, director.cli, director.configId]) : "";
        departmentRoleUi.workspaceScope = panelState.departmentConfigurationScope;
        departmentRoleUi.hostIssue = panelState.departmentConfigurationIssue || "";
        const changed = scope !== departmentRoleUi.scope;
        const mode = state.interactiveMode;
        const modeChanged = Boolean(departmentRoleUi.mode && departmentRoleUi.mode !== mode);
        departmentRoleUi.scope = scope;
        departmentRoleUi.mode = mode;
        departmentRoleUi.director = director;
        departmentRoleUi.saved = panelState.departmentRolePreferences || {};
        ["leader", "employee"].forEach((role) => {
          const row = departmentRoleUi.rows[role];
          if (changed || !row) {
            const next = createDepartmentRoleDraft(departmentRoleUi.saved[role]);
            const targetConfigId = currentDepartmentRoleConfigId(next.draft.cli);
            next.bindingKey = currentDepartmentRoleBindingKey(next.draft.cli);
            if (next.draft.configId !== targetConfigId) {
              next.draft.configId = targetConfigId;
              next.draft.model = undefined; next.draft.thinkingMode = null; next.draft.openCodeVariant = null;
              next.dirty = Boolean(departmentRoleUi.saved[role]);
            }
            departmentRoleUi.rows[role] = next;
          }
          else if (row) {
            const bindingKey = currentDepartmentRoleBindingKey(row.draft.cli);
            const activeConfigId = currentDepartmentRoleConfigId(row.draft.cli);
            if (bindingKey !== row.bindingKey || activeConfigId !== row.draft.configId) {
              invalidateDepartmentRoleWork(row, "目标 CLI 配置已变化，请重新选择模型并保存。" );
              row.bindingKey = bindingKey;
              row.draft.configId = activeConfigId;
              row.draft.model = undefined; row.draft.thinkingMode = null; row.draft.openCodeVariant = null;
              row.dirty = true;
            }
            if (modeChanged) invalidateDepartmentRoleWork(row, "模式已切换，保存结果未确认，请检查并重试。" );
          }
          if (!changed && row && !row.dirty && !row.saving) {
            const draft = createDepartmentRoleDraft(departmentRoleUi.saved[role]).draft;
            const targetConfigId = currentDepartmentRoleConfigId(draft.cli);
            const bindingKey = currentDepartmentRoleBindingKey(draft.cli);
            if (targetConfigId !== draft.configId) {
              draft.configId = targetConfigId;
              draft.model = undefined; draft.thinkingMode = null; draft.openCodeVariant = null;
            }
            if (draft.cli !== row.draft.cli || bindingKey !== row.bindingKey || draft.configId !== row.draft.configId) {
              invalidateDepartmentRoleWork(row, "目标 CLI 配置已变化，请重新选择模型并保存。" );
              row.bindingKey = bindingKey;
            }
            row.draft = draft;
          }
        });
        renderDepartmentConfiguration();
      }
      function requestDepartmentRoleCandidates(role) {
        const row = departmentRoleUi.rows[role];
        if (!row || !row.draft.cli || !departmentRoleUi.scope) return;
        if (departmentRoleCliIssue(role, row.draft.cli)) {
          row.requestId = ""; row.loading = false; row.candidates = null;
          renderDepartmentRole(role); return;
        }
        row.draft.configId = currentDepartmentRoleConfigId(row.draft.cli);
        row.bindingKey = currentDepartmentRoleBindingKey(row.draft.cli);
        if (!row.draft.configId) {
          row.requestId = ""; row.candidates = null; row.loading = false;
          row.error = "";
          renderDepartmentRole(role);
          return;
        }
        row.loading = true;
        row.error = "";
        row.candidates = null;
        row.requestId = departmentRoleUi.scope + ":" + role + ":" + (++departmentRoleUi.sequence);
        row.requestModeGeneration = departmentRoleUi.modeGeneration;
        vscode.postMessage({ type: "requestDepartmentRoleCandidates", scope: departmentRoleUi.workspaceScope, role, requestId: row.requestId,
          cli: row.draft.cli, configId: row.draft.configId });
        renderDepartmentRole(role);
      }
      function applyDepartmentRoleCandidates(data) {
        const row = departmentRoleUi.rows[data.role];
        if (!row || row.requestId !== data.requestId || row.requestModeGeneration !== departmentRoleUi.modeGeneration || data.scope !== departmentRoleUi.workspaceScope
          || row.bindingKey !== currentDepartmentRoleBindingKey(row.draft.cli)) return;
        row.loading = false;
        row.error = data.error || "";
        const candidates = data.candidates;
        if (candidates && candidates.cli === row.draft.cli && candidates.configId === row.draft.configId) row.candidates = candidates;
        renderDepartmentRole(data.role);
        syncDepartmentSendReadiness();
      }
      function renderDepartmentRole(role) {
        const row = departmentRoleUi.rows[role];
        if (!row) return;
        const draft = row.draft;
        const candidates = row.candidates;
        const pending = row.loading || Boolean(row.saving);
        departmentRoleOptions(departmentRoleControl(role, "cli"), getEnabledCliNames().filter((cli) => departmentExecutionClis.includes(cli)).map((cli) => ({ value: cli, label: formatCliDisplayName(cli) })), draft.cli, "请选择 CLI");
        departmentRoleControl(role, "cli").disabled = Boolean(row.saving);
        const models = (candidates?.models || []).map((model) => ({ value: model, label: model }));
        if (candidates?.supportsDefaultModel) models.unshift({ value: "__default__", label: t("departmentRoleDefaultModel") });
        const modelSelect = departmentRoleControl(role, "model");
        departmentRoleOptions(modelSelect, models, draft.model === null ? "__default__" : draft.model, row.loading ? "正在读取模型…" : "请选择模型");
        modelSelect.title = draft.model === null ? t("departmentRoleDefaultModel") : draft.model || "";
        departmentRoleControl(role, "model").disabled = pending || !draft.configId || !models.length;
        const effort = departmentRoleEffort(row);
        const choices = effort.choices.map((value) => ({ value, label: value }));
        const thinking = departmentRoleControl(role, "thinking");
        departmentRoleOptions(thinking, draft.cli === "opencode" ? [] : choices, effort.selected, "", false);
        thinking.hidden = draft.cli === "opencode" || !choices.length;
        thinking.disabled = pending || draft.model === undefined || !choices.length;
        const variant = departmentRoleControl(role, "variant");
        departmentRoleOptions(variant, draft.cli === "opencode" ? choices : [], effort.selected, "", false);
        variant.hidden = draft.cli !== "opencode" || !choices.length;
        variant.disabled = pending || draft.model === undefined || !choices.length;
        const retry = departmentRoleControl(role, "retry");
        retry.hidden = !row.error;
        retry.disabled = pending;
        syncDepartmentSendReadiness();
      }
      function renderDepartmentConfiguration() {
        if (departmentRoleUi.syncingPanelState) return;
        const group = document.getElementById("departmentRoleConfiguration");
        if (!group) return;
        const visible = state.interactiveMode === "department";
        group.hidden = !visible;
        document.querySelector(".config-select-row")?.classList?.toggle("department-mode", visible);
        const director = departmentRoleUi.director;
        syncDepartmentSendReadiness();
        const ordinaryModels = document.querySelector(".input-model-row");
        if (ordinaryModels) ordinaryModels.hidden = visible;
        const directorControls = document.getElementById("departmentDirectorControls");
        if (directorControls && ordinaryModels) {
          const controlIds = ["modelSelect", "thinkingMode", "openCodePrimaryModelSelect", "openCodePrimaryThinkingMode"];
          const desired = new Set(state.currentCli === "opencode"
            ? ["openCodePrimaryModelSelect", "openCodePrimaryThinkingMode"]
            : ["modelSelect", "thinkingMode"]);
          controlIds.forEach((id) => {
            const control = document.getElementById(id);
            if (!control) return;
            if (!departmentRoleUi.controlLocations.has(control)) {
              departmentRoleUi.controlLocations.set(control, { parent: control.parentNode, nextSibling: control.nextSibling });
            }
            const location = departmentRoleUi.controlLocations.get(control);
            if (visible && desired.has(id)) {
              if (control.parentNode !== directorControls) directorControls.appendChild(control);
            } else if (control.parentNode !== location.parent) {
              const nextSibling = location.nextSibling?.parentNode === location.parent ? location.nextSibling : null;
              location.parent.insertBefore(control, nextSibling);
            }
          });
        }
        ["leader", "employee"].forEach((role) => {
          const row = departmentRoleUi.rows[role];
          if (!row) return;
          if (visible && !row.requestId && director?.configId) requestDepartmentRoleCandidates(role);
          else renderDepartmentRole(role);
        });
      }
      function saveDepartmentRolePreference(role) {
        const row = departmentRoleUi.rows[role];
        if (row && departmentRoleCliIssue(role, row.draft.cli)) return;
        const directorConfigId = departmentRoleUi.director?.configId;
        if (!row || row.saving || row.loading || !directorConfigId || !row.draft.configId || row.draft.model === undefined
          || !row.candidates || row.candidates.cli !== row.draft.cli || row.candidates.configId !== row.draft.configId
          || row.bindingKey !== currentDepartmentRoleBindingKey(row.draft.cli)) return;
        // Persist the actual visible effort, as the Loop+ submodel selectors do.
        const effort = departmentRoleEffort(row).selected || null;
        row.draft.thinkingMode = row.draft.cli === "opencode" ? null : effort;
        row.draft.openCodeVariant = row.draft.cli === "opencode" ? effort : null;
        row.saving = departmentRoleUi.scope + ":save:" + (++departmentRoleUi.sequence);
        row.savingBindingKey = row.bindingKey;
        row.savingMode = departmentRoleUi.mode;
        row.savingModeGeneration = departmentRoleUi.modeGeneration;
        row.error = "";
        vscode.postMessage({ type: "updateDepartmentRolePreference", scope: departmentRoleUi.workspaceScope, role, directorConfigId, requestId: row.saving, preference: { ...row.draft } });
        renderDepartmentRole(role);
      }
      function applyDepartmentRolePreferenceSaved(data) {
        const row = departmentRoleUi.rows[data.role];
        if (!row || row.saving !== data.requestId || data.scope !== departmentRoleUi.workspaceScope
          || data.directorConfigId !== departmentRoleUi.director?.configId
          || row.savingMode !== departmentRoleUi.mode
          || row.savingModeGeneration !== departmentRoleUi.modeGeneration
          || row.savingBindingKey !== currentDepartmentRoleBindingKey(row.draft.cli)) return;
        row.saving = "";
        row.savingBindingKey = "";
        row.savingMode = "";
        row.error = data.ok ? "" : data.error || t("departmentRoleSaveError");
        row.dirty = !data.ok;
        if (data.ok) {
          departmentRoleUi.saved[data.role] = { ...row.draft };
          // Success is an explicit host acknowledgement; an older panel projection may still say saving.
          departmentRoleUi.hostIssue = "";
        }
        renderDepartmentRole(data.role);
      }
      function departmentRootReadinessIssue(payload, tabId) {
        const tab = typeof getConversationTabSummary === "function" ? getConversationTabSummary(tabId) : null;
        const mode = typeof resolveDispatchInteractiveMode === "function"
          ? resolveDispatchInteractiveMode(payload?.interactiveMode, tab, Boolean(tabId && typeof getActiveConversationTabId === "function" && tabId !== getActiveConversationTabId()))
          : payload?.interactiveMode || state.interactiveMode;
        if (mode !== "department") return "";
        // Existing task supplements use their frozen configuration and existing queue/conflict flow.
        if (tab?.loopTaskId || (typeof isConversationTabBusy === "function" && isConversationTabBusy(tabId))) return "";
        if (payload?.departmentConfigurationScope !== undefined && payload.departmentConfigurationScope !== departmentRoleUi.workspaceScope) return "工作区或配置作用域已变化，请在当前工作区重新发送。";
        if (!departmentRoleUi.director?.configId) return "总监当前没有有效档案，请先在顶部配置入口选择并激活档案。";
        const rows = [departmentRoleUi.rows.leader, departmentRoleUi.rows.employee];
        if (rows.some((row) => !row)) return "产研部角色配置正在加载，请加载完成后再新建任务。";
        const capabilityIssue = rows.map((row, index) => departmentRoleCliIssue(index === 0 ? "leader" : "employee", row.draft.cli)).find(Boolean);
        if (capabilityIssue) return capabilityIssue;
        if (rows.some((row) => row.error)) return "产研部角色配置加载或保存失败，请重试成功后再新建任务。";
        if (rows.some((row) => !currentDepartmentRoleConfigId(row.draft.cli))) return "目标 CLI 没有已激活档案，请先在顶部配置入口选择并激活档案。";
        if (rows.some((row) => row.candidates && !row.candidates.models.length && !row.candidates.supportsDefaultModel)) return t("departmentRoleNoModels");
        if (rows.some((row) => row.saving)) return "产研部角色配置正在保存，请保存完成后再新建任务。";
        if (rows.some((row) => row.loading)) return "产研部角色配置正在加载，请加载完成后再新建任务。";
        if (rows.some((row) => !row.candidates)) return "产研部角色候选尚未就绪，请重新加载后再新建任务。";
        if (rows.some((row) => row.dirty)) return "产研部角色配置尚未保存，请完成选择并保存后再新建任务。";
        if (rows.some((row) => !row.draft.configId || row.draft.model === undefined
          || row.bindingKey !== currentDepartmentRoleBindingKey(row.draft.cli)
          || row.candidates.cli !== row.draft.cli || row.candidates.configId !== row.draft.configId
          || (row.draft.model === null ? !row.candidates.supportsDefaultModel : !row.candidates.models.includes(row.draft.model)))) return "请先完成组长和员工的 CLI、模型与力度选择。";
        return departmentRoleUi.hostIssue;
      }
      function syncDepartmentSendReadiness() {
        const tabId = typeof getActiveConversationTabId === "function" ? getActiveConversationTabId() : null;
        const issue = departmentRootReadinessIssue({ interactiveMode: state.interactiveMode }, tabId);
        const message = document.getElementById("departmentRoleMessage");
        if (message) message.textContent = state.interactiveMode === "department" ? issue : "";
        if (typeof elements !== "undefined" && elements.sendPrompt) {
          elements.sendPrompt.disabled = Boolean(issue)
            || (typeof isCreatingConversationTab === "function" && isCreatingConversationTab(tabId));
          elements.sendPrompt.title = issue || t("sendButton");
        }
      }
      function guardDepartmentRootDispatch(payload, tabId) {
        const issue = departmentRootReadinessIssue(payload, tabId);
        if (!issue) return true;
        syncDepartmentSendReadiness();
        if (typeof showToast === "function") showToast(issue);
        return false;
      }
      function bindDepartmentRoleControls() {
        ["leader", "employee"].forEach((role) => {
          ["cli", "model", "thinking", "variant"].forEach((field) => {
            const control = departmentRoleControl(role, field);
            if (!control) return;
            control.addEventListener("change", () => {
              const row = departmentRoleUi.rows[role];
              if (!row || control.value === "__missing__") return;
              row.dirty = true;
              row.error = "";
              if (field === "cli") {
                row.draft.cli = control.value;
                row.draft.configId = currentDepartmentRoleConfigId(control.value);
                row.draft.model = undefined;
                row.draft.thinkingMode = null;
                row.draft.openCodeVariant = null;
                requestDepartmentRoleCandidates(role);
              } else {
                if (field === "model") {
                  row.draft.model = control.value === "__default__" ? null : control.value;
                  row.draft.thinkingMode = null;
                  row.draft.openCodeVariant = null;
                } else row.draft[field === "thinking" ? "thinkingMode" : "openCodeVariant"] = control.value || null;
                saveDepartmentRolePreference(role);
              }
              renderDepartmentRole(role);
            });
          });
          departmentRoleControl(role, "retry")?.addEventListener("click", () => {
            const row = departmentRoleUi.rows[role];
            if (row?.candidates) saveDepartmentRolePreference(role);
            else requestDepartmentRoleCandidates(role);
          });
        });
      }
      bindDepartmentRoleControls();
`;
