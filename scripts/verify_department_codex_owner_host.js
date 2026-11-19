/* Installed EH + real adapter/repositories and production Codex worker. Free simulated NDJSON CLI. */
"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto"), cp = require("node:child_process"), assert = require("node:assert/strict");
const product = path.resolve(__dirname, ".."), cancel = process.argv.includes("--prelaunch-cancel");
async function until(check, label, ms = 15000) { const end = Date.now() + ms; while (!await check()) { if (Date.now() > end) throw new Error(label); await new Promise(r => setTimeout(r, 20)); } }
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-codex-eh-")), home = path.join(directory, "home"), workspace = path.join(directory, "workspace");
  const workspaceKey = `${path.basename(workspace)}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
  const report = { directory, product, cancel, scope: "installed EH actual adapter + production task/config stores + coordinator/worker; fixture trusted runPrompt callback; simulated CLI, no UI/model claim" };
  let host, exited, forced = false;
  console.log("Artifacts: " + directory);
  try {
    for (const dir of [home, workspace, path.join(home, ".sinitek_cli"), path.join(directory, "user-data/User"), path.join(directory, "extensions")]) fs.mkdirSync(dir, { recursive: true });
    const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false, autoCompactContextAfterRun: false, memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false, cliEnabledByName: Object.fromEntries(clis.map(cli => [cli, false])) }));
    fs.writeFileSync(path.join(directory, "user-data/User/settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none", "sinitek-cli-tools.autoOpenPanel": false, ...Object.fromEntries(clis.map(cli => [`sinitek-cli-tools.commands.${cli}`, process.execPath])) }));
    const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), CODEX_HOME: path.join(home, ".codex") });
    const seed = cp.spawnSync(process.execPath, [__filename, "--seed", directory, home, workspaceKey], { env, encoding: "utf8", timeout: 30000 }); assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8")), entry = path.join(directory, "extension-test.js");
    fs.writeFileSync(entry, `const vscode=require('vscode');exports.run=async()=>{const end=Date.now()+60000;let extension;while(Date.now()<end){extension=vscode.extensions.getExtension(${JSON.stringify(`${manifest.publisher}.${manifest.name}`)});if(extension?.isActive)break;await new Promise(r=>setTimeout(r,100));}if(!extension?.isActive)throw new Error('automatic activation failed');await require(${JSON.stringify(path.join(product, "dist/test/extensionHost/fixtures/departmentcodexhostfixture.js"))}).runDepartmentCodexHostFixture(${JSON.stringify(directory)},${JSON.stringify(workspace)},${JSON.stringify(workspaceKey)},${JSON.stringify(process.execPath)},${cancel});};`);
    const code = process.env.SINITEK_VSCODE_EXE || (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Code" : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe") : "/usr/share/code/code");
    assert.ok(fs.existsSync(code), "installed VS Code required");
    const log = fs.openSync(path.join(directory, "vscode.log"), "w");
    host = cp.spawn(code, ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage", `--user-data-dir=${path.join(directory, "user-data")}`, `--extensions-dir=${path.join(directory, "extensions")}`, `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${entry}`, workspace], { env, detached: process.platform !== "win32", stdio: ["ignore", log, log] }); fs.closeSync(log);
    host.once("error", error => { exited = { error: error.message }; }); host.once("exit", (code, signal) => { exited = { code, signal }; });
    await until(() => exited, "EH failed to exit", 90000); assert.equal(exited.code, 0, JSON.stringify(exited));
    const result = JSON.parse(fs.readFileSync(path.join(directory, "eh-result.json"), "utf8")); report.result = result;
    assert.equal(fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json")), false);
    if (cancel) { assert.equal(result.cancelledBeforeLaunch, true); assert.equal(fs.existsSync(path.join(directory, "task-started")), false); report.ok = true; return; }
    const { DepartmentExecutionOwnerClient } = require(path.join(product, "dist/runtime/departmentexecutionownerclient.js"));
    const client = new DepartmentExecutionOwnerClient(path.join(directory, "owners", result.identity.ownerId));
    assert.equal((await client.observeExecution(result.identity)).status, "live"); assert.equal((await client.startExecution(result.identity)).status, "live");
    const observed = JSON.parse(fs.readFileSync(path.join(directory, "observed"), "utf8"));
    assert.ok(Number.isSafeInteger(observed.ownerPid) && observed.ownerPid > 1);
    assert.notEqual(observed.ownerPid, result.ehPid);
    const beforeTask = observed.task.tasks.find(task => task.id === result.identity.leaderTaskId);
    assert.deepEqual(beforeTask.subTasks.find(task => task.id === result.identity.subtaskId).executionSession,
      { cli: "codex", sessionId: result.identity.session.id, configId: "profile" });
    assert.equal(observed.runtime.executionBindings.length, 1);
    assert.deepEqual(observed.runtime.executionBindings[0].identity, result.identity);
    const wire = () => fs.readFileSync(path.join(directory, "wire.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
    assert.equal(wire().filter(m => m.method === "turn/start").length, 1);
    fs.writeFileSync(path.join(directory, "control-1.json.tmp"), JSON.stringify({ response: "turn", messages: [{ method: "turn/completed", params: { threadId: "native", turn: { id: "turn", status: "completed" } } }] }));
    fs.renameSync(path.join(directory, "control-1.json.tmp"), path.join(directory, "control-1.json"));
    await until(() => fs.existsSync(path.join(directory, "stdin-eof")), "native EOF not requested");
    fs.writeFileSync(path.join(directory, "control-2.json.tmp"), JSON.stringify({ close: true })); fs.renameSync(path.join(directory, "control-2.json.tmp"), path.join(directory, "control-2.json"));
    await until(async () => (await client.observeExecution(result.identity)).status === "unknown", "unknown resource cleanup not preserved");
    assert.equal(wire().filter(m => m.method === "turn/start").length, 1);
    report.ownerSurvivedEH = true; report.completeReceipt = false; report.ok = true;
  } catch (error) { report.ok = false; report.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    if (host && !exited) { forced = true; try { process.kill(process.platform === "win32" ? host.pid : -host.pid, "SIGTERM"); } catch {} }
    // Fixture teardown only. Forced termination never counts as native cleanup evidence.
    if (!report.ok && host?.pid && exited && process.platform !== "win32") {
      try { process.kill(-host.pid, "SIGTERM"); } catch {}
    }
    report.forcedHostCleanup = forced; if (forced) { report.ok = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
}
if (process.argv[2] === "--seed") {
  require(path.join(product, "dist/test/vscodeMock.js")).installVscodeMock(); // seed only; installed EH and worker use no mock
  require(path.join(product, "dist/test/extensionHost/fixtures/departmentcodexhostfixture.js")).seedDepartmentCodexHostFixture(process.argv[3], process.argv[4], process.argv[5]).catch(error => { console.error(error); process.exitCode = 1; });
} else main().catch(error => { console.error(error); process.exitCode = 1; });
