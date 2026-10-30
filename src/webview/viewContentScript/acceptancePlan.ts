// Loop+ 验收方案弹窗：方案选择/保存、复选项、名称编辑与确认启动。
export const VIEW_CONTENT_SCRIPT_ACCEPTANCE_PLAN = `      const ACCEPTANCE_PLAN_SYSTEM_ID = "system_default";
      const ACCEPTANCE_PLAN_NEW_ID = "new";
      const ACCEPTANCE_PLAN_CHECK_KEYS = ["maintainability", "security", "performance", "ui_aesthetics", "other"];
      const ACCEPTANCE_PLAN_CHECK_INPUT_IDS = {
        maintainability: "acceptancePlanCheckMaintainability",
        security: "acceptancePlanCheckSecurity",
        performance: "acceptancePlanCheckPerformance",
        ui_aesthetics: "acceptancePlanCheckUi",
        other: "acceptancePlanCheckOther",
      };
      const acceptancePlanDialog = {
        open: false,
        payload: null,
        tabId: "",
        planId: ACCEPTANCE_PLAN_SYSTEM_ID,
        name: "",
        checks: [],
        otherText: "",
        submitting: false,
        saving: false,
        returnFocus: null,
        nameDialogOpen: false,
        deleteDialogOpen: false,
        deleting: false,
      };

      function getAcceptancePlanElement(id) {
        return document.getElementById(id);
      }

      function normalizeAcceptancePlanChecks(value) {
        const selected = [];
        ACCEPTANCE_PLAN_CHECK_KEYS.forEach((key) => {
          if (Array.isArray(value) && value.indexOf(key) >= 0) {
            selected.push(key);
          }
        });
        return selected;
      }

      function normalizeAcceptancePlanName(value) {
        const text = typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
        return text.slice(0, 60).trim();
      }

      function normalizeAcceptancePlanOtherText(value) {
        const text = typeof value === "string" ? value.replace(/\\r\\n/g, "\\n").trim() : "";
        return text.slice(0, 4000);
      }

      function normalizeAcceptancePlanSnapshot(value) {
        if (!value || typeof value !== "object") {
          return null;
        }
        const checks = normalizeAcceptancePlanChecks(value.checks);
        const otherText = checks.indexOf("other") >= 0
          ? normalizeAcceptancePlanOtherText(value.otherText)
          : "";
        const isSystem = value.systemDefault === true || value.id === ACCEPTANCE_PLAN_SYSTEM_ID;
        if (isSystem) {
          return {
            id: ACCEPTANCE_PLAN_SYSTEM_ID,
            name: t("acceptancePlanSystemDefault"),
            checks,
            otherText,
            systemDefault: true,
          };
        }
        const id = typeof value.id === "string" ? value.id.trim() : "";
        const name = normalizeAcceptancePlanName(value.name);
        if (!id || !name) {
          return null;
        }
        return { id, name, checks, otherText, systemDefault: false };
      }

      function getAcceptancePlanSummaries() {
        const raw = Array.isArray(state.loopPlusAcceptancePlans) ? state.loopPlusAcceptancePlans : [];
        const plans = [];
        raw.forEach((item) => {
          const normalized = normalizeAcceptancePlanSnapshot(item);
          if (normalized && !normalized.systemDefault && !plans.some((plan) => plan.id === normalized.id)) {
            plans.push(normalized);
          }
        });
        return plans;
      }

      function buildSystemAcceptancePlan() {
        return {
          id: ACCEPTANCE_PLAN_SYSTEM_ID,
          name: t("acceptancePlanSystemDefault"),
          checks: [],
          otherText: "",
          systemDefault: true,
        };
      }

      function resolveAcceptancePlanById(planId) {
        if (!planId || planId === ACCEPTANCE_PLAN_SYSTEM_ID) {
          return buildSystemAcceptancePlan();
        }
        return getAcceptancePlanSummaries().find((plan) => plan.id === planId) || null;
      }

      function hasAcceptancePlanName(name, excludePlanId) {
        const normalized = normalizeAcceptancePlanName(name);
        if (!normalized) {
          return false;
        }
        if (normalized === "系统默认") {
          return true;
        }
        return getAcceptancePlanSummaries().some((plan) => (
          plan.id !== excludePlanId && plan.name === normalized
        ));
      }

      function formatAcceptancePlanText(template, params) {
        return String(template || "").replace(/\\{(\\w+)\\}/g, (match, key) => (
          params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
        ));
      }

      function findAcceptancePlanByName(name, excludePlanId) {
        const normalized = normalizeAcceptancePlanName(name);
        if (!normalized || normalized === "系统默认") {
          return null;
        }
        return getAcceptancePlanSummaries().find((plan) => (
          plan.id !== excludePlanId && plan.name === normalized
        )) || null;
      }

      function isSavedAcceptancePlanId(planId) {
        return Boolean(planId)
          && planId !== ACCEPTANCE_PLAN_SYSTEM_ID
          && planId !== ACCEPTANCE_PLAN_NEW_ID
          && getAcceptancePlanSummaries().some((plan) => plan.id === planId);
      }

      function savedPlanWithDefaultName() {
        const label = t("acceptancePlanDefaultName");
        return getAcceptancePlanSummaries().find((plan) => plan.name === label) || null;
      }

      function applyAcceptancePlanDraftToDom() {
        const select = getAcceptancePlanElement("acceptancePlanSelect");
        if (select) {
          const plans = getAcceptancePlanSummaries();
          const savedDefault = savedPlanWithDefaultName();
          const previousValue = select.value;
          select.innerHTML = "";
          const newOption = document.createElement("option");
          newOption.value = ACCEPTANCE_PLAN_NEW_ID;
          newOption.textContent = t("acceptancePlanNewOption");
          select.appendChild(newOption);
          if (!savedDefault) {
            const systemOption = document.createElement("option");
            systemOption.value = ACCEPTANCE_PLAN_SYSTEM_ID;
            systemOption.textContent = t("acceptancePlanDefaultName");
            select.appendChild(systemOption);
          }
          plans.forEach((plan) => {
            const option = document.createElement("option");
            option.value = plan.id;
            option.textContent = plan.name;
            select.appendChild(option);
          });
          const currentId = acceptancePlanDialog.planId;
          const target = currentId === ACCEPTANCE_PLAN_NEW_ID || currentId === ACCEPTANCE_PLAN_SYSTEM_ID
            ? currentId
            : (plans.some((plan) => plan.id === currentId) ? currentId : ACCEPTANCE_PLAN_SYSTEM_ID);
          select.value = target;
          if (previousValue && previousValue !== target && !plans.some((plan) => plan.id === previousValue) && previousValue !== ACCEPTANCE_PLAN_NEW_ID && previousValue !== ACCEPTANCE_PLAN_SYSTEM_ID) {
            select.value = target;
          }
        }
        const deleteButton = getAcceptancePlanElement("deleteAcceptancePlan");
        if (deleteButton) {
          deleteButton.hidden = !isSavedAcceptancePlanId(acceptancePlanDialog.planId);
        }
        const nameField = getAcceptancePlanElement("acceptancePlanNameField");
        const nameInput = getAcceptancePlanElement("acceptancePlanNameInput");
        if (nameField) {
          nameField.style.display = "flex";
        }
        if (nameInput) {
          nameInput.value = acceptancePlanDialog.name;
        }
        ACCEPTANCE_PLAN_CHECK_KEYS.forEach((key) => {
          const input = getAcceptancePlanElement(ACCEPTANCE_PLAN_CHECK_INPUT_IDS[key]);
          if (input) {
            input.checked = acceptancePlanDialog.checks.indexOf(key) >= 0;
          }
        });
        const otherCheck = getAcceptancePlanElement(ACCEPTANCE_PLAN_CHECK_INPUT_IDS.other);
        const otherField = getAcceptancePlanElement("acceptancePlanOtherField");
        const otherText = getAcceptancePlanElement("acceptancePlanOtherText");
        const otherChecked = Boolean(otherCheck && otherCheck.checked);
        if (otherField) {
          otherField.style.display = otherChecked ? "flex" : "none";
        }
        if (otherCheck) {
          otherCheck.setAttribute("aria-expanded", otherChecked ? "true" : "false");
        }
        if (otherText) {
          otherText.value = acceptancePlanDialog.otherText;
        }
      }

      function loadAcceptancePlanDraft(planId, options = {}) {
        const savedDefault = savedPlanWithDefaultName();
        if (savedDefault && (!planId || planId === ACCEPTANCE_PLAN_SYSTEM_ID)) {
          planId = savedDefault.id;
        }
        if (planId === ACCEPTANCE_PLAN_NEW_ID) {
          acceptancePlanDialog.planId = ACCEPTANCE_PLAN_NEW_ID;
          acceptancePlanDialog.name = "";
          acceptancePlanDialog.checks = [];
          acceptancePlanDialog.otherText = "";
        } else {
          const plan = resolveAcceptancePlanById(planId) || buildSystemAcceptancePlan();
          acceptancePlanDialog.planId = plan.id;
          acceptancePlanDialog.name = plan.systemDefault ? t("acceptancePlanDefaultName") : plan.name;
          acceptancePlanDialog.checks = plan.checks.slice();
          acceptancePlanDialog.otherText = plan.otherText;
        }
        if (options.keepError !== true) {
          clearAcceptancePlanError();
        }
        applyAcceptancePlanDraftToDom();
      }

      function readAcceptancePlanChecksFromDom() {
        const checks = [];
        ACCEPTANCE_PLAN_CHECK_KEYS.forEach((key) => {
          const input = getAcceptancePlanElement(ACCEPTANCE_PLAN_CHECK_INPUT_IDS[key]);
          if (input && input.checked) {
            checks.push(key);
          }
        });
        return checks;
      }

      function readAcceptancePlanDraftFromDom() {
        const nameInput = getAcceptancePlanElement("acceptancePlanNameInput");
        const otherText = getAcceptancePlanElement("acceptancePlanOtherText");
        const checks = readAcceptancePlanChecksFromDom();
        return {
          planId: acceptancePlanDialog.planId,
          name: normalizeAcceptancePlanName(nameInput ? nameInput.value : acceptancePlanDialog.name),
          checks,
          otherText: checks.indexOf("other") >= 0
            ? normalizeAcceptancePlanOtherText(otherText ? otherText.value : "")
            : "",
        };
      }

      function syncAcceptancePlanOtherField() {
        const otherCheck = getAcceptancePlanElement(ACCEPTANCE_PLAN_CHECK_INPUT_IDS.other);
        const otherField = getAcceptancePlanElement("acceptancePlanOtherField");
        const checked = Boolean(otherCheck && otherCheck.checked);
        if (otherField) {
          otherField.style.display = checked ? "flex" : "none";
        }
        if (otherCheck) {
          otherCheck.setAttribute("aria-expanded", checked ? "true" : "false");
        }
      }

      function showAcceptancePlanError(message) {
        const error = getAcceptancePlanElement("acceptancePlanError");
        if (!error) {
          return;
        }
        error.textContent = message || "";
        error.style.display = message ? "block" : "none";
      }

      function clearAcceptancePlanError() {
        showAcceptancePlanError("");
      }

      function validateAcceptancePlanDraft(draft) {
        if (draft.checks.indexOf("other") >= 0 && !draft.otherText) {
          return t("acceptancePlanOtherTextRequired");
        }
        return "";
      }

      function setAcceptancePlanSaving(saving) {
        acceptancePlanDialog.saving = Boolean(saving);
        const overlay = getAcceptancePlanElement("acceptancePlanOverlay");
        if (overlay) {
          overlay.classList.toggle("is-saving", acceptancePlanDialog.saving);
        }
        const saveButton = getAcceptancePlanElement("saveAcceptancePlan");
        if (saveButton) {
          saveButton.disabled = acceptancePlanDialog.saving;
          saveButton.textContent = acceptancePlanDialog.saving
            ? t("acceptancePlanSaving")
            : t("acceptancePlanSavePlan");
        }
        const deleteButton = getAcceptancePlanElement("deleteAcceptancePlan");
        if (deleteButton) {
          deleteButton.disabled = acceptancePlanDialog.saving;
        }
        const deleteConfirm = getAcceptancePlanElement("confirmAcceptancePlanDelete");
        if (deleteConfirm) {
          deleteConfirm.disabled = acceptancePlanDialog.saving;
        }
        const nameConfirm = getAcceptancePlanElement("confirmAcceptancePlanName");
        const nameConfirmHadFocus = Boolean(nameConfirm && document.activeElement === nameConfirm);
        if (nameConfirm) {
          nameConfirm.disabled = acceptancePlanDialog.saving;
          nameConfirm.textContent = acceptancePlanDialog.saving
            ? t("acceptancePlanSaving")
            : t("acceptancePlanSaveNameConfirm");
        }
        // 禁用当前焦点按钮会把焦点甩出弹窗，Esc 就到不了命名层。保存期间把焦点留在名称输入框。
        if (nameConfirmHadFocus && acceptancePlanDialog.saving) {
          const nameInput = getAcceptancePlanElement("acceptancePlanNewName");
          if (nameInput && typeof nameInput.focus === "function") {
            nameInput.focus();
          }
        }
      }

      function isAcceptancePlanNameDialogOpen() {
        const overlay = getAcceptancePlanElement("acceptancePlanNameOverlay");
        return Boolean(overlay && overlay.classList.contains("visible"));
      }

      function openAcceptancePlanNameDialog(presetName) {
        const overlay = getAcceptancePlanElement("acceptancePlanNameOverlay");
        if (!overlay) {
          return;
        }
        acceptancePlanDialog.nameDialogOpen = true;
        const input = getAcceptancePlanElement("acceptancePlanNewName");
        if (input) {
          input.value = normalizeAcceptancePlanName(presetName || "");
        }
        const error = getAcceptancePlanElement("acceptancePlanNameError");
        if (error) {
          error.textContent = "";
          error.style.display = "none";
        }
        overlay.classList.add("visible");
        setTimeout(() => {
          if (input) {
            input.focus();
            input.select();
          }
        }, 0);
      }

      function closeAcceptancePlanNameDialog(options = {}) {
        const overlay = getAcceptancePlanElement("acceptancePlanNameOverlay");
        if (overlay) {
          overlay.classList.remove("visible");
        }
        acceptancePlanDialog.nameDialogOpen = false;
        if (options.restoreFocus !== false) {
          const sibling = getAcceptancePlanElement("saveAcceptancePlan");
          if (sibling && acceptancePlanDialog.open) {
            sibling.focus();
          }
        }
      }

      function showAcceptancePlanNameError(message) {
        const error = getAcceptancePlanElement("acceptancePlanNameError");
        if (!error) {
          return;
        }
        error.textContent = message || "";
        error.style.display = message ? "block" : "none";
      }

      function requestAcceptancePlanSave(planId, draft) {
        vscode.postMessage({
          type: "saveLoopPlusAcceptancePlan",
          planId: planId || null,
          name: draft.name,
          checks: draft.checks,
          otherText: draft.otherText,
          select: true,
        });
      }

      function confirmAcceptancePlanNameDialog() {
        if (acceptancePlanDialog.saving) {
          return;
        }
        const input = getAcceptancePlanElement("acceptancePlanNewName");
        const name = normalizeAcceptancePlanName(input ? input.value : "");
        if (!name) {
          showAcceptancePlanNameError(t("acceptancePlanNameRequired"));
          if (input) {
            input.focus();
          }
          return;
        }
        if (hasAcceptancePlanName(name, acceptancePlanDialog.planId)) {
          showAcceptancePlanNameError(t("acceptancePlanNameDuplicate"));
          if (input) {
            input.focus();
          }
          return;
        }
        const otherText = getAcceptancePlanElement("acceptancePlanOtherText");
        const checks = readAcceptancePlanChecksFromDom();
        const draft = {
          name,
          checks,
          otherText: checks.indexOf("other") >= 0
            ? normalizeAcceptancePlanOtherText(otherText ? otherText.value : "")
            : "",
        };
        const validationError = validateAcceptancePlanDraft(draft);
        if (validationError) {
          closeAcceptancePlanNameDialog();
          showAcceptancePlanError(validationError);
          return;
        }
        setAcceptancePlanSaving(true);
        requestAcceptancePlanSave(null, draft);
      }

      function saveAcceptancePlanFromDialog() {
        if (acceptancePlanDialog.saving) {
          return;
        }
        const draft = readAcceptancePlanDraftFromDom();
        const validationError = validateAcceptancePlanDraft(draft);
        if (validationError) {
          showAcceptancePlanError(validationError);
          return;
        }
        if (!draft.name) {
          showAcceptancePlanError(t("acceptancePlanNameRequired"));
          const nameInput = getAcceptancePlanElement("acceptancePlanNameInput");
          if (nameInput && typeof nameInput.focus === "function") {
            nameInput.focus();
          }
          return;
        }
        // 已保存方案按 ID 更新；系统默认和新增方案若与已有方案同名，则覆盖那一条。
        const sameName = findAcceptancePlanByName(draft.name, null);
        const updatingSavedPlan = isSavedAcceptancePlanId(draft.planId);
        if (hasAcceptancePlanName(draft.name, updatingSavedPlan ? draft.planId : (sameName ? sameName.id : null))) {
          showAcceptancePlanError(t("acceptancePlanNameDuplicate"));
          return;
        }
        const targetPlanId = updatingSavedPlan ? draft.planId : (sameName ? sameName.id : null);
        clearAcceptancePlanError();
        setAcceptancePlanSaving(true);
        requestAcceptancePlanSave(targetPlanId, draft);
      }

      function isAcceptancePlanDeleteDialogOpen() {
        const overlay = getAcceptancePlanElement("acceptancePlanDeleteOverlay");
        return Boolean(overlay && overlay.classList.contains("visible"));
      }

      function openAcceptancePlanDeleteDialog() {
        if (acceptancePlanDialog.saving || !isSavedAcceptancePlanId(acceptancePlanDialog.planId)) {
          return;
        }
        const overlay = getAcceptancePlanElement("acceptancePlanDeleteOverlay");
        if (!overlay) {
          return;
        }
        const name = normalizeAcceptancePlanName(acceptancePlanDialog.name) || acceptancePlanDialog.planId;
        const desc = getAcceptancePlanElement("acceptancePlanDeleteDesc");
        if (desc) {
          desc.textContent = formatAcceptancePlanText(t("acceptancePlanDeleteDesc"), { name });
        }
        acceptancePlanDialog.deleteDialogOpen = true;
        overlay.classList.add("visible");
        setTimeout(() => {
          const cancel = getAcceptancePlanElement("cancelAcceptancePlanDelete");
          if (cancel && typeof cancel.focus === "function") {
            cancel.focus();
          }
        }, 0);
      }

      function closeAcceptancePlanDeleteDialog(options = {}) {
        const overlay = getAcceptancePlanElement("acceptancePlanDeleteOverlay");
        if (overlay) {
          overlay.classList.remove("visible");
        }
        acceptancePlanDialog.deleteDialogOpen = false;
        if (options.restoreFocus !== false) {
          const sibling = getAcceptancePlanElement("deleteAcceptancePlan");
          if (sibling && acceptancePlanDialog.open && !sibling.hidden && typeof sibling.focus === "function") {
            sibling.focus();
          }
        }
      }

      function confirmAcceptancePlanDeleteDialog() {
        if (acceptancePlanDialog.saving || !isSavedAcceptancePlanId(acceptancePlanDialog.planId)) {
          closeAcceptancePlanDeleteDialog({ restoreFocus: false });
          return;
        }
        acceptancePlanDialog.deleting = true;
        setAcceptancePlanSaving(true);
        vscode.postMessage({
          type: "deleteLoopPlusAcceptancePlan",
          planId: acceptancePlanDialog.planId,
        });
      }

      function handleAcceptancePlanSavedMessage(data) {
        const wasDeleting = acceptancePlanDialog.deleting;
        acceptancePlanDialog.deleting = false;
        setAcceptancePlanSaving(false);
        const error = data && typeof data.error === "string" ? data.error : "";
        if (error) {
          if (isAcceptancePlanNameDialogOpen()) {
            showAcceptancePlanNameError(error);
            const nameInput = getAcceptancePlanElement("acceptancePlanNewName");
            if (nameInput && typeof nameInput.focus === "function") {
              nameInput.focus();
            }
            return;
          }
          showAcceptancePlanError(error || t("acceptancePlanSaveFailed"));
          return;
        }
        if (Array.isArray(data.plans)) {
          state.loopPlusAcceptancePlans = data.plans;
        }
        if (typeof data.selection === "string" && data.selection) {
          state.loopPlusAcceptancePlanSelection = data.selection;
        }
        if (wasDeleting) {
          closeAcceptancePlanDeleteDialog({ restoreFocus: false });
          loadAcceptancePlanDraft(typeof data.selection === "string" && data.selection ? data.selection : ACCEPTANCE_PLAN_SYSTEM_ID);
          showToast(t("acceptancePlanDeleted"));
          return;
        }
        if (data.plan && typeof data.plan === "object") {
          const plan = normalizeAcceptancePlanSnapshot(data.plan);
          if (plan && !plan.systemDefault) {
            const savedId = plan.id;
            if (isAcceptancePlanNameDialogOpen()) {
              closeAcceptancePlanNameDialog({ restoreFocus: false });
            }
            acceptancePlanDialog.planId = savedId;
            acceptancePlanDialog.name = plan.name;
            acceptancePlanDialog.checks = plan.checks.slice();
            acceptancePlanDialog.otherText = plan.otherText;
            clearAcceptancePlanError();
            applyAcceptancePlanDraftToDom();
            showToast(t("acceptancePlanSaved"));
            return;
          }
        }
        applyAcceptancePlanDraftToDom();
      }

      function handleAcceptancePlanSelectedMessage(data) {
        if (data && typeof data.error === "string" && data.error) {
          showAcceptancePlanError(data.error);
          return;
        }
        if (data && typeof data.selection === "string" && data.selection) {
          state.loopPlusAcceptancePlanSelection = data.selection;
        }
      }

      function isAcceptancePlanRequiredForPayload(payload, targetTabId) {
        if (!payload) {
          return false;
        }
        const tab = typeof getConversationTabSummary === "function"
          ? getConversationTabSummary(targetTabId)
          : null;
        const mode = typeof resolveDispatchInteractiveMode === "function"
          ? resolveDispatchInteractiveMode(payload.interactiveMode, tab, false)
          : payload.interactiveMode;
        if (mode !== "loop_plus") {
          return false;
        }
        // 已有 Loop+ 主任务或子任务绑定的标签页属于续跑/恢复/补充，不再弹验收方案。
        if (tab && typeof tab.loopTaskId === "string" && tab.loopTaskId) {
          return false;
        }
        if (tab && typeof tab.loopTaskRole === "string" && tab.loopTaskRole) {
          return false;
        }
        if (payload.skipPromptHistory === true) {
          return false;
        }
        return true;
      }

      function isAcceptancePlanSessionStillValid(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const tab = typeof getConversationTabSummary === "function"
          ? getConversationTabSummary(targetTabId)
          : null;
        if (!tab) {
          return false;
        }
        if (typeof tab.loopTaskId === "string" && tab.loopTaskId) {
          return false;
        }
        // 忙碌状态交给既有冲突/排队分支处理，不在这里拦截。
        return true;
      }

      function openAcceptancePlanDialog(payload, tabId, initialDraft) {
        const overlay = getAcceptancePlanElement("acceptancePlanOverlay");
        if (!overlay) {
          const sent = dispatchPrompt(payload);
          if (sent) {
            elements.promptInput.value = "";
            resetPromptContextForNextPrompt();
          }
          return;
        }
        acceptancePlanDialog.open = true;
        acceptancePlanDialog.submitting = false;
        acceptancePlanDialog.saving = false;
        acceptancePlanDialog.payload = payload;
        acceptancePlanDialog.tabId = typeof tabId === "string" ? tabId : "";
        // 焦点回到输入框，用户取消后可以继续编辑原有草稿。
        acceptancePlanDialog.returnFocus = typeof elements !== "undefined" && elements && elements.promptInput
          ? elements.promptInput
          : document.activeElement;
        if (initialDraft && typeof initialDraft === "object") {
          const normalized = normalizeAcceptancePlanSnapshot(initialDraft) || buildSystemAcceptancePlan();
          acceptancePlanDialog.planId = normalized.id;
          acceptancePlanDialog.name = normalized.systemDefault ? t("acceptancePlanDefaultName") : normalized.name;
          acceptancePlanDialog.checks = normalized.checks.slice();
          acceptancePlanDialog.otherText = normalized.otherText;
          clearAcceptancePlanError();
          applyAcceptancePlanDraftToDom();
        } else {
          const preferredPlan = typeof state.loopPlusAcceptancePlanSelection === "string"
            ? state.loopPlusAcceptancePlanSelection
            : ACCEPTANCE_PLAN_SYSTEM_ID;
          loadAcceptancePlanDraft(preferredPlan);
        }
        setAcceptancePlanSaving(false);
        overlay.classList.add("visible");
        setTimeout(() => {
          const select = getAcceptancePlanElement("acceptancePlanSelect");
          if (select) {
            select.focus();
          }
        }, 0);
      }

      function closeAcceptancePlanDialog(options = {}) {
        const overlay = getAcceptancePlanElement("acceptancePlanOverlay");
        if (overlay) {
          overlay.classList.remove("visible");
        }
        closeAcceptancePlanNameDialog({ restoreFocus: false });
        closeAcceptancePlanDeleteDialog({ restoreFocus: false });
        acceptancePlanDialog.open = false;
        acceptancePlanDialog.payload = null;
        acceptancePlanDialog.tabId = "";
        acceptancePlanDialog.submitting = false;
        setAcceptancePlanSaving(false);
        clearAcceptancePlanError();
        const returnFocus = acceptancePlanDialog.returnFocus;
        acceptancePlanDialog.returnFocus = null;
        if (options.restoreFocus !== false) {
          if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
            returnFocus.focus();
          } else if (elements.promptInput) {
            elements.promptInput.focus();
          }
        }
      }

      function buildAcceptancePlanSnapshotFromDraft(draft) {
        const isSystem = draft.planId === ACCEPTANCE_PLAN_SYSTEM_ID;
        return {
          id: isSystem ? ACCEPTANCE_PLAN_SYSTEM_ID : draft.planId,
          name: isSystem ? t("acceptancePlanSystemDefault") : draft.name,
          checks: draft.checks.slice(),
          otherText: draft.checks.indexOf("other") >= 0 ? draft.otherText : "",
          systemDefault: isSystem,
        };
      }

      function confirmAcceptancePlan() {
        if (!acceptancePlanDialog.open || acceptancePlanDialog.submitting || acceptancePlanDialog.saving) {
          return;
        }
        const draft = readAcceptancePlanDraftFromDom();
        const validationError = validateAcceptancePlanDraft(draft);
        if (validationError) {
          showAcceptancePlanError(validationError);
          return;
        }
        if (!draft.name) {
          showAcceptancePlanError(t("acceptancePlanNameRequired"));
          const nameInput = getAcceptancePlanElement("acceptancePlanNameInput");
          if (nameInput && typeof nameInput.focus === "function") {
            nameInput.focus();
          }
          return;
        }
        const payload = acceptancePlanDialog.payload;
        const capturedTabId = acceptancePlanDialog.tabId;
        if (!payload) {
          closeAcceptancePlanDialog();
          return;
        }
        // 确认前重新校验来源标签页，避免异步弹窗把请求发到别的会话。
        if (capturedTabId && capturedTabId !== getActiveConversationTabId()) {
          showAcceptancePlanError(t("acceptancePlanSessionChanged"));
          return;
        }
        if (typeof isAcceptancePlanSessionStillValid === "function" && !isAcceptancePlanSessionStillValid(capturedTabId)) {
          showAcceptancePlanError(t("acceptancePlanSessionChanged"));
          return;
        }
        const nextPayload = Object.assign({}, payload, {
          loopPlusAcceptancePlan: buildAcceptancePlanSnapshotFromDraft(draft),
        });
        // 先加锁再关闭弹窗，确保重复点击只产生一次发送。
        acceptancePlanDialog.submitting = true;
        closeAcceptancePlanDialog({ restoreFocus: false });
        const outcome = typeof sendPromptWithAcceptancePlan === "function"
          ? sendPromptWithAcceptancePlan(nextPayload, capturedTabId)
          : "failed";
        if (outcome === "failed") {
          showToast(t("acceptancePlanSendFailed"));
        }
      }

      function cancelAcceptancePlan() {
        if (acceptancePlanDialog.saving) {
          return;
        }
        // 取消只关闭弹窗：不清输入框、不清附件、不清上下文、不发送请求。
        closeAcceptancePlanDialog();
      }

      function trapAcceptancePlanFocus(event) {
        const overlay = getAcceptancePlanElement("acceptancePlanOverlay");
        const nameOverlay = getAcceptancePlanElement("acceptancePlanNameOverlay");
        const deleteOverlay = getAcceptancePlanElement("acceptancePlanDeleteOverlay");
        const activeOverlay = isAcceptancePlanDeleteDialogOpen()
          ? deleteOverlay
          : (isAcceptancePlanNameDialogOpen() ? nameOverlay : overlay);
        if (!activeOverlay || !activeOverlay.classList.contains("visible")) {
          return;
        }
        const focusable = Array.prototype.slice.call(activeOverlay.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )).filter((element) => element.offsetParent !== null || element === document.activeElement);
        if (!focusable.length) {
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      function handleAcceptancePlanKeydown(event) {
        if (!acceptancePlanDialog.open && !isAcceptancePlanNameDialogOpen() && !isAcceptancePlanDeleteDialogOpen()) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (isAcceptancePlanDeleteDialogOpen()) {
            closeAcceptancePlanDeleteDialog();
            return;
          }
          if (isAcceptancePlanNameDialogOpen()) {
            closeAcceptancePlanNameDialog();
            return;
          }
          cancelAcceptancePlan();
          return;
        }
        if (event.key === "Tab") {
          trapAcceptancePlanFocus(event);
        }
      }

      function bindAcceptancePlanDialogEvents() {
        const overlay = getAcceptancePlanElement("acceptancePlanOverlay");
        if (!overlay) {
          return;
        }
        const select = getAcceptancePlanElement("acceptancePlanSelect");
        if (select) {
          select.addEventListener("change", () => {
            if (acceptancePlanDialog.saving) {
              return;
            }
            const nextPlanId = select.value;
            loadAcceptancePlanDraft(nextPlanId);
            // 「新增方案」只存在于本次弹窗，不写入最近选中项。
            if (nextPlanId !== ACCEPTANCE_PLAN_NEW_ID) {
              state.loopPlusAcceptancePlanSelection = nextPlanId;
              vscode.postMessage({ type: "selectLoopPlusAcceptancePlan", planId: nextPlanId });
            }
          });
        }
        ACCEPTANCE_PLAN_CHECK_KEYS.forEach((key) => {
          const input = getAcceptancePlanElement(ACCEPTANCE_PLAN_CHECK_INPUT_IDS[key]);
          if (!input) {
            return;
          }
          input.addEventListener("change", () => {
            if (key === "other") {
              syncAcceptancePlanOtherField();
            }
            if (acceptancePlanDialog.saving) {
              return;
            }
            clearAcceptancePlanError();
          });
        });
        const otherText = getAcceptancePlanElement("acceptancePlanOtherText");
        if (otherText) {
          otherText.addEventListener("input", () => {
            if (acceptancePlanDialog.saving) {
              return;
            }
            clearAcceptancePlanError();
          });
        }
        const nameInput = getAcceptancePlanElement("acceptancePlanNameInput");
        if (nameInput) {
          nameInput.addEventListener("input", () => {
            if (acceptancePlanDialog.saving) {
              return;
            }
            clearAcceptancePlanError();
          });
          nameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveAcceptancePlanFromDialog();
            }
          });
        }
        const saveButton = getAcceptancePlanElement("saveAcceptancePlan");
        if (saveButton) {
          saveButton.addEventListener("click", () => saveAcceptancePlanFromDialog());
        }
        const deleteButton = getAcceptancePlanElement("deleteAcceptancePlan");
        if (deleteButton) {
          deleteButton.addEventListener("click", () => openAcceptancePlanDeleteDialog());
        }
        const deleteOverlay = getAcceptancePlanElement("acceptancePlanDeleteOverlay");
        if (deleteOverlay) {
          const deleteConfirm = getAcceptancePlanElement("confirmAcceptancePlanDelete");
          if (deleteConfirm) {
            deleteConfirm.addEventListener("click", () => confirmAcceptancePlanDeleteDialog());
          }
          const deleteCancel = getAcceptancePlanElement("cancelAcceptancePlanDelete");
          if (deleteCancel) {
            deleteCancel.addEventListener("click", () => closeAcceptancePlanDeleteDialog());
          }
          const deleteClose = getAcceptancePlanElement("closeAcceptancePlanDelete");
          if (deleteClose) {
            deleteClose.addEventListener("click", () => closeAcceptancePlanDeleteDialog());
          }
          deleteOverlay.addEventListener("mousedown", (event) => {
            if (event.target === deleteOverlay) {
              closeAcceptancePlanDeleteDialog();
            }
          });
          deleteOverlay.addEventListener("keydown", handleAcceptancePlanKeydown);
        }
        const cancelButton = getAcceptancePlanElement("cancelAcceptancePlan");
        if (cancelButton) {
          cancelButton.addEventListener("click", () => cancelAcceptancePlan());
        }
        const confirmButton = getAcceptancePlanElement("confirmAcceptancePlan");
        if (confirmButton) {
          confirmButton.addEventListener("click", () => confirmAcceptancePlan());
        }
        const closeButton = getAcceptancePlanElement("closeAcceptancePlan");
        if (closeButton) {
          closeButton.addEventListener("click", () => cancelAcceptancePlan());
        }
        overlay.addEventListener("mousedown", (event) => {
          if (event.target === overlay) {
            cancelAcceptancePlan();
          }
        });
        const nameOverlay = getAcceptancePlanElement("acceptancePlanNameOverlay");
        if (nameOverlay) {
          const nameInputElement = getAcceptancePlanElement("acceptancePlanNewName");
          if (nameInputElement) {
            nameInputElement.addEventListener("keydown", (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                confirmAcceptancePlanNameDialog();
              }
            });
            nameInputElement.addEventListener("input", () => showAcceptancePlanNameError(""));
          }
          const nameConfirm = getAcceptancePlanElement("confirmAcceptancePlanName");
          if (nameConfirm) {
            nameConfirm.addEventListener("click", () => confirmAcceptancePlanNameDialog());
          }
          const nameCancel = getAcceptancePlanElement("cancelAcceptancePlanName");
          if (nameCancel) {
            nameCancel.addEventListener("click", () => closeAcceptancePlanNameDialog());
          }
          const nameClose = getAcceptancePlanElement("closeAcceptancePlanName");
          if (nameClose) {
            nameClose.addEventListener("click", () => closeAcceptancePlanNameDialog());
          }
          nameOverlay.addEventListener("mousedown", (event) => {
            if (event.target === nameOverlay) {
              closeAcceptancePlanNameDialog();
            }
          });
        }
        overlay.addEventListener("keydown", handleAcceptancePlanKeydown);
        if (nameOverlay) {
          nameOverlay.addEventListener("keydown", handleAcceptancePlanKeydown);
        }
      }
`;
