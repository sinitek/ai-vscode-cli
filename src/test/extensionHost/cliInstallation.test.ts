import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";
import * as ts from "typescript";
import { getCliDisplayName, getCliInstallCommand } from "../../cli/installer";
import { CLI_LIST, type CliName } from "../../cli/types";
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
  cli?: CliName;
  platform?: NodeJS.Platform;
  installed?: boolean;
  selection?: "install" | "settings" | "cancel";
  suppressNonModal?: boolean;
} = {}) {
  const cli = options.cli ?? "zcode";
  const platform = options.platform ?? "darwin";
  const status = { command: cli === "kimi-code" ? "kimi" : cli, installed: options.installed === true, checkedAt: Date.now() };
  const warnings: Array<{ message: string; options: { modal?: boolean }; actions: string[] }> = [];
  const terminalNames: string[] = [];
  const shownTerminals: string[] = [];
  const sentCommands: string[] = [];
  const executedCommands: unknown[][] = [];
  const informationMessages: string[] = [];
  const cliInstallStatuses: Partial<Record<CliName, typeof status | null>> = { [cli]: status };
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
        showWarningMessage: async (message: string, ...items: Array<string | { modal?: boolean }>) => {
          const messageOptions = items.find((item): item is { modal?: boolean } => typeof item === "object") ?? {};
          const actions = items.filter((item): item is string => typeof item === "string");
          warnings.push({ message, options: messageOptions, actions });
          if (options.suppressNonModal && messageOptions.modal !== true) {
            return undefined;
          }
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
  for (const cli of CLI_LIST) {
    test(`missing ${cli} offers modal one-click terminal installation on ${platform}`, async () => {
      const harness = createHarness({ cli, platform });
      const installCommand = getCliInstallCommand(cli, platform);

      await harness.switchCli(cli);

      assert.equal(harness.warnings.length, 1);
      assert.ok(harness.warnings[0].message.includes(`${getCliDisplayName(cli)} CLI 当前不可用（${harness.status.command}）`));
      assert.equal(harness.warnings[0].options.modal, true);
      assert.deepEqual(harness.warnings[0].actions, ["一键安装", t("common.openSettings")]);
      assert.deepEqual(harness.terminalNames, [`CLI Install: ${cli}`]);
      assert.deepEqual(harness.shownTerminals, harness.terminalNames);
      assert.deepEqual(harness.sentCommands, [installCommand]);
      assert.deepEqual(harness.executedCommands, []);
      assert.equal(harness.cliInstallStatuses[cli], null);
      assert.deepEqual(harness.informationMessages, [
        t("cli.install.started", { command: installCommand }),
      ]);
    });
  }
}

for (const cli of CLI_LIST) {
  test(`installed ${cli} does not prompt or reinstall on CLI group switch`, async () => {
    const harness = createHarness({ cli, installed: true });

    await harness.switchCli(cli);

    assert.deepEqual(harness.warnings, []);
    assert.deepEqual(harness.terminalNames, []);
    assert.deepEqual(harness.sentCommands, []);
    assert.deepEqual(harness.executedCommands, []);
    assert.equal(harness.cliInstallStatuses[cli], harness.status);
  });

  test(`cancelling the ${cli} installation dialog does not execute commands`, async () => {
    const harness = createHarness({ cli, selection: "cancel" });

    await harness.switchCli(cli);

    assert.equal(harness.warnings.length, 1);
    assert.equal(harness.warnings[0].options.modal, true);
    assert.deepEqual(harness.terminalNames, []);
    assert.deepEqual(harness.sentCommands, []);
    assert.deepEqual(harness.executedCommands, []);
    assert.equal(harness.cliInstallStatuses[cli], harness.status);
  });

  test(`the ${cli} dialog opens the executable setting without installing`, async () => {
    const harness = createHarness({ cli, selection: "settings" });

    await harness.switchCli(cli);

    assert.equal(harness.warnings[0].options.modal, true);
    assert.deepEqual(harness.executedCommands, [["workbench.action.openSettings", `sinitek-cli-tools.commands.${cli}`]]);
    assert.deepEqual(harness.terminalNames, []);
    assert.deepEqual(harness.sentCommands, []);
    assert.equal(harness.cliInstallStatuses[cli], harness.status);
  });

  test(`${cli} can be installed from the dialog when non-modal notifications are hidden`, async () => {
    const harness = createHarness({ cli, suppressNonModal: true });

    await harness.switchCli(cli);

    assert.equal(harness.warnings[0].options.modal, true);
    assert.deepEqual(harness.sentCommands, [getCliInstallCommand(cli, "darwin")]);
    assert.equal(harness.cliInstallStatuses[cli], null);
  });
}
