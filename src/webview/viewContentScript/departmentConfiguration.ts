// The same runtime is exercised by the DOM harness and the real Webview.
export const VIEW_CONTENT_SCRIPT_DEPARTMENT_CONFIGURATION = `
      const departmentRoleUi = { scope: "", sequence: 0, rows: {}, saved: {}, director: null, workspaceScope: undefined, hostIssue: "" };
      function departmentRoleControl(role, field) {
        return document.getElementById("department-" + role + "-" + field);
      }
      function departmentRoleOptions(select, choices, selected, placeholder) {
        if (!select) return;
        select.replaceChildren();
        const items = [{ value: "__missing__", label: placeholder }].concat(choices);
        items.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.label;
          select.appendChild(option);
        });
        select.value = items.some((item) => item.value === selected) ? selected : "__missing__";
      }
      function createDepartmentRoleDraft(preference) {
        return { draft: preference ? { ...preference } : { cli: state.currentCli, configId: null, model: undefined, thinkingMode: null, openCodeVariant: null },
          candidates: null, loading: false, requestId: "", saving: "", error: "", dirty: false };
      }
      function syncDepartmentConfigurationState(panelState) {
        const director = panelState.departmentDirector || null;
        const scope = director ? JSON.stringify([panelState.departmentConfigurationScope, director.cli, director.configId]) : "";
        departmentRoleUi.workspaceScope = panelState.departmentConfigurationScope;
        departmentRoleUi.hostIssue = panelState.departmentConfigurationIssue || "";
        const changed = scope !== departmentRoleUi.scope;
        departmentRoleUi.scope = scope;
        departmentRoleUi.director = director;
        departmentRoleUi.saved = panelState.departmentRolePreferences || {};
        ["leader", "employee"].forEach((role) => {
          const row = departmentRoleUi.rows[role];
          if (changed || !row) departmentRoleUi.rows[role] = createDepartmentRoleDraft(departmentRoleUi.saved[role]);
          else if (!row.dirty && !row.saving) {
            const draft = createDepartmentRoleDraft(departmentRoleUi.saved[role]).draft;
            if (draft.cli !== row.draft.cli || draft.configId !== row.draft.configId) {
              row.requestId = ""; row.candidates = null; row.loading = false;
            }
            row.draft = draft;
          }
        });
        renderDepartmentConfiguration();
      }
      function requestDepartmentRoleCandidates(role) {
        const row = departmentRoleUi.rows[role];
        if (!row || !row.draft.cli || !departmentRoleUi.scope) return;
        row.loading = true;
        row.error = "";
        row.candidates = null;
        row.requestId = departmentRoleUi.scope + ":" + role + ":" + (++departmentRoleUi.sequence);
        vscode.postMessage({ type: "requestDepartmentRoleCandidates", scope: departmentRoleUi.workspaceScope, role, requestId: row.requestId,
          cli: row.draft.cli, configId: row.draft.configId });
        renderDepartmentRole(role);
      }
      function applyDepartmentRoleCandidates(data) {
        const row = departmentRoleUi.rows[data.role];
        if (!row || row.requestId !== data.requestId || data.scope !== departmentRoleUi.workspaceScope) return;
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
        departmentRoleOptions(departmentRoleControl(role, "cli"), getEnabledCliNames().map((cli) => ({ value: cli, label: formatCliDisplayName(cli) })), draft.cli, "请选择 CLI");
        departmentRoleControl(role, "cli").disabled = Boolean(row.saving);
        departmentRoleOptions(departmentRoleControl(role, "config"), (candidates?.configs || []).map((config) => ({ value: config.id, label: config.name })), draft.configId, row.loading ? "正在读取档案…" : "请选择档案");
        departmentRoleControl(role, "config").disabled = pending || !candidates?.configs?.length;
        const models = (candidates?.models || []).map((model) => ({ value: model, label: model }));
        if (candidates?.supportsDefaultModel) models.unshift({ value: "__default__", label: t("departmentRoleDefaultModel") });
        departmentRoleOptions(departmentRoleControl(role, "model"), models, draft.model === null ? "__default__" : draft.model, row.loading ? "正在读取模型…" : "请选择模型");
        departmentRoleControl(role, "model").disabled = pending || !draft.configId || !models.length;
        const model = draft.model === null ? candidates?.defaultModel || "" : draft.model;
        const modes = candidates?.thinkingByModel?.[model] || [];
        departmentRoleOptions(departmentRoleControl(role, "thinking"), [{ value: "", label: "沿用档案力度" }].concat(modes.map((mode) => ({ value: mode, label: mode }))), draft.thinkingMode || "", "请选择力度");
        departmentRoleControl(role, "thinking").disabled = pending || draft.model === undefined || !modes.length;
        const variants = candidates?.variantsByModel?.[model] || [];
        const variant = departmentRoleControl(role, "variant");
        departmentRoleOptions(variant, [{ value: "", label: "沿用默认变体" }].concat(variants.map((value) => ({ value, label: value }))), draft.openCodeVariant || "", "请选择变体");
        variant.hidden = draft.cli !== "opencode";
        variant.disabled = pending || draft.model === undefined || !variants.length;
        const message = document.getElementById("department-" + role + "-message");
        message.textContent = row.error || (row.saving ? "正在保存角色配置…" : row.loading ? "正在加载角色候选…" : !candidates ? "" : !candidates.configs.length ? t("departmentRoleNoConfigs") : draft.configId && !models.length ? t("departmentRoleNoModels") : "");
        const retry = departmentRoleControl(role, "retry");
        retry.hidden = !row.error;
        retry.disabled = pending;
        syncDepartmentSendReadiness();
      }
      function renderDepartmentConfiguration() {
        const group = document.getElementById("departmentRoleConfiguration");
        if (!group) return;
        const visible = state.interactiveMode === "department";
        group.hidden = !visible;
        document.querySelector(".config-select-row")?.classList?.toggle("department-mode", visible);
        const director = departmentRoleUi.director;
        const summary = document.getElementById("departmentDirectorSummary");
        summary.textContent = director ? [formatCliDisplayName(director.cli),
          (state.configStateByCli?.[director.cli]?.configs || state.configState?.configs || []).find((config) => config.id === director.configId)?.name || "未选择档案",
          director.model || t("departmentRoleDefaultModel"), director.thinkingMode || "沿用档案力度",
          ...(director.openCodeVariant ? [director.openCodeVariant] : [])].join(" · ") : "正在加载总监当前配置…";
        syncDepartmentSendReadiness();
        const ordinaryModels = document.querySelector(".input-model-row");
        if (ordinaryModels) ordinaryModels.hidden = visible;
        ["leader", "employee"].forEach((role) => {
          const row = departmentRoleUi.rows[role];
          if (!row) return;
          if (visible && !row.requestId && director?.configId) requestDepartmentRoleCandidates(role);
          else renderDepartmentRole(role);
        });
      }
      function saveDepartmentRolePreference(role) {
        const row = departmentRoleUi.rows[role];
        const directorConfigId = departmentRoleUi.director?.configId;
        if (!row || row.saving || row.loading || !directorConfigId || !row.draft.configId || row.draft.model === undefined) return;
        row.saving = departmentRoleUi.scope + ":save:" + (++departmentRoleUi.sequence);
        row.error = "";
        vscode.postMessage({ type: "updateDepartmentRolePreference", scope: departmentRoleUi.workspaceScope, role, directorConfigId, requestId: row.saving, preference: { ...row.draft } });
        renderDepartmentRole(role);
      }
      function applyDepartmentRolePreferenceSaved(data) {
        const row = departmentRoleUi.rows[data.role];
        if (!row || row.saving !== data.requestId || data.scope !== departmentRoleUi.workspaceScope || data.directorConfigId !== departmentRoleUi.director?.configId) return;
        row.saving = "";
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
        if (!departmentRoleUi.director?.configId) return "总监当前没有有效档案，请先选择档案。";
        const rows = [departmentRoleUi.rows.leader, departmentRoleUi.rows.employee];
        if (rows.some((row) => !row || row.loading)) return "产研部角色配置正在加载，请加载完成后再新建任务。";
        if (rows.some((row) => row.saving)) return "产研部角色配置正在保存，请保存完成后再新建任务。";
        if (rows.some((row) => row.error)) return "产研部角色配置加载或保存失败，请重试成功后再新建任务。";
        if (rows.some((row) => !row.candidates)) return "产研部角色候选尚未就绪，请重新加载后再新建任务。";
        if (rows.some((row) => row.dirty)) return "产研部角色配置尚未保存，请完成选择并保存后再新建任务。";
        if (rows.some((row) => !row.draft.configId || row.draft.model === undefined
          || row.candidates.cli !== row.draft.cli || row.candidates.configId !== row.draft.configId
          || !row.candidates.configs.some((config) => config.id === row.draft.configId)
          || (row.draft.model === null ? !row.candidates.supportsDefaultModel : !row.candidates.models.includes(row.draft.model)))) return "请先完成组长和员工的 CLI、档案与模型选择。";
        return departmentRoleUi.hostIssue;
      }
      function syncDepartmentSendReadiness() {
        const tabId = typeof getActiveConversationTabId === "function" ? getActiveConversationTabId() : null;
        const issue = departmentRootReadinessIssue({ interactiveMode: state.interactiveMode }, tabId);
        const message = document.getElementById("departmentRoleMessage");
        if (message) message.textContent = state.interactiveMode === "department" ? issue : "";
        if (typeof elements !== "undefined" && elements.sendPrompt) {
          elements.sendPrompt.disabled = Boolean(issue);
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
          ["cli", "config", "model", "thinking", "variant"].forEach((field) => {
            const control = departmentRoleControl(role, field);
            if (!control) return;
            control.addEventListener("change", () => {
              const row = departmentRoleUi.rows[role];
              if (!row || control.value === "__missing__") return;
              row.dirty = true;
              row.error = "";
              if (field === "cli" || field === "config") {
                if (field === "cli") row.draft.cli = control.value;
                row.draft.configId = field === "config" ? control.value : null;
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
