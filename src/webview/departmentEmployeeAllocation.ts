import type { DepartmentGroupChatProjection } from "./loopGroupChatPanelTypes";

export function renderDepartmentEmployeeAllocation(department: DepartmentGroupChatProjection, leaderTaskId: string, escapeHtml: (text: string) => string): string {
  const snapshot = department.employeeAllocation;
  const row = snapshot?.rootTaskId === department.rootTaskId ? snapshot.leaders.find((item) => item.leaderTaskId === leaderTaskId) : undefined;
  const editable = department.role === "director" && department.employeeAllocationEditable === true && Boolean(row);
  const description = row
    ? `${row.source === "manual" ? "手动" : "默认均分"} · 期望上限 ${row.desiredLimit} · 实际占用 ${row.activeEmployees ?? "未知"} · ${row.appliedLimit === null ? "待首次派发" : `已应用上限 ${row.appliedLimit}`} · ${row.pending ? "已保存，下次派发生效" : row.appliedLimit === null ? "等待首次派发应用" : "已应用"}`
    : "员工额度未知，额度服务不可用，暂不可编辑。";
  const attributes = `data-allocation-root="${escapeHtml(department.rootTaskId)}" data-allocation-leader="${escapeHtml(leaderTaskId)}" data-allocation-revision="${snapshot?.revision ?? ""}" data-allocation-editable="${editable}"`;
  const controls = department.role === "director" ? `<div class="department-allocation-controls">
    <label>员工上限 <input class="department-allocation-input" type="number" min="0" max="${department.maxEmployees}" step="1" aria-label="员工上限：${escapeHtml(leaderTaskId)}" data-department-focus-key="${escapeHtml(`${department.rootTaskId}:${leaderTaskId}:limit`)}" value="${row?.desiredLimit ?? ""}"${editable ? "" : " disabled"}></label>
    <button class="button" type="button" data-allocation-action="save" data-department-focus-key="${escapeHtml(`${department.rootTaskId}:${leaderTaskId}:save`)}"${editable ? "" : " disabled"}>保存</button>
    <button class="button" type="button" data-allocation-action="reset" data-department-focus-key="${escapeHtml(`${department.rootTaskId}:${leaderTaskId}:reset`)}"${editable ? "" : " disabled"}>恢复均分</button>
  </div>` : "";
  return `<div class="department-allocation" ${attributes}>${controls}<div class="member-meta" data-allocation-meta>${escapeHtml(description)}</div>
    ${row && department.role === "director" && !editable ? '<div class="member-meta">额度写入服务不可用，暂不可编辑。</div>' : ""}
    <div class="member-meta department-allocation-feedback" role="status" aria-live="polite"></div></div>`;
}

/** Runs inside the existing generated Webview; host messages still pass its source gate. */
export const DEPARTMENT_EMPLOYEE_ALLOCATION_SCRIPT = String.raw`
      const departmentEmployeeAllocation = (() => {
        let root = "";
        let serial = 0;
        const drafts = new Map();
        const rows = () => Array.from(document.querySelectorAll("[data-allocation-leader]"));
        const inputOf = (row) => row.querySelector(".department-allocation-input");
        const rowOf = (target) => target && target.closest && target.closest("[data-allocation-leader]");
        const stateOf = (row) => {
          const id = row.dataset.allocationLeader;
          if (!drafts.has(id)) drafts.set(id, { value: inputOf(row)?.value || "", dirty: false, version: 0, pending: null, error: "" });
          return drafts.get(id);
        };
        function paint(row) {
          const state = stateOf(row);
          const input = inputOf(row);
          if (input && state.dirty) input.value = state.value;
          const disabled = row.dataset.allocationEditable !== "true" || Boolean(state.pending);
          row.querySelectorAll("input, button").forEach((element) => { element.disabled = disabled; });
          const save = row.querySelector('[data-allocation-action="save"]');
          if (save) save.textContent = state.pending ? "保存中…" : "保存";
          row.setAttribute("aria-busy", String(Boolean(state.pending)));
          const feedback = row.querySelector(".department-allocation-feedback");
          feedback.textContent = state.error || (state.pending ? "保存中…" : "");
          feedback.classList.toggle("department-allocation-error", Boolean(state.error));
        }
        function sync() {
          const currentRows = rows();
          const nextRoot = currentRows[0]?.dataset.allocationRoot || "";
          if (root !== nextRoot) { drafts.clear(); root = nextRoot; }
          const present = new Set(currentRows.map((row) => row.dataset.allocationLeader));
          for (const id of drafts.keys()) if (!present.has(id)) drafts.delete(id);
          currentRows.forEach(paint);
        }
        function submit(row, reset) {
          if (!row || row.dataset.allocationRoot !== root || row.dataset.allocationEditable !== "true") return;
          const state = stateOf(row), input = inputOf(row);
          if (state.pending || !input) return;
          const text = input.value.trim();
          const value = reset ? null : Number(text);
          const revision = Number(row.dataset.allocationRevision);
          if (!reset && (!text || !Number.isSafeInteger(value) || value < 0 || value > Number(input.max))) {
            state.error = "请输入 0 到 " + input.max + " 之间的整数。";
            paint(row); input.focus({ preventScroll: true }); return;
          }
          if (!Number.isSafeInteger(revision) || revision < 0) return;
          const requestId = "employee-limit-" + Date.now() + "-" + (++serial);
          state.pending = { requestId, version: state.version, revision };
          state.error = "";
          paint(row);
          vscode.postMessage({ type: "loopGroupChatChat:updateDepartmentEmployeeLimit", requestId,
            leaderTaskId: row.dataset.allocationLeader, employeeLimit: value, expectedRevision: revision });
        }
        document.addEventListener("input", (event) => {
          const row = rowOf(event.target);
          if (!row || event.target !== inputOf(row)) return;
          const state = stateOf(row);
          state.value = event.target.value; state.dirty = true; state.version += 1; state.error = "";
          paint(row);
        });
        document.addEventListener("keydown", (event) => {
          const row = rowOf(event.target);
          if (event.key === "Enter" && row && event.target === inputOf(row) && !event.isComposing) {
            event.preventDefault(); submit(row, false);
          }
        });
        document.addEventListener("click", (event) => {
          const button = event.target.closest && event.target.closest("[data-allocation-action]");
          if (button && !button.disabled) submit(rowOf(button), button.dataset.allocationAction === "reset");
        });
        function settled(message) {
          if (!message || message.type !== "loopGroupChatChat:departmentEmployeeLimitSettled") return false;
          if (message.rootTaskId !== root) return true;
          const row = rows().find((item) => item.dataset.allocationLeader === message.leaderTaskId);
          const state = row && drafts.get(message.leaderTaskId);
          const pending = state?.pending;
          if (!pending || pending.requestId !== message.requestId) return true;
          state.pending = null;
          if (!message.ok) state.error = typeof message.error === "string" ? message.error : "保存失败，请重试。";
          else if (Number.isSafeInteger(message.revision) && message.revision >= pending.revision
            && message.revision >= Number(row.dataset.allocationRevision) && Number.isSafeInteger(message.desiredLimit) && message.desiredLimit >= 0) {
            if (state.version === pending.version) {
              state.dirty = false; state.value = String(message.desiredLimit);
              inputOf(row).value = state.value;
            }
          } else state.error = "额度已更新，请刷新后重试。";
          paint(row); return true;
        }
        sync();
        return { sync, settled };
      })();
`;
