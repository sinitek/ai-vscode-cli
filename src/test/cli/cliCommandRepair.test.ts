import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
  buildRepairedCliCommand,
  inspectUnresolvedCliCommands,
  locateCliExecutableForRepair,
} from "../../cli/cliCommandRepair";

type CommandRepairEnvironment = {
  HOME?: string;
  USERPROFILE?: string;
  PATH?: string;
  PATHEXT?: string;
  APPDATA?: string;
  LOCALAPPDATA?: string;
  ProgramFiles?: string;
  npm_config_prefix?: string;
  NPM_CONFIG_PREFIX?: string;
  PNPM_HOME?: string;
  SCOOP?: string;
};

function setCommandRepairEnvironment(homeDir: string): () => void {
  const original: CommandRepairEnvironment = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    ProgramFiles: process.env.ProgramFiles,
    npm_config_prefix: process.env.npm_config_prefix,
    NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX,
    PNPM_HOME: process.env.PNPM_HOME,
    SCOOP: process.env.SCOOP,
  };
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.PATH = "";
  process.env.PATHEXT = ".exe;.cmd";
  process.env.APPDATA = path.join(homeDir, "Roaming");
  process.env.LOCALAPPDATA = path.join(homeDir, "Local");
  process.env.ProgramFiles = path.join(homeDir, "ProgramFiles");
  delete process.env.npm_config_prefix;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.PNPM_HOME;
  delete process.env.SCOOP;
  return () => {
    restoreEnvironmentVariable("HOME", original.HOME);
    restoreEnvironmentVariable("USERPROFILE", original.USERPROFILE);
    restoreEnvironmentVariable("PATH", original.PATH);
    restoreEnvironmentVariable("PATHEXT", original.PATHEXT);
    restoreEnvironmentVariable("APPDATA", original.APPDATA);
    restoreEnvironmentVariable("LOCALAPPDATA", original.LOCALAPPDATA);
    restoreEnvironmentVariable("ProgramFiles", original.ProgramFiles);
    restoreEnvironmentVariable("npm_config_prefix", original.npm_config_prefix);
    restoreEnvironmentVariable("NPM_CONFIG_PREFIX", original.NPM_CONFIG_PREFIX);
    restoreEnvironmentVariable("PNPM_HOME", original.PNPM_HOME);
    restoreEnvironmentVariable("SCOOP", original.SCOOP);
  };
}

function setPlatform(value: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (!descriptor?.configurable) {
    throw new Error("process.platform must be configurable for command repair tests");
  }
  Object.defineProperty(process, "platform", { ...descriptor, value });
  return () => {
    Object.defineProperty(process, "platform", descriptor);
  };
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function writeCommand(filePath: string, contents = "@echo off\r\n"): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

test("reports spawn ENOENT only for CLI commands the extension host cannot use", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-repair-inspect-"));
  const restoreEnv = setCommandRepairEnvironment(homeDir);
  const restorePlatform = setPlatform("win32");
  try {
    const missing = inspectUnresolvedCliCommands({
      codex: "codex",
      claude: "claude",
      opencode: "opencode",
    }, "win32");
    assert.deepEqual(missing.map((issue) => issue.summary), [
      "spawn codex ENOENT",
      "spawn claude ENOENT",
      "spawn opencode ENOENT",
    ]);

    const windowsAppsDir = path.join(homeDir, "Local", "Microsoft", "WindowsApps");
    await writeCommand(path.join(windowsAppsDir, "codex.exe"), "");
    process.env.PATH = windowsAppsDir;
    const stubOnly = inspectUnresolvedCliCommands({ codex: "codex" }, "win32");
    assert.equal(stubOnly[0]?.summary, "spawn codex ENOENT");

    await writeCommand(path.join(homeDir, "Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
    const resolved = inspectUnresolvedCliCommands({
      codex: "codex",
      claude: "claude",
      opencode: "opencode",
    }, "win32");
    assert.deepEqual(resolved.map((issue) => issue.cli), ["claude", "opencode"]);
  } finally {
    restorePlatform();
    restoreEnv();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("repairs a Windows CLI from the fresh registry PATH and ignores app execution aliases", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-repair-locate-"));
  const restoreEnv = setCommandRepairEnvironment(homeDir);
  const restorePlatform = setPlatform("win32");
  try {
    const stubDir = path.join(homeDir, "Local", "Microsoft", "WindowsApps");
    const realDir = path.join(homeDir, "tools", "codex");
    await writeCommand(path.join(stubDir, "codex.exe"), "");
    const realPath = path.join(realDir, "codex.exe");
    await writeCommand(realPath);
    const located = await locateCliExecutableForRepair("codex", "codex", {
      platform: "win32",
      env: process.env,
      homeDir,
      readRegistryPath: async () => `${stubDir};${realDir}`,
    });
    assert.equal(located, realPath);
    assert.equal(
      buildRepairedCliCommand("codex --profile work", "codex", path.join(homeDir, "Program Files", "codex.exe")),
      `"${path.join(homeDir, "Program Files", "codex.exe")}" --profile work`,
    );
  } finally {
    restorePlatform();
    restoreEnv();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("repairs codex from a user bin directory that the normal resolver does not search", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-repair-bun-"));
  const restoreEnv = setCommandRepairEnvironment(homeDir);
  const restorePlatform = setPlatform("win32");
  try {
    const bunPath = path.join(homeDir, ".bun", "bin", "codex.exe");
    await writeCommand(bunPath);
    assert.equal(inspectUnresolvedCliCommands({ codex: "codex" }, "win32")[0]?.summary, "spawn codex ENOENT");
    const located = await locateCliExecutableForRepair("codex", "codex", {
      platform: "win32",
      env: process.env,
      homeDir,
      readRegistryPath: async () => "",
    });
    assert.equal(located, bunPath);
  } finally {
    restorePlatform();
    restoreEnv();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});
