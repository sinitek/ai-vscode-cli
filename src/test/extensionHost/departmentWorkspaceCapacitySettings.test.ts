import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installVscodeMock } from "../vscodeMock";
import { type WorkspaceSettings } from "../../workspaceSettingsStore";
installVscodeMock();
const { routeSettingMessage } = require("../../settingMessageRouter") as typeof import("../../settingMessageRouter");

test("capacity message router publishes only after successful persistence, rejects stale/invalid writes and retries", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "department-capacity-handler-"));
  let scope = "workspace-a:1", failure = false, throws = false;
  let settings: WorkspaceSettings = { departmentMaxEmployees: 11, workspaceMemoryEnabled: true };
  const messages: any[] = [], errors: string[] = [];
  let writes = 0, published = 0;
  const file = path.join(directory, "saved.json");
  const deps: any = {
    getCurrentCli: () => "codex", getWorkspaceSettings: () => settings,
    getDepartmentConfigurationScope: () => scope,
    saveWorkspaceSettingsWithResult: (next: WorkspaceSettings) => {
      writes++;
      assert.notEqual(next, settings);
      assert.equal(settings.departmentMaxLeaders, undefined, "memory stays unchanged before persistence");
      if (throws) throw new Error("disk failure");
      if (failure) return { ok: false };
      fs.writeFileSync(file, JSON.stringify(next)); return { ok: true };
    },
    setWorkspaceSettings: (next: WorkspaceSettings) => { published++; settings = next; },
    postWebviewMessage: (message: unknown) => messages.push(message),
    showWebviewError: (_title: string, error: string) => errors.push(error),
    postPanelState: async () => undefined,
  };
  let request = 0;
  const send = (value: unknown, requestScope = scope, key = "workspaceDepartmentMaxLeaders") => routeSettingMessage({ type: "updateSetting", key, value: { value, scope: requestScope, requestId: String(++request) } }, deps);
  try {
    for (const value of [true, {}, "bad", 0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) await send(value);
    assert.equal(writes, 0); assert.equal(errors.length, 8);
    failure = true; await send(2); assert.equal(published, 0); assert.equal(fs.existsSync(file), false);
    throws = true; await send(2); assert.equal(published, 0);
    throws = false; failure = false; await send("2.8");
    assert.deepEqual(settings, { departmentMaxLeaders: 2, departmentMaxEmployees: 11, workspaceMemoryEnabled: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), settings);
    deps.saveWorkspaceSettingsWithResult = (next: WorkspaceSettings) => { fs.writeFileSync(file, JSON.stringify(next)); return { ok: true }; };
    await send("", scope); assert.equal(settings.departmentMaxLeaders, undefined); assert.equal(settings.departmentMaxEmployees, 11);
    await send(7, scope, "workspaceDepartmentMaxEmployees"); assert.equal(settings.departmentMaxEmployees, 7);
    const saved = fs.readFileSync(file, "utf8");
    deps.saveWorkspaceSettingsWithResult = () => ({ ok: false });
    await send(5); assert.equal(fs.readFileSync(file, "utf8"), saved); assert.equal(settings.departmentMaxLeaders, undefined);
    scope = "workspace-b:2"; settings = { workspaceMemoryEnabled: false };
    const before = published; const errorCount = errors.length;
    await send(3, "workspace-a:1");
    assert.equal(published, before); assert.equal(errors.length, errorCount); assert.equal(messages.at(-1).scope, "workspace-a:1");
    assert.deepEqual(settings, { workspaceMemoryEnabled: false });
    assert.equal(fs.readFileSync(file, "utf8"), saved);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
