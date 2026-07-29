// Model manager, model selection, and model persistence handlers.
export const VIEW_CONTENT_SCRIPT_MODEL_MANAGER = `      function cliSupportsManagedModelSelection(cli = state.currentCli) {
        return cli === "codex";
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

      function getCurrentModelConfigId() {
        return state.selectedConfigId || state.configState.activeConfigId || null;
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

        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = t("modelOptionDefault");
        elements.modelSelect.appendChild(defaultOption);

        availableModels.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName;
          elements.modelSelect.appendChild(option);
        });

        const manageOption = document.createElement("option");
        manageOption.value = MODEL_MANAGE_OPTION_VALUE;
        manageOption.textContent = t("modelOptionManage");
        elements.modelSelect.appendChild(manageOption);

        const nextValue = typeof state.selectedModel === "string" ? state.selectedModel : "";
        if (nextValue && availableModels.includes(nextValue)) {
          elements.modelSelect.value = nextValue;
          return;
        }
        elements.modelSelect.value = "";
      }

      function cliSupportsLoopRoleModelSelection(cli = state.currentCli) {
        return cli === "codex";
      }

      function isLoopRoleModelMode(cli = state.currentCli, interactiveMode = state.interactiveMode) {
        const normalizedMode = normalizeInteractiveMode(interactiveMode);
        return cliSupportsLoopRoleModelSelection(cli) && (normalizedMode === "loop" || normalizedMode === "graph");
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
        if (!selectElement) {
          return;
        }
        const availableModels = getLoopRoleModelsForCli(state.currentCli, role);
        selectElement.innerHTML = "";

        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = t("modelOptionDefault");
        selectElement.appendChild(defaultOption);

        availableModels.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName;
          selectElement.appendChild(option);
        });

        selectElement.value = getSelectedLoopRoleModelForCli(state.currentCli, role);
        selectElement.title = role === "subtask"
          ? t("codexLoopSubtaskModelSelectAria")
          : t("codexLoopMainModelSelectAria");
      }

      function updateCodexLoopModelSelectOptions() {
        updateCodexLoopRoleModelSelect(elements.codexLoopMainModelSelect, "main");
        updateCodexLoopRoleModelSelect(elements.codexLoopSubtaskModelSelect, "subtask");
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
        if (!selectElement) {
          return;
        }
        const payload = state.openCodeModels || normalizeOpenCodeModelsPayload(null);
        const models = Array.isArray(payload.models) ? payload.models : [];
        const selectedRef = role === "small" ? payload.selectedSmallRef : payload.selectedPrimaryRef;
        const validRefs = new Set(models.map((model) => model.ref));
        const nextValue = selectedRef && validRefs.has(selectedRef) ? selectedRef : "";
        if (role === "small") {
          payload.selectedSmallRef = nextValue || null;
        } else {
          payload.selectedPrimaryRef = nextValue || null;
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
        const baseTitle = role === "small"
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
        updateOpenCodeRoleModelSelect(elements.openCodePrimaryModelSelect, "primary");
        updateOpenCodeRoleModelSelect(elements.openCodeSmallModelSelect, "small");
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

      function syncModelSelectorByInteractiveMode(cli = state.currentCli) {
        const supportsModelSelection = cliSupportsManagedModelSelection(cli);
        const isOpenCode = cli === "opencode";
        const interactiveMode = normalizeInteractiveMode(state.interactiveMode);
        const isLoop = interactiveMode === "loop";
        const showCodexLoopModelGroup = isLoopRoleModelMode(cli, interactiveMode);
        const showSingleModelSelect = supportsModelSelection && !showCodexLoopModelGroup;
        const showLoopExecutionModeSelect = isLoop;
        if (elements.codexLoopModelGroup) {
          elements.codexLoopModelGroup.style.display = showCodexLoopModelGroup ? "" : "none";
        }
        if (elements.codexLoopMainModelSelect) {
          elements.codexLoopMainModelSelect.disabled = !showCodexLoopModelGroup;
        }
        if (elements.codexLoopSubtaskModelSelect) {
          elements.codexLoopSubtaskModelSelect.disabled = !showCodexLoopModelGroup;
        }
        if (elements.openCodeModelGroup) {
          elements.openCodeModelGroup.style.display = isOpenCode ? "" : "none";
        }
        if (elements.openCodePrimaryModelSelect) {
          elements.openCodePrimaryModelSelect.disabled = !isOpenCode;
        }
        if (elements.openCodeSmallModelSelect) {
          elements.openCodeSmallModelSelect.disabled = !isOpenCode;
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
        if (!supportsModelSelection) {
          hideAddModelDialog();
        }
      }

      function showAddModelDialog() {
        if (!elements.addModelOverlay || !cliSupportsManagedModelSelection()) {
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
        elements.modelInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirmAddModel();
          } else if (event.key === "Escape") {
            hideAddModelDialog();
          }
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
          handleCodexLoopRoleModelChange("subtask", event.target.value);
        });
      }

      if (elements.modelSelect) {
        updateModelSelectOptions();
        elements.modelSelect.addEventListener("change", (event) => {
          const value = event.target.value || "";
          if (value === MODEL_MANAGE_OPTION_VALUE) {
            showAddModelDialog();
            return;
          }
          state.selectedModel = value;
          if (state.selectedModelsByCli) {
            state.selectedModelsByCli[state.currentCli] = value;
          }
          vscode.postMessage({
            type: "selectCliModel",
            cli: state.currentCli,
            model: value || null,
            configId: getCurrentModelConfigId(),
          });
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
      if (elements.installCodeGraph) {
        elements.installCodeGraph.addEventListener("click", () => {
          vscode.postMessage({
            type: "installCodeGraph",
          });
        });
      }
`;
