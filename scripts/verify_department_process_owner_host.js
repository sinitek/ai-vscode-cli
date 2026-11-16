/* Minimal installed Extension Host production-repository/process bootstrap check. No browser/UI claims or models. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const product = path.resolve(__dirname, "..");
const prelaunchCancel = process.argv.includes("--prelaunch-cancel");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(label); await pause(20); }
}
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-process-eh-"));
  const home = path.join(directory, "home"), workspace = path.join(directory, "workspace");
  const workspaceKey = `${path.basename(workspace)}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
  const report = { directory, product, scenario: prelaunchCancel ? "adapter-prelaunch-cancel" : "production-start", platform: process.platform, scope: prelaunchCancel ? "Installed EH + real adapter + shared production stream bridge + coordinator/worker; cancel gated native export, zero task run; no parser/UI assertion" : "Installed EH activation + real production repository + coordinator + independent Node Owner + controlled CLI; parser/session file path, no browser assertion" };
  let child, exit, forced = false;
  console.log(`Artifacts: ${directory}`);
  try {
    for (const item of [home, workspace, path.join(home, ".sinitek_cli"), path.join(directory, "user-data/User"), path.join(directory, "extensions")]) fs.mkdirSync(item, { recursive: true });
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false,
      autoCompactContextAfterRun: false, memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false,
      cliEnabledByName: Object.fromEntries(clis.map(cli => [cli, false])) }));
    fs.writeFileSync(path.join(directory, "user-data/User/settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none",
      "sinitek-cli-tools.autoOpenPanel": false, ...Object.fromEntries(clis.map(cli => [`sinitek-cli-tools.commands.${cli}`, process.execPath])) }));
    const seedEnv = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex") };
    const seed = cp.spawnSync(process.execPath, [__filename, "--seed", directory, home, workspaceKey], { env: seedEnv, encoding: "utf8", timeout: 30000 });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
    const entry = path.join(directory, "extension-test.js");
    fs.writeFileSync(entry, `const vscode = require('vscode');\nexports.run = async () => {\nlet extension; const deadline=Date.now()+60000;\nwhile(Date.now()<deadline) { extension=vscode.extensions.getExtension(${JSON.stringify(`${manifest.publisher}.${manifest.name}`)}); if(extension?.isActive) break; await new Promise(r=>setTimeout(r,100)); }\nif(!extension?.isActive) throw new Error('automatic activation failed');\nawait require(${JSON.stringify(path.join(product, "dist/test/extensionHost/fixtures/departmentprocesshostfixture.js"))}).runDepartmentProcessHostFixture(${JSON.stringify(directory)}, ${JSON.stringify(workspace)}, ${JSON.stringify(workspaceKey)}, ${JSON.stringify(process.execPath)}, ${JSON.stringify(prelaunchCancel)});\n};\n`);
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), CODEX_HOME: path.join(home, ".codex") });
    const code = process.env.SINITEK_VSCODE_EXE || (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Code" : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe") : "/usr/share/code/code");
    const log = fs.openSync(path.join(directory, "vscode.log"), "w");
    child = cp.spawn(code, ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage",
      `--user-data-dir=${path.join(directory, "user-data")}`, `--extensions-dir=${path.join(directory, "extensions")}`, `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${entry}`, workspace],
      { env, detached: process.platform !== "win32", stdio: ["ignore", log, log] });
    fs.closeSync(log);
    child.once("error", error => { exit = { error: error.message }; });
    child.once("exit", (code, signal) => { exit = { code, signal }; });
    await until(() => exit, "VS Code did not exit normally", 90000);
    report.exit = exit; assert.equal(exit.code, 0, JSON.stringify(exit));
    assert.ok(fs.existsSync(path.join(directory, "eh-result.json")), "EH production chain did not complete");
    const result = JSON.parse(fs.readFileSync(path.join(directory, "eh-result.json"), "utf8"));
    assert.equal(fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json")), false, "EH repository writer must close normally");
    if (prelaunchCancel) {
      assert.equal(result.cancelledBeforeLaunch, true); assert.equal(result.adapterSignal, true);
      assert.equal(result.taskUnchanged, true); assert.equal(result.exportDrained, true);
      assert.equal(fs.existsSync(path.join(directory, "spawn-count")), false);
      assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "configuration/selection.json"), "utf8")).leases.length, 0);
      report.result = result; report.ok = true; return;
    }
    const { DepartmentExecutionOwnerClient } = require(path.join(product, "dist/runtime/departmentexecutionownerclient.js"));
    const client = new DepartmentExecutionOwnerClient(path.join(directory, "owners", result.identity.ownerId));
    assert.equal((await client.observeExecution(result.identity)).status, "live", "Owner must outlive actual EH exit");
    assert.equal((await client.startExecution(result.identity)).status, "live", "identity-only duplicate start is idempotent");
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count"), "utf8"), "spawn\n");
    const observed = JSON.parse(fs.readFileSync(path.join(directory, "observed"), "utf8"));
    assert.deepEqual(observed.identity, result.identity); assert.notEqual(observed.ownerLeases[0].pid, result.ehPid);
    fs.writeFileSync(path.join(directory, "exit"), "open");
    assert.equal((await client.observeExecution(result.identity)).status, "live", "parent exit cannot certify descendant-held pipe drain");
    fs.writeFileSync(path.join(directory, "drain"), "open");
    await until(async () => (await client.observeExecution(result.identity)).status === "unknown", "Owner terminal cleanup did not settle");
    assert.equal(fs.readFileSync(path.join(directory, "spawn-count"), "utf8"), "spawn\n");
    const { DepartmentRuntimeStore } = require(path.join(product, "dist/extensionHost/departmentruntimestore.js"));
    const state = new DepartmentRuntimeStore(path.join(directory, "runtime")).read("root", workspaceKey);
    assert.ok(state.ok && state.value); assert.equal(state.value.capacity.employees.length, 1);
    report.result = { sessionId: result.sessionId, answer: result.answer, boundBeforeSpawn: true, ownerOutlivedEH: true, singleSpawn: true,
      closeDrainGated: true, finalObservation: "unknown", capacityRetained: true, nativeAndTabRelease: "unobservable" }; report.ok = true;
  } catch (error) { report.ok = false; report.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    if (child && !exit) { forced = true; try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch {} }
    // Fixture-only cleanup; killing a worker never constitutes production receipt evidence.
    for (const gate of ["exit", "drain", "export-open"]) fs.writeFileSync(path.join(directory, gate), "fixture cleanup");
    const selectionFile = path.join(directory, "configuration/selection.json");
    if (fs.existsSync(selectionFile)) for (const lease of JSON.parse(fs.readFileSync(selectionFile, "utf8")).leases) { try { process.kill(lease.pid, "SIGTERM"); } catch {} }
    report.forcedHostCleanup = forced; if (forced) { report.ok = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
}
if (process.argv[2] === "--seed") {
  require(path.join(product, "dist/test/vscodeMock.js")).installVscodeMock(); // Seed subprocess only; actual EH/Owner never mock vscode.
  require(path.join(product, "dist/test/extensionHost/fixtures/departmentprocesshostfixture.js"))
    .seedDepartmentProcessHostFixture(process.argv[3], process.argv[4], process.argv[5]).catch(error => { console.error(error); process.exitCode = 1; });
} else main().catch(error => { console.error(error); process.exitCode = 1; });
