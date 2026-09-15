import test = require("node:test");
import assert = require("node:assert/strict");
import * as os from "os";
import * as path from "path";

import {
  expandHomePath,
  formatHomeDisplayPath,
  resolveCodexHomeDir,
  resolveXdgConfigHome,
} from "../../shared/userHomePaths";

test("expands Unix and Windows home prefixes to native paths", () => {
  const homeDir = path.join(path.sep, "home", "tester");

  assert.equal(expandHomePath("", { homeDir }), "");
  assert.equal(expandHomePath("~", { homeDir }), path.normalize(homeDir));
  assert.equal(
    expandHomePath("~/.codex/config.toml", { homeDir }),
    path.join(homeDir, ".codex", "config.toml"),
  );
  assert.equal(
    expandHomePath("~\\.codex\\skills", { homeDir }),
    path.join(homeDir, ".codex", "skills"),
  );
});

test("expands Windows environment variables before joining native paths", () => {
  const userProfile = "C:\\Users\\tester";
  assert.equal(
    expandHomePath("%USERPROFILE%\\.codex\\config.toml", {
      homeDir: userProfile,
      env: { USERPROFILE: userProfile },
      platform: "win32",
    }),
    path.normalize("C:\\Users\\tester\\.codex\\config.toml"),
  );
  assert.equal(
    expandHomePath("%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin", {
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      platform: "win32",
    }),
    path.normalize("C:\\Users\\tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin"),
  );
});

test("resolves CODEX_HOME even when it is written as ~/.codex", () => {
  const homeDir = path.join(path.sep, "Users", "tester");
  assert.equal(
    resolveCodexHomeDir({ CODEX_HOME: "~/.codex" }, homeDir),
    path.join(homeDir, ".codex"),
  );
  assert.equal(
    resolveCodexHomeDir({ CODEX_HOME_DIR: "~/.custom-codex" }, homeDir),
    path.join(homeDir, ".custom-codex"),
  );
  assert.equal(
    resolveCodexHomeDir({}, homeDir),
    path.join(homeDir, ".codex"),
  );
});

test("resolves XDG config home with a home-prefixed override", () => {
  const homeDir = path.join(path.sep, "home", "tester");
  assert.equal(
    resolveXdgConfigHome({}, homeDir),
    path.join(homeDir, ".config"),
  );
  assert.equal(
    resolveXdgConfigHome({ XDG_CONFIG_HOME: "~/.xdg" }, homeDir),
    path.join(homeDir, ".xdg"),
  );
});

test("formats user-visible home paths for the current platform", () => {
  if (process.platform === "win32") {
    assert.equal(
      formatHomeDisplayPath(".sinitek_cli", "logs"),
      path.join(os.homedir(), ".sinitek_cli", "logs"),
    );
    return;
  }
  assert.equal(formatHomeDisplayPath(".sinitek_cli", "logs"), "~/.sinitek_cli/logs");
});
