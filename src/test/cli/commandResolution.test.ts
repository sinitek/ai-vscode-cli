import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
  getConfiguredCliCommandParts,
  resolveCliCommand,
  splitConfiguredCliCommand,
} from "../../cli/commandResolution";

type CommandResolutionEnvironment = {
  HOME?: string;
  USERPROFILE?: string;
  PATH?: string;
  PATHEXT?: string;
  APPDATA?: string;
  LOCALAPPDATA?: string;
  npm_config_prefix?: string;
  NPM_CONFIG_PREFIX?: string;
  PNPM_HOME?: string;
};

function setCommandResolutionEnvironment(homeDir: string, pathValue: string): () => void {
  const original: CommandResolutionEnvironment = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    npm_config_prefix: process.env.npm_config_prefix,
    NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX,
    PNPM_HOME: process.env.PNPM_HOME,
  };
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.PATH = pathValue;
  delete process.env.npm_config_prefix;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.PNPM_HOME;

  return () => {
    restoreEnvironmentVariable("HOME", original.HOME);
    restoreEnvironmentVariable("USERPROFILE", original.USERPROFILE);
    restoreEnvironmentVariable("PATH", original.PATH);
    restoreEnvironmentVariable("PATHEXT", original.PATHEXT);
    restoreEnvironmentVariable("APPDATA", original.APPDATA);
    restoreEnvironmentVariable("LOCALAPPDATA", original.LOCALAPPDATA);
    restoreEnvironmentVariable("npm_config_prefix", original.npm_config_prefix);
    restoreEnvironmentVariable("NPM_CONFIG_PREFIX", original.NPM_CONFIG_PREFIX);
    restoreEnvironmentVariable("PNPM_HOME", original.PNPM_HOME);
  };
}

function setPlatform(value: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (!descriptor?.configurable) {
    throw new Error("process.platform must be configurable for command resolution tests");
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

test("splits configured CLI command strings and preserves fallback commands", () => {
  assert.deepEqual(
    splitConfiguredCliCommand("  \"node binary\" --profile 'two words' plain  "),
    ["node binary", "--profile", "two words", "plain"],
  );
  assert.deepEqual(splitConfiguredCliCommand(" \n\t "), []);
  assert.deepEqual(getConfiguredCliCommandParts(" \n\t ", "codex"), ["codex"]);
});

test("prefers the npm global user bin before later PATH entries", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-command-resolution-"));
  const homeDir = path.join(tempRoot, "home");
  const npmBin = path.join(homeDir, ".npm-global", "bin");
  const brewBin = path.join(tempRoot, "brew", "bin");
  const npmOpenCode = path.join(npmBin, "opencode");
  const brewOpenCode = path.join(brewBin, "opencode");
  await fs.mkdir(npmBin, { recursive: true });
  await fs.mkdir(brewBin, { recursive: true });
  await fs.writeFile(npmOpenCode, "");
  await fs.writeFile(brewOpenCode, "");

  const restoreEnvironment = setCommandResolutionEnvironment(homeDir, brewBin);
  try {

    const resolved = resolveCliCommand("opencode");
    assert.deepEqual(resolved, {
      command: npmOpenCode,
      resolvedFrom: "unix-user-bin",
    });
  } finally {
    restoreEnvironment();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("falls back to PATH when no preferred user-bin executable exists", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-command-resolution-"));
  const homeDir = path.join(tempRoot, "home");
  const brewBin = path.join(tempRoot, "brew", "bin");
  const brewOpenCode = path.join(brewBin, "opencode");
  await fs.mkdir(path.join(homeDir, ".npm-global", "bin"), { recursive: true });
  await fs.mkdir(brewBin, { recursive: true });
  await fs.writeFile(brewOpenCode, "");

  const restoreEnvironment = setCommandResolutionEnvironment(homeDir, brewBin);
  try {

    const resolved = resolveCliCommand("opencode");
    assert.deepEqual(resolved, {
      command: brewOpenCode,
      resolvedFrom: "path",
    });
  } finally {
    restoreEnvironment();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("expands a home-prefixed configured command path", async () => {
  const commandName = `.sinitek-cli-home-path-test-${process.pid}-${Date.now()}`;
  const commandPath = path.join(os.homedir(), commandName);
  await fs.writeFile(commandPath, "");
  try {
    const resolved = resolveCliCommand(`~/${commandName}`);
    assert.deepEqual(resolved, {
      command: commandPath,
      resolvedFrom: "config",
    });
  } finally {
    await fs.rm(commandPath, { force: true });
  }
});

test("discovers Codex from the Windows official install directory", async () => {
  const restorePlatform = setPlatform("win32");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-windows-codex-bin-"));
  const localAppData = path.join(tempRoot, "Local");
  const binDir = path.join(localAppData, "Programs", "OpenAI", "Codex", "bin");
  const commandPath = path.join(binDir, "codex.cmd");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(commandPath, "");
  const restoreEnvironment = setCommandResolutionEnvironment(path.join(tempRoot, "home"), "");
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalAppData = process.env.APPDATA;
  const originalPathExt = process.env.PATHEXT;
  try {
    process.env.LOCALAPPDATA = localAppData;
    delete process.env.APPDATA;
    process.env.PATHEXT = ".cmd;.exe";
    const resolved = resolveCliCommand("codex");
    assert.deepEqual(resolved, {
      command: commandPath,
      resolvedFrom: "windows-npm-bin",
    });
  } finally {
    restoreEnvironmentVariable("LOCALAPPDATA", originalLocalAppData);
    restoreEnvironmentVariable("APPDATA", originalAppData);
    restoreEnvironmentVariable("PATHEXT", originalPathExt);
    restoreEnvironment();
    restorePlatform();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
