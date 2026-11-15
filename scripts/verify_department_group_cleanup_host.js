/* Isolated installed EH; actual logical tab host/controller, controlled panel/settings ports. No CLI/model calls. */
"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const product = path.resolve(__dirname, "..");
async function main() {
  const directory = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "dgrp-"));
  const home = path.join(directory, "home"), workspace = path.join(directory, "workspace"), userData = path.join(directory, "user-data");
  for (const name of [home, workspace, path.join(home, ".sinitek_cli"), path.join(userData, "User"), path.join(directory, "extensions")]) fs.mkdirSync(name, { recursive: true });
  const clis = ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"];
  fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false, autoCompactContextAfterRun: false,
    memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false, cliEnabledByName: Object.fromEntries(clis.map((cli) => [cli, false])) }));
  fs.writeFileSync(path.join(userData, "User/settings.json"), JSON.stringify({ "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
    "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off", "window.restoreWindows": "none", "sinitek-cli-tools.autoOpenPanel": false }));
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), CODEX_HOME: path.join(home, ".codex") });
  const fixture = path.join(product, "dist/test/extensionHost/fixtures/departmentgroupcleanupproductionhost.js"), entry = path.join(directory, "extension-test.js");
  fs.writeFileSync(entry, `exports.run=async()=>{const vscode=require('vscode');const extension=vscode.extensions.getExtension('sinitek.sinitek-cli-tools');if(!extension)throw new Error('extension missing');await extension.activate();const result=await require(${JSON.stringify(fixture)}).verifyProductionGroupCleanup();require('fs').writeFileSync(${JSON.stringify(path.join(directory, "result.json"))},JSON.stringify({...result,ehPid:process.pid,vscode:require('vscode').version}));};`);
  const code = process.env.SINITEK_VSCODE_EXE || (process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/MacOS/Code" : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe") : "/usr/share/code/code");
  const report = { directory, product, scope: "installed EH activated extension actual composition callback; test-only getter on isolated compiled artifact, no CLI/full UI" };
  const extensionPath = path.join(product, "dist/extension.js"), originalExtension = fs.readFileSync(extensionPath, "utf8");
  assert.ok(process.env.ROUND231_ISOLATED_BUILD === "1", "requires a physical isolated build; shared dist must not be instrumented");
  let child, ended = false;
  try {
    fs.appendFileSync(extensionPath, "\nexports.__round231Composition = () => getDepartmentRuntimeComposition();\n");
    assert.ok(fs.existsSync(code), "installed VS Code required");
    const log = fs.openSync(path.join(directory, "vscode.log"), "w");
    child = cp.spawn(code, ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--use-inmemory-secretstorage",
      `--user-data-dir=${userData}`, `--extensions-dir=${path.join(directory, "extensions")}`, `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${entry}`, workspace],
      { env, detached: process.platform !== "win32", stdio: ["ignore", log, log] }); fs.closeSync(log);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("isolated EH did not exit")), 90000);
      child.once("error", (e) => { clearTimeout(timer); reject(e); });
      child.once("close", (code, signal) => { clearTimeout(timer); ended = true; resolve({ code, signal }); });
    });
    assert.equal(result.code, 0, JSON.stringify(result)); report.result = JSON.parse(fs.readFileSync(path.join(directory, "result.json"), "utf8"));
    assert.equal(report.result.callbackInstalled, true); assert.equal(report.result.unknownRejected, true); assert.equal(report.result.capacityReleased, false); report.ok = true;
  } catch (e) { report.ok = false; report.error = e.stack || String(e); process.exitCode = 1; }
  finally {
    fs.writeFileSync(extensionPath, originalExtension);
    report.forcedHostCleanup = Boolean(child && !ended);
    if (report.forcedHostCleanup) { try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch {} report.ok = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
