import { fixtureEmployeeAdmission } from "./departmentemployeeadmission";
import * as fs from "fs";
import * as path from "path";
import { createDepartmentCodexPreparation, type DepartmentCodexLaunchDescription } from "../../../extensionHost/departmentcodexpreparation";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import type { LoopTaskRecord } from "../../../loopTaskStore";
/** A short lived trusted host, not another execution worker. */
async function main(): Promise<void> {
  const directory = process.argv[2], file = (name: string) => path.join(directory, name);
  const selection = JSON.parse(fs.readFileSync(file("expected"), "utf8"));
  const description: DepartmentCodexLaunchDescription = JSON.parse(fs.readFileSync(file("description"), "utf8"));
  const read = (id: string): LoopTaskRecord => JSON.parse(fs.readFileSync(file(id + "-task"), "utf8"));
  const store = new DepartmentRuntimeStore(file("runtime"));
  const admission = fixtureEmployeeAdmission(store);
  const service = createDepartmentCodexPreparation({ store, employeeAdmission: admission.port, ownerDirectory: file("owners"), workspaceKey: () => "workspace",
    readTask: read, updateTask(id, patch) { const task = { ...read(id), ...patch }; fs.writeFileSync(file(id + "-task"), JSON.stringify(task)); return read(id); } });
  service.authorizeAttempt("leader", "subtask", "attempt");
  void service.run("leader", "subtask", { onAssistantDelta() {}, onThreadId() {}, onTrace() {}, onTaskListUpdate() {} }, selection, async () => description).catch(() => undefined);
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file("task-started"))) { if (Date.now() > deadline) throw new Error("host-task-not-started"); await new Promise((resolve) => setTimeout(resolve, 5)); }
  fs.writeFileSync(file("host-exiting"), String(process.pid));
  process.exit(0); // Deliberate startup host death; the original granted Owner must survive.
}
if (require.main === module) void main().catch((error) => { console.error(error); process.exit(1); });
