/* Installed VS Code only. No tasks, model calls, downloads or user-profile access.
 * Mirrors verify_vscode_compaction_routing.js: isolated HOME/user-data/extensions,
 * --extensionDevelopmentPath + --extensionTestsPath, and an allowlisted environment.
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const assert = require("node:assert/strict");
const product = path.resolve(__dirname, "..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = Number(process.env.SINITEK_ACTIVATION_TIMEOUT_MS || 75000);

function executable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  if (process.platform === "darwin") return "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe");
  return "/usr/share/code/code";
}
function remainingProcesses(pid, root) {
  if (process.platform === "win32") {
    const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
    if (result.status !== 0) throw new Error("Cannot verify isolated process exit: " + result.stderr);
    const processes = JSON.parse(result.stdout);
    return (Array.isArray(processes) ? processes : [processes]).filter(p => p.CommandLine?.includes(root));
  }
  const result = cp.spawnSync("ps", ["-axo", "pid=,pgid=,stat=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Cannot verify isolated process exit: " + result.stderr);
  return result.stdout.split("\n").filter(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return match && !match[3].includes("Z") && (Number(match[2]) === pid || match[4].includes(root));
  });
}
async function main() {
  // macOS UNIX-domain socket paths are limited to 103 bytes; its default TMPDIR is too long.
  const root = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "sinitek-dept-host-"));
  const report = { root, product, platform: process.platform, assertions: [], scope: "Installed Extension Host production activate/storage only; no CLI/tasks/cold restart" };
  console.log(`Artifacts: ${root}`);
  let child, exited = false, forced = false;
  try {
    const code = executable();
    assert.ok(fs.existsSync(code), `Installed VS Code missing: ${code}`);
    assert.ok(fs.existsSync(path.join(product, "dist/extension.js")), "Build the isolated source copy first");
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
    assert.ok(manifest.activationEvents.includes("onStartupFinished"));
    const home = path.join(root, "home");
    for (const dir of [home, path.join(home, ".sinitek_cli"), path.join(root, "user-data/User"), path.join(root, "extensions"), path.join(root, "workspace")]) fs.mkdirSync(dir, { recursive: true });
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false, autoCompactContextAfterRun: false,
      memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false, cliEnabledByName: Object.fromEntries(clis.map(cli => [cli, false])) }));
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({ "window.title": "Sinitek isolated department activation smoke",
      "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false, "sinitek-cli-tools.humanInteractionNotifications": false,
      ...Object.fromEntries(clis.map(cli => [`sinitek-cli-tools.commands.${cli}`, process.execPath])) }));
    // Test entry observes automatic onStartupFinished activation. It NEVER calls activate(),
    // exports internal hooks, substitutes a source factory, or submits a command/task.
    const testEntry = path.join(root, "activation-test.js");
    fs.writeFileSync(testEntry, `
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),vscode=require('vscode');
exports.run=async()=>{
  const root=${JSON.stringify(root)}, expectedHome=fs.realpathSync(${JSON.stringify(home)});
  assert.equal(fs.realpathSync(os.homedir()),expectedHome,'Extension Host HOME must be isolated');
  const until=Date.now()+${timeout - 10000};
  let extension;
  while(Date.now()<until){extension=vscode.extensions.getExtension(${JSON.stringify(`${manifest.publisher}.${manifest.name}`)});if(extension?.isActive)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(extension?.isActive,'onStartupFinished did not activate current product');
  assert.equal(fs.realpathSync(extension.extensionPath),fs.realpathSync(${JSON.stringify(product)}));
  const owned=fs.realpathSync(path.join(expectedHome,'.sinitek_cli','department-tasks-v1'));
  const source=JSON.parse(fs.readFileSync(path.join(owned,'.department-source.json'),'utf8'));
  const owner=JSON.parse(fs.readFileSync(path.join(owned,'.department-owner.json'),'utf8'));
  const catalog=JSON.parse(fs.readFileSync(path.join(expectedHome,'.sinitek_cli','loop-task-identities','catalog.json'),'utf8'));
  assert.equal(source.version,1);assert.equal(source.sourceId,'department-production-v1');
  assert.equal(owner.version,1);assert.equal(owner.sourceId,source.sourceId);assert.ok(owner.token);
  assert.equal(catalog.version,1);assert.equal(catalog.ready,true);assert.deepEqual(catalog.roots,[owned]);
  assert.deepEqual(catalog.files,{});assert.deepEqual(catalog.owned,{});
  assert.equal(fs.existsSync(path.join(expectedHome,'.sinitek_cli','loop-task-identities','transaction.lock')),false);
  fs.writeFileSync(path.join(root,'activated.json'),JSON.stringify({vscode:vscode.version,home:expectedHome,extensionPath:extension.extensionPath,owned,source,catalog,ownerObserved:true},null,2));
  // Resolve the real test runner. It owns Extension Host deactivation and the
  // application's exit code. An explicit quit while run() is pending races that
  // protocol and can report a rejected test RPC as application exit 1.
};
`);
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), CODEX_HOME: path.join(home, ".codex") });
    // An isolated HOME does not isolate the OS keychain. Its synchronous native
    // access can block the main process (including quit) on macOS. Keep smoke
    // secrets in memory; production source/owner/catalog storage remains real.
    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage", "--log=trace",
      `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
      `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${testEntry}`, path.join(root, "workspace")];
    report.launch = { code, args, home };
    const output = fs.openSync(path.join(root, "vscode.log"), "w");
    child = cp.spawn(code, args, { env, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", output, output] });
    fs.closeSync(output);
    child.once("exit", (code, signal) => { exited = true; report.exit = { code, signal }; });
    child.once("error", error => { exited = true; report.spawnError = error.message; });
    const deadline = Date.now() + timeout;
    while (!exited && Date.now() < deadline) await pause(200);
    assert.ok(exited, "Timed out waiting for automatic activation tests and isolated VS Code shutdown");
    assert.equal(report.exit?.code, 0, JSON.stringify(report.exit || report.spawnError));
    const activated = JSON.parse(fs.readFileSync(path.join(root, "activated.json"), "utf8"));
    report.activation = activated;
    report.assertions.push("Current product automatically activated; real source marker/owner and ready catalog observed under isolated HOME");
    let remaining = remainingProcesses(child.pid, root);
    const drainDeadline = Date.now() + 10000;
    while (remaining.length && Date.now() < drainDeadline) { await pause(200); remaining = remainingProcesses(child.pid, root); }
    report.remaining = remaining;
    assert.deepEqual(remaining, [], "Isolated VS Code resources did not exit");
    assert.equal(fs.existsSync(path.join(activated.owned, ".department-owner.json")), false, "Owner marker not released on normal deactivation");
    assert.equal(fs.existsSync(path.join(home, ".sinitek_cli/loop-task-identities/transaction.lock")), false);
    report.assertions.push("Isolated instance exited; no matching processes, active owner marker or identity transaction lock remain");
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = error.stack || String(error); process.exitCode = 1;
    console.error(report.error);
  } finally {
    if (child?.pid) {
      try {
        const remaining = remainingProcesses(child.pid, root);
        report.processesAtCleanup = remaining;
        if (!exited || remaining.length) {
          forced = true;
          if (process.platform === "win32") cp.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
          else process.kill(-child.pid, "SIGTERM");
          for (let i = 0; i < 50 && remainingProcesses(child.pid, root).length; i++) await pause(100);
          const leftovers = remainingProcesses(child.pid, root);
          if (leftovers.length && process.platform !== "win32") {
            process.kill(-child.pid, "SIGKILL");
            for (let i = 0; i < 50 && remainingProcesses(child.pid, root).length; i++) await pause(100);
          }
          report.remainingAfterCleanup = remainingProcesses(child.pid, root);
        }
      } catch (error) { report.cleanupError = String(error); }
    }
    // Preserve successful startup observations even when later application teardown fails.
    const observation = path.join(root, "activated.json");
    if (fs.existsSync(observation)) {
      report.activation = JSON.parse(fs.readFileSync(observation, "utf8"));
      report.ownerMarkerRemaining = fs.existsSync(path.join(report.activation.owned, ".department-owner.json"));
    }
    const logs = path.join(root, "user-data/logs");
    report.logRoot = logs;
    report.forcedCleanup = forced;
    if (forced) { report.ok = false; process.exitCode = 1; }
    if (!report.ok && fs.existsSync(path.join(root, "vscode.log"))) report.outputTail = fs.readFileSync(path.join(root, "vscode.log"), "utf8").slice(-12000);
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
