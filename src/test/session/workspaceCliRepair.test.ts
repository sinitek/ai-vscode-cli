import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
import { CLI_LIST } from "../../cli/types";
import type { CliCommandRepairIssue } from "../../cli/cliCommandRepair";

installVscodeMock();

const vscode = require("vscode") as typeof import("vscode");
const commandResolution = require("../../cli/commandResolution") as typeof import("../../cli/commandResolution");
const { createWorkspacePanelMessageHandlers } = require("../../panelMessageHandlers/workspace") as typeof import("../../panelMessageHandlers/workspace");

function createRepairHarness(context: import("node:test").TestContext, commands: Record<string, string> = {}) {
  const requestedKeys: string[] = [];
  const posted: Array<{ type: string; issues: CliCommandRepairIssue[] }> = [];
  context.mock.method(vscode.workspace, "getConfiguration", () => ({
    get: <T>(key: string, fallback?: T): T | undefined => {
      requestedKeys.push(key);
      return (commands[key] ?? fallback) as T | undefined;
    },
  }));
  const handlers = createWorkspacePanelMessageHandlers({
    postWebviewMessage: (message: typeof posted[number]) => { posted.push(message); },
  } as never);
  return { handlers, posted, requestedKeys };
}

test("repair inspection checks kimi rather than the internal kimi-code identifier", async (context) => {
  context.mock.method(commandResolution, "resolveCliCommand", () => null);
  const { handlers, posted, requestedKeys } = createRepairHarness(context);

  await handlers.inspectCliRepairs?.({ type: "inspectCliRepairs" });

  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.type, "cliRepairIssues");
  assert.deepEqual(requestedKeys, CLI_LIST.map((cli) => `commands.${cli}`));
  assert.deepEqual(posted[0]?.issues.find((issue) => issue.cli === "kimi-code"), {
    cli: "kimi-code",
    command: "kimi",
    summary: "spawn kimi ENOENT",
  });
});

test("repair inspection respects configured executables and arguments for every CLI", async (context) => {
  context.mock.method(commandResolution, "resolveCliCommand", () => null);
  const executablePaths = CLI_LIST.map((cli) => path.join(os.tmpdir(), "custom cli", `${cli}-custom`));
  const commands = Object.fromEntries(CLI_LIST.map((cli, index) => [
    `commands.${cli}`,
    `"${executablePaths[index]}" --profile work`,
  ]));
  const { handlers, posted } = createRepairHarness(context, commands);

  await handlers.inspectCliRepairs?.({ type: "inspectCliRepairs" });

  assert.deepEqual(posted[0]?.issues, CLI_LIST.map((cli, index) => ({
    cli,
    command: executablePaths[index],
    summary: `spawn ${path.basename(executablePaths[index]!)} ENOENT`,
  })));
});

test("repair inspection does not report an available Kimi executable as missing", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-kimi-repair-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executablePath = path.join(directory, process.platform === "win32" ? "kimi.cmd" : "kimi");
  await fs.writeFile(executablePath, "kimi test executable\n");
  context.mock.method(commandResolution, "resolveCliCommand", (command: string) => (
    command === "kimi" ? { command: executablePath, resolvedFrom: "path" } : null
  ));
  const { handlers, posted } = createRepairHarness(context);

  await handlers.inspectCliRepairs?.({ type: "inspectCliRepairs" });

  assert.equal(posted[0]?.issues.some((issue) => issue.cli === "kimi-code"), false);
  assert.deepEqual(posted[0]?.issues.map((issue) => issue.cli), CLI_LIST.filter((cli) => cli !== "kimi-code"));
});
