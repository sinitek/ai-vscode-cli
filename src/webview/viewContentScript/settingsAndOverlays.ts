// Tool settings, modal tabs, rules, history, and prompt input handlers.
export const VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS = `      function setToolSettingsTab(scope) {
        const workspace = scope === "workspace";
        if (elements.toolSettingsGlobalTab) {
          elements.toolSettingsGlobalTab.classList.toggle("active", !workspace);
          elements.toolSettingsGlobalTab.setAttribute("aria-selected", workspace ? "false" : "true");
        }
        if (elements.toolSettingsWorkspaceTab) {
          elements.toolSettingsWorkspaceTab.classList.toggle("active", workspace);
          elements.toolSettingsWorkspaceTab.setAttribute("aria-selected", workspace ? "true" : "false");
        }
        if (elements.toolSettingsGlobalPanel) {
          elements.toolSettingsGlobalPanel.classList.toggle("active", !workspace);
        }
        if (elements.toolSettingsWorkspacePanel) {
          elements.toolSettingsWorkspacePanel.classList.toggle("active", workspace);
        }
      }

      function getActiveLoopMainTaskId() {
        const conversationTabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs
          : { activeTabId: null, tabs: [] };
        const activeTab = conversationTabs.tabs.find((tab) => tab && tab.id === conversationTabs.activeTabId);
        if (!activeTab || activeTab.loopTaskRole !== "main") {
          return "";
        }
        return typeof activeTab.loopTaskId === "string" ? activeTab.loopTaskId.trim() : "";
      }

      function syncOpenCurrentLoopGroupChatButton() {
        if (!elements.openCurrentLoopGroupChat) {
          return;
        }
        const taskId = getActiveLoopMainTaskId();
        elements.openCurrentLoopGroupChat.style.display = taskId ? "inline-flex" : "none";
        elements.openCurrentLoopGroupChat.disabled = !taskId;
        if (elements.runWait) {
          elements.runWait.classList.toggle("has-current-loop-group-chat", Boolean(taskId));
        }
        if (typeof updateRunWait === "function") {
          updateRunWait();
        }
      }

      function openCurrentLoopGroupChat() {
        const taskId = getActiveLoopMainTaskId();
        if (!taskId) {
          return;
        }
        vscode.postMessage({ type: "openLoopGroupChat", taskId });
      }

      function getActiveGraphRunId() {
        const conversationTabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs
          : { activeTabId: null, tabs: [] };
        const activeTab = conversationTabs.tabs.find((tab) => tab && tab.id === conversationTabs.activeTabId);
        const meta = typeof getGraphMetaForTabSummary === "function"
          ? getGraphMetaForTabSummary(activeTab)
          : null;
        return meta && typeof meta.graphRunId === "string" ? meta.graphRunId.trim() : "";
      }

      function syncOpenCurrentGraphRunButton() {
        if (!elements.openCurrentGraphRun) {
          return;
        }
        const graphRunId = getActiveGraphRunId();
        elements.openCurrentGraphRun.style.display = graphRunId ? "inline-flex" : "none";
        elements.openCurrentGraphRun.disabled = !graphRunId;
        if (elements.runWait) {
          elements.runWait.classList.toggle("has-current-graph-run", Boolean(graphRunId));
        }
        if (typeof updateRunWait === "function") {
          updateRunWait();
        }
      }

      function openCurrentGraphRun() {
        const graphRunId = getActiveGraphRunId();
        if (!graphRunId) {
          return;
        }
        vscode.postMessage({ type: "openGraphRun", graphRunId });
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = state.currentCli === "opencode"
          || (supported && (state.currentCli === "claude" || state.currentCli === "codex"));
        const disabled = !visible || state.isRunning;
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = disabled;
        elements.commonCommandButton.setAttribute("aria-disabled", String(disabled));
        elements.commonCommandButton.tabIndex = disabled ? -1 : 0;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = disabled;
        }
      }

      if (elements.toolSettingsGlobalTab) {
        elements.toolSettingsGlobalTab.addEventListener("click", () => setToolSettingsTab("global"));
      }
      if (elements.toolSettingsWorkspaceTab) {
        elements.toolSettingsWorkspaceTab.addEventListener("click", () => setToolSettingsTab("workspace"));
      }
      if (elements.autoCompactContextAfterRun) {
        elements.autoCompactContextAfterRun.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.autoCompactContextAfterRun = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "autoCompactContextAfterRun",
            value: enabled,
          });
        });
      }
      if (elements.multiAgentEnabled) {
        elements.multiAgentEnabled.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.multiAgentEnabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "multiAgentEnabled",
            value: enabled,
          });
        });
      }
      if (elements.humanInteractionEnabled) {
        elements.humanInteractionEnabled.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.humanInteractionEnabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "humanInteractionEnabled",
            value: enabled,
          });
        });
      }
      if (elements.loopMaxRounds) {
        const commitLoopMaxRounds = () => {
          const nextValue = normalizeLoopMaxRounds(elements.loopMaxRounds.value);
          state.loopMaxRounds = nextValue;
          elements.loopMaxRounds.value = String(nextValue);
          vscode.postMessage({
            type: "updateSetting",
            key: "loopMaxRounds",
            value: nextValue,
          });
        };
        elements.loopMaxRounds.addEventListener("change", commitLoopMaxRounds);
        elements.loopMaxRounds.addEventListener("blur", commitLoopMaxRounds);
      }
      if (elements.loopSubtaskMaxThinkingMode) {
        elements.loopSubtaskMaxThinkingMode.addEventListener("change", (event) => {
          const nextValue = normalizeLoopSubtaskMaxThinkingMode(event.target.value);
          state.loopSubtaskMaxThinkingMode = nextValue;
          elements.loopSubtaskMaxThinkingMode.value = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "loopSubtaskMaxThinkingMode",
            value: nextValue,
          });
        });
      }
      if (elements.languageSelect) {
        elements.languageSelect.addEventListener("change", (event) => {
          const nextValue = event.target.value || "auto";
          state.locale = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "locale",
            value: nextValue,
          });
        });
      }
      if (elements.macTaskShell) {
        elements.macTaskShell.addEventListener("change", (event) => {
          const nextValue = event.target.value === "bash" ? "bash" : "zsh";
          state.macTaskShell = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "macTaskShell",
            value: nextValue,
          });
        });
      }

      elements.openConfig.addEventListener("click", () => {
        vscode.postMessage({ type: "openConfig" });
      });

      elements.attachmentButton.addEventListener("click", () => {
        elements.attachmentInput.click();
      });

      elements.attachmentInput.addEventListener("change", (event) => {
        const input = event.target;
        if (!input || !input.files) {
          return;
        }
        handleFileSelection(input.files);
        input.value = "";
      });

      function openHistory() {
        if (elements.historyButton) {
          elements.historyButton.classList.add("is-loading");
          elements.historyButton.setAttribute("aria-busy", "true");
        }
        const showRenderedHistory = () => {
          try {
            renderSessionList();
            renderPromptHistoryList();
            setHistoryTab(state.historyTab);
            elements.historyOverlay.classList.add("visible");
          } finally {
            if (elements.historyButton) {
              elements.historyButton.classList.remove("is-loading");
              elements.historyButton.removeAttribute("aria-busy");
            }
          }
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            setTimeout(showRenderedHistory, 0);
          });
        } else {
          setTimeout(showRenderedHistory, 0);
        }
      }

      function closeHistory() {
        elements.historyOverlay.classList.remove("visible");
      }

      function openRules() {
        elements.rulesOverlay.classList.add("visible");
      }

      function closeRules() {
        elements.rulesOverlay.classList.remove("visible");
      }

      function openHelp() {
        elements.helpOverlay.classList.add("visible");
      }

      function closeHelp() {
        elements.helpOverlay.classList.remove("visible");
      }

      function openToolSettings() {
        elements.toolSettingsOverlay.classList.add("visible");
      }

      function closeToolSettings() {
        elements.toolSettingsOverlay.classList.remove("visible");
      }

      function openCommonCommands() {
        elements.commonCommandsOverlay.classList.add("visible");
      }

      function closeCommonCommands() {
        elements.commonCommandsOverlay.classList.remove("visible");
      }

      function normalizeHumanInteractionText(value, fallback) {
        const text = typeof value === "string" ? value.trim() : "";
        return text || fallback || "";
      }

      function normalizeHumanInteractionOptions(value) {
        if (!Array.isArray(value)) {
          return [];
        }
        const seen = new Set();
        const options = [];
        value.forEach((item) => {
          const record = item && typeof item === "object" ? item : {};
          const optionValue = normalizeHumanInteractionText(record.value, normalizeHumanInteractionText(record.id, normalizeHumanInteractionText(record.label, String(item || ""))));
          if (!optionValue || seen.has(optionValue)) {
            return;
          }
          seen.add(optionValue);
          options.push({
            value: optionValue,
            label: normalizeHumanInteractionText(record.label, optionValue),
            description: normalizeHumanInteractionText(record.description, ""),
          });
        });
        return options;
      }

      function normalizeHumanInteractionField(rawField, index) {
        const field = rawField && typeof rawField === "object" ? rawField : {};
        const id = normalizeHumanInteractionText(field.id, normalizeHumanInteractionText(field.name, "answer_" + (index + 1)));
        const options = normalizeHumanInteractionOptions(field.options);
        const supportedTypes = ["text", "password", "textarea", "radio", "checkbox", "select", "multiselect"];
        const requestedType = normalizeHumanInteractionText(field.type, options.length ? "radio" : "textarea").toLowerCase();
        return {
          id,
          label: normalizeHumanInteractionText(field.label, id),
          type: supportedTypes.includes(requestedType) ? requestedType : (options.length ? "radio" : "textarea"),
          required: field.required !== false,
          placeholder: normalizeHumanInteractionText(field.placeholder, ""),
          description: normalizeHumanInteractionText(field.description, ""),
          options,
          defaultValue: field.defaultValue,
        };
      }

      function normalizeHumanInteractionRequest(request) {
        const record = request && typeof request === "object" ? request : {};
        const rawFields = Array.isArray(record.formFields) ? record.formFields : [];
        const formFields = rawFields
          .map((field, index) => normalizeHumanInteractionField(field, index))
          .filter((field) => field.id);
        return {
          interactionId: normalizeHumanInteractionText(record.interactionId, createMessageId()),
          tabId: normalizeHumanInteractionText(record.tabId, getActiveConversationTabId() || ""),
          title: normalizeHumanInteractionText(record.title, t("humanInteractionTitle")),
          instruction: normalizeHumanInteractionText(record.instruction, t("humanInteractionDefaultInstruction")),
          formFields: formFields.length ? formFields : [normalizeHumanInteractionField({
            id: "answer",
            label: t("humanInteractionDefaultFieldLabel"),
            type: "textarea",
            required: true,
            placeholder: t("humanInteractionDefaultFieldPlaceholder"),
          }, 0)],
          submitLabel: normalizeHumanInteractionText(record.submitLabel, t("humanInteractionSubmit")),
          cancelLabel: normalizeHumanInteractionText(record.cancelLabel, t("humanInteractionReject")),
          values: {},
          error: "",
        };
      }

      function getHumanInteractionDefaultValues(field) {
        const value = field.defaultValue;
        if (Array.isArray(value)) {
          return value.map((item) => String(item));
        }
        if (typeof value === "string" && value.trim()) {
          return [value.trim()];
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return [String(value)];
        }
        return [];
      }

      function createHumanInteractionInput(field) {
        if (field.type === "textarea") {
          const textarea = document.createElement("textarea");
          textarea.className = "human-interaction-input human-interaction-textarea";
          textarea.rows = 4;
          textarea.setAttribute("data-human-field", field.id);
          textarea.placeholder = field.placeholder || "";
          textarea.value = getHumanInteractionDefaultValues(field)[0] || "";
          return textarea;
        }
        if (field.type === "select" || field.type === "multiselect") {
          const select = document.createElement("select");
          select.className = "human-interaction-input";
          select.setAttribute("data-human-field", field.id);
          select.multiple = field.type === "multiselect";
          if (select.multiple) {
            select.size = Math.min(Math.max(field.options.length, 2), 6);
          }
          const defaults = new Set(getHumanInteractionDefaultValues(field));
          field.options.forEach((option) => {
            const item = document.createElement("option");
            item.value = option.value;
            item.textContent = option.label;
            item.selected = defaults.has(option.value);
            select.appendChild(item);
          });
          return select;
        }
        if ((field.type === "radio" || field.type === "checkbox") && field.options.length) {
          const group = document.createElement("div");
          group.className = "human-interaction-options";
          const defaults = new Set(getHumanInteractionDefaultValues(field));
          field.options.forEach((option) => {
            const label = document.createElement("label");
            label.className = "human-interaction-option";
            const input = document.createElement("input");
            input.type = field.type === "radio" ? "radio" : "checkbox";
            input.name = "humanInteraction:" + field.id;
            input.value = option.value;
            input.setAttribute("data-human-field", field.id);
            input.checked = defaults.has(option.value);
            const text = document.createElement("span");
            text.textContent = option.label;
            label.appendChild(input);
            label.appendChild(text);
            if (option.description) {
              const description = document.createElement("small");
              description.textContent = option.description;
              label.appendChild(description);
            }
            group.appendChild(label);
          });
          return group;
        }
        if (field.type === "checkbox") {
          const label = document.createElement("label");
          label.className = "human-interaction-option";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.setAttribute("data-human-field", field.id);
          input.checked = getHumanInteractionDefaultValues(field).includes("true");
          const text = document.createElement("span");
          text.textContent = field.placeholder || field.label;
          label.appendChild(input);
          label.appendChild(text);
          return label;
        }
        const input = document.createElement("input");
        input.className = "human-interaction-input";
        input.type = field.type === "password" ? "password" : "text";
        input.setAttribute("data-human-field", field.id);
        input.placeholder = field.placeholder || "";
        input.value = getHumanInteractionDefaultValues(field)[0] || "";
        return input;
      }

      function renderHumanInteractionDialog() {
        const dialog = state.humanInteractionDialog;
        if (!elements.humanInteractionOverlay || !elements.humanInteractionForm) {
          return;
        }
        elements.humanInteractionTitle.textContent = dialog.title || t("humanInteractionTitle");
        elements.humanInteractionInstruction.textContent = dialog.instruction || t("humanInteractionDefaultInstruction");
        elements.humanInteractionSubmit.textContent = dialog.submitLabel || t("humanInteractionSubmit");
        elements.humanInteractionReject.textContent = dialog.cancelLabel || t("humanInteractionReject");
        elements.humanInteractionError.textContent = dialog.error || "";
        elements.humanInteractionError.style.display = dialog.error ? "block" : "none";
        elements.humanInteractionForm.innerHTML = "";
        dialog.formFields.forEach((field) => {
          const wrapper = document.createElement("div");
          wrapper.className = "human-interaction-field";
          const label = document.createElement("label");
          label.className = "human-interaction-label";
          label.textContent = field.required ? field.label + " *" : field.label;
          wrapper.appendChild(label);
          if (field.description) {
            const description = document.createElement("div");
            description.className = "human-interaction-description";
            description.textContent = field.description;
            wrapper.appendChild(description);
          }
          wrapper.appendChild(createHumanInteractionInput(field));
          elements.humanInteractionForm.appendChild(wrapper);
        });
        elements.humanInteractionOverlay.classList.toggle("visible", Boolean(dialog.open));
        if (dialog.open) {
          const firstControl = elements.humanInteractionForm.querySelector("[data-human-field]");
          if (firstControl && typeof firstControl.focus === "function") {
            firstControl.focus();
          }
        }
      }

      function openHumanInteractionDialog(request) {
        state.humanInteractionDialog = Object.assign({ open: true }, normalizeHumanInteractionRequest(request));
        renderHumanInteractionDialog();
        postWebviewDebug("human-interaction-request-received", {
          interactionId: state.humanInteractionDialog.interactionId,
          tabId: state.humanInteractionDialog.tabId,
          fields: state.humanInteractionDialog.formFields.length,
          overlayVisible: Boolean(elements.humanInteractionOverlay && elements.humanInteractionOverlay.classList.contains("visible")),
        });
      }

      function closeHumanInteractionDialog() {
        state.humanInteractionDialog = {
          open: false,
          interactionId: "",
          tabId: "",
          title: "",
          instruction: "",
          formFields: [],
          submitLabel: "",
          cancelLabel: "",
          values: {},
          error: "",
        };
        if (elements.humanInteractionOverlay) {
          elements.humanInteractionOverlay.classList.remove("visible");
        }
      }

      function collectHumanInteractionValues() {
        const values = {};
        const form = elements.humanInteractionForm;
        state.humanInteractionDialog.formFields.forEach((field) => {
          const controls = Array.from(form.querySelectorAll("[data-human-field]"))
            .filter((control) => control.getAttribute("data-human-field") === field.id);
          if (field.type === "checkbox" && !field.options.length) {
            values[field.id] = Boolean(controls[0] && controls[0].checked);
            return;
          }
          if (field.type === "multiselect") {
            const control = controls[0];
            values[field.id] = control && control.selectedOptions
              ? Array.from(control.selectedOptions).map((option) => option.value)
              : [];
            return;
          }
          if (field.type === "checkbox") {
            values[field.id] = controls
              .filter((control) => control.checked)
              .map((control) => control.value);
            return;
          }
          if (field.type === "select") {
            const control = controls[0];
            values[field.id] = control ? control.value : "";
            return;
          }
          if (field.type === "radio") {
            const checked = controls.find((control) => control.checked);
            values[field.id] = checked ? checked.value : "";
            return;
          }
          values[field.id] = controls[0] ? controls[0].value : "";
        });
        return values;
      }

      function isHumanInteractionValueEmpty(value) {
        if (Array.isArray(value)) {
          return value.length === 0;
        }
        if (typeof value === "boolean") {
          return !value;
        }
        return !String(value || "").trim();
      }

      function submitHumanInteractionDialog() {
        const dialog = state.humanInteractionDialog;
        if (!dialog.open || !dialog.interactionId) {
          return;
        }
        const values = collectHumanInteractionValues();
        const missingField = dialog.formFields.find((field) => field.required && isHumanInteractionValueEmpty(values[field.id]));
        if (missingField) {
          dialog.error = t("humanInteractionRequired", { label: missingField.label });
          renderHumanInteractionDialog();
          return;
        }
        vscode.postMessage({
          type: "humanInteractionResponse",
          interactionId: dialog.interactionId,
          tabId: dialog.tabId,
          status: "completed",
          values,
        });
        closeHumanInteractionDialog();
      }

      function rejectHumanInteractionDialog() {
        const dialog = state.humanInteractionDialog;
        if (!dialog.open || !dialog.interactionId) {
          closeHumanInteractionDialog();
          return;
        }
        vscode.postMessage({
          type: "humanInteractionResponse",
          interactionId: dialog.interactionId,
          tabId: dialog.tabId,
          status: "aborted",
          values: {},
        });
        closeHumanInteractionDialog();
      }

      function cancelHumanInteractionDialog(tabId) {
        const dialog = state.humanInteractionDialog;
        if (!dialog.open) {
          return;
        }
        if (tabId && dialog.tabId && dialog.tabId !== tabId) {
          return;
        }
        closeHumanInteractionDialog();
      }

      function setHistoryTab(tab) {
        const isPrompts = tab === "prompts";
        const isSessions = !isPrompts;
        state.historyTab = isPrompts ? "prompts" : "sessions";
        elements.historyTabPrompts.classList.toggle("active", isPrompts);
        elements.historyTabSessions.classList.toggle("active", isSessions);
        elements.historyTabPrompts.setAttribute("aria-selected", String(isPrompts));
        elements.historyTabSessions.setAttribute("aria-selected", String(isSessions));
        elements.historyPanelPrompts.classList.toggle("active", isPrompts);
        elements.historyPanelSessions.classList.toggle("active", isSessions);
        if (elements.clearAllHistory) {
          elements.clearAllHistory.textContent = isPrompts
            ? t("historyClearPrompts")
            : t("historyClearSessions");
        }
        syncResetSessionAvailability();
      }

      function setHelpTab(tab) {
        const isModes = tab === "modes";
        const isInstall = !isModes;
        elements.helpTabModes.classList.toggle("active", isModes);
        elements.helpTabInstall.classList.toggle("active", isInstall);
        elements.helpTabModes.setAttribute("aria-selected", String(isModes));
        elements.helpTabInstall.setAttribute("aria-selected", String(isInstall));
        elements.helpPanelModes.classList.toggle("active", isModes);
        elements.helpPanelInstall.classList.toggle("active", isInstall);
      }

      function setRulesHint(message) {
        elements.rulesHint.textContent = message || "";
      }

      function collectRuleTargets() {
        const targets = [];
        if (elements.rulesSaveCodex.checked) {
          targets.push("codex");
        }
        if (elements.rulesSaveClaude.checked) {
          targets.push("claude");
        }
        if (elements.rulesSaveOpenCode.checked) {
          targets.push("opencode");
        }
        return targets;
      }

      function setRulesLoadCliOptions(isGlobal) {
        const currentValue = elements.rulesLoadCli.value;
        const options = isGlobal
          ? [
              { value: "codex", label: "codex" },
              { value: "claude", label: "claude" },
              { value: "opencode", label: "opencode" },
            ]
          : [
              { value: "codex", label: "codex/opencode" },
              { value: "claude", label: "claude" },
            ];
        elements.rulesLoadCli.innerHTML = "";
        options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          elements.rulesLoadCli.appendChild(optionElement);
        });
        const nextValue = options.some((option) => option.value === currentValue) ? currentValue : options[0].value;
        elements.rulesLoadCli.value = nextValue;
      }

      function syncRulesSaveOptions(isGlobal) {
        if (elements.rulesSaveCodexLabel) {
          elements.rulesSaveCodexLabel.textContent = isGlobal ? "codex" : "codex/opencode";
        }
        if (elements.rulesSaveOpenCodeOption) {
          elements.rulesSaveOpenCodeOption.style.display = isGlobal ? "" : "none";
        }
        if (!isGlobal && elements.rulesSaveOpenCode) {
          elements.rulesSaveOpenCode.checked = false;
        }
      }

      function updateRulesPath(cli) {
        if (!elements.rulesPath) {
          return;
        }
        const scopePaths = state.rulePaths ? state.rulePaths[state.ruleScope] : null;
        const pathText = scopePaths && scopePaths[cli] ? scopePaths[cli] : "";
        if (!pathText && state.ruleScope === "project") {
          elements.rulesPath.textContent = t("rulesPathNoWorkspace");
          return;
        }
        elements.rulesPath.textContent = pathText ? t("rulesPathPrefix") + pathText : "";
      }

      function updateRulesScope(scope) {
        state.ruleScope = scope;
        const isGlobal = scope === "global";
        elements.scopeGlobal.className = isGlobal ? "help-tab active" : "help-tab";
        elements.scopeProject.className = isGlobal ? "help-tab" : "help-tab active";
        elements.scopeGlobal.setAttribute("aria-selected", String(isGlobal));
        elements.scopeProject.setAttribute("aria-selected", String(!isGlobal));
        setRulesLoadCliOptions(isGlobal);
        syncRulesSaveOptions(isGlobal);
        updateRulesPath(elements.rulesLoadCli.value);
      }

      elements.historyButton.addEventListener("click", () => {
        openHistory();
      });

      elements.closeHistory.addEventListener("click", () => {
        closeHistory();
      });

      elements.closeHistoryMessages.addEventListener("click", () => {
        closeHistorySessionMessages();
      });

      elements.exportHistoryMessages.addEventListener("click", () => {
        requestHistorySessionExport(null);
      });

      if (elements.clearAllHistory) {
        elements.clearAllHistory.addEventListener("click", () => {
          if (state.historyTab === "prompts") {
            vscode.postMessage({ type: "clearPromptHistory" });
            return;
          }
          requestResetConversationTabSession();
        });
      }

      if (elements.promptHistoryFavoritesOnly) {
        elements.promptHistoryFavoritesOnly.addEventListener("change", (event) => {
          state.promptHistoryFavoritesOnly = Boolean(event.target.checked);
          persistWebviewUiState();
          renderPromptHistoryList();
        });
      }

      elements.historyTabPrompts.addEventListener("click", () => {
        setHistoryTab("prompts");
      });

      elements.historyTabSessions.addEventListener("click", () => {
        setHistoryTab("sessions");
      });

      elements.historyOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyOverlay) {
          closeHistory();
        }
      });

      elements.historyMessagesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyMessagesOverlay) {
          closeHistorySessionMessages();
        }
      });

      elements.rulesButton.addEventListener("click", () => {
        setRulesHint("");
        updateRulesScope(state.ruleScope);
        openRules();
      });

      elements.closeRules.addEventListener("click", () => {
        closeRules();
      });

      elements.rulesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.rulesOverlay) {
          closeRules();
        }
      });

      elements.helpButton.addEventListener("click", () => {
        setHelpTab("install");
        openHelp();
      });

      elements.closeHelp.addEventListener("click", () => {
        closeHelp();
      });

      elements.helpOverlay.addEventListener("click", (event) => {
        if (event.target === elements.helpOverlay) {
          closeHelp();
        }
      });

      elements.toolSettingsButton.addEventListener("click", () => {
        openToolSettings();
      });

      elements.closeToolSettings.addEventListener("click", () => {
        closeToolSettings();
      });

      elements.toolSettingsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.toolSettingsOverlay) {
          closeToolSettings();
        }
      });

      elements.commonCommandButton.addEventListener("click", () => {
        if (elements.commonCommandButton.getAttribute("aria-disabled") === "true") {
          return;
        }
        openCommonCommands();
      });

      elements.closeCommonCommands.addEventListener("click", () => {
        closeCommonCommands();
      });

      elements.commonCommandsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.commonCommandsOverlay) {
          closeCommonCommands();
        }
      });

      elements.commandCompact.addEventListener("click", () => {
        closeCommonCommands();
        vscode.postMessage({ type: "runCommonCommand", command: "compactContext" });
      });

      if (elements.closeHumanInteraction) {
        elements.closeHumanInteraction.addEventListener("click", () => {
          rejectHumanInteractionDialog();
        });
      }
      if (elements.humanInteractionReject) {
        elements.humanInteractionReject.addEventListener("click", () => {
          rejectHumanInteractionDialog();
        });
      }
      if (elements.humanInteractionSubmit) {
        elements.humanInteractionSubmit.addEventListener("click", () => {
          submitHumanInteractionDialog();
        });
      }
      if (elements.humanInteractionOverlay) {
        elements.humanInteractionOverlay.addEventListener("click", (event) => {
          if (event.target === elements.humanInteractionOverlay) {
            rejectHumanInteractionDialog();
          }
        });
      }

      elements.runConflictOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runConflictOverlay) {
          closeRunConflictOverlay();
        }
      });

      elements.closeRunConflict.addEventListener("click", () => {
        closeRunConflictOverlay();
      });

      elements.queuePrompt.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        queuePromptForLater(promptPayload);
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        resetPromptContextForNextPrompt();
      });

      elements.pauseAndSend.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        if (isLoopMainConversationTabRunning(getActiveConversationTabId())) {
          queuePromptForLater(promptPayload);
          resetPromptContextForNextPrompt();
          return;
        }
        const sent = dispatchPrompt(promptPayload);
        if (sent) {
          resetPromptContextForNextPrompt();
        }
      });

      elements.queueIndicator.addEventListener("click", () => {
        openQueueOverlay();
      });

      elements.continueQueue.addEventListener("click", () => {
        continueQueuedPrompts();
      });

      elements.runPromptButton.addEventListener("click", () => {
        openRunPromptOverlay();
      });

      if (elements.openCurrentLoopGroupChat) {
        elements.openCurrentLoopGroupChat.addEventListener("click", () => {
          openCurrentLoopGroupChat();
        });
      }

      if (elements.openCurrentGraphRun) {
        elements.openCurrentGraphRun.addEventListener("click", () => {
          openCurrentGraphRun();
        });
      }

      if (elements.conversationTabs) {
        elements.conversationTabs.addEventListener("click", () => {
          window.setTimeout(syncOpenCurrentLoopGroupChatButton, 0);
          window.setTimeout(syncOpenCurrentGraphRunButton, 0);
        });
      }

      elements.runStreamButton.addEventListener("click", () => {
        openRunStreamOverlay();
      });

      elements.exportRunStream.addEventListener("click", () => {
        requestRunStreamExport();
      });

      elements.runPromptOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runPromptOverlay) {
          closeRunPromptOverlay();
        }
      });

      elements.closeRunPrompt.addEventListener("click", () => {
        closeRunPromptOverlay();
      });

      elements.runStreamOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runStreamOverlay) {
          closeRunStreamOverlay();
        }
      });

      elements.closeRunStream.addEventListener("click", () => {
        closeRunStreamOverlay();
      });

      elements.configApplyErrorOverlay.addEventListener("click", (event) => {
        if (event.target === elements.configApplyErrorOverlay) {
          closeConfigApplyErrorOverlay();
        }
      });

      elements.closeConfigApplyError.addEventListener("click", () => {
        closeConfigApplyErrorOverlay();
      });

      elements.copyConfigApplyError.addEventListener("click", () => {
        const detail = elements.configApplyErrorContent
          ? String(elements.configApplyErrorContent.textContent || "")
          : "";
        if (!detail.trim()) {
          return;
        }
        copyTextToClipboard(detail, t("toastConfigApplyErrorCopied"));
      });

      elements.queueOverlay.addEventListener("click", (event) => {
        if (event.target === elements.queueOverlay) {
          closeQueueOverlay();
        }
      });

      elements.closeQueue.addEventListener("click", () => {
        closeQueueOverlay();
      });

      elements.helpTabModes.addEventListener("click", () => {
        setHelpTab("modes");
      });

      elements.helpTabInstall.addEventListener("click", () => {
        setHelpTab("install");
      });

      elements.loadRules.addEventListener("click", () => {
        const cli = elements.rulesLoadCli.value;
        setRulesHint(t("rulesHintLoading"));
        vscode.postMessage({ type: "loadRules", cli, scope: state.ruleScope });
      });

      elements.rulesLoadCli.addEventListener("change", (event) => {
        updateRulesPath(event.target.value);
      });

      elements.scopeGlobal.addEventListener("click", () => {
        updateRulesScope("global");
        setRulesHint("");
      });

      elements.scopeProject.addEventListener("click", () => {
        updateRulesScope("project");
        setRulesHint("");
      });

      elements.saveRules.addEventListener("click", () => {
        const targets = collectRuleTargets();
        if (!targets.length) {
          setRulesHint(t("rulesHintSelectCli"));
          return;
        }
        const content = elements.rulesInput.value || "";
        setRulesHint(t("rulesHintSaving"));
        vscode.postMessage({ type: "saveRules", content, targets, scope: state.ruleScope });
      });

      elements.sendPrompt.addEventListener("click", () => {
        sendPrompt();
      });

      elements.pathPickerButton.addEventListener("click", () => {
        requestWorkspacePathPick();
      });

      elements.scrollToBottomButton.addEventListener("click", () => {
        stickChatToBottom("smooth");
      });

      elements.chatArea.addEventListener("scroll", () => {
        if (shouldForceFollowLatestMessagesForActiveTab()) {
          followLatestMessages = true;
        } else if (!isScrollButtonSuppressed()) {
          followLatestMessages = isChatNearBottom();
        }
        updateScrollToBottomButton();
      });

      elements.stopRun.addEventListener("click", () => {
        vscode.postMessage({ type: "stopRun" });
      });

      elements.promptInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });

      elements.promptInput.addEventListener("compositionend", () => {
        isComposing = false;
        lastCompositionEndAt = Date.now();
      });

      elements.promptInput.addEventListener("keydown", (event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          requestWorkspacePathPick();
          return;
        }
        if (
          event.key === "Enter"
          && !event.shiftKey
          && !event.isComposing
          && !isComposing
          && event.keyCode !== 229
          && Date.now() - lastCompositionEndAt > compositionEnterGuardMs
        ) {
          event.preventDefault();
          sendPrompt();
        }
      });

      elements.promptInput.addEventListener("paste", (event) => {
        const files = getClipboardFiles(event);
        if (!files.length) {
          return;
        }
        event.preventDefault();
        handleFileSelection(files);
      });

      elements.promptInput.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      elements.promptInput.addEventListener("drop", (event) => {
        const uris = getDropUris(event);
        if (uris.length) {
          event.preventDefault();
          vscode.postMessage({ type: "resolveDropPaths", uris });
          return;
        }
        const files = event.dataTransfer && event.dataTransfer.files
          ? Array.from(event.dataTransfer.files)
          : [];
        if (files.length) {
          event.preventDefault();
          handleFileSelection(files);
        }
      });

`;
