import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import { getCliDisplayName, getCliInstallCommand } from "../../cli/installer";
import type { CliName } from "../../cli/types";
import { t } from "../../i18n";

const source = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
const sourceFile = ts.createSourceFile("extension.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
const installationScript = ts.transpileModule([
  "maybePromptInstallOnCliGroupSwitch",
  "promptInstallMissingCli",
].map((name) => {
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, "Missing installation function: " + name);
  return declaration.getText(sourceFile);
}).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function createHarness(options: {
  platform?: NodeJS.Platform;
  installed?: boolean;
  selection?: "install" | "settings" | "cancel";
} = {}) {
  const platform = options.platform ?? "darwin";
  const status = { command: "zcode", installed: options.installed === true, checkedAt: Date.now() };
  const warnings: Array<{ message: string; actions: string[] }> = [];
  const terminalNames: string[] = [];
  const shownTerminals: string[] = [];
  const sentCommands: string[] = [];
  const executedCommands: unknown[][] = [];
  const informationMessages: string[] = [];
  const cliInstallStatuses: Partial<Record<CliName, typeof status | null>> = { zcode: status };
  const switchCli = vm.runInNewContext(`${installationScript}\nmaybePromptInstallOnCliGroupSwitch;`, {
    getCliInstallStatus: async () => status,
    getCliDisplayName,
    getCliInstallCommand: (cli: CliName) => getCliInstallCommand(cli, platform),
    buildCliCommandNotFoundMessage: (_cli: CliName, command: string) => "找不到 CLI：" + command,
    maybePromptUpgradeCodexForImageSupport: async () => undefined,
    CLI_INSTALL_TERMINAL_PREFIX: "CLI Install",
    cliInstallStatuses,
    process: { platform },
    t,
    logInfo: () => undefined,
    vscode: {
      window: {
        showWarningMessage: async (message: string, ...actions: string[]) => {
          warnings.push({ message, actions });
          if (options.selection === "cancel") {
            return undefined;
          }
          return options.selection === "settings" ? actions[1] : actions[0];
        },
        createTerminal: ({ name }: { name: string }) => {
          terminalNames.push(name);
          return {
            show: () => shownTerminals.push(name),
            sendText: (command: string) => sentCommands.push(command),
          };
        },
        showInformationMessage: async (message: string) => { informationMessages.push(message); },
      },
      commands: {
        executeCommand: async (...args: unknown[]) => { executedCommands.push(args); },
      },
    },
  }) as (cli: CliName) => Promise<void>;
  return {
    switchCli,
    warnings,
    terminalNames,
    shownTerminals,
    sentCommands,
    executedCommands,
    informationMessages,
    cliInstallStatuses,
    status,
  };
}

for (const platform of ["win32", "darwin", "linux"] as const) {
  test(`missing ZCode offers one-click terminal installation on ${platform}`, async () => {
    const harness = createHarness({ platform });

    await harness.switchCli("zcode");

    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0].message, /ZCode CLI 当前不可用（zcode）/);
    assert.deepEqual(harness.warnings[0].actions, ["一键安装", t("common.openSettings")]);
    assert.deepEqual(harness.terminalNames, ["CLI Install: zcode"]);
    assert.deepEqual(harness.shownTerminals, harness.terminalNames);
    assert.deepEqual(harness.sentCommands, ["npm install -g zcode-app-cli@latest"]);
    assert.deepEqual(harness.executedCommands, []);
    assert.equal(harness.cliInstallStatuses.zcode, null);
    assert.deepEqual(harness.informationMessages, [
      t("cli.install.started", { command: "npm install -g zcode-app-cli@latest" }),
    ]);
  });
}

test("installed ZCode does not prompt or reinstall on CLI group switch", async () => {
  const harness = createHarness({ installed: true });

  await harness.switchCli("zcode");

  assert.deepEqual(harness.warnings, []);
  assert.deepEqual(harness.terminalNames, []);
  assert.deepEqual(harness.sentCommands, []);
  assert.deepEqual(harness.executedCommands, []);
  assert.equal(harness.cliInstallStatuses.zcode, harness.status);
});

test("cancelling the ZCode installation prompt does not execute commands", async () => {
  const harness = createHarness({ selection: "cancel" });

  await harness.switchCli("zcode");

  assert.equal(harness.warnings.length, 1);
  assert.deepEqual(harness.terminalNames, []);
  assert.deepEqual(harness.sentCommands, []);
  assert.deepEqual(harness.executedCommands, []);
  assert.equal(harness.cliInstallStatuses.zcode, harness.status);
});

test("the ZCode settings action still opens the executable setting without installing", async () => {
  const harness = createHarness({ selection: "settings" });

  await harness.switchCli("zcode");

  assert.deepEqual(harness.executedCommands, [["workbench.action.openSettings", "sinitek-cli-tools.commands.zcode"]]);
  assert.deepEqual(harness.terminalNames, []);
  assert.deepEqual(harness.sentCommands, []);
  assert.equal(harness.cliInstallStatuses.zcode, harness.status);
});
