import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import type * as vscode from "vscode";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import { registerExtensionCommands, type ExtensionCommandRegistryDeps } from "../../commandRegistry";

function createCommandHarness(testContext: TestContext) {
  const vscodeMock = require("vscode");
  const originalRegisterCommand = vscodeMock.commands.registerCommand;
  const originalGetWorkspaceFolder = vscodeMock.workspace.getWorkspaceFolder;
  const originalAsRelativePath = vscodeMock.workspace.asRelativePath;
  const callbacks = new Map<string, (...args: any[]) => Promise<void>>();
  const calls: Array<string | string[]> = [];
  const createUri = (resourcePath: string): vscode.Uri => ({
    scheme: "file",
    path: resourcePath,
    toString: () => `file://${resourcePath}`,
  } as vscode.Uri);
  vscodeMock.commands.registerCommand = (command: string, callback: (...args: any[]) => Promise<void>) => {
    callbacks.set(command, callback);
    return { dispose: () => undefined };
  };
  vscodeMock.workspace.getWorkspaceFolder = (uri: vscode.Uri) => uri.path.startsWith("/workspace/")
    ? { uri: createUri("/workspace") }
    : undefined;
  vscodeMock.workspace.asRelativePath = (uri: vscode.Uri, includeWorkspaceFolder: boolean) => {
    assert.equal(includeWorkspaceFolder, false);
    return uri.path.slice("/workspace/".length);
  };
  testContext.after(() => {
    vscodeMock.commands.registerCommand = originalRegisterCommand;
    vscodeMock.workspace.getWorkspaceFolder = originalGetWorkspaceFolder;
    vscodeMock.workspace.asRelativePath = originalAsRelativePath;
  });
  const deps: ExtensionCommandRegistryDeps = {
    isCliName: (value): value is "codex" => value === "codex",
    getCurrentCli: () => "codex",
    setCurrentCli: async () => undefined,
    runCli: async () => undefined,
    revealPanelView: async () => { calls.push("reveal"); },
    postPanelState: async () => { calls.push("state"); },
    insertPromptPaths: (paths) => { calls.push(paths); },
    openLoopGroupChatPanel: async () => undefined,
  };
  registerExtensionCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext, deps);
  const command = callbacks.get("sinitek-cli-tools.addToCliReference");
  assert.ok(command);
  return { calls, deps, createUri, command };
}

test("Explorer reference command reveals the panel before inserting selected paths", async (testContext) => {
  const { command, calls, createUri } = createCommandHarness(testContext);
  const file = createUri("/workspace/src/app.ts");
  const directory = createUri("/workspace/my folder");
  await command(file, [file, directory, file]);
  assert.deepEqual(calls, ["reveal", "state", ["src/app.ts", "my folder"]]);
});

test("Explorer reference command handles a single resource and ignores missing or outside resources", async (testContext) => {
  const { command, calls, createUri } = createCommandHarness(testContext);
  await command();
  await command(createUri("/outside/app.ts"));
  assert.deepEqual(calls, []);
  await command(createUri("/workspace/src"));
  assert.deepEqual(calls, ["reveal", "state", ["src"]]);
});

test("Explorer reference command does not insert into an unrevealed panel on failure", async (testContext) => {
  const { command, calls, deps, createUri } = createCommandHarness(testContext);
  deps.revealPanelView = async () => { throw new Error("cannot reveal"); };
  await assert.rejects(command(createUri("/workspace/src")), /cannot reveal/);
  assert.deepEqual(calls, []);
});

test("Explorer reference manifest enables files and directories with a Chinese menu title", () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
  const manifest = readJson("package.json");
  const commandId = "sinitek-cli-tools.addToCliReference";
  assert.ok(manifest.activationEvents.includes(`onCommand:${commandId}`));
  assert.deepEqual(manifest.contributes.commands.find((item: any) => item.command === commandId), {
    command: commandId,
    title: "%command.addToCliReference%",
  });
  const menu = manifest.contributes.menus["explorer/context"].find((item: any) => item.command === commandId);
  assert.equal(menu.when, "resourceScheme == file || resourceScheme == vscode-remote");
  assert.equal(menu.when.includes("explorerResourceIsFolder"), false);
  assert.equal(manifest.contributes.menus.commandPalette.find((item: any) => item.command === commandId).when, "false");
  for (const fileName of ["package.nls.json", "package.nls.zh-cn.json"]) {
    assert.equal(readJson(fileName)["command.addToCliReference"], "加入到 Sinitek CLI 引用");
  }
});
