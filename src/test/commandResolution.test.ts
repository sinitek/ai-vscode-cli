import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { resolveCliCommand } from "../cli/commandResolution";

test("prefers the npm global user bin before later PATH entries", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-command-resolution-"));
  const homeDir = path.join(tempRoot, "home");
  const npmBin = path.join(homeDir, ".npm-global", "bin");
  const brewBin = path.join(tempRoot, "brew", "bin");
  const npmGemini = path.join(npmBin, "gemini");
  const brewGemini = path.join(brewBin, "gemini");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;

  await fs.mkdir(npmBin, { recursive: true });
  await fs.mkdir(brewBin, { recursive: true });
  await fs.writeFile(npmGemini, "");
  await fs.writeFile(brewGemini, "");

  try {
    process.env.HOME = homeDir;
    process.env.PATH = brewBin;

    const resolved = resolveCliCommand("gemini");
    assert.deepEqual(resolved, {
      command: npmGemini,
      resolvedFrom: "unix-user-bin",
    });
  } finally {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("falls back to PATH when no preferred user-bin executable exists", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-command-resolution-"));
  const homeDir = path.join(tempRoot, "home");
  const brewBin = path.join(tempRoot, "brew", "bin");
  const brewGemini = path.join(brewBin, "gemini");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;

  await fs.mkdir(path.join(homeDir, ".npm-global", "bin"), { recursive: true });
  await fs.mkdir(brewBin, { recursive: true });
  await fs.writeFile(brewGemini, "");

  try {
    process.env.HOME = homeDir;
    process.env.PATH = brewBin;

    const resolved = resolveCliCommand("gemini");
    assert.deepEqual(resolved, {
      command: brewGemini,
      resolvedFrom: "path",
    });
  } finally {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
