import * as fs from "fs";
import { DepartmentGenerationAuthorityServer, readDepartmentGenerationAuthority } from "./departmentgenerationauthority";
import { isLeaderExecutionScope } from "../extensionHost/departmentleaderexecutionledger";
import { exactKeys, identifier, record } from "./departmentexecutionidentity";

export async function runDepartmentGenerationAuthorityWorker(): Promise<void> {
  let initialized = false;
  process.on("message", (value: unknown) => {
    if (initialized) {
      if (record(value) && exactKeys(value, ["operation", "claim"]) && value.operation === "native-drained" && identifier(value.claim)) {
        workerServer?.confirmOriginalDrain(value.claim); return;
      }
      if (record(value) && exactKeys(value, ["operation", "id", "ok"]) && value.operation === "drain-result"
        && identifier(value.id) && typeof value.ok === "boolean") { workerServer?.originalDrainResult(value.id, value.ok); return; }
      if (!record(value) || Object.keys(value).sort().join(",") !== "claim,operation" || value.operation !== "shutdown" || typeof value.claim !== "string") {
        process.exitCode = 1; return;
      }
      const saved = readDepartmentGenerationAuthority(workerDirectory);
      if (workerServer?.hasRecoveryController() || !saved || saved.snapshot.claim !== value.claim || saved.snapshot.state !== "sealed"
        || saved.snapshot.tickets.some(ticket => ticket.state !== "released")) {
        process.send?.({ operation: "shutdown-result", ok: false, reason: "department-generation-authority-responsibility-open" }); return;
      }
      void workerServer?.close().then(() => {
        process.send?.({ operation: "shutdown-result", ok: true, reason: "closed" });
        process.disconnect?.();
      }, error => process.send?.({ operation: "shutdown-result", ok: false,
        reason: error instanceof Error ? error.message : "department-generation-authority-shutdown-failed" }));
      return;
    }
    if (!record(value) || !exactKeys(value, ["directory", "producerId", "readyFile", "scope", ...(value.ownerDirectory !== undefined ? ["ownerDirectory"] : [])]) || typeof value.directory !== "string"
      || (value.ownerDirectory !== undefined && (typeof value.ownerDirectory !== "string" || !value.ownerDirectory))
      || typeof value.readyFile !== "string" || !identifier(value.producerId) || !isLeaderExecutionScope(value.scope)) { process.exitCode = 1; return; }
    initialized = true;
    const input = value as { directory: string; readyFile: string; ownerDirectory?: string; producerId: string; scope: import("../extensionHost/departmentleaderexecutionledger").DepartmentLeaderExecutionScope };
    const server = new DepartmentGenerationAuthorityServer(input.directory, input.scope, input.producerId, undefined,
      input.ownerDirectory ? { ownerDirectory: input.ownerDirectory, drain(id) {
        if (process.connected) process.send?.({ operation: "drain-original", id });
      }, originalConnected() { return process.connected; }, retired() { if (process.connected) process.disconnect(); } } : undefined);
    workerDirectory = input.directory; workerServer = server;
    void server.listen().then(() => {
      const saved = readDepartmentGenerationAuthority(input.directory);
      if (!saved) throw new Error("department-generation-authority-registration-unreadable");
      const fd = fs.openSync(input.readyFile, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version: 2, scope: saved.snapshot.scope, producerId: saved.snapshot.producerId,
        claim: saved.snapshot.claim, state: saved.snapshot.state }), "utf8"); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      process.send?.({ version: 2, scope: saved.snapshot.scope, producerId: saved.snapshot.producerId,
        claim: saved.snapshot.claim, state: saved.snapshot.state, producerProof: server.producerProofForBootstrap() });
    }).catch(() => { process.exitCode = 1; });
  });
}

let workerDirectory = "";
let workerServer: DepartmentGenerationAuthorityServer | undefined;

if (require.main === module) {
  if (!process.send) process.exitCode = 1;
  else void runDepartmentGenerationAuthorityWorker();
}
