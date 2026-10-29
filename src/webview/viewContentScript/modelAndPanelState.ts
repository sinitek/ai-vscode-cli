// Model config, panel state application, controls, and scrolling.
export const VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE = `      function updateAppHeight() {
        document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
      }

      function scheduleAppHeightUpdate() {
        if (resizeFrame) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          updateAppHeight();
        });
      }

      function normalizeModelNameList(value, caseSensitive = false) {
        if (!Array.isArray(value)) {
          return [];
        }
        const seen = new Set();
        const result = [];
        value.forEach((item) => {
          const modelName = typeof item === "string" ? item.trim() : "";
          const key = caseSensitive ? modelName : modelName.toLowerCase();
          if (!modelName || seen.has(key)) {
            return;
          }
          seen.add(key);
          result.push(modelName);
        });
        return result;
      }

      function normalizeModelSelection(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function normalizeLoopRoleModelsPayload(payload, caseSensitive = false) {
        return {
          main: normalizeModelNameList(payload && payload.main, caseSensitive),
          subtask: normalizeModelNameList(payload && payload.subtask, caseSensitive),
        };
      }

      function normalizeLoopRoleSelectionPayload(payload) {
        return {
          main: normalizeModelSelection(payload && payload.main),
          subtask: normalizeModelSelection(payload && payload.subtask),
        };
      }

      function normalizeThinkingModeSelection(value) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (state.currentCli === "kimi-code") {
          // Kimi Code 的 off/on 表示“沿用配置里的 effort”，不是可选档位；只有 ultra 在
          // 界面上按 max 展示（与 resolveKimiThinkingValue 的 ultra→配置档位一致）。
          if (normalized === "ultra") {
            return "max";
          }
          return ["low", "medium", "high", "xhigh", "max"].includes(normalized) ? normalized : "";
        }
        if (normalized === "off") {
          return state.currentCli === "grok" ? "off" : "low";
        }
        return ["low", "medium", "high", "xhigh", "max", "ultra"].includes(normalized)
          ? normalized
          : "";
      }

      function normalizeLoopRoleThinkingPayload(payload, cli) {
        const targetCli = typeof cli === "string" && cli ? cli : state.currentCli;
        const normalizeRole = (value) => {
          const normalized = typeof value === "string" ? value.trim() : "";
          if (targetCli === "kimi-code") {
            if (normalized === "ultra") {
              return "max";
            }
            return ["low", "medium", "high", "xhigh", "max"].includes(normalized) ? normalized : "";
          }
          if (normalized === "off") {
            return targetCli === "grok" || targetCli === "claude" ? "off" : "low";
          }
          return ["low", "medium", "high", "xhigh", "max", "ultra"].includes(normalized)
            ? normalized
            : "";
        };
        return {
          main: normalizeRole(payload && payload.main),
          subtask: normalizeRole(payload && payload.subtask),
        };
      }

      function getDshReasoningOptionsForModel(model) {
        const optionsByModel = state.dshReasoningOptionsByModel;
        const options = optionsByModel && typeof optionsByModel === "object" && model
          ? optionsByModel[model]
          : null;
        return Array.isArray(options)
          ? options.filter((option) => typeof option === "string" && ["low", "medium", "high", "xhigh", "max"].includes(option))
          : [];
      }

      function getLoopRoleThinkingOptionsForCli(cli, role) {
        if (cli === "dsh") {
          const model = typeof getSelectedLoopRoleModelForCli === "function"
            ? getSelectedLoopRoleModelForCli(cli, role)
            : "";
          return getDshReasoningOptionsForModel(model);
        }
        if (cli === "kimi-code") {
          // 优先用 ACP 公布的档位；未公布时回落到官方默认五档，
          // 不能把 off / on / ultra 当成真实档位下发。
          const advertised = Array.isArray(state.kimiThinkingOptions)
            ? state.kimiThinkingOptions.filter((option) =>
              typeof option === "string"
              && ["low", "medium", "high", "xhigh", "max"].includes(option),
            )
            : [];
          return advertised.length > 0 ? advertised : ["low", "medium", "high", "xhigh", "max"];
        }
        const options = [];
        if (cli === "grok") {
          options.push("off");
        }
        options.push("low", "medium", "high", "xhigh", "max", "ultra");
        return options;
      }

      function normalizeLoopRoleThinkingSelection(cli, role, value) {
        const normalized = typeof value === "string" ? value.trim() : "";
        const options = getLoopRoleThinkingOptionsForCli(cli, role);
        return options.includes(normalized) ? normalized : "";
      }

      function normalizeOpenCodeThinkingPayload(payload) {
        const normalized = {
          selectedVariant: null,
          configuredDefaultVariant: null,
          options: [],
          disabled: false,
          messageKey: "",
        };
        if (!payload || typeof payload !== "object") {
          return normalized;
        }
        const selectedVariant = typeof payload.selectedVariant === "string"
          ? payload.selectedVariant.trim()
          : "";
        normalized.selectedVariant = selectedVariant || null;
        normalized.disabled = payload.disabled === true;
        normalized.messageKey = typeof payload.messageKey === "string" ? payload.messageKey.trim() : "";
        const seen = new Set();
        if (Array.isArray(payload.options)) {
          payload.options.forEach((item) => {
            if (!item || typeof item !== "object") {
              return;
            }
            const value = typeof item.value === "string" ? item.value.trim() : "";
            if (!value || seen.has(value)) {
              return;
            }
            seen.add(value);
            const label = typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : value;
            const source = typeof item.source === "string" && item.source.trim()
              ? item.source.trim()
              : undefined;
            normalized.options.push({ value, label, source });
          });
        }
        const configuredDefaultVariant = typeof payload.configuredDefaultVariant === "string"
          ? payload.configuredDefaultVariant.trim()
          : "";
        normalized.configuredDefaultVariant = configuredDefaultVariant && seen.has(configuredDefaultVariant)
          ? configuredDefaultVariant
          : null;
        return normalized;
      }

      function normalizeOpenCodeModelsPayload(payload) {
        const normalized = {
          models: [],
          configMainRef: null,
          configSubtaskRef: null,
          selectedMainRef: null,
          selectedSubtaskRef: null,
          configPrimaryRef: null,
          configSmallRef: null,
          selectedPrimaryRef: null,
          selectedSmallRef: null,
          issues: [],
        };
        if (!payload || typeof payload !== "object") {
          return normalized;
        }
        [
          ["configMainRef", "configPrimaryRef"],
          ["configSubtaskRef", "configSmallRef"],
          ["selectedMainRef", "selectedPrimaryRef"],
          ["selectedSubtaskRef", "selectedSmallRef"],
        ].forEach(([canonicalKey, legacyKey]) => {
          const rawValue = typeof payload[canonicalKey] === "string"
            ? payload[canonicalKey]
            : typeof payload[legacyKey] === "string"
              ? payload[legacyKey]
              : "";
          const value = rawValue.trim();
          normalized[canonicalKey] = value || null;
          normalized[legacyKey] = normalized[canonicalKey];
        });
        const seenRefs = new Set();
        if (Array.isArray(payload.models)) {
          payload.models.forEach((item) => {
            if (!item || typeof item !== "object") {
              return;
            }
            const ref = typeof item.ref === "string" ? item.ref.trim() : "";
            if (!ref || seenRefs.has(ref)) {
              return;
            }
            seenRefs.add(ref);
            const label = typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : ref;
            normalized.models.push({
              ref,
              label,
              providerId: typeof item.providerId === "string" ? item.providerId.trim() : "",
              modelId: typeof item.modelId === "string" ? item.modelId.trim() : "",
            });
          });
        }
        if (Array.isArray(payload.issues)) {
          payload.issues.forEach((issue) => {
            if (!issue || typeof issue !== "object") {
              return;
            }
            const code = typeof issue.code === "string" ? issue.code.trim() : "";
            if (!code) {
              return;
            }
            const role = issue.role === "subtask" || issue.role === "small"
              ? "subtask"
              : issue.role === "main" || issue.role === "primary"
                ? "main"
                : undefined;
            const messageKey = typeof issue.messageKey === "string" && issue.messageKey.trim()
              ? issue.messageKey.trim()
              : undefined;
            normalized.issues.push({ role, code, messageKey });
          });
        }
        return normalized;
      }

      function reconcilePendingOpenCodeRoleSelection(nextOpenCodeModels) {
        const pendingSelection = state.pendingOpenCodeRoleSelection;
        if (!pendingSelection || pendingSelection.configId !== state.selectedConfigId) {
          return nextOpenCodeModels;
        }
        const role = pendingSelection.role === "subtask" ? "subtask" : "main";
        const expectedRef = typeof pendingSelection.value === "string" && pendingSelection.value.trim()
          ? pendingSelection.value.trim()
          : null;
        const incomingRef = role === "subtask"
          ? nextOpenCodeModels.selectedSubtaskRef
          : nextOpenCodeModels.selectedMainRef;
        if (incomingRef === expectedRef) {
          state.pendingOpenCodeRoleSelection = null;
          return nextOpenCodeModels;
        }

        const previousModels = state.openCodeModels;
        const previousRef = previousModels
          ? (role === "subtask" ? previousModels.selectedSubtaskRef : previousModels.selectedMainRef)
          : null;
        if (previousRef !== expectedRef) {
          return nextOpenCodeModels;
        }

        if (role === "subtask") {
          nextOpenCodeModels.selectedSubtaskRef = previousRef;
          nextOpenCodeModels.selectedSmallRef = previousRef;
        } else {
          nextOpenCodeModels.selectedMainRef = previousRef;
          nextOpenCodeModels.selectedPrimaryRef = previousRef;
        }
        return nextOpenCodeModels;
      }

      function shouldPreserveCurrentCliModelsOnEmptySnapshot(cli, nextModels, nextManagedModels, previousModels, previousManagedModels) {
        if (cli !== state.currentCli) {
          return false;
        }
        if (nextModels.length > 0 || nextManagedModels.length > 0) {
          return false;
        }
        if (previousModels.length === 0 && previousManagedModels.length === 0) {
          return false;
        }
        const activeConfigId = state.configState && typeof state.configState.activeConfigId === "string"
          ? state.configState.activeConfigId
          : "";
        const selectedConfigId = typeof state.selectedConfigId === "string" ? state.selectedConfigId : "";
        if (!selectedConfigId) {
          return false;
        }
        return !activeConfigId || activeConfigId !== selectedConfigId;
      }

      function applyModelState(modelState, panelCurrentCli) {
        if (!modelState) {
          return;
        }
        const nextModelsByCli = {};
        const nextModelLabelsByCli = {};
        const nextManagedModelsByCli = {};
        const nextSelectedModelsByCli = {};
        const nextLoopModelsByCli = {};
        const nextSelectedLoopModelsByCli = {};
        const nextSelectedLoopThinkingByCli = {};

        CLI_NAMES.forEach((cli) => {
          // Grok / Kimi Code 的模型名直接来自 config 文件别名，大小写有意义。
          const keepModelCase = cli === "grok" || cli === "kimi-code" || cli === "zcode";
          const incomingModels = normalizeModelNameList(modelState.optionsByCli && modelState.optionsByCli[cli], keepModelCase);
          const incomingManagedModels = normalizeModelNameList(modelState.managedByCli && modelState.managedByCli[cli]);
          const previousModels = normalizeModelNameList(state.modelsByCli && state.modelsByCli[cli], keepModelCase);
          const previousManagedModels = normalizeModelNameList(state.managedModelsByCli && state.managedModelsByCli[cli]);
          const incomingLoopModels = normalizeLoopRoleModelsPayload(modelState.loopOptionsByCli && modelState.loopOptionsByCli[cli], keepModelCase);
          const previousLoopModels = normalizeLoopRoleModelsPayload(state.loopModelsByCli && state.loopModelsByCli[cli], keepModelCase);
          const incomingLoopSelection = normalizeLoopRoleSelectionPayload(modelState.selectedLoopByCli && modelState.selectedLoopByCli[cli]);
          const previousLoopSelection = normalizeLoopRoleSelectionPayload(state.selectedLoopModelsByCli && state.selectedLoopModelsByCli[cli]);
          const incomingLoopThinking = normalizeLoopRoleThinkingPayload(modelState.selectedLoopThinkingByCli && modelState.selectedLoopThinkingByCli[cli], cli);
          const previousLoopThinking = normalizeLoopRoleThinkingPayload(state.selectedLoopThinkingByCli && state.selectedLoopThinkingByCli[cli], cli);
          const preservePrevious = shouldPreserveCurrentCliModelsOnEmptySnapshot(
            cli,
            incomingModels,
            incomingManagedModels,
            previousModels,
            previousManagedModels
          );

          nextModelsByCli[cli] = preservePrevious ? previousModels : incomingModels;
          nextModelLabelsByCli[cli] = preservePrevious
            ? (state.modelLabelsByCli && state.modelLabelsByCli[cli]) || {}
            : (modelState.labelsByCli && modelState.labelsByCli[cli]) || {};
          nextManagedModelsByCli[cli] = preservePrevious ? previousManagedModels : incomingManagedModels;
          nextSelectedModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedModelsByCli && state.selectedModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedByCli && modelState.selectedByCli[cli]);
          nextLoopModelsByCli[cli] = preservePrevious ? previousLoopModels : incomingLoopModels;
          nextSelectedLoopModelsByCli[cli] = preservePrevious ? previousLoopSelection : incomingLoopSelection;
          nextSelectedLoopThinkingByCli[cli] = preservePrevious ? previousLoopThinking : incomingLoopThinking;
        });

        state.modelsByCli = nextModelsByCli;
        state.modelLabelsByCli = nextModelLabelsByCli;
        state.managedModelsByCli = nextManagedModelsByCli;
        state.selectedModelsByCli = nextSelectedModelsByCli;
        state.loopModelsByCli = nextLoopModelsByCli;
        state.selectedLoopModelsByCli = nextSelectedLoopModelsByCli;
        state.selectedLoopThinkingByCli = nextSelectedLoopThinkingByCli;
        state.dshReasoningOptions = panelCurrentCli === "dsh" && Array.isArray(modelState.dshReasoningOptions)
          ? modelState.dshReasoningOptions.filter((option) => typeof option === "string" && option.trim())
          : panelCurrentCli === "dsh" ? [] : state.dshReasoningOptions;
        state.dshReasoningOptionsByModel = modelState.dshReasoningOptionsByModel
          && typeof modelState.dshReasoningOptionsByModel === "object"
          ? Object.fromEntries(Object.entries(modelState.dshReasoningOptionsByModel).map(([model, options]) => [
            model,
            Array.isArray(options)
              ? options.filter((option) => typeof option === "string" && ["low", "medium", "high", "xhigh", "max"].includes(option))
              : [],
          ]))
          : state.dshReasoningOptionsByModel || {};
        const incomingSubtaskCli = modelState.selectedLoopSubtaskCliByConfigId && typeof modelState.selectedLoopSubtaskCliByConfigId === "object"
          ? { ...modelState.selectedLoopSubtaskCliByConfigId }
          : {};
        const pendingSubtaskCli = state.pendingLoopSubtaskCliSelection;
        if (pendingSubtaskCli && pendingSubtaskCli.configId) {
          const incomingCli = incomingSubtaskCli[pendingSubtaskCli.configId] || "";
          if (incomingCli === pendingSubtaskCli.cli) {
            state.pendingLoopSubtaskCliSelection = null;
          } else {
            incomingSubtaskCli[pendingSubtaskCli.configId] = pendingSubtaskCli.cli;
          }
        }
        state.selectedLoopSubtaskCliByConfigId = incomingSubtaskCli;
        state.activeConfigIdByCli = modelState.activeConfigIdByCli && typeof modelState.activeConfigIdByCli === "object"
          ? modelState.activeConfigIdByCli
          : {};
        state.modelIssuesByCli = modelState.issuesByCli && typeof modelState.issuesByCli === "object"
          ? modelState.issuesByCli
          : {};
        state.thinkingModeByCli = modelState.thinkingModeByCli && typeof modelState.thinkingModeByCli === "object"
          ? modelState.thinkingModeByCli
          : {};
        state.selectedModel = state.selectedModelsByCli[panelCurrentCli] || "";
      }

      function getNewlyCompletedLoopTabIds(previousConversationTabs, nextConversationTabs) {
        const previousTabs = previousConversationTabs && Array.isArray(previousConversationTabs.tabs)
          ? previousConversationTabs.tabs
          : [];
        const nextTabs = nextConversationTabs && Array.isArray(nextConversationTabs.tabs)
          ? nextConversationTabs.tabs
          : [];
        const previousById = new Map(previousTabs.map((tab) => [tab.id, tab]));
        return nextTabs
          .filter((tab) => {
            const previous = tab && previousById.get(tab.id);
            const wasRunning = Boolean(
              previous
              && (previous.loopTaskRunning === true || previous.loopTaskStatus === "running")
            );
            return wasRunning && tab.loopTaskStatus === "completed";
          })
          .map((tab) => tab.id);
      }

      function applyState(panelState) {
        const previousCli = state.currentCli;
        const previousConversationTabs = state.conversationTabs || { activeTabId: null, tabs: [] };
        const previousActiveTabId = typeof previousConversationTabs.activeTabId === "string"
          ? previousConversationTabs.activeTabId
          : null;
        state.currentCli = panelState.currentCli;
        if (state.currentCli !== "zcode" || previousCli !== "zcode"
          || previousActiveTabId !== panelState.conversationTabs?.activeTabId
          || state.selectedModelsByCli?.zcode !== panelState.modelState?.selectedByCli?.zcode
          || state.configState?.activeConfigId !== panelState.configState?.activeConfigId) {
          state.zcodeThinkingOptions = null;
        }
        if (state.currentCli !== "kimi-code" && Array.isArray(state.kimiThinkingOptions)) {
          // 切换 CLI 后不能沿用上一个 Kimi 会话公布的档位。
          state.kimiThinkingOptions = [];
          state.kimiThinkingOptionsAdvertised = false;
        }
        if (state.currentCli !== "dsh") {
          state.dshReasoningOptions = [];
        } else if (Array.isArray(panelState.dshReasoningOptions)) {
          state.dshReasoningOptions = panelState.dshReasoningOptions.filter((option) => typeof option === "string" && option.trim());
        }
        state.sessionState = panelState.sessionState;
        const nextConversationTabs = panelState.conversationTabs || { activeTabId: null, tabs: [] };
        const newlyCompletedLoopTabIds = getNewlyCompletedLoopTabIds(
          previousConversationTabs,
          nextConversationTabs
        );
        state.conversationTabs = nextConversationTabs;
        if (typeof releaseRunningFlowStopForActiveTasks === "function") {
          releaseRunningFlowStopForActiveTasks();
        }
        const nextActiveTabId = state.conversationTabs && typeof state.conversationTabs.activeTabId === "string"
          ? state.conversationTabs.activeTabId
          : null;
        const previousConfigurationContextKey = typeof state.appliedConfigurationContextKey === "string"
          ? state.appliedConfigurationContextKey
          : previousCli + ":" + (previousActiveTabId || "");
        const nextConfigurationContextKey = state.currentCli + ":" + (nextActiveTabId || "");
        const pendingConversationReset = state.pendingConversationReset;
        const nextActiveTab = Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs.find((tab) => tab.id === nextActiveTabId)
          : null;
        const preservesResetConfiguration = pendingConversationReset
          && pendingConversationReset.tabId
          && pendingConversationReset.cli === previousCli
          && pendingConversationReset.cli === state.currentCli
          && pendingConversationReset.tabId === previousActiveTabId
          && nextActiveTab
          && nextActiveTab.cli === state.currentCli
          && !nextActiveTab.sessionId
          && !(Array.isArray(previousConversationTabs.tabs)
            && previousConversationTabs.tabs.some((tab) => tab.id === nextActiveTabId))
          && !state.conversationTabs.tabs.some((tab) => tab.id === pendingConversationReset.tabId);
        state.appliedConfigurationContextKey = nextConfigurationContextKey;
        if (previousConfigurationContextKey !== nextConfigurationContextKey) {
          state.pendingConversationReset = null;
          if (!preservesResetConfiguration) {
            state.autoAppliedConfig = false;
            state.selectedConfigId = "";
            state.pendingConfigApply = null;
            state.pendingOpenCodeRoleSelection = null;
          }
        }
        const tabIds = Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs.map((tab) => tab.id)
          : [];
        pruneConversationRuntimeStates(tabIds);
        if (Array.isArray(state.conversationTabs.tabs)) {
          state.conversationTabs.tabs.forEach((tab) => {
            updateLoopMetaForTabFromSummary(tab);
          });
        }
        syncActiveMessagesFromRuntime();
        state.promptHistory = Array.isArray(panelState.promptHistory) ? panelState.promptHistory : [];
        state.humanInteractionHistory = Array.isArray(panelState.humanInteractionHistory) ? panelState.humanInteractionHistory : [];
        state.scheduledTasks = Array.isArray(panelState.scheduledTasks) ? panelState.scheduledTasks : [];
        state.configState = panelState.configState || { configs: [], activeConfigId: null };
        state.configStateByCli = panelState.configStateByCli && typeof panelState.configStateByCli === "object"
          ? panelState.configStateByCli
          : {};
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        let nextSelected = state.configState.activeConfigId || "";
        let shouldAutoApplyConfig = false;
        const pendingConfigApply = state.pendingConfigApply
          && state.pendingConfigApply.cli === state.currentCli
          && configs.some(c => c.id === state.pendingConfigApply.configId)
            ? state.pendingConfigApply
            : null;
        if (
          state.pendingConfigApply
          && state.pendingConfigApply.cli === state.currentCli
          && !pendingConfigApply
        ) {
          state.pendingConfigApply = null;
        }
        if (
          pendingConfigApply
          && state.configState.activeConfigId === pendingConfigApply.configId
        ) {
          state.pendingConfigApply = null;
        } else if (pendingConfigApply) {
          nextSelected = pendingConfigApply.configId;
        }

        // 配置应用是异步的；在 activeConfigId 追上前端选择前，保持用户刚选的配置。
        if (!pendingConfigApply && state.selectedConfigId && state.selectedConfigId !== nextSelected) {
          const configExists = configs.some(c => c.id === state.selectedConfigId);
          if (configExists) {
            nextSelected = state.selectedConfigId;
            shouldAutoApplyConfig = true;
          }
        }

        if (!nextSelected && configs.length > 0) {
          nextSelected = configs[0].id;
          shouldAutoApplyConfig = true;
        }
        const autoApplyConfigKey = state.currentCli + ":" + nextSelected;
        const canAutoApplyConfig = shouldAutoApplyConfig && (
          !state.autoAppliedConfig
          || lastAutoApplyConfigKey !== autoApplyConfigKey
          || Date.now() - lastAutoApplyConfigAt > autoApplyConfigRetryMs
        );
        if (canAutoApplyConfig) {
          state.pendingConfigApply = { cli: state.currentCli, configId: nextSelected };
          state.autoAppliedConfig = true;
          lastAutoApplyConfigKey = autoApplyConfigKey;
          lastAutoApplyConfigAt = Date.now();
          vscode.postMessage({
            type: "applyConfig",
            cli: state.currentCli,
            configId: nextSelected,
          });
        }
        state.selectedConfigId = nextSelected;
        const matchesSelectedConfig = (state.configState.activeConfigId || "") === nextSelected;
        if (matchesSelectedConfig) {
          state.thinkingMode = state.currentCli === "kimi-code"
            ? normalizeThinkingModeSelection(panelState.thinkingMode) || "high"
            : panelState.thinkingMode || "medium";
          state.openCodeThinking = normalizeOpenCodeThinkingPayload(panelState.openCodeThinking);
          state.openCodeSmallThinking = normalizeOpenCodeThinkingPayload(panelState.openCodeSmallThinking);
          state.openCodeModels = reconcilePendingOpenCodeRoleSelection(
            normalizeOpenCodeModelsPayload(panelState.openCodeModels)
          );
        }
        if (panelState.loopSubtaskOpenCodeModels) {
          state.loopSubtaskOpenCodeModels = normalizeOpenCodeModelsPayload(panelState.loopSubtaskOpenCodeModels);
        }
        state.interactiveMode = normalizeInteractiveMode(panelState.interactiveMode);
        const previousAutoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        state.debug = Boolean(panelState.debug);
        state.autoAddEditorContextTags = Boolean(panelState.autoAddEditorContextTags);
        state.longTermMemoryEnabled = panelState.longTermMemoryEnabled === true;
        state.workspaceMemoryEnabled = panelState.workspaceMemoryEnabled === true;
        state.workspaceHarnessInstalled = panelState.workspaceHarnessInstalled === true;
        state.codeGraphInstalled = panelState.codeGraphInstalled === true;
        state.codeGraphInstalling = panelState.codeGraphInstalling === true;
        state.autoCompactContextAfterRun = Boolean(panelState.autoCompactContextAfterRun);
        state.humanInteractionEnabled = panelState.humanInteractionEnabled !== false;
        state.cliEnabledByName = panelState && panelState.cliEnabledByName && typeof panelState.cliEnabledByName === "object"
          ? panelState.cliEnabledByName
          : {};
        if (typeof syncCliEnabledControls === "function") {
          syncCliEnabledControls();
        }
        state.humanInteractionTimeoutMinutes = normalizeHumanInteractionTimeoutMinutes(
          panelState.humanInteractionTimeoutMinutes
        );
        state.loopMaxRounds = normalizeLoopMaxRounds(panelState.loopMaxRounds);
        state.loopPlusDecisionSubtaskMax = normalizeLoopPlusDecisionSubtaskMax(
          panelState.loopPlusDecisionSubtaskMax
        );
        state.loopPlusMaxAcceptances = normalizeLoopPlusMaxAcceptances(
          panelState.loopPlusMaxAcceptances
        );
        state.loopSubtaskMaxThinkingMode = normalizeLoopSubtaskMaxThinkingMode(
          panelState.loopSubtaskMaxThinkingMode
        );
        state.loopExecutionModeByCli = normalizeLoopExecutionModeByCli(
          panelState.loopExecutionModeByCli,
          state.loopExecutionModeByCli
        );
        if (!state.autoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        } else if (!previousAutoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        }
        state.isMac = Boolean(panelState.isMac);
        state.macTaskShell = panelState.macTaskShell === "bash" ? "bash" : "zsh";
        state.interactive = panelState.interactive || { supported: false, enabled: false };
        state.rulePaths = panelState.rulePaths || { global: {}, project: {} };
        // Handle modelState
        if (panelState.modelState && matchesSelectedConfig) {
          applyModelState(panelState.modelState, panelState.currentCli);
        }
        if (typeof syncEnabledCliSelectElement === "function") {
          syncEnabledCliSelectElement(elements.currentCli, panelState.currentCli);
        } else if (elements.currentCli) {
          elements.currentCli.value = panelState.currentCli;
        }
        if (elements.rulesLoadCli && typeof setRulesLoadCliOptions !== "function") {
          elements.rulesLoadCli.value = panelState.currentCli;
        }
        updateRulesScope(state.ruleScope);
        syncThinkingOptions();
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        updateCodexLoopModelSelectOptions();
        updateOpenCodeModelSelectOptions();
        syncModelSelectorByInteractiveMode();
        if (elements.addModelOverlay && elements.addModelOverlay.classList.contains("visible")) {
          renderModelManagerList();
          syncModelManageForm();
        }
        if (elements.debugMode) {
          elements.debugMode.checked = state.debug;
        }
        if (elements.autoAddEditorContextTags) {
          elements.autoAddEditorContextTags.checked = state.autoAddEditorContextTags;
        }
        syncLongTermMemoryWorkspaceControl();
        syncCodeGraphWorkspaceControl();
        if (elements.autoCompactContextAfterRun) {
          elements.autoCompactContextAfterRun.checked = state.autoCompactContextAfterRun;
        }
        if (elements.humanInteractionEnabled) {
          elements.humanInteractionEnabled.checked = state.humanInteractionEnabled;
        }
        if (elements.humanInteractionTimeoutMinutes) {
          elements.humanInteractionTimeoutMinutes.value = String(state.humanInteractionTimeoutMinutes);
        }
        state.historyRetentionDays = Number.isFinite(Number(panelState.historyRetentionDays))
          ? Math.min(Math.max(Math.floor(Number(panelState.historyRetentionDays)), 1), 3650)
          : 30;
        if (elements.historyRetentionDays) {
          elements.historyRetentionDays.value = String(state.historyRetentionDays);
        }
        if (elements.loopMaxRounds) {
          elements.loopMaxRounds.value = String(state.loopMaxRounds);
        }
        if (elements.loopPlusDecisionSubtaskMax) {
          elements.loopPlusDecisionSubtaskMax.value = String(state.loopPlusDecisionSubtaskMax);
        }
        if (elements.loopPlusMaxAcceptances) {
          elements.loopPlusMaxAcceptances.value = String(state.loopPlusMaxAcceptances);
        }
        if (elements.loopSubtaskMaxThinkingMode) {
          elements.loopSubtaskMaxThinkingMode.value = state.loopSubtaskMaxThinkingMode;
        }
        if (elements.macTaskShellRow) {
          elements.macTaskShellRow.style.display = state.isMac ? "flex" : "none";
        }
        if (elements.macTaskShell) {
          elements.macTaskShell.value = state.macTaskShell;
        }
        if (elements.resultOnlyToggle) {
          elements.resultOnlyToggle.checked = state.onlyShowFinalResults;
        }
        syncInteractiveOptions();
        if (elements.interactiveModeSelect) {
          elements.interactiveModeSelect.value = state.interactiveMode;
        }
        renderConfigOptions();
        syncRunningStateForActiveTab();
        renderConversationTabs();
        syncOpenCurrentLoopGroupChatButton();
        syncOpenCurrentGraphRunButton();
        renderSessionList();
        renderPromptHistoryList();
        renderScheduledTaskList();
        applyEditorContext(panelState.editorContext);
        newlyCompletedLoopTabIds.forEach((tabId) => {
          flushPendingPromptQueue(tabId);
        });
      }

      function renderConfigOptions() {
        elements.configSelect.innerHTML = "";
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        if (configs.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = t("noConfigOption");
          elements.configSelect.appendChild(option);
          elements.configSelect.value = "";
          return;
        }
        configs.forEach((config) => {
          const option = document.createElement("option");
          option.value = config.id;
          option.textContent = config.name || config.id;
          elements.configSelect.appendChild(option);
        });
        elements.configSelect.value = state.selectedConfigId || "";
      }

      function appendThinkingOption(selectElement, value, label) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        selectElement.appendChild(option);
      }

      function isOpenCodeThinkingEffort(value) {
        return value === "low"
          || value === "medium"
          || value === "high"
          || value === "xhigh"
          || value === "max"
          || value === "ultra";
      }

      function syncOpenCodeThinkingSelect(selectElement, payload, titleFallback) {
        if (!selectElement || (typeof isSelectFocused === "function" && isSelectFocused(selectElement))) {
          return normalizeOpenCodeThinkingPayload(payload);
        }
        const normalizedPayload = normalizeOpenCodeThinkingPayload(payload);
        selectElement.innerHTML = "";
        appendCodexThinkingOptions(selectElement);
        const selectedVariant = typeof normalizedPayload.selectedVariant === "string"
          ? normalizedPayload.selectedVariant.trim()
          : "";
        selectElement.value = isOpenCodeThinkingEffort(selectedVariant) ? selectedVariant : "medium";
        selectElement.disabled = false;
        selectElement.title = titleFallback;
        return normalizedPayload;
      }

      function getSelectedLoopRoleThinkingModeForCli(cli, role) {
        return state.selectedLoopThinkingByCli
          && state.selectedLoopThinkingByCli[cli]
          ? normalizeThinkingModeSelection(state.selectedLoopThinkingByCli[cli][role])
          : "";
      }

      function getVisibleLoopRoleThinkingModeForCli(cli, role) {
        const selected = getSelectedLoopRoleThinkingModeForCli(cli, role);
        if (cli === "dsh" || cli === "kimi-code") {
          const options = getLoopRoleThinkingOptionsForCli(cli, role);
          return options.includes(selected)
            ? selected
            : options.includes(state.thinkingMode) ? state.thinkingMode : (options[0] || "");
        }
        return selected || normalizeThinkingModeSelection(state.thinkingMode) || "medium";
      }

      function getCliLoopThinkingAria(cli, role) {
        if (cli === "kimi-code") {
          return t(role === "subtask" ? "kimiCodeLoopSubtaskThinkingModeAria" : "kimiCodeLoopMainThinkingModeAria");
        }
        if (cli === "grok") {
          return t(role === "subtask" ? "grokLoopSubtaskThinkingModeAria" : "grokLoopMainThinkingModeAria");
        }
        if (cli === "dsh") {
          return t(role === "subtask" ? "dshLoopSubtaskThinkingModeAria" : "dshLoopMainThinkingModeAria");
        }
        return t(role === "subtask" ? "codexLoopSubtaskThinkingModeAria" : "codexLoopMainThinkingModeAria");
      }

      function appendCodexThinkingOptions(selectElement) {
        appendThinkingOption(selectElement, "low", "low");
        appendThinkingOption(selectElement, "medium", "medium");
        appendThinkingOption(selectElement, "high", "high");
        appendThinkingOption(selectElement, "xhigh", "xhigh");
        appendThinkingOption(selectElement, "max", "max");
        appendThinkingOption(selectElement, "ultra", "ultra");
      }

      function updateCodexLoopRoleThinkingSelect(selectElement, role) {
        if (!selectElement || (typeof isSelectFocused === "function" && isSelectFocused(selectElement))) {
          return;
        }
        selectElement.innerHTML = "";
        const options = getLoopRoleThinkingOptionsForCli(state.currentCli, role);
        options.forEach((option) => appendThinkingOption(selectElement, option, option));
        selectElement.disabled = options.length === 0;
        selectElement.value = getVisibleLoopRoleThinkingModeForCli(state.currentCli, role);
        selectElement.title = getCliLoopThinkingAria(state.currentCli, role);
        if (typeof selectElement.setAttribute === "function") {
          selectElement.setAttribute("aria-label", selectElement.title);
        }
      }

      function updateCodexLoopThinkingSelectOptions() {
        updateCodexLoopRoleThinkingSelect(elements.codexLoopMainThinkingMode, "main");
        updateCodexLoopRoleThinkingSelect(elements.codexLoopSubtaskThinkingMode, "subtask");
      }

      function syncOpenCodeThinkingOptions() {
        state.openCodeThinking = syncOpenCodeThinkingSelect(
          elements.openCodePrimaryThinkingMode,
          state.openCodeThinking,
          t("openCodePrimaryThinkingModeAria")
        );
        state.openCodeSmallThinking = syncOpenCodeThinkingSelect(
          elements.openCodeSmallThinkingMode,
          state.openCodeSmallThinking,
          t("openCodeSmallThinkingModeAria")
        );
        if (elements.thinkingMode) {
          elements.thinkingMode.style.display = "none";
        }
        if (elements.openCodePrimaryThinkingMode) {
          elements.openCodePrimaryThinkingMode.style.display = "";
        }
        if (elements.openCodeSmallThinkingMode) {
          elements.openCodeSmallThinkingMode.style.display = state.currentCli === "opencode" ? "" : "none";
        }
      }

      function syncGenericThinkingOptions() {
        if (state.currentCli === "zcode" && Array.isArray(state.zcodeThinkingOptions)) {
          const advertised = state.zcodeThinkingOptions;
          elements.thinkingMode.innerHTML = "";
          elements.thinkingMode.title = t("thinkingModeAria");
          elements.thinkingMode.disabled = advertised.length === 0;
          advertised.forEach((option) => appendThinkingOption(elements.thinkingMode, option, option));
          if (advertised.length > 0) {
            const selected = advertised.includes(state.thinkingMode)
              ? state.thinkingMode
              : advertised.includes("high") ? "high" : advertised[0];
            elements.thinkingMode.value = selected;
            if (selected !== state.thinkingMode) {
              updateThinkingMode(selected);
            }
          }
          return;
        }
        if (state.currentCli === "dsh") {
          const advertised = Array.isArray(state.dshReasoningOptions)
            ? state.dshReasoningOptions.filter((option) =>
              typeof option === "string"
              && option.trim()
              && option !== "off"
              && ["low", "medium", "high", "xhigh", "max"].includes(option),
            )
            : [];
          elements.thinkingMode.innerHTML = "";
          elements.thinkingMode.title = t("thinkingModeAria");
          if (advertised.length === 0) {
            elements.thinkingMode.disabled = true;
            return;
          }
          elements.thinkingMode.disabled = false;
          advertised.forEach((option) => {
            appendThinkingOption(elements.thinkingMode, option, option);
          });
          const selected = advertised.includes(state.thinkingMode)
            ? state.thinkingMode
            : advertised.includes("high")
            ? "high"
            : advertised[0];
          elements.thinkingMode.value = selected;
          if (selected !== state.thinkingMode) {
            updateThinkingMode(selected);
          }
          return;
        }
        if (state.currentCli === "kimi-code") {
          // Kimi Code 的可用档位由 ACP 会话公布（取决于 config.toml 的 capabilities /
          // support_efforts）；没有公布时保留官方默认五档，绝不发未公布值。
          const advertised = Array.isArray(state.kimiThinkingOptions)
            ? state.kimiThinkingOptions.filter((option) =>
              typeof option === "string"
              && ["low", "medium", "high", "xhigh", "max"].includes(option),
            )
            : [];
          const kimiOptions = advertised.length > 0
            ? advertised
            : state.kimiThinkingOptionsAdvertised
            ? []
            : ["low", "medium", "high", "xhigh", "max"];
          elements.thinkingMode.innerHTML = "";
          elements.thinkingMode.title = t("thinkingModeAria");
          if (kimiOptions.length === 0) {
            // 广告里只有 off/on（env-only 通道）时没有真实努力档，宁可禁用也不下发改写值。
            elements.thinkingMode.disabled = true;
            return;
          }
          elements.thinkingMode.disabled = false;
          kimiOptions.forEach((option) => {
            appendThinkingOption(elements.thinkingMode, option, option);
          });
          if (!kimiOptions.includes(state.thinkingMode)) {
            // 只调整界面值，不写回 workspace 设置：用户原本可能选择了“沿用配置 effort”，
            // 这里擅自持久化会把那个意图覆盖掉。下一轮 ACP 确认值会再对齐一次。
            state.thinkingMode = kimiOptions.includes("high") ? "high" : kimiOptions[0];
          }
          elements.thinkingMode.value = state.thinkingMode;
          return;
        }
        const isCodex = state.currentCli === "codex";
        const isClaude = state.currentCli === "claude";
        const isGrok = state.currentCli === "grok";
        const keepsExtendedThinking = isCodex || isClaude || isGrok || state.currentCli === "zcode";
        elements.thinkingMode.innerHTML = "";
        elements.thinkingMode.disabled = false;
        elements.thinkingMode.title = t("thinkingModeAria");
        if (!isCodex) {
          appendThinkingOption(elements.thinkingMode, "off", "off");
        }
        appendThinkingOption(elements.thinkingMode, "low", "low");
        appendThinkingOption(elements.thinkingMode, "medium", "medium");
        appendThinkingOption(elements.thinkingMode, "high", "high");
        if (keepsExtendedThinking) {
          appendThinkingOption(elements.thinkingMode, "xhigh", "xhigh");
          appendThinkingOption(elements.thinkingMode, "max", "max");
          appendThinkingOption(elements.thinkingMode, "ultra", "ultra");
        }
        if (isCodex && state.thinkingMode === "off") {
          updateThinkingMode("low");
        }
        if (!keepsExtendedThinking && state.thinkingMode === "xhigh") {
          updateThinkingMode("high");
        }
        if (!keepsExtendedThinking && state.thinkingMode === "max") {
          updateThinkingMode("high");
        }
        elements.thinkingMode.value = state.thinkingMode;
      }

      function syncThinkingOptions() {
        if (state.currentCli === "opencode") {
          syncOpenCodeThinkingOptions();
          return;
        }
        const showCodexRoleThinking = typeof isLoopRoleModelMode === "function"
          ? isLoopRoleModelMode(state.currentCli, state.interactiveMode)
          : false;
        if (elements.openCodeSmallThinkingMode) {
          elements.openCodeSmallThinkingMode.style.display = "none";
        }
        if (elements.openCodePrimaryThinkingMode) {
          elements.openCodePrimaryThinkingMode.style.display = "none";
        }
        updateCodexLoopThinkingSelectOptions();
        if (elements.codexLoopMainThinkingMode) {
          elements.codexLoopMainThinkingMode.style.display = showCodexRoleThinking ? "" : "none";
        }
        if (elements.codexLoopSubtaskThinkingMode) {
          elements.codexLoopSubtaskThinkingMode.style.display = showCodexRoleThinking ? "" : "none";
        }
        if (elements.thinkingMode) {
          elements.thinkingMode.style.display = showCodexRoleThinking ? "none" : "";
        }
        syncGenericThinkingOptions();
      }

      function syncInteractiveOptions() {
        syncInteractiveModeSelector();
        syncCommonCommandOptions();
      }

      function syncInteractiveModeSelector() {
        if (!elements.interactiveModeSelect) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = supported || state.currentCli === "opencode";
        elements.interactiveModeSelect.style.display = visible ? "" : "none";
        elements.interactiveModeSelect.disabled = !visible;
        elements.interactiveModeSelect.value = normalizeInteractiveMode(state.interactiveMode);
        syncModelSelectorByInteractiveMode();
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        // Kimi Code 的 ACP 通道没有暴露压缩方法（与 DSH 相同），因此不显示“压缩上下文”入口，
        // 避免用户点了只得到一条“不支持”提示。
        const visible = supported && (state.currentCli === "claude" || state.currentCli === "codex" || state.currentCli === "grok");
        const disabled = !visible || state.isRunning;
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = disabled;
        elements.commonCommandButton.setAttribute("aria-disabled", String(disabled));
        elements.commonCommandButton.tabIndex = disabled ? -1 : 0;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = disabled;
        }
      }

      function updateThinkingMode(nextMode) {
        state.thinkingMode = nextMode;
        elements.thinkingMode.value = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      }

      function getChatDistanceToBottom() {
        return elements.chatArea.scrollHeight - (elements.chatArea.scrollTop + elements.chatArea.clientHeight);
      }

      function isChatNearBottom(threshold = CHAT_BOTTOM_THRESHOLD_PX) {
        return getChatDistanceToBottom() <= threshold;
      }

      function isScrollButtonSuppressed() {
        return Date.now() < suppressScrollButtonUntil;
      }

      function scrollChatToBottom(behavior = "auto") {
        elements.chatArea.scrollTo({ top: elements.chatArea.scrollHeight, behavior });
      }

      function restoreChatScrollTop(scrollTop) {
        if (!elements.chatArea) {
          return;
        }
        const maxScrollTop = Math.max(0, elements.chatArea.scrollHeight - elements.chatArea.clientHeight);
        const nextScrollTop = Math.min(Math.max(0, Number(scrollTop) || 0), maxScrollTop);
        if (elements.chatArea.scrollTop !== nextScrollTop) {
          elements.chatArea.scrollTop = nextScrollTop;
        }
      }

      function stickChatToBottom(behavior = "auto") {
        followLatestMessages = true;
        suppressScrollButtonUntil = Date.now() + AUTO_SCROLL_BUTTON_SUPPRESS_MS;
        updateScrollToBottomButton(true);
        scrollChatToBottom(behavior);
        requestAnimationFrame(() => {
          scrollChatToBottom("auto");
          updateScrollToBottomButton(true);
        });
        setTimeout(() => {
          updateScrollToBottomButton();
        }, AUTO_SCROLL_BUTTON_SUPPRESS_MS + 20);
      }

      function updateScrollToBottomButton(forceHide = false) {
        if (!elements.scrollToBottomButton) {
          return;
        }
        const hasMessages = state.messages.length > 0;
        const hasOverflow = elements.chatArea.scrollHeight > (elements.chatArea.clientHeight + 1);
        const distanceToBottom = getChatDistanceToBottom();
        const buttonSuppressed = isScrollButtonSuppressed();
        const shouldShow = !forceHide && !buttonSuppressed && hasMessages && hasOverflow && distanceToBottom > CHAT_BOTTOM_THRESHOLD_PX;
        elements.scrollToBottomButton.classList.toggle("visible", shouldShow);
        elements.scrollToBottomButton.setAttribute("aria-hidden", String(!shouldShow));
        if (elements.scrollToBottomWrap) {
          elements.scrollToBottomWrap.setAttribute("aria-hidden", String(!shouldShow));
        }
        if (state.debug && shouldShow !== lastScrollToBottomVisible) {
          const debugPayload = {
            visible: shouldShow,
            forceHide,
            buttonSuppressed,
            followLatestMessages,
            distanceToBottom,
            scrollTop: elements.chatArea.scrollTop,
            scrollHeight: elements.chatArea.scrollHeight,
            clientHeight: elements.chatArea.clientHeight,
            threshold: CHAT_BOTTOM_THRESHOLD_PX,
          };
          console.debug("[scroll-to-bottom]", debugPayload);
          postWebviewDebug("scroll-to-bottom-visibility", debugPayload);
        }
        lastScrollToBottomVisible = shouldShow;
      }

`;
