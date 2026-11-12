/* Launch installed VS Code; no downloaded Electron/browser/test dependencies. */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const cp = require("node:child_process");
const assert = require("node:assert/strict");
const product = path.resolve(__dirname, "..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { if (error.fatal) throw error; last = error; }
    await pause(100);
  }
  throw new Error(`Timed out: ${label}${last ? ": " + last.message : ""}`);
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.seq = 0; this.pending = new Map(); this.contexts = new Map();
    this.ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const call = this.pending.get(message.id);
        if (call) { this.pending.delete(message.id); clearTimeout(call.timer);
          message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result); }
      }
      if (message.method === "Target.attachedToTarget") {
        const sid = message.params.sessionId;
        void this.send("Runtime.enable", {}, sid).catch(() => {});
        void this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
      }
      if (message.method === "Runtime.executionContextCreated") {
        const context = message.params.context;
        this.contexts.set((message.sessionId || "") + ":" + context.id, { id: context.id, session: message.sessionId });
      }
      if (message.method === "Runtime.executionContextDestroyed")
        this.contexts.delete((message.sessionId || "") + ":" + message.params.executionContextId);
    });
  }
  async open() { await new Promise((resolve, reject) => { this.ws.addEventListener("open", resolve, { once: true });
    this.ws.addEventListener("error", reject, { once: true }); }); }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(context, expression) {
    const result = await this.send("Runtime.evaluate", { contextId: context.id, expression, returnByValue: true }, context.session);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async webview() {
    for (const context of this.contexts.values()) {
      try { if (await this.evaluate(context, "typeof document !== 'undefined' && !!document.getElementById('conversationTabs')")) return context; } catch {}
    }
  }
  close() { for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error("CDP closed")); }
    this.pending.clear(); this.ws.close(); }
}
async function main() {
  if (typeof WebSocket === "undefined") throw new Error("Node with built-in WebSocket required (Node 22+).");
  const code = process.env.SINITEK_VSCODE_EXE || path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe");
  assert.ok(fs.existsSync(code), `Installed Code.exe missing: ${code}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-native-compaction-"));
  console.log(`Artifacts: ${root}`);
  const report = { root, code, assertions: [], snapshots: [], scope: "Windows isolated Extension Host + current product Webview" };
  const dirs = ["home", "user-data/User", "extensions", "workspace", "development", "compiled"];
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(product, "package.json"), "utf8"));
  fs.writeFileSync(path.join(root, "development/package.json"), JSON.stringify({ name: "native-compaction-validation", publisher: "sinitek",
    version: "0.0.0", engines: manifest.engines, main: "./entry.js", activationEvents: [], contributes: manifest.contributes }));
  const hooks = `\nexports.__native = { runPrompt, runContextCompaction, postPanelState, loadConfigState, resolvePromptRunTarget,
    getActiveConversationTabId, createLoopSubtaskRunTarget, getConversationTabById, createLoopTaskRecord,
    readLoopTaskRecord, updateLoopTaskRecord, appendSystemMessageForLoop, getLoopMessagesForTarget,
    readTaskStore, cancelLoopPlusInvocation, loopOrchestrationOwnership, stopAllRuns, deactivate };\n`;
  // Append exports only in memory. No product source or shared dist is rewritten.
  fs.writeFileSync(path.join(root, "development/entry.js"), `const fs=require('fs'), Module=require('module'), path=require('path');
const file=${JSON.stringify(path.join(product, "dist/extension.js"))};
const loaded=new Module(file,module); loaded.filename=file; loaded.paths=Module._nodeModulePaths(path.dirname(file));
loaded._compile(fs.readFileSync(file,'utf8')+${JSON.stringify(hooks)},file);
exports.activate=context=>{loaded.exports.activate(context);return {native:loaded.exports.__native};};
exports.deactivate=()=>loaded.exports.deactivate();\n`);
  fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify({ "window.title": "Sinitek isolated native compaction validation",
    "workbench.startupEditor": "none", "security.workspace.trust.enabled": false, "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off",
    "sinitek-cli-tools.autoOpenPanel": false, "sinitek-cli-tools.humanInteractionNotifications": false,
    "sinitek-cli-tools.humanInteractionWindowAttention": false, "sinitek-cli-tools.taskCompletionNotifications": false,
    ...Object.fromEntries(["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"].map(cli => [`sinitek-cli-tools.commands.${cli}`, process.execPath])) }));
  fs.mkdirSync(path.join(root, "home/.sinitek_cli"), { recursive: true });
  fs.writeFileSync(path.join(root, "home/.sinitek_cli/settings.json"), JSON.stringify({ humanInteractionEnabled: false,
    autoCompactContextAfterRun: false, memoryAutoExtractAfterCompact: false, memoryAutoExtractAfterLoopTask: false,
    cliEnabledByName: { codex: true, claude: false, opencode: false, grok: false, dsh: false, "kimi-code": false, zcode: false } }));
  const compileArgs = [path.join(product, "node_modules/typescript/bin/tsc"), "--target", "ES2022", "--module", "commonjs",
    "--strict", "--skipLibCheck", "--types", "node,vscode", "--outDir", path.join(root, "compiled"),
    path.join(product, "src/test/nativehost/completioncompactionrouting.ts")];
  const compiled = cp.spawnSync(process.execPath, compileArgs, { cwd: product, encoding: "utf8" });
  fs.writeFileSync(path.join(root, "compile.log"), compiled.stdout + compiled.stderr);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  report.compile = { command: [process.execPath, ...compileArgs], exitCode: compiled.status };
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  // Allowlist environment; no credential/provider/session variables are inherited.
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "TEMP", "TMP"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { HOME: path.join(root, "home"), USERPROFILE: path.join(root, "home"),
    APPDATA: path.join(root, "home/AppData/Roaming"), LOCALAPPDATA: path.join(root, "home/AppData/Local"),
    CODEX_HOME: path.join(root, "home/.codex"), CODEX_HOME_DIR: path.join(root, "home/.codex"),
    SINITEK_NATIVE_ROOT: root, SINITEK_NATIVE_PRODUCT: product });
  const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust",
    `--user-data-dir=${path.join(root, "user-data")}`, `--extensions-dir=${path.join(root, "extensions")}`,
    `--extensionDevelopmentPath=${path.join(root, "development")}`, `--extensionTestsPath=${path.join(root, "compiled/completioncompactionrouting.js")}`,
    `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", path.join(root, "workspace")];
  report.launch = { args, isolatedHome: env.HOME };
  const output = fs.openSync(path.join(root, "vscode.log"), "w");
  const child = cp.spawn(code, args, { env, windowsHide: true, stdio: ["ignore", output, output] });
  fs.closeSync(output);
  let exited = false; child.on("exit", (code, signal) => { exited = true; report.exit = { code, signal }; });
  child.once("error", error => { exited = true; report.spawnError = error.message; });
  let cdp; let bridge;
  try {
    bridge = await until(() => {
      if (exited) {
        const log = fs.readFileSync(path.join(root, "vscode.log"), "utf8");
        throw Object.assign(new Error(`Isolated VS Code exited before Extension Host bridge: ${report.spawnError || JSON.stringify(report.exit)}\n${log}`), { fatal: true });
      }
      return fs.existsSync(path.join(root, "bridge.json")) && JSON.parse(fs.readFileSync(path.join(root, "bridge.json"), "utf8"));
    }, "Extension Host bridge", 60000);
    report.vscode = bridge.vscode;
    const command = async name => { const response = await fetch(`http://127.0.0.1:${bridge.port}/${name}`);
      const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body; };
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const workbench = targets.find(target => target.type === "page" && target.url.includes("workbench"));
    assert.ok(workbench, "real VS Code workbench CDP target");
    cdp = new Cdp(workbench.webSocketDebuggerUrl); await cdp.open();
    await cdp.send("Runtime.enable");
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const context = await until(() => cdp.webview(), "product Webview execution context");
    const read = () => cdp.evaluate(context, `({tabs:[...document.querySelectorAll('.conversation-tab')].map(el=>({label:el.querySelector('.conversation-tab-label').textContent,classes:el.className,selected:el.getAttribute('aria-selected')})),status:document.getElementById('runStatusText').textContent,statusClass:document.getElementById('runStatusText').className,waitDisplay:getComputedStyle(document.getElementById('runWait')).display})`);
    const snapshot = async name => { const value = await read(); report.snapshots.push({ name, ...value }); return value; };
    const click = async index => { await cdp.evaluate(context, `document.querySelectorAll('.conversation-tab')[${index}].click()`);
      await until(async () => (await read()).tabs[index]?.selected === "true", "product tab click"); await command("refresh"); };
    const scene = await command("begin"); report.scene = scene;
    await until(async () => (await read()).tabs.length === 2, "two actual tabs");
    // Before completion refresh's completion assertions do not yet apply.
    await cdp.evaluate(context, "document.querySelectorAll('.conversation-tab')[1].click()");
    await command("completeChild");
    await until(async () => !(await read()).tabs[1].classes.includes("running"), "completed child DOM");
    let view = await snapshot("child-completed-parent-review");
    assert.ok(view.tabs[0].classes.includes("running")); assert.ok(!view.tabs[1].classes.includes("errored"));
    await command("compact");
    await until(async () => (await read()).status.includes("压缩"), "active child compaction indicator");
    view = await snapshot("active-child-compacting");
    assert.ok(view.tabs[1].classes.includes("running")); assert.ok(view.statusClass.includes("compacting"));
    await click(0);
    view = await snapshot("background-child-compacting-parent-active");
    assert.ok(view.tabs[0].classes.includes("running")); assert.ok(view.tabs[1].classes.includes("running"));
    assert.ok(!view.statusClass.includes("compacting"));
    await command("rejectCompact");
    await until(async () => !(await read()).tabs[1].classes.includes("running"), "background compaction ends");
    view = await snapshot("background-child-rejection-state-refresh");
    assert.ok(view.tabs[0].classes.includes("running")); assert.ok(!view.tabs[0].classes.includes("errored"));
    assert.ok(!view.tabs[1].classes.includes("errored"));
    await click(1);
    view = await snapshot("completed-child-reactivated");
    assert.ok(!view.statusClass.includes("compacting")); assert.equal(view.waitDisplay, "none");
    assert.ok(!view.tabs[1].classes.includes("errored"));
    // Same completed child, now reject while active as a separate presentation branch.
    await command("compact");
    await until(async () => (await read()).statusClass.includes("compacting"), "second active compaction");
    await command("rejectCompact");
    await until(async () => !(await read()).statusClass.includes("compacting"), "active compaction ends");
    await snapshot("active-child-rejection-state-refresh");
    await click(0); await click(1);
    view = await snapshot("completed-child-after-repeat-switch-refresh");
    assert.ok(!view.tabs[1].classes.includes("errored")); assert.equal(view.waitDisplay, "none");
    await command("newFailure");
    await until(async () => (await read()).tabs[1].classes.includes("errored"), "new execution error DOM");
    view = await snapshot("real-new-execution-failure");
    assert.ok(view.tabs[0].classes.includes("running")); assert.ok(!view.tabs[0].classes.includes("errored"));
    await click(0); await click(1);
    view = await snapshot("new-execution-error-survives-switch-refresh");
    assert.ok(view.tabs[1].classes.includes("errored"));
    report.assertions.push("actual child completion persisted; parent review running", "active and background compaction indicators observed",
      "rejected compaction ended without child execution failure or parent pollution", "switch and full state refresh preserve completion",
      "new actual runner rejection remains errored across switch and state refresh");
    // CDP screenshot of final product DOM, scoped to this isolated window.
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(root, "final-dom.png"), Buffer.from(shot.data, "base64"));
    await command("finish");
    await until(() => exited, "isolated VS Code normal exit", 30000);
    assert.equal(report.exit.code, 0);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    throw error;
  } finally {
    cdp?.close();
    if (!exited) {
      // Only terminate the process tree created above, never any user VS Code process.
      const killed = cp.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
      report.cleanup = { scopedPid: child.pid, taskkillStatus: killed.status };
      await until(() => exited, "owned process tree exit", 10000).catch(() => {});
    }
    report.resources = { launchedPid: child.pid, exited, artifactsRetained: true };
    fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed || false, vscode: report.vscode, artifacts: root, exited }));
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
