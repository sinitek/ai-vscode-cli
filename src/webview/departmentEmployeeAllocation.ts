import type { DepartmentGroupChatProjection } from "./loopGroupChatPanelTypes";
import { buildDepartmentLeaderChatTitle } from "./loopGroupChatPanelRenderer";
import { renderModalActions, renderModalCloseButton, renderModalHeader } from "./modalComponents";

type AllocationRow = NonNullable<DepartmentGroupChatProjection["employeeAllocation"]>["leaders"][number];
type EscapeHtml = (text: string) => string;

function describeAllocation(row?: AllocationRow): string {
  return row
    ? `${row.source === "manual" ? "手动" : "默认均分"} · 期望上限 ${row.desiredLimit} · 实际占用 ${row.activeEmployees ?? "未知"} · ${row.appliedLimit === null ? "待首次派发" : `已应用上限 ${row.appliedLimit}`}${row.pending ? " · 已保存，下次派发生效" : ""}`
    : "员工额度未知，额度服务不可用，暂不可编辑。";
}

function readAllocation(department: DepartmentGroupChatProjection) {
  const snapshot = department.employeeAllocation;
  return snapshot?.rootTaskId === department.rootTaskId ? snapshot : undefined;
}

export function renderDepartmentEmployeeAllocationSummary(department: DepartmentGroupChatProjection, leaderTaskId: string, escapeHtml: EscapeHtml): string {
  return `<div class="member-meta">${escapeHtml(describeAllocation(readAllocation(department)?.leaders.find((item) => item.leaderTaskId === leaderTaskId)))}</div>`;
}

export function renderDepartmentEmployeeAllocationRows(department: DepartmentGroupChatProjection | undefined, escapeHtml: EscapeHtml): string {
  if (department?.role !== "director") return "";
  const snapshot = readAllocation(department);
  const rows = department.leaders.map((leader) => {
    const leaderTaskId = leader.taskId;
    const row = snapshot?.leaders.find((item) => item.leaderTaskId === leaderTaskId);
    const editable = Boolean(leaderTaskId && row && department.employeeAllocationEditable === true);
    const title = escapeHtml(`${buildDepartmentLeaderChatTitle(leader.leaderNumber)} · ${leader.participant.title}`);
    return `<li class="department-allocation" data-allocation-root="${escapeHtml(department.rootTaskId)}" data-allocation-leader="${escapeHtml(leaderTaskId)}" data-allocation-revision="${snapshot?.revision ?? ""}" data-allocation-editable="${editable}">
      <h3 class="department-allocation-name">${title}</h3>
      <div class="member-meta">${escapeHtml(leaderTaskId ? describeAllocation(row) : "组长尚未创建，暂不可编辑。")}</div>
      ${row && !editable ? '<div class="member-meta">额度写入服务不可用，暂不可编辑。</div>' : ""}
      <div class="department-allocation-controls">
        <label>员工上限 <input class="department-allocation-input" type="number" min="0" max="${department.maxEmployees}" step="1" aria-label="员工上限：${title}" value="${row?.desiredLimit ?? ""}"${editable ? "" : " disabled"}></label>
      </div>
      <div class="member-meta department-allocation-feedback" role="status" aria-live="polite"></div>
    </li>`;
  }).join("");
  return `<ul class="department-allocation-list" data-allocation-root="${escapeHtml(department.rootTaskId)}">${rows || '<li class="member-meta">尚未分配组长</li>'}</ul>`;
}

export function renderDepartmentEmployeeAllocationDialog(rowsHtml: string): string {
  return `<dialog id="departmentAllocationDialog" class="dialog department-allocation-dialog" aria-labelledby="departmentAllocationTitle">
    ${renderModalHeader({
      className: "dialog-header",
      titleHtml: '<h2 id="departmentAllocationTitle" class="dialog-title">分配员工</h2>',
      closeHtml: renderModalCloseButton({ id: "departmentAllocationClose", label: "关闭", className: "icon-button" }),
    })}
    <div id="departmentAllocationSlot" class="dialog-body">${rowsHtml}</div>
    ${renderModalActions("dialog-actions", '<div id="departmentAllocationStatus" class="member-meta department-allocation-error" role="status"></div><button id="departmentAllocationSave" class="button primary" type="button">保存并关闭</button>')}
  </dialog>`;
}

/** Runs inside the existing generated Webview; host messages still pass its source gate. */
export const DEPARTMENT_EMPLOYEE_ALLOCATION_SCRIPT = String.raw`
      const departmentEmployeeAllocation = (() => {
        const dialog = document.getElementById("departmentAllocationDialog");
        if (!dialog) return null;
        const slot = document.getElementById("departmentAllocationSlot");
        const close = document.getElementById("departmentAllocationClose");
        const save = document.getElementById("departmentAllocationSave");
        const status = document.getElementById("departmentAllocationStatus");
        let root = "";
        let serial = 0;
        let batch = null;
        const drafts = new Map();
        const rows = () => Array.from(slot.querySelectorAll("[data-allocation-leader]"));
        const idOf = (row) => row.dataset.allocationLeader;
        const editable = (row) => row.dataset.allocationEditable === "true";
        const inputOf = (row) => row.querySelector(".department-allocation-input");
        const rowOf = (target) => target && target.closest && target.closest("[data-allocation-leader]");
        const findRow = (leaderTaskId) => rows().find((row) => idOf(row) === leaderTaskId);
        function paintRow(row) {
          const pending = batch?.request?.leaderTaskId === idOf(row);
          const error = drafts.get(idOf(row))?.error || "";
          inputOf(row).disabled = !editable(row) || Boolean(batch);
          row.setAttribute("aria-busy", String(pending));
          const feedback = row.querySelector(".department-allocation-feedback");
          feedback.textContent = error || (pending ? "保存中…" : "");
          feedback.classList.toggle("department-allocation-error", Boolean(error));
        }
        function paint() {
          const currentRows = rows();
          currentRows.forEach(paintRow);
          close.disabled = Boolean(batch);
          save.disabled = Boolean(batch) || !currentRows.some(editable);
          save.textContent = batch ? "保存中…" : "保存并关闭";
        }
        function sync(replace) {
          const focused = document.activeElement;
          const focusedRow = rowOf(focused);
          replace?.(slot);
          const nextRoot = slot.firstElementChild?.dataset.allocationRoot || "";
          if (root !== nextRoot) {
            drafts.clear(); batch = null; root = nextRoot;
            if (dialog.open) dialog.close();
          }
          const currentRows = rows();
          const present = new Set(currentRows.map(idOf));
          for (const id of drafts.keys()) if (!present.has(id)) drafts.delete(id);
          for (const row of currentRows) {
            const draft = drafts.get(idOf(row));
            const input = inputOf(row);
            if (draft && input.value !== draft.value) input.value = draft.value;
          }
          if (batch?.request && !present.has(batch.request.leaderTaskId)) {
            failSave("待保存的组长已变更，请重试。");
          } else paint();
          if (dialog.open && focusedRow && !focused.isConnected) {
            const replacement = findRow(idOf(focusedRow));
            const control = replacement && inputOf(replacement);
            (control && !control.disabled ? control : close).focus({ preventScroll: true });
          }
        }
        function failSave(error, row) {
          const draft = row && drafts.get(idOf(row));
          if (draft) draft.error = error;
          status.textContent = (batch?.saved ? "部分额度已保存。" : "") + (draft ? "保存失败，请重试。" : error);
          batch = null;
          paint();
          const input = row && inputOf(row);
          (input && !input.disabled ? input : close).focus();
        }
        function saveNext(revision) {
          const change = batch.remaining.shift();
          if (!change) {
            batch = null;
            dialog.close();
            return;
          }
          const row = findRow(change.leaderTaskId);
          if (!row || !editable(row)) {
            failSave("待保存的组长额度不可编辑，请重试。", row); return;
          }
          const expectedRevision = revision ?? Number(row.dataset.allocationRevision);
          if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || Number(row.dataset.allocationRevision) > expectedRevision) {
            failSave("额度已更新，请刷新后重试。", row); return;
          }
          const requestId = "employee-limit-" + Date.now() + "-" + (++serial);
          batch.request = { ...change, requestId, expectedRevision };
          paint();
          vscode.postMessage({ type: "loopGroupChatChat:updateDepartmentEmployeeLimit", ...batch.request });
        }
        function submit() {
          if (!dialog.open || save.disabled) return;
          const remaining = [];
          status.textContent = "";
          for (const row of rows()) {
            const draft = drafts.get(idOf(row));
            if (!draft) continue;
            if (!editable(row)) { failSave("该组额度暂不可编辑，请重试。", row); return; }
            const input = inputOf(row);
            const value = Number(draft.value);
            if (!draft.value || !Number.isSafeInteger(value) || value < 0 || value > Number(input.max)) {
              draft.error = "请输入 0 到 " + input.max + " 之间的整数。";
              paintRow(row); input.focus(); return;
            }
            draft.error = "";
            if (value !== Number(input.defaultValue)) remaining.push({ leaderTaskId: idOf(row), employeeLimit: value });
          }
          batch = { remaining, request: null, saved: 0 };
          saveNext();
        }
        dialog.addEventListener("input", (event) => {
          const row = rowOf(event.target);
          if (batch || !row || event.target !== inputOf(row) || !editable(row)) return;
          const input = event.target;
          if (input.value === input.defaultValue) drafts.delete(idOf(row));
          else drafts.set(idOf(row), { value: input.value, error: "" });
          paintRow(row);
        });
        dialog.addEventListener("keydown", (event) => {
          if (event.key === "Escape") event.stopPropagation();
          const row = rowOf(event.target);
          if (event.key === "Enter" && row && event.target === inputOf(row) && !event.isComposing) {
            event.preventDefault(); submit();
          }
        });
        save.addEventListener("click", submit);
        close.addEventListener("click", () => dialog.close());
        dialog.addEventListener("cancel", (event) => {
          if (batch) event.preventDefault();
        });
        dialog.addEventListener("close", () => {
          if (dialog.open) return;
          drafts.clear();
          status.textContent = "";
          rows().forEach((row) => {
            const input = inputOf(row);
            input.value = input.defaultValue;
          });
          paint();
          if (document.activeElement === document.body) actionButton("allocateEmployees")?.focus({ preventScroll: true });
        });
        function settled(message) {
          if (!message || message.type !== "loopGroupChatChat:departmentEmployeeLimitSettled") return false;
          const request = batch?.request;
          if (!request || message.rootTaskId !== root || message.leaderTaskId !== request.leaderTaskId || message.requestId !== request.requestId) return true;
          const row = findRow(request.leaderTaskId);
          if (!message.ok) failSave(message.error || "保存失败，请重试。", row);
          else if (!row || !Number.isSafeInteger(message.revision) || message.revision < request.expectedRevision
            || message.revision < Number(row.dataset.allocationRevision) || message.desiredLimit !== request.employeeLimit) {
            failSave("额度已更新，请刷新后重试。", row);
          } else {
            drafts.delete(request.leaderTaskId);
            const input = inputOf(row);
            input.defaultValue = input.value = String(message.desiredLimit);
            batch.saved += 1;
            saveNext(message.revision);
          }
          return true;
        }
        sync();
        return { sync, settled, open: () => { if (!dialog.open) dialog.showModal(); } };
      })();
`;
