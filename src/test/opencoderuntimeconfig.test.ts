import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";

import { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";

const configContent = JSON.stringify({
  model: "provider/default",
  small_model: "provider/small",
  provider: {
    provider: {
      models: { default: {}, selected: {}, small: {}, tiny: {} },
    },
  },
});

test("creates a private runtime overlay and cleans it idempotently", () => {
  const result = createOpenCodeRuntimeConfigOverlay({
    configContent,
    primaryModel: "provider/selected",
    smallModel: "provider/tiny",
  });
  assert.equal(result.ok, true);
  assert.ok(result.overlay);
  const overlay = result.overlay!;
  assert.equal(overlay.envOverrides.OPENCODE_CONFIG, overlay.configPath);
  assert.equal(fs.statSync(overlay.configPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(overlay.configPath)).mode & 0o777, 0o700);
  const parsed = JSON.parse(fs.readFileSync(overlay.configPath, "utf8")) as Record<string, unknown>;
  assert.equal(parsed.model, "provider/selected");
  assert.equal(parsed.small_model, "provider/tiny");
  overlay.cleanup();
  overlay.cleanup();
  assert.equal(fs.existsSync(overlay.configPath), false);
});

test("rejects unavailable runtime role models before writing a file", () => {
  const result = createOpenCodeRuntimeConfigOverlay({
    configContent,
    primaryModel: "provider/missing",
    smallModel: "provider/tiny",
  });
  assert.equal(result.ok, false);
  assert.equal(result.overlay, null);
  assert.match(result.issues[0]?.message ?? "", /not an available model/u);
});
