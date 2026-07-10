import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");

function loadDefaultRunCommands(): Record<string, string> {
  const source = fs.readFileSync(uiPath, "utf8");
  const block = source.match(/const DEFAULT_RUN_COMMANDS = \{([\s\S]*?)\n\s*\};/);
  assert.ok(block, "DEFAULT_RUN_COMMANDS should exist");

  return Object.fromEntries(
    Array.from(block[1].matchAll(/^\s*(claude|codex|opencode): "([^"]+)",$/gm), (match) => [
      match[1],
      match[2],
    ]),
  );
}

test("configuration UI exposes the expected default launch commands", () => {
  const commands = loadDefaultRunCommands();

  assert.deepEqual(commands, {
    claude: "claude --dangerously-skip-permissions",
    codex: "codex --dangerously-bypass-approvals-and-sandbox",
    opencode: "opencode --auto",
  });
  assert.equal(commands.opencode.split(/\s+/).filter((argument) => argument === "--auto").length, 1);
});
