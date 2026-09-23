// Tool settings, modal tabs, rules, history, and prompt input handlers.
export const VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS = `      function setToolSettingsTab(scope) {
        const aiTask = scope === "aiTask";
        const workspace = scope === "workspace";
        const repair = scope === "repair";
        const general = !aiTask && !workspace && !repair;
        if (elements.toolSettingsGeneralTab) {
          elements.toolSettingsGeneralTab.classList.toggle("active", general);
          elements.toolSettingsGeneralTab.setAttribute("aria-selected", general ? "true" : "false");
        }
        if (elements.toolSettingsAiTaskTab) {
          elements.toolSettingsAiTaskTab.classList.toggle("active", aiTask);
          elements.toolSettingsAiTaskTab.setAttribute("aria-selected", aiTask ? "true" : "false");
        }
        if (elements.toolSettingsWorkspaceTab) {
          elements.toolSettingsWorkspaceTab.classList.toggle("active", workspace);
          elements.toolSettingsWorkspaceTab.setAttribute("aria-selected", workspace ? "true" : "false");
        }
        if (elements.toolSettingsRepairTab) {
          elements.toolSettingsRepairTab.classList.toggle("active", repair);
          elements.toolSettingsRepairTab.setAttribute("aria-selected", repair ? "true" : "false");
        }
        if (elements.toolSettingsGeneralPanel) {
          elements.toolSettingsGeneralPanel.classList.toggle("active", general);
        }
        if (elements.toolSettingsAiTaskPanel) {
          elements.toolSettingsAiTaskPanel.classList.toggle("active", aiTask);
        }
        if (elements.toolSettingsWorkspacePanel) {
          elements.toolSettingsWorkspacePanel.classList.toggle("active", workspace);
        }
        if (elements.toolSettingsRepairPanel) {
          elements.toolSettingsRepairPanel.classList.toggle("active", repair);
        }
        if (repair) {
          requestCliRepairs();
        }
      }

      function requestCliRepairs() {
        vscode.postMessage({ type: "inspectCliRepairs" });
      }

      function renderCliRepairIssues(issues) {
        const body = elements.toolSettingsRepairBody;
        const table = elements.toolSettingsRepairTable;
        const empty = elements.toolSettingsRepairEmpty;
        if (!body) {
          return;
        }
        const list = Array.isArray(issues) ? issues : [];
        body.innerHTML = "";
        if (empty) {
          empty.hidden = list.length > 0;
        }
        if (table) {
          table.hidden = list.length === 0;
        }
        list.forEach((issue) => {
          const row = document.createElement("tr");
          const summaryCell = document.createElement("td");
          const summary = document.createElement("div");
          summary.className = "tool-settings-repair-summary";
          summary.textContent = issue && issue.summary ? String(issue.summary) : "";
          const detail = document.createElement("div");
          detail.className = "tool-settings-note";
          detail.textContent = t("toolSettingsCliRepairDetail", {
            command: issue && issue.command ? String(issue.command) : "",
          });
          summaryCell.appendChild(summary);
          summaryCell.appendChild(detail);
          const actionCell = document.createElement("td");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "action-button tool-settings-repair-button";
          button.textContent = t("toolSettingsCliRepairButton");
          button.addEventListener("click", () => {
            if (!issue || !issue.cli) {
              return;
            }
            button.disabled = true;
            button.textContent = t("toolSettingsCliRepairWorking");
            vscode.postMessage({ type: "repairCliCommand", cli: issue.cli });
          });
          actionCell.appendChild(button);
          row.appendChild(summaryCell);
          row.appendChild(actionCell);
          body.appendChild(row);
        });
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

      let scheduledTaskFiles = [];

      function formatScheduledTaskInputDate(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        return date.getFullYear()
          + "-" + pad(date.getMonth() + 1)
          + "-" + pad(date.getDate())
          + "T" + pad(date.getHours())
          + ":" + pad(date.getMinutes());
      }

      function getDefaultScheduledTaskTime() {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
        return formatScheduledTaskInputDate(date.getTime());
      }

      function setScheduledTaskError(message) {
        if (!elements.scheduledTaskError) {
          return;
        }
        elements.scheduledTaskError.textContent = message || "";
        elements.scheduledTaskError.style.display = message ? "block" : "none";
      }

      function renderScheduledTaskAttachments() {
        if (!elements.scheduledTaskAttachments) {
          return;
        }
        elements.scheduledTaskAttachments.innerHTML = "";
        scheduledTaskFiles.forEach((file) => {
          const item = document.createElement("span");
          item.className = "scheduled-task-attachment";
          item.textContent = file.name || t("attachmentFallbackName");
          elements.scheduledTaskAttachments.appendChild(item);
        });
      }

      function scheduledTaskModeLabel(mode) {
        if (mode === "loop") {
          return t("interactiveModeLoop");
        }
        if (mode === "graph") {
          return t("interactiveModeGraph");
        }
        if (mode === "coding") {
          return t("interactiveModeCoding");
        }
        return "";
      }

      function getScheduledTaskSelectedMode() {
        if (elements.scheduledTaskMode && elements.scheduledTaskMode.value) {
          return normalizeInteractiveMode(elements.scheduledTaskMode.value);
        }
        return normalizeInteractiveMode(state.interactiveMode);
      }

      function syncScheduledTaskModeSelect() {
        if (!elements.scheduledTaskMode) {
          return;
        }
        elements.scheduledTaskMode.value = normalizeInteractiveMode(state.interactiveMode);
      }

      function scheduledTaskStatusLabel(status) {
        const labels = {
          pending: "scheduledTaskStatusPending",
          running: "scheduledTaskStatusRunning",
          completed: "scheduledTaskStatusCompleted",
          failed: "scheduledTaskStatusFailed",
          cancelled: "scheduledTaskStatusCancelled",
        };
        return t(labels[status] || "scheduledTaskStatusPending");
      }

      function renderScheduledTaskList() {
        if (!elements.scheduledTaskList) {
          return;
        }
        elements.scheduledTaskList.innerHTML = "";
        const tasks = Array.isArray(state.scheduledTasks) ? state.scheduledTasks : [];
        if (!tasks.length) {
          const empty = document.createElement("div");
          empty.className = "scheduled-task-empty";
          empty.textContent = t("scheduledTaskEmpty");
          elements.scheduledTaskList.appendChild(empty);
          return;
        }
        tasks.forEach((task) => {
          const item = document.createElement("div");
          item.className = "scheduled-task-item";
          const meta = document.createElement("div");
          meta.className = "scheduled-task-meta";
          const text = document.createElement("div");
          text.className = "scheduled-task-text";
          text.textContent = task.prompt || "";
          const time = document.createElement("div");
          time.className = "scheduled-task-time";
          time.textContent = formatDateTime(task.scheduledAt);
          const status = document.createElement("div");
          status.className = "scheduled-task-status";
          const attachmentCount = Array.isArray(task.attachmentNames) ? task.attachmentNames.length : 0;
          const modeLabel = scheduledTaskModeLabel(task.interactiveMode);
          status.textContent = scheduledTaskStatusLabel(task.status)
            + " · " + task.cli
            + (modeLabel ? " · " + modeLabel : "")
            + (attachmentCount ? " · " + t("scheduledTaskAttachmentCount", { count: attachmentCount }) : "");
          meta.appendChild(text);
          meta.appendChild(time);
          meta.appendChild(status);
          item.appendChild(meta);
          if (task.status !== "running") {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "secondary action-button scheduled-task-delete";
            deleteButton.textContent = t("scheduledTaskDelete");
            deleteButton.addEventListener("click", () => {
              vscode.postMessage({ type: "deleteScheduledTask", id: task.id });
            });
            item.appendChild(deleteButton);
          }
          elements.scheduledTaskList.appendChild(item);
        });
      }

      function openScheduledTask() {
        setScheduledTaskError("");
        if (elements.scheduledTaskPrompt) {
          elements.scheduledTaskPrompt.value = elements.promptInput.value || "";
        }
        if (elements.scheduledTaskTime) {
          elements.scheduledTaskTime.value = getDefaultScheduledTaskTime();
        }
        syncScheduledTaskModeSelect();
        scheduledTaskFiles = [];
        if (elements.scheduledTaskAttachmentInput) {
          elements.scheduledTaskAttachmentInput.value = "";
        }
        renderScheduledTaskAttachments();
        renderScheduledTaskList();
        elements.scheduledTaskOverlay.classList.add("visible");
      }

      function closeScheduledTask() {
        elements.scheduledTaskOverlay.classList.remove("visible");
      }

      async function handleScheduledTaskFiles(fileList) {
        const files = fileList ? Array.from(fileList) : [];
        if (!files.length) {
          return;
        }
        const validationError = validateUploadFiles(files);
        if (validationError) {
          setScheduledTaskError(validationError);
          return;
        }
        try {
          scheduledTaskFiles = [];
          for (const file of files) {
            scheduledTaskFiles.push({
              name: file.name,
              type: file.type || "",
              dataUrl: await readFileAsDataUrl(file),
            });
          }
          renderScheduledTaskAttachments();
          setScheduledTaskError("");
        } catch {
          setScheduledTaskError(t("toastReadFileFailed"));
        }
      }

      function saveScheduledTask() {
        const prompt = elements.scheduledTaskPrompt && elements.scheduledTaskPrompt.value
          ? elements.scheduledTaskPrompt.value.trim()
          : "";
        const scheduledAt = elements.scheduledTaskTime
          ? new Date(elements.scheduledTaskTime.value).getTime()
          : NaN;
        if (!prompt) {
          setScheduledTaskError(t("scheduledTaskPromptRequired"));
          return;
        }
        if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
          setScheduledTaskError(t("scheduledTaskTimeInvalid"));
          return;
        }
        const promptPayload = buildPromptPayload(prompt);
        const targetCli = state.currentCli;
        const selectedMode = getScheduledTaskSelectedMode();
        const loopModels = state.selectedLoopModelsByCli && state.selectedLoopModelsByCli[targetCli]
          ? state.selectedLoopModelsByCli[targetCli]
          : {};
        vscode.postMessage({
          type: "scheduleTask",
          prompt,
          scheduledAt,
          tabId: getActiveConversationTabId(),
          cli: targetCli,
          interactiveMode: selectedMode,
          contextOptions: promptPayload.contextOptions,
          model: state.selectedModelsByCli && state.selectedModelsByCli[targetCli]
            ? state.selectedModelsByCli[targetCli]
            : undefined,
          loopMainModel: loopModels.main || undefined,
          loopSubtaskModel: loopModels.subtask || undefined,
          loopMainThinkingMode: state.selectedLoopThinkingByCli && state.selectedLoopThinkingByCli[targetCli]
            ? state.selectedLoopThinkingByCli[targetCli].main || undefined
            : undefined,
          loopSubtaskThinkingMode: state.selectedLoopThinkingByCli && state.selectedLoopThinkingByCli[targetCli]
            ? state.selectedLoopThinkingByCli[targetCli].subtask || undefined
            : undefined,
          loopExecutionMode: selectedMode === "loop" ? getLoopExecutionModeForCli(targetCli) : undefined,
          files: scheduledTaskFiles,
        });
        if (elements.saveScheduledTask) {
          elements.saveScheduledTask.disabled = true;
        }
      }

      if (elements.toolSettingsGeneralTab) {
        elements.toolSettingsGeneralTab.addEventListener("click", () => setToolSettingsTab("general"));
      }
      if (elements.toolSettingsAiTaskTab) {
        elements.toolSettingsAiTaskTab.addEventListener("click", () => setToolSettingsTab("aiTask"));
      }
      if (elements.toolSettingsWorkspaceTab) {
        elements.toolSettingsWorkspaceTab.addEventListener("click", () => setToolSettingsTab("workspace"));
      }
      if (elements.toolSettingsRepairTab) {
        elements.toolSettingsRepairTab.addEventListener("click", () => setToolSettingsTab("repair"));
      }
      setToolSettingsTab("general");
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
      if (elements.historyRetentionDays) {
        const commitHistoryRetentionDays = () => {
          const raw = Number(elements.historyRetentionDays.value);
          const nextValue = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 3650) : 30;
          state.historyRetentionDays = nextValue;
          elements.historyRetentionDays.value = String(nextValue);
          vscode.postMessage({ type: "updateSetting", key: "historyRetentionDays", value: nextValue });
        };
        elements.historyRetentionDays.addEventListener("change", commitHistoryRetentionDays);
        elements.historyRetentionDays.addEventListener("blur", commitHistoryRetentionDays);
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

      if (elements.historySearchInput) {
        elements.historySearchInput.addEventListener("input", (event) => {
          state.historySearchQuery = String(event.target.value || "");
          renderSessionList();
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

      if (elements.scheduleTaskButton) {
        elements.scheduleTaskButton.addEventListener("click", () => {
          openScheduledTask();
        });
      }
      if (elements.closeScheduledTask) {
        elements.closeScheduledTask.addEventListener("click", closeScheduledTask);
      }
      if (elements.saveScheduledTask) {
        elements.saveScheduledTask.addEventListener("click", saveScheduledTask);
      }
      if (elements.scheduledTaskAttachmentInput) {
        elements.scheduledTaskAttachmentInput.addEventListener("change", (event) => {
          handleScheduledTaskFiles(event.target.files);
          event.target.value = "";
        });
      }

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
