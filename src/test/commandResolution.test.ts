import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { resolveCliCommand } from "../cli/commandResolution";

type CommandResolutionEnvironment = {
  HOME?: string;
  PATH?: string;
  npm_config_prefix?: string;
  NPM_CONFIG_PREFIX?: string;
  PNPM_HOME?: string;
};

function setCommandResolutionEnvironment(homeDir: string, pathValue: string): () => void {
  const original: CommandResolutionEnvironment = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    npm_config_prefix: process.env.npm_config_prefix,
    NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX,
    PNPM_HOME: process.env.PNPM_HOME,
  };
  process.env.HOME = homeDir;
  process.env.PATH = pathValue;
  delete process.env.npm_config_prefix;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.PNPM_HOME;

  return () => {
    restoreEnvironmentVariable("HOME", original.HOME);
    restoreEnvironmentVariable("PATH", original.PATH);
    restoreEnvironmentVariable("npm_config_prefix", original.npm_config_prefix);
    restoreEnvironmentVariable("NPM_CONFIG_PREFIX", original.NPM_CONFIG_PREFIX);
    restoreEnvironmentVariable("PNPM_HOME", original.PNPM_HOME);
  };
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

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
