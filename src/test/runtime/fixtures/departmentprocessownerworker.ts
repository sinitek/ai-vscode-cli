import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { createDepartmentProcessExecutionLauncher, type PreparedDepartmentProcessExecution } from "../../../runtime/departmentprocessexecutionlauncher";
import { DepartmentExecutionOwnerServer } from "../../../runtime/departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "../../../runtime/departmentexecutionownerclient";
import { sameExecution, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../../runtime/departmentexecutionidentity";
import { createOpenCodeRuntimeConfigOverlay } from "../../../cli/opencoderuntimeconfig";

const [, , mode, directory, option] = process.argv;
const file = (name: string): string => path.join(directory, name);

function waitForFile(name: string): Promise<void> {
  return new Promise((resolve) => {
    const watcher = fs.watch(directory, () => { if (fs.existsSync(file(name))) { watcher.close(); resolve(); } });
    if (fs.existsSync(file(name))) { watcher.close(); resolve(); }
  });
}
function trace(part: string): void { fs.appendFileSync(file("release-count.txt"), part + "\n"); }

async function owner(): Promise<void> {
  // Identity/selection and launch data come from the test's trusted preparation, never Owner IPC.
  const input = JSON.parse(fs.readFileSync(file("prepared-input"), "utf8")) as {
    identity: DepartmentExecutionIdentity; selection: DepartmentExecutionSelection;
  };
  const value = input.identity;
  const overlay = createOpenCodeRuntimeConfigOverlay({
    configContent: '{"provider":{"fixture":{"models":{"model":{}}}}}',
    primaryModel: "fixture/model", smallModel: null,
  }).overlay;
  if (!overlay) throw new Error("fixture-overlay-unavailable");
  fs.writeFileSync(file("overlay-path.txt"), overlay.configPath);
  const root = file("execution-root"), links = file("execution-link"), temp = file("extra-temp");
  fs.mkdirSync(root); fs.writeFileSync(links, "owned-link-fixture"); fs.mkdirSync(temp);
  const prepared: PreparedDepartmentProcessExecution = {
    identity: value, selection: input.selection, executionMode: "process",
    launch: { command: process.execPath, args: [__filename, "payload", directory, "prepared-argument"],
      cwd: directory, baseEnvironment: { OWNER_VALUE: "base", OWNER_BASE: "base-only", PWD: "base-pwd" },
      envOverrides: { OWNER_VALUE: "task", OPENCODE_CONFIG: "task-path-must-not-win" }, overlay,
    },
    resources: {
      // Test capabilities only: these prove invocation/shape, not a real native CLI session or VS Code tab release.
      runner: { owned: true, release: () => { trace("runner"); return { status: "confirmed", evidence: "fixture-session-released" }; } },
      executionRoot: { owned: true, release: () => {
        trace("executionRoot");
        if (option === "fail-root") return { status: "failed", reason: "fixture-root-release-failed" };
        fs.rmdirSync(root); return { status: "confirmed", evidence: "fixture-root-absent" };
      } },
      links: { owned: true, release: () => { trace("links"); fs.unlinkSync(links); return { status: "confirmed", evidence: "fixture-link-absent" }; } },
      temp: { owned: true, release: () => {
        trace("temp");
        if (option === "fail-temp") return { status: "failed", reason: "fixture-extra-temp-failed" };
        fs.rmdirSync(temp); return { status: "confirmed", evidence: "fixture-extra-temp-absent" };
      } },
      tab: option === "missing-tab" ? { owned: true } : { owned: true, release: () => {
        trace("tab"); return { status: "confirmed", evidence: "fixture-tab-released" };
      } },
    },
  };
  const launcher = createDepartmentProcessExecutionLauncher((requested) => {
    fs.appendFileSync(file("resolve-count.txt"), "resolve\n");
    return sameExecution(requested, value) ? prepared : null;
  });
  const server = new DepartmentExecutionOwnerServer({ directory, ownerId: value.ownerId, launcher });
  await server.listen();
  if (Object.keys(require.cache).some((key) => /[\\/]cli[\\/]config\.js$|[\\/]vscode[\\/]/.test(key))) {
    throw new Error("forbidden-host-runtime-dependency");
  }
  process.send?.({ ready: true, requirements: launcher.requirements(value) });
  process.on("message", (message: unknown) => {
    if (message && typeof message === "object" && "shutdown" in message) {
      void server.close().then(() => { process.disconnect(); }, () => process.send?.({ shutdownRejected: true }));
    }
  });
}

async function payload(): Promise<void> {
  fs.appendFileSync(file("spawn-count.txt"), "spawn\n");
  const configPath = process.env.OPENCODE_CONFIG!;
  fs.writeFileSync(file("observed.json"), JSON.stringify({
    value: process.env.OWNER_VALUE, base: process.env.OWNER_BASE, host: process.env.OWNER_HOST_ONLY ?? null,
    pwd: process.env.PWD, cwd: process.cwd(), argument: option,
    overlayReadable: JSON.parse(fs.readFileSync(configPath, "utf8")).model === "fixture/model",
  }));
  process.stdout.write("parent-head\n");
  // This descendant keeps the exact stdout/stderr pipes alive after the parent exits.
  const tail = spawn(process.execPath, [__filename, "tail", directory], { stdio: ["ignore", process.stdout, process.stderr] });
  tail.unref();
  await waitForFile("release-parent");
  fs.writeFileSync(file("parent-exiting"), "exit\n");
  process.exit(0);
}

async function tail(): Promise<void> {
  fs.writeFileSync(file("tail-ready"), "ready\n");
  await waitForFile("release-tail");
  await Promise.all([
    new Promise<void>((resolve, reject) => process.stdout.write("O".repeat(128 * 1024) + "stdout-tail\n", (error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => process.stderr.write("E".repeat(128 * 1024) + "stderr-tail\n", (error) => error ? reject(error) : resolve())),
  ]);
  fs.writeFileSync(file("tail-written"), "written\n");
}

async function main(): Promise<void> {
  if (mode === "owner") return owner();
  if (mode === "payload") return payload();
  if (mode === "tail") return tail();
  if (mode === "client-start") {
    const identity = JSON.parse(fs.readFileSync(file("prepared-input"), "utf8")).identity as DepartmentExecutionIdentity;
    const observed = await new DepartmentExecutionOwnerClient(directory).startExecution(identity);
    process.stdout.write(JSON.stringify(observed) + "\n");
    return;
  }
  throw new Error("fixture-mode-unknown");
}
void main().catch(() => { process.stderr.write("department-process-fixture-failed\n"); process.exitCode = 2; });
