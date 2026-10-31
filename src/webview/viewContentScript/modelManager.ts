// Model manager, model selection, and model persistence handlers.
export const VIEW_CONTENT_SCRIPT_MODEL_MANAGER = `      function cliUsesConfigDeclaredModels(cli = state.currentCli) {
        return cli === "grok" || cli === "kimi-code" || cli === "zcode";
      }

      function getCliLoopModelSelectAria(cli, role) {
        if (cli === "grok") {
          return t(role === "subtask" ? "grokLoopSubtaskModelSelectAria" : "grokLoopMainModelSelectAria");
        }
        if (cli === "dsh") {
          return t(role === "subtask" ? "dshLoopSubtaskModelSelectAria" : "dshLoopMainModelSelectAria");
        }
        if (cli === "kimi-code") {
          return t(role === "subtask" ? "kimiCodeLoopSubtaskModelSelectAria" : "kimiCodeLoopMainModelSelectAria");
        }
        if (cli === "zcode") {
          return t(role === "subtask" ? "zcodeLoopSubtaskModelSelectAria" : "zcodeLoopMainModelSelectAria");
        }
        return t(role === "subtask" ? "codexLoopSubtaskModelSelectAria" : "codexLoopMainModelSelectAria");
      }

      function getNoConfiguredModelLabel(cli) {
        if (cli === "zcode") {
          return t("zcodeNoConfiguredModel");
        }
        if (cli === "kimi-code") {
          return t("kimiCodeNoConfiguredModel");
        }
        return t(cli === "grok" ? "grokNoConfiguredModel" : "modelOptionDefault");
      }

      function cliSupportsManagedModelSelection(cli = state.currentCli) {
        return cli === "codex" || cli === "grok" || cli === "kimi-code";
      }

      function cliSupportsModelSelection(cli = state.currentCli) {
        return cliSupportsManagedModelSelection(cli) || cli === "dsh" || cli === "zcode";
      }

      function canOpenModelManagerDialog(cli = state.currentCli) {
        return cli === "codex" || cli === "kimi-code";
      }

      function getModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.modelsByCli && Array.isArray(state.modelsByCli[cli])
          ? state.modelsByCli[cli]
          : [];
        return models;
      }

      function getManagedModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.managedModelsByCli && Array.isArray(state.managedModelsByCli[cli])
          ? state.managedModelsByCli[cli]
          : [];
        return models;
      }

      function getModelOptionLabel(cli, modelName) {
        const labels = state.modelLabelsByCli && state.modelLabelsByCli[cli];
        const label = labels && labels[modelName];
        return typeof label === "string" && label.trim() ? label.trim() : modelName;
      }

      function getCurrentModelConfigId() {
        return state.selectedConfigId || state.configState.activeConfigId || null;
      }

      function syncCliSelectAvailability() {
        if (elements.currentCli) {
          elements.currentCli.disabled = false;
        }
      }

      function handleModelSelectChange(value) {
        if (value === MODEL_MANAGE_OPTION_VALUE) {
          showAddModelDialog();
          return;
        }
        const model = typeof value === "string" ? value : "";
        state.selectedModel = model;
        if (state.selectedModelsByCli) {
          state.selectedModelsByCli[state.currentCli] = model;
        }
        vscode.postMessage({
          type: "selectCliModel",
          cli: state.currentCli,
          model: model || null,
          configId: getCurrentModelConfigId(),
        });
      }

      function reportModelManagerInspection() {
        if (!cliSupportsManagedModelSelection()) {
          return;
        }
        vscode.postMessage({
          type: "inspectModelManager",
          cli: state.currentCli,
          configId: getCurrentModelConfigId(),
          visibleModelCount: getModelsForCurrentCli().length,
          visibleManagedModelCount: getManagedModelsForCurrentCli().length,
          selectedModel: state.selectedModel || null,
        });
      }

      function showModelManageError(message) {
        elements.modelAddError.textContent = message;
        elements.modelAddError.style.display = "block";
      }

      function clearModelManageError() {
        elements.modelAddError.textContent = "";
        elements.modelAddError.style.display = "none";
      }

      function syncModelManageForm() {
        const isEditing = Boolean(editingModelName);
        if (elements.modelEditHint) {
          elements.modelEditHint.textContent = isEditing ? t("modelManageEditing", { model: editingModelName }) : "";
          elements.modelEditHint.style.display = isEditing ? "block" : "none";
        }
        if (elements.clearModelEdit) {
          elements.clearModelEdit.style.display = isEditing ? "inline-flex" : "none";
        }
        if (elements.confirmAddModel) {
          elements.confirmAddModel.textContent = isEditing ? t("modelSaveButton") : t("modelAddButton");
        }
      }

      function resetModelManageForm() {
        editingModelName = "";
        elements.modelInput.value = "";
        clearModelManageError();
        syncModelManageForm();
      }

      function startEditModel(modelName) {
        editingModelName = modelName;
        elements.modelInput.value = modelName;
        clearModelManageError();
        syncModelManageForm();
        elements.modelInput.focus();
        elements.modelInput.select();
      }

      function renderModelManagerList() {
        if (!elements.modelManagerList) {
          return;
        }
        const availableModels = getManagedModelsForCurrentCli();
        elements.modelManagerList.innerHTML = "";
        if (!availableModels.length) {
          const empty = document.createElement("div");
          empty.className = "model-manager-empty";
          empty.textContent = t("modelManageEmpty");
          elements.modelManagerList.appendChild(empty);
          return;
        }
        availableModels.forEach((modelName, index) => {
          const item = document.createElement("div");
          item.className = "model-manager-item";

          const meta = document.createElement("div");
          meta.className = "model-manager-meta";

          const name = document.createElement("div");
          name.className = "model-manager-name";
          name.textContent = modelName;
          meta.appendChild(name);

          item.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "model-manager-actions";

          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.className = "secondary action-button model-manager-button";
          editButton.textContent = t("modelEditLabel");
          editButton.addEventListener("click", () => {
            startEditModel(modelName);
          });
          actions.appendChild(editButton);

          const moveUpButton = document.createElement("button");
          moveUpButton.type = "button";
          moveUpButton.className = "secondary action-button model-manager-button";
          moveUpButton.textContent = t("modelMoveUpLabel");
          moveUpButton.disabled = index === 0;
          moveUpButton.addEventListener("click", () => {
            vscode.postMessage({
              type: "moveCliModel",
              cli: state.currentCli,
              model: modelName,
              direction: "up",
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(moveUpButton);

          const moveDownButton = document.createElement("button");
          moveDownButton.type = "button";
          moveDownButton.className = "secondary action-button model-manager-button";
          moveDownButton.textContent = t("modelMoveDownLabel");
          moveDownButton.disabled = index === availableModels.length - 1;
          moveDownButton.addEventListener("click", () => {
            vscode.postMessage({
              type: "moveCliModel",
              cli: state.currentCli,
              model: modelName,
              direction: "down",
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(moveDownButton);

          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "secondary action-button model-manager-button";
          deleteButton.textContent = t("modelRemoveLabel");
          deleteButton.addEventListener("click", () => {
            if (editingModelName && editingModelName.toLowerCase() === String(modelName).toLowerCase()) {
              resetModelManageForm();
            }
            vscode.postMessage({
              type: "deleteCliModel",
              cli: state.currentCli,
              model: modelName,
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(deleteButton);

          item.appendChild(actions);
          elements.modelManagerList.appendChild(item);
        });
      }

      function updateModelSelectOptions() {
        if (!elements.modelSelect) {
          return;
        }
        const availableModels = getModelsForCurrentCli();
        elements.modelSelect.innerHTML = "";

        if (!cliUsesConfigDeclaredModels() || availableModels.length === 0) {
          const configDeclared = cliUsesConfigDeclaredModels();
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = getNoConfiguredModelLabel(state.currentCli);
          defaultOption.disabled = configDeclared;
          elements.modelSelect.appendChild(defaultOption);
        }

        availableModels.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = getModelOptionLabel(state.currentCli, modelName);
          elements.modelSelect.appendChild(option);
        });

        if (canOpenModelManagerDialog(state.currentCli)) {
          const manageOption = document.createElement("option");
          manageOption.value = MODEL_MANAGE_OPTION_VALUE;
          manageOption.textContent = t("modelOptionManage");
          elements.modelSelect.appendChild(manageOption);
        }

        const nextValue = typeof state.selectedModel === "string" ? state.selectedModel : "";
        if (nextValue && availableModels.includes(nextValue)) {
          elements.modelSelect.value = nextValue;
          return;
        }
        elements.modelSelect.value = cliUsesConfigDeclaredModels() ? availableModels[0] || "" : "";
      }

      function cliSupportsLoopRoleModelSelection(cli = state.currentCli) {
        return cli === "codex" || cli === "grok" || cli === "dsh" || cli === "kimi-code" || cli === "zcode";
      }

      function isLoopRoleModelMode(cli = state.currentCli, interactiveMode = state.interactiveMode) {
        const normalizedMode = normalizeInteractiveMode(interactiveMode);
        return cliSupportsLoopRoleModelSelection(cli) && (
          normalizedMode === "loop" || normalizedMode === "graph" || normalizedMode === "loop_plus"
        );
      }

      function isOpenCodeRoleModelMode(cli = state.currentCli, interactiveMode = state.interactiveMode) {
        const normalizedMode = normalizeInteractiveMode(interactiveMode);
        return cli === "opencode" && (
          normalizedMode === "loop" || normalizedMode === "graph" || normalizedMode === "loop_plus"
        );
      }

      function getLoopRoleModelsForCli(cli, role) {
        const roleModels = state.loopModelsByCli && state.loopModelsByCli[cli] && Array.isArray(state.loopModelsByCli[cli][role])
          ? state.loopModelsByCli[cli][role]
          : [];
        if (roleModels.length > 0) {
          return roleModels;
        }
        return state.modelsByCli && Array.isArray(state.modelsByCli[cli])
          ? state.modelsByCli[cli]
          : [];
      }

      function getSelectedLoopRoleModelForCli(cli, role) {
        const selected = state.selectedLoopModelsByCli
          && state.selectedLoopModelsByCli[cli]
          && typeof state.selectedLoopModelsByCli[cli][role] === "string"
          ? state.selectedLoopModelsByCli[cli][role].trim()
          : "";
        const availableModels = getLoopRoleModelsForCli(cli, role);
        if (selected && availableModels.includes(selected)) {
          return selected;
        }
        return "";
      }

      function updateCodexLoopRoleModelSelect(selectElement, role) {
        if (!selectElement || (typeof isSelectFocused === "function" && isSelectFocused(selectElement))) {
          return;
        }
        const availableModels = getLoopRoleModelsForCli(state.currentCli, role);
        selectElement.innerHTML = "";

        const configDeclared = cliUsesConfigDeclaredModels();
        if (!configDeclared || availableModels.length === 0) {
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = getNoConfiguredModelLabel(state.currentCli);
          defaultOption.disabled = configDeclared;
          selectElement.appendChild(defaultOption);
        }

        availableModels.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = getModelOptionLabel(state.currentCli, modelName);
          selectElement.appendChild(option);
        });

        selectElement.value = getSelectedLoopRoleModelForCli(state.currentCli, role);
        selectElement.title = getCliLoopModelSelectAria(state.currentCli, role);
        if (typeof selectElement.setAttribute === "function") {
          selectElement.setAttribute("aria-label", selectElement.title);
        }
      }

      function updateCodexLoopModelSelectOptions() {
        updateCodexLoopRoleModelSelect(elements.codexLoopMainModelSelect, "main");
        updateCodexLoopRoleModelSelect(elements.codexLoopSubtaskModelSelect, "subtask");
        if (typeof updateCodexLoopThinkingSelectOptions === "function") {
          updateCodexLoopThinkingSelectOptions();
        }
      }

      function clearOpenCodeModelOptions() {
        state.openCodeModels = normalizeOpenCodeModelsPayload(null);
        updateOpenCodeModelSelectOptions();
      }

      function getOpenCodeModelIssueMessage(issue) {
        if (!issue || typeof issue !== "object") {
          return "";
        }
        const issueKey = typeof issue.messageKey === "string" && issue.messageKey
          ? issue.messageKey
          : issue.code;
        const i18nKeyByIssue = {
          "invalid-json": "openCodeModelIssueInvalidJson",
          "missing-role-model": "openCodeModelIssueMissingRoleModel",
          "invalid-model-ref": "openCodeModelIssueInvalidModelRef",
          "provider-not-found": "openCodeModelIssueProviderNotFound",
          "model-not-found": "openCodeModelIssueModelNotFound",
          "duplicate-role-model": "openCodeModelIssueDuplicateRoleModel",
          "provider-disabled": "openCodeModelIssueProviderDisabled",
          "model-filtered": "openCodeModelIssueModelFiltered",
          "metadata-unavailable": "openCodeModelIssueMetadataUnavailable",
        };
        if (typeof issue.messageKey === "string" && Object.prototype.hasOwnProperty.call(i18n, issue.messageKey)) {
          return t(issue.messageKey);
        }
        return t(i18nKeyByIssue[issueKey] || i18nKeyByIssue[issue.code] || "openCodeModelIssueGeneric");
      }

      function getOpenCodeModelOptionLabel(model) {
        const ref = model && typeof model.ref === "string" ? model.ref.trim() : "";
        const rawLabel = model && typeof model.label === "string" ? model.label : "";
        const label = rawLabel.trim();
        const legacyRefSuffix = ref ? " (" + ref + ")" : "";
        const legacyRefOnlyLabel = legacyRefSuffix.trim();
        const suffixCandidate = rawLabel.trimEnd();
        const normalizedLabel = label === legacyRefOnlyLabel
          ? ""
          : legacyRefSuffix && suffixCandidate.endsWith(legacyRefSuffix)
            ? suffixCandidate.slice(0, -legacyRefSuffix.length).trim()
            : label;
        if (normalizedLabel && normalizedLabel !== ref) {
          return normalizedLabel;
        }
        const modelId = model && typeof model.modelId === "string" ? model.modelId.trim() : "";
        if (modelId) {
          return modelId;
        }
        const separatorIndex = ref.lastIndexOf("/");
        return separatorIndex >= 0 ? ref.slice(separatorIndex + 1) : ref;
      }

      function updateOpenCodeRoleModelSelect(selectElement, role) {
        if (!selectElement || (typeof isSelectFocused === "function" && isSelectFocused(selectElement))) {
          return;
        }
        const payload = state.openCodeModels || normalizeOpenCodeModelsPayload(null);
        const models = Array.isArray(payload.models) ? payload.models : [];
        const selectedRef = role === "subtask" ? payload.selectedSubtaskRef : payload.selectedMainRef;
        const validRefs = new Set(models.map((model) => model.ref));
        const nextValue = selectedRef && validRefs.has(selectedRef) ? selectedRef : "";
        if (role === "subtask") {
          payload.selectedSubtaskRef = nextValue || null;
          payload.selectedSmallRef = payload.selectedSubtaskRef;
        } else {
          payload.selectedMainRef = nextValue || null;
          payload.selectedPrimaryRef = payload.selectedMainRef;
        }
        selectElement.innerHTML = "";
        if (models.length === 0) {
          const placeholderOption = document.createElement("option");
          placeholderOption.value = "";
          placeholderOption.textContent = t("openCodeNoConfiguredModel");
          placeholderOption.disabled = true;
          selectElement.appendChild(placeholderOption);
        } else {
          models.forEach((model) => {
            const option = document.createElement("option");
            option.value = model.ref;
            option.textContent = getOpenCodeModelOptionLabel(model);
            selectElement.appendChild(option);
          });
        }
        selectElement.value = nextValue;
        const issue = Array.isArray(payload.issues)
          ? payload.issues.find((candidate) => !candidate.role || candidate.role === role)
          : null;
        const baseTitle = role === "subtask"
          ? t("openCodeSmallModelSelectAria")
          : t("openCodePrimaryModelSelectAria");
        const issueMessage = getOpenCodeModelIssueMessage(issue);
        selectElement.title = [baseTitle, issueMessage].filter(Boolean).join(" ");
        if (issueMessage) {
          selectElement.setAttribute("aria-invalid", "true");
        } else {
          selectElement.removeAttribute("aria-invalid");
        }
      }

      function updateOpenCodeModelSelectOptions() {
        updateOpenCodeRoleModelSelect(elements.openCodePrimaryModelSelect, "main");
        updateOpenCodeRoleModelSelect(elements.openCodeSmallModelSelect, "subtask");
        if (!elements.openCodeModelIssue) {
          return;
        }
        const payload = state.openCodeModels || normalizeOpenCodeModelsPayload(null);
        const issueMessages = Array.isArray(payload.issues)
          ? payload.issues.map(getOpenCodeModelIssueMessage).filter(Boolean)
          : [];
        const uniqueMessages = Array.from(new Set(issueMessages));
        elements.openCodeModelIssue.textContent = uniqueMessages.join(" ");
        elements.openCodeModelIssue.style.display = uniqueMessages.length > 0 ? "inline" : "none";
      }

      function isSelectFocused(selectElement) {
        return typeof document !== "undefined" && document.activeElement === selectElement;
      }

      function getActiveConfigIdForStateCli(cli) {
        if (state.activeConfigIdByCli && Object.prototype.hasOwnProperty.call(state.activeConfigIdByCli, cli)) {
          return state.activeConfigIdByCli[cli] || null;
        }
        if (cli === state.currentCli) {
          return state.selectedConfigId || (state.configState && state.configState.activeConfigId) || null;
        }
        return null;
      }

      function getLoopSubtaskRoute() {
        const mainCli = state.currentCli;
        const mainConfigId = getActiveConfigIdForStateCli(mainCli);
        const stored = mainConfigId && state.selectedLoopSubtaskCliByConfigId
          ? state.selectedLoopSubtaskCliByConfigId[mainConfigId]
          : "";
        const names = typeof getEnabledCliNames === "function"
          ? getEnabledCliNames()
          : (Array.isArray(CLI_NAMES) ? CLI_NAMES : ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
        const storedEnabled = stored && names.indexOf(stored) >= 0 ? stored : "";
        const mainEnabled = names.indexOf(mainCli) >= 0 ? mainCli : "";
        const subtaskCli = storedEnabled || mainEnabled || names[0] || "";
        const crossCli = Boolean(subtaskCli) && subtaskCli !== mainCli;
        const subtaskConfigId = crossCli ? getActiveConfigIdForStateCli(subtaskCli) : mainConfigId;
        const targetConfigLoaded = state.configStateByCli && Object.prototype.hasOwnProperty.call(state.configStateByCli, subtaskCli);
        const configPending = crossCli && !subtaskConfigId && !targetConfigLoaded;
        let unavailableReason = "";
        if (state.modelIssuesByCli && state.modelIssuesByCli[subtaskCli]) {
          unavailableReason = state.modelIssuesByCli[subtaskCli];
        } else if (crossCli && !subtaskConfigId) {
          unavailableReason = t("loopSubtaskRouteMissingConfig");
        } else if (subtaskCli === "opencode") {
          const models = getLoopSubtaskOpenCodeModelState();
          const issues = models && Array.isArray(models.issues) ? models.issues : [];
          const blocking = issues.some((issue) => issue && (
            issue.code === "invalid-json" || issue.code === "metadata-unavailable" || issue.code === "provider-not-found"
          ));
          if (blocking) {
            unavailableReason = t("loopSubtaskRouteReadFailed");
          }
        }
        return { mainCli, mainConfigId, subtaskCli, crossCli, subtaskConfigId, configPending, unavailableReason };
      }

      function shouldShowSubtaskRouteIssue(interactiveMode) {
        return interactiveMode === "loop" || interactiveMode === "graph" || interactiveMode === "loop_plus";
      }

      function getLoopSubtaskOpenCodeModelState() {
        const routeCli = state.currentCli;
        if (routeCli !== "opencode" && state.loopSubtaskOpenCodeModels) {
          return state.loopSubtaskOpenCodeModels;
        }
        return state.openCodeModels;
      }

      function setRouteControlVisible(control, visible) {
        if (!control) {
          return;
        }
        control.style.display = visible ? "" : "none";
        control.disabled = !visible;
        if (!visible) {
          control.tabIndex = -1;
        } else if (typeof control.removeAttribute === "function") {
          control.removeAttribute("tabindex");
        }
      }

      function fillSubtaskCliSelect(selectElement, selectedCli) {
        if (!selectElement || isSelectFocused(selectElement)) {
          return;
        }
        const names = typeof getEnabledCliNames === "function"
          ? getEnabledCliNames()
          : (Array.isArray(CLI_NAMES) ? CLI_NAMES : ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
        const currentValues = Array.from(selectElement.options || []).map((option) => option.value);
        const same = currentValues.length === names.length && names.every((name, index) => currentValues[index] === name);
        if (!same) {
          selectElement.innerHTML = "";
          names.forEach((name) => {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            selectElement.appendChild(option);
          });
        }
        selectElement.value = names.indexOf(selectedCli) >= 0 ? selectedCli : (names[0] || "");
        selectElement.title = t("loopSubtaskCliSelectAria");
        if (typeof selectElement.setAttribute === "function") {
          selectElement.setAttribute("aria-label", selectElement.title);
        }
        selectElement.disabled = false;
        selectElement.tabIndex = 0;
      }

      function populateSubtaskModelSelect(selectElement, route) {
        if (!selectElement || isSelectFocused(selectElement)) {
          return;
        }
        const cli = route.subtaskCli;
        selectElement.innerHTML = "";
        if (cli === "claude") {
          return;
        }
        if (cli === "opencode") {
          const models = getLoopSubtaskOpenCodeModelState();
          const options = models && Array.isArray(models.models) ? models.models : [];
          const empty = document.createElement("option");
          empty.value = "";
          empty.textContent = t("openCodeNoConfiguredModel");
          empty.disabled = true;
          selectElement.appendChild(empty);
          options.forEach((model) => {
            const option = document.createElement("option");
            option.value = model.ref;
            option.textContent = getOpenCodeModelOptionLabel(model);
            selectElement.appendChild(option);
          });
          const selected = models && (models.selectedSubtaskRef || models.selectedSmallRef) || "";
          selectElement.value = selected || "";
          selectElement.title = t("openCodeSmallModelSelectAria");
        } else if (cli === state.currentCli && (cli === "codex" || cli === "grok" || cli === "dsh" || cli === "kimi-code" || cli === "zcode")) {
          updateCodexLoopRoleModelSelect(selectElement, "subtask");
          return;
        } else {
          const models = getLoopRoleModelsForCli(cli, "subtask");
          const configDeclared = cliUsesConfigDeclaredModels(cli);
          if (!configDeclared || models.length === 0) {
            const empty = document.createElement("option");
            empty.value = "";
            empty.textContent = getNoConfiguredModelLabel(cli);
            empty.disabled = configDeclared;
            selectElement.appendChild(empty);
          }
          models.forEach((modelName) => {
            const option = document.createElement("option");
            option.value = modelName;
            option.textContent = getModelOptionLabel(cli, modelName);
            selectElement.appendChild(option);
          });
          selectElement.value = getSelectedLoopRoleModelForCli(cli, "subtask");
          selectElement.title = getCliLoopModelSelectAria(cli, "subtask");
        }
        if (typeof selectElement.setAttribute === "function" && selectElement.title) {
          selectElement.setAttribute("aria-label", selectElement.title);
        }
      }

      function populateSubtaskThinkingSelect(selectElement, route) {
        if (!selectElement || isSelectFocused(selectElement) || typeof appendCodexThinkingOptions !== "function") {
          return;
        }
        selectElement.innerHTML = "";
        if (route.subtaskCli === "dsh") {
          const model = readLoopSubtaskModelSelection(route);
          const options = typeof getDshReasoningOptionsForModel === "function"
            ? getDshReasoningOptionsForModel(model)
            : [];
          options.forEach((option) => appendThinkingOption(selectElement, option, option));
          const requested = readLoopSubtaskThinkingSelection(route);
          const fallback = state.thinkingModeByCli && state.thinkingModeByCli.dsh;
          selectElement.value = options.includes(requested)
            ? requested
            : options.includes(fallback) ? fallback : (options[0] || "");
          selectElement.disabled = options.length === 0;
          selectElement.title = t("dshLoopSubtaskThinkingModeAria");
          if (typeof selectElement.setAttribute === "function") {
            selectElement.setAttribute("aria-label", selectElement.title);
          }
          return;
        }
        if (route.subtaskCli === "kimi-code") {
          // Kimi Code 的思考档只有 low/medium/high/xhigh/max，没有 off/on/ultra。
          ["low", "medium", "high", "xhigh", "max"].forEach((option) => {
            appendThinkingOption(selectElement, option, option);
          });
          const requested = readLoopSubtaskThinkingSelection(route);
          selectElement.value = ["low", "medium", "high", "xhigh", "max"].includes(requested) ? requested : "medium";
          selectElement.disabled = false;
          selectElement.title = t("kimiCodeLoopSubtaskThinkingModeAria");
          if (typeof selectElement.setAttribute === "function") {
            selectElement.setAttribute("aria-label", selectElement.title);
          }
          return;
        }
        if (route.subtaskCli === "grok" || route.subtaskCli === "claude") {
          appendThinkingOption(selectElement, "off", "off");
        }
        appendCodexThinkingOptions(selectElement);
        let value = "";
        if (route.subtaskCli === "opencode") {
          const models = getLoopSubtaskOpenCodeModelState();
          value = models && models.selectedSubtaskVariant
            ? models.selectedSubtaskVariant
            : (state.openCodeSmallThinking && state.openCodeSmallThinking.selectedVariant) || "medium";
        } else {
          value = readLoopSubtaskThinkingSelection(route) || "medium";
        }
        selectElement.value = value || "medium";
      }

      function updateLoopSubtaskTargetControls() {
        if (typeof getLoopSubtaskRoute !== "function") {
          return;
        }
        const route = getLoopSubtaskRoute();
        const mode = normalizeInteractiveMode(state.interactiveMode);
        const active = mode === "loop" || mode === "graph" || mode === "loop_plus";
        const showModel = active && route.subtaskCli !== "claude";
        const showThinking = active;
        const rows = [
          { cli: elements.codexLoopSubtaskCliSelect, model: elements.codexLoopSubtaskModelSelect, thinking: elements.codexLoopSubtaskThinkingMode, enabled: isLoopRoleModelMode(state.currentCli, mode) },
          { cli: elements.openCodeLoopSubtaskCliSelect, model: elements.openCodeSmallModelSelect, thinking: elements.openCodeSmallThinkingMode, enabled: active && state.currentCli === "opencode" },
          { cli: elements.claudeLoopSubtaskCliSelect, model: elements.claudeLoopSubtaskModelSelect, thinking: elements.claudeLoopSubtaskThinkingMode, enabled: active && state.currentCli === "claude" },
        ];
        rows.forEach((row) => {
          if (row.cli) {
            fillSubtaskCliSelect(row.cli, route.subtaskCli);
            row.cli.disabled = !row.enabled;
          }
          if (!row.enabled) {
            return;
          }
          setRouteControlVisible(row.model, showModel);
          setRouteControlVisible(row.thinking, showThinking);
          if (showModel) {
            populateSubtaskModelSelect(row.model, route);
          } else if (row.model && !isSelectFocused(row.model)) {
            row.model.innerHTML = "";
          }
          if (showThinking) {
            populateSubtaskThinkingSelect(row.thinking, route);
          }
          if (row.model) {
            row.model.disabled = !showModel || Boolean(route.unavailableReason);
          }
          if (row.thinking) {
            row.thinking.disabled = Boolean(route.unavailableReason);
          }
        });
        if (elements.loopSubtaskRouteIssue) {
          const routeIssue = !shouldShowSubtaskRouteIssue(mode)
            ? ""
            : route.configPending
              ? t("loopSubtaskRouteConfigSyncing")
              : route.unavailableReason;
          elements.loopSubtaskRouteIssue.textContent = routeIssue;
          elements.loopSubtaskRouteIssue.style.display = routeIssue ? "inline" : "none";
        }
        state.loopSubtaskRoute = route;
      }

      function syncModelSelectorByInteractiveMode(cli = state.currentCli) {
        if (typeof syncCliSelectAvailability === "function") {
          syncCliSelectAvailability();
        }
        const supportsModelSelection = cliSupportsModelSelection(cli);
        const isOpenCode = cli === "opencode";
        const interactiveMode = normalizeInteractiveMode(state.interactiveMode);
        const isLoop = interactiveMode === "loop";
        const showCodexLoopModelGroup = isLoopRoleModelMode(cli, interactiveMode);
        const showOpenCodeSubtaskModel = isOpenCodeRoleModelMode(cli, interactiveMode);
        const showSingleModelSelect = supportsModelSelection && !showCodexLoopModelGroup;
        const showLoopExecutionModeSelect = isLoop;
        const showClaudeSubtaskRoute = cli === "claude" && (
          interactiveMode === "loop" || interactiveMode === "graph" || interactiveMode === "loop_plus"
        );
        if (elements.codexLoopModelGroup) {
          elements.codexLoopModelGroup.style.display = showCodexLoopModelGroup ? "" : "none";
        }
        if (elements.codexLoopMainModelSelect) {
          elements.codexLoopMainModelSelect.disabled = !showCodexLoopModelGroup;
        }
        if (elements.codexLoopSubtaskModelSelect) {
          elements.codexLoopSubtaskModelSelect.disabled = !showCodexLoopModelGroup;
        }
        if (elements.codexLoopMainThinkingMode) {
          elements.codexLoopMainThinkingMode.disabled = !showCodexLoopModelGroup;
          elements.codexLoopMainThinkingMode.style.display = showCodexLoopModelGroup ? "" : "none";
        }
        if (elements.codexLoopSubtaskThinkingMode) {
          elements.codexLoopSubtaskThinkingMode.disabled = !showCodexLoopModelGroup;
          elements.codexLoopSubtaskThinkingMode.style.display = showCodexLoopModelGroup ? "" : "none";
        }
        if (elements.openCodeModelGroup) {
          elements.openCodeModelGroup.style.display = isOpenCode ? "" : "none";
        }
        if (elements.claudeLoopSubtaskGroup) {
          elements.claudeLoopSubtaskGroup.style.display = showClaudeSubtaskRoute ? "" : "none";
        }
        if (elements.openCodePrimaryModelSelect) {
          elements.openCodePrimaryModelSelect.disabled = !isOpenCode;
        }
        if (elements.openCodeSmallModelSelect) {
          elements.openCodeSmallModelSelect.disabled = !showOpenCodeSubtaskModel;
          const row = elements.openCodeSmallModelSelect.parentElement;
          if (row) {
            row.style.display = showOpenCodeSubtaskModel ? "" : "none";
          }
        }
        if (elements.modelSelect) {
          elements.modelSelect.style.display = showSingleModelSelect ? "" : "none";
          elements.modelSelect.disabled = !showSingleModelSelect;
        }
        if (elements.loopExecutionModeSelect) {
          elements.loopExecutionModeSelect.style.display = showLoopExecutionModeSelect ? "" : "none";
          elements.loopExecutionModeSelect.disabled = !showLoopExecutionModeSelect;
          elements.loopExecutionModeSelect.value = getLoopExecutionModeForCli();
        }
        if (typeof updateLoopSubtaskTargetControls === "function") {
          updateLoopSubtaskTargetControls();
        }
      }

      function handleCurrentCliSelectionChange(cli) {
        syncModelSelectorByInteractiveMode(cli);
        if (!canOpenModelManagerDialog(cli)) {
          hideAddModelDialog();
        }
      }

      function showAddModelDialog() {
        if (!elements.addModelOverlay || !canOpenModelManagerDialog()) {
          return;
        }
        if (elements.modelSelect) {
          elements.modelSelect.value = state.selectedModel || "";
        }
        resetModelManageForm();
        renderModelManagerList();
        reportModelManagerInspection();
        elements.addModelOverlay.classList.add("visible");
        elements.modelInput.focus();
      }

      function hideAddModelDialog() {
        if (!elements.addModelOverlay) {
          return;
        }
        elements.addModelOverlay.classList.remove("visible");
        resetModelManageForm();
        if (elements.modelSelect) {
          elements.modelSelect.value = state.selectedModel || "";
        }
      }

      function shouldSubmitModelInputOnEnter(event, isComposing, lastCompositionEndAt, now = Date.now()) {
        return event.key === "Enter"
          && !event.isComposing
          && !isComposing
          && event.keyCode !== 229
          && event.which !== 229
          && now - lastCompositionEndAt > 150;
      }

      function confirmAddModel() {
        if (!cliSupportsManagedModelSelection()) {
          return;
        }
        const modelName = elements.modelInput.value.trim();
        if (!modelName) {
          showModelManageError(t("modelAddEmptyError"));
          return;
        }
        const existingModels = getModelsForCurrentCli();
        const editingKey = editingModelName ? editingModelName.toLowerCase() : "";
        const duplicate = existingModels.some((model) => {
          const currentKey = String(model).toLowerCase();
          return currentKey === modelName.toLowerCase() && currentKey !== editingKey;
        });
        if (duplicate) {
          showModelManageError(t("modelAddExistsError"));
          return;
        }
        if (editingModelName) {
          vscode.postMessage({
            type: "renameCliModel",
            cli: state.currentCli,
            previousModel: editingModelName,
            nextModel: modelName,
            configId: getCurrentModelConfigId(),
          });
        } else {
          vscode.postMessage({
            type: "addCliModel",
            cli: state.currentCli,
            model: modelName,
            configId: getCurrentModelConfigId(),
          });
        }
        resetModelManageForm();
      }

      if (elements.addModelOverlay) {
        let modelInputIsComposing = false;
        let modelInputLastCompositionEndAt = 0;
        elements.closeAddModel.addEventListener("click", hideAddModelDialog);
        elements.cancelAddModel.addEventListener("click", hideAddModelDialog);
        if (elements.clearModelEdit) {
          elements.clearModelEdit.addEventListener("click", resetModelManageForm);
        }
        elements.confirmAddModel.addEventListener("click", confirmAddModel);
        elements.addModelOverlay.addEventListener("click", (event) => {
          if (event.target === elements.addModelOverlay) {
            hideAddModelDialog();
          }
        });
        elements.modelInput.addEventListener("compositionstart", () => {
          modelInputIsComposing = true;
        });
        elements.modelInput.addEventListener("compositionend", () => {
          modelInputIsComposing = false;
          modelInputLastCompositionEndAt = Date.now();
        });
        elements.modelInput.addEventListener("keydown", (event) => {
          if (shouldSubmitModelInputOnEnter(event, modelInputIsComposing, modelInputLastCompositionEndAt)) {
            event.preventDefault();
            confirmAddModel();
          } else if (event.key === "Escape") {
            hideAddModelDialog();
          }
        });
      }


      function normalizeSubtaskThinkingValue(cli, rawValue) {
        const normalized = typeof rawValue === "string" ? rawValue.trim() : "";
        if (cli === "dsh") {
          return ["low", "high", "xhigh", "max"].includes(normalized) ? normalized : "";
        }
        if (cli === "kimi-code") {
          return ["low", "medium", "high", "xhigh", "max"].includes(normalized) ? normalized : "";
        }
        if (normalized === "off") {
          return cli === "grok" || cli === "claude" ? "off" : "low";
        }
        return ["low", "medium", "high", "xhigh", "max", "ultra"].indexOf(normalized) >= 0 ? normalized : "";
      }

      function readLoopSubtaskModelSelection(route) {
        if (!route || route.subtaskCli === "claude") {
          return "";
        }
        if (route.subtaskCli === "opencode") {
          const models = getLoopSubtaskOpenCodeModelState();
          return normalizeModelSelection(models && (models.selectedSubtaskRef || models.selectedSmallRef));
        }
        return typeof getSelectedLoopRoleModelForCli === "function"
          ? getSelectedLoopRoleModelForCli(route.subtaskCli, "subtask")
          : "";
      }

      function readLoopSubtaskThinkingSelection(route) {
        if (!route || route.subtaskCli === "opencode") {
          return "";
        }
        const stored = state.selectedLoopThinkingByCli
          && state.selectedLoopThinkingByCli[route.subtaskCli]
          ? state.selectedLoopThinkingByCli[route.subtaskCli].subtask
          : "";
        return normalizeSubtaskThinkingValue(route.subtaskCli, stored)
          || (state.thinkingModeByCli
            ? normalizeSubtaskThinkingValue(route.subtaskCli, state.thinkingModeByCli[route.subtaskCli])
            : "")
          || "";
      }

      function handleLoopSubtaskCliChange(rawValue) {
        const names = typeof getEnabledCliNames === "function"
          ? getEnabledCliNames()
          : (Array.isArray(CLI_NAMES) ? CLI_NAMES : ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
        if (names.indexOf(rawValue) < 0) {
          return;
        }
        const nextCli = rawValue;
        const mainConfigId = getActiveConfigIdForStateCli(state.currentCli);
        if (!state.selectedLoopSubtaskCliByConfigId || typeof state.selectedLoopSubtaskCliByConfigId !== "object") {
          state.selectedLoopSubtaskCliByConfigId = {};
        }
        if (mainConfigId) {
          state.selectedLoopSubtaskCliByConfigId[mainConfigId] = nextCli;
          state.pendingLoopSubtaskCliSelection = { configId: mainConfigId, cli: nextCli };
        }
        if (typeof updateLoopSubtaskTargetControls === "function") {
          updateLoopSubtaskTargetControls();
        }
        vscode.postMessage({
          type: "selectLoopSubtaskCli",
          cli: nextCli,
          configId: mainConfigId,
        });
      }

      function postOpenCodeSubtaskRouteModel(route, rawValue) {
        const models = getLoopSubtaskOpenCodeModelState() || {};
        const selectedRef = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
        const configRef = models.configSubtaskRef || models.configSmallRef || null;
        const value = selectedRef && selectedRef === configRef ? null : selectedRef;
        const effectiveRef = value || configRef || null;
        const targetState = route.crossCli && state.loopSubtaskOpenCodeModels
          ? state.loopSubtaskOpenCodeModels
          : state.openCodeModels;
        if (targetState) {
          targetState.selectedSubtaskRef = effectiveRef;
          targetState.selectedSmallRef = effectiveRef;
        }
        vscode.postMessage({
          type: "updateOpenCodeRoleModel",
          role: "small",
          modelRole: "subtask",
          value,
          configId: route.subtaskConfigId,
        });
      }

      function handleLoopSubtaskModelChange(rawValue) {
        const route = getLoopSubtaskRoute();
        if (!route || route.subtaskCli === "claude" || route.unavailableReason) {
          return;
        }
        if (route.subtaskCli === "opencode") {
          if (!route.crossCli && state.currentCli === "opencode" && typeof handleOpenCodeRoleModelChange === "function") {
            handleOpenCodeRoleModelChange("subtask", rawValue);
            return;
          }
          postOpenCodeSubtaskRouteModel(route, rawValue);
          return;
        }
        const value = normalizeModelSelection(rawValue);
        if (!state.selectedLoopModelsByCli || typeof state.selectedLoopModelsByCli !== "object") {
          state.selectedLoopModelsByCli = {};
        }
        const existingSelection = state.selectedLoopModelsByCli[route.subtaskCli] || { main: "", subtask: "" };
        state.selectedLoopModelsByCli[route.subtaskCli] = {
          main: normalizeModelSelection(existingSelection.main),
          subtask: value,
        };
        if (!state.selectedLoopThinkingByCli || typeof state.selectedLoopThinkingByCli !== "object") {
          state.selectedLoopThinkingByCli = {};
        }
        const existingThinking = state.selectedLoopThinkingByCli[route.subtaskCli] || { main: "", subtask: "" };
        state.selectedLoopThinkingByCli[route.subtaskCli] = {
          main: normalizeSubtaskThinkingValue(route.subtaskCli, existingThinking.main),
          subtask: "",
        };
        vscode.postMessage({
          type: "selectCliLoopModel",
          cli: route.subtaskCli,
          role: "subtask",
          model: value || null,
          configId: route.subtaskConfigId,
        });
      }

      function handleLoopSubtaskThinkingChange(rawValue) {
        const route = getLoopSubtaskRoute();
        if (!route || route.unavailableReason) {
          return;
        }
        if (route.subtaskCli === "opencode") {
          if (!route.crossCli && state.currentCli === "opencode" && typeof handleOpenCodeThinkingModeChange === "function") {
            handleOpenCodeThinkingModeChange("subtask", rawValue);
            return;
          }
          const selectedVariant = typeof rawValue === "string" ? rawValue.trim() : "";
          const value = ["low", "medium", "high", "xhigh", "max", "ultra"].indexOf(selectedVariant) >= 0
            ? selectedVariant
            : null;
          const models = getLoopSubtaskOpenCodeModelState() || {};
          if (state.loopSubtaskOpenCodeModels) {
            state.loopSubtaskOpenCodeModels.selectedSubtaskVariant = value;
          }
          vscode.postMessage({
            type: "updateOpenCodeVariant",
            role: "small",
            modelRole: "subtask",
            value,
            configId: route.subtaskConfigId,
            model: models.selectedSubtaskRef || models.selectedSmallRef || null,
          });
          return;
        }
        const value = normalizeSubtaskThinkingValue(route.subtaskCli, rawValue) || "medium";
        if (route.subtaskCli === "dsh" && !getDshReasoningOptionsForModel(readLoopSubtaskModelSelection(route)).includes(value)) {
          return;
        }
        if (!state.selectedLoopThinkingByCli || typeof state.selectedLoopThinkingByCli !== "object") {
          state.selectedLoopThinkingByCli = {};
        }
        const existingThinking = state.selectedLoopThinkingByCli[route.subtaskCli] || { main: "", subtask: "" };
        state.selectedLoopThinkingByCli[route.subtaskCli] = {
          main: normalizeSubtaskThinkingValue(route.subtaskCli, existingThinking.main),
          subtask: value,
        };
        vscode.postMessage({
          type: "updateSetting",
          key: "selectedLoopThinkingMode." + route.subtaskCli + ".subtask",
          value,
        });
      }

      function handleCodexLoopRoleModelChange(role, rawValue) {
        const value = normalizeModelSelection(rawValue);
        if (!state.selectedLoopModelsByCli || typeof state.selectedLoopModelsByCli !== "object") {
          state.selectedLoopModelsByCli = {};
        }
        const cli = state.currentCli;
        const existingSelection = state.selectedLoopModelsByCli[cli] || { main: "", subtask: "" };
        state.selectedLoopModelsByCli[cli] = {
          main: role === "main" ? value : normalizeModelSelection(existingSelection.main),
          subtask: role === "subtask" ? value : normalizeModelSelection(existingSelection.subtask),
        };
        if (!state.selectedLoopThinkingByCli || typeof state.selectedLoopThinkingByCli !== "object") {
          state.selectedLoopThinkingByCli = {};
        }
        const existingThinking = state.selectedLoopThinkingByCli[cli] || { main: "", subtask: "" };
        state.selectedLoopThinkingByCli[cli] = {
          main: role === "main" ? "" : normalizeThinkingModeSelection(existingThinking.main),
          subtask: role === "subtask" ? "" : normalizeThinkingModeSelection(existingThinking.subtask),
        };
        if (typeof updateCodexLoopThinkingSelectOptions === "function") {
          updateCodexLoopThinkingSelectOptions();
        }
        vscode.postMessage({
          type: "selectCliLoopModel",
          cli,
          role,
          model: value || null,
          configId: getCurrentModelConfigId(),
        });
      }

      if (elements.codexLoopMainModelSelect) {
        elements.codexLoopMainModelSelect.addEventListener("change", (event) => {
          handleCodexLoopRoleModelChange("main", event.target.value);
        });
      }

      if (elements.codexLoopSubtaskModelSelect) {
        elements.codexLoopSubtaskModelSelect.addEventListener("change", (event) => {
          handleLoopSubtaskModelChange(event.target.value);
        });
      }
      if (elements.openCodeSmallModelSelect) {
        // OpenCode role changes stay on the existing listener in event bindings.
      }
      [
        elements.codexLoopSubtaskCliSelect,
        elements.openCodeLoopSubtaskCliSelect,
        elements.claudeLoopSubtaskCliSelect,
      ].forEach((selectElement) => {
        if (!selectElement) {
          return;
        }
        selectElement.addEventListener("change", (event) => {
          handleLoopSubtaskCliChange(event.target.value);
        });
      });
      if (elements.claudeLoopSubtaskModelSelect) {
        elements.claudeLoopSubtaskModelSelect.addEventListener("change", (event) => {
          handleLoopSubtaskModelChange(event.target.value);
        });
      }

      function handleCodexLoopRoleThinkingChange(role, rawValue) {
        const cli = state.currentCli;
        const value = cli === "dsh"
          ? normalizeLoopRoleThinkingSelection(cli, role, rawValue)
          : normalizeThinkingModeSelection(rawValue) || "medium";
        if (!value) {
          return;
        }
        if (!state.selectedLoopThinkingByCli || typeof state.selectedLoopThinkingByCli !== "object") {
          state.selectedLoopThinkingByCli = {};
        }
        const existingThinking = state.selectedLoopThinkingByCli[cli] || { main: "", subtask: "" };
        state.selectedLoopThinkingByCli[cli] = {
          main: role === "main" ? value : normalizeThinkingModeSelection(existingThinking.main),
          subtask: role === "subtask" ? value : normalizeThinkingModeSelection(existingThinking.subtask),
        };
        vscode.postMessage({
          type: "updateSetting",
          key: "selectedLoopThinkingMode." + cli + "." + role,
          value,
        });
      }

      if (elements.codexLoopMainThinkingMode) {
        elements.codexLoopMainThinkingMode.addEventListener("change", (event) => {
          handleCodexLoopRoleThinkingChange("main", event.target.value);
        });
      }

      if (elements.codexLoopSubtaskThinkingMode) {
        elements.codexLoopSubtaskThinkingMode.addEventListener("change", (event) => {
          handleLoopSubtaskThinkingChange(event.target.value);
        });
      }
      if (elements.claudeLoopSubtaskThinkingMode) {
        elements.claudeLoopSubtaskThinkingMode.addEventListener("change", (event) => {
          handleLoopSubtaskThinkingChange(event.target.value);
        });
      }

      if (elements.modelSelect) {
        updateModelSelectOptions();
        elements.modelSelect.addEventListener("change", (event) => {
          handleModelSelectChange(event.target.value || "");
        });
      }
      syncModelSelectorByInteractiveMode();

      if (elements.loopExecutionModeSelect) {
        elements.loopExecutionModeSelect.addEventListener("change", (event) => {
          const nextMode = setLoopExecutionModeForCli(state.currentCli, event.target.value);
          elements.loopExecutionModeSelect.value = nextMode;
          vscode.postMessage({
            type: "updateSetting",
            key: "loopExecutionMode." + state.currentCli,
            value: nextMode,
          });
        });
      }

      if (elements.interactiveModeSelect) {
        elements.interactiveModeSelect.addEventListener("change", (event) => {
          const nextMode = normalizeInteractiveMode(event.target.value);
          state.interactiveMode = nextMode;
          syncModelSelectorByInteractiveMode();
          vscode.postMessage({
            type: "updateSetting",
            key: "interactiveMode." + state.currentCli,
            value: nextMode,
          });
        });
      }
      if (elements.debugMode) {
        elements.debugMode.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.debug = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "debug",
            value: enabled,
          });
        });
      }
      if (elements.autoAddEditorContextTags) {
        elements.autoAddEditorContextTags.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.autoAddEditorContextTags = enabled;
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
          syncPromptContextWithEditorContext({ resetDismissed: true });
          renderPromptContextTags();
          vscode.postMessage({
            type: "updateSetting",
            key: "autoAddEditorContextTags",
            value: enabled,
          });
        });
      }
      if (elements.longTermMemoryEnabled) {
        elements.longTermMemoryEnabled.addEventListener("change", (event) => {
          if (state.workspaceHarnessInstalled) {
            syncLongTermMemoryWorkspaceControl();
            return;
          }
          const enabled = Boolean(event.target.checked);
          state.longTermMemoryEnabled = enabled;
          state.workspaceMemoryEnabled = enabled;
          syncLongTermMemoryWorkspaceControl();
          if (enabled) {
            vscode.postMessage({
              type: "initializeWorkspaceHarness",
              enabled: true,
            });
            return;
          }
          vscode.postMessage({
            type: "updateSetting",
            key: "workspaceMemoryEnabled",
            value: false,
          });
        });
      }
      if (elements.codeGraphEnabled) {
        elements.codeGraphEnabled.addEventListener("change", (event) => {
          if (state.codeGraphInstalled || state.codeGraphInstalling) {
            syncCodeGraphWorkspaceControl();
            return;
          }
          const enabled = Boolean(event.target.checked);
          if (!enabled) {
            syncCodeGraphWorkspaceControl();
            return;
          }
          syncCodeGraphWorkspaceControl();
          vscode.postMessage({
            type: "installCodeGraph",
          });
        });
      }
`;
