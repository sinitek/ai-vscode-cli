import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { ensureCodexProjectTrusted, resolveCodexModelProvider } from "../../interactive/codexRuntimeConfig";

test("resolves the root model_provider from Codex TOML", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-provider-"));
  try {
    await fs.writeFile(path.join(codexHomeDir, "config.toml"), [
      "model = \"gpt-5.6\"",
      "model_provider = 'gateway'",
      "",
      "[model_providers.gateway]",
      "name = \"Gateway\"",
    ].join("\n"));

    assert.equal(await resolveCodexModelProvider(codexHomeDir), "gateway");
  } finally {
    await fs.rm(codexHomeDir, { recursive: true, force: true });
  }
});

test("new-session project trust writes without waiting for a cross-window mutex", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-trust-lock-"));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-trust-project-"));
  const configPath = path.join(codexHomeDir, "config.toml");
  try {
    await fs.writeFile(configPath, "model = \"test\"\n");
    await fs.mkdir(path.join(codexHomeDir, ".sinitek-runtime-coordination", "config.toml"), { recursive: true });
    await fs.writeFile(path.join(codexHomeDir, ".sinitek-runtime-coordination", "config.toml", "mutex"), "held");
    const trust = ensureCodexProjectTrusted({ projectRoot, codexHomeDir });
    const persisted = await trust;
    assert.equal(persisted.status, "updated");
    assert.match(await fs.readFile(configPath, "utf8"), /trust_level = "trusted"/);
  } finally {
    await fs.rm(codexHomeDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test("leaves model provider unset when Codex TOML has no root setting", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-provider-"));
  try {
    await fs.writeFile(path.join(codexHomeDir, "config.toml"), "model = \"gpt-5.6\"\n");

    assert.equal(await resolveCodexModelProvider(codexHomeDir), null);
  } finally {
    await fs.rm(codexHomeDir, { recursive: true, force: true });
  }
});
