import test = require("node:test");
import assert = require("node:assert/strict");
import * as os from "os";
import * as path from "path";

import {
  getOfficialArchiveValidationFile,
  getOfficialSkillTargetDir,
  isOfficialSkillPlatform,
  resolveOfficialSkillInstallRoot,
} from "../../config/officialSkillService";

type OfficialSkillTargetItem = Parameters<typeof getOfficialSkillTargetDir>[0];
type OfficialArchiveValidationItem = Parameters<typeof getOfficialArchiveValidationFile>[0];

function createTargetItem(overrides: Partial<OfficialSkillTargetItem> = {}): OfficialSkillTargetItem {
  return {
    platform: "codex",
    installFolderName: "openai-docs",
    ...overrides,
  };
}

function createArchiveValidationItem(platform: string): OfficialArchiveValidationItem {
  return { platform } as unknown as OfficialArchiveValidationItem;
}

test("recognizes supported official skill platforms", () => {
  assert.equal(isOfficialSkillPlatform("claude"), true);
  assert.equal(isOfficialSkillPlatform("codex"), true);
  assert.equal(isOfficialSkillPlatform("opencode"), true);
  assert.equal(isOfficialSkillPlatform("gemini"), false);
  assert.equal(isOfficialSkillPlatform("unknown"), false);
  assert.equal(isOfficialSkillPlatform(""), false);
});

test("resolves target directory under the platform install root", () => {
  const item = createTargetItem({ platform: "codex", installFolderName: "openai-docs" });
  assert.equal(
    getOfficialSkillTargetDir(item),
    path.join(resolveOfficialSkillInstallRoot("codex"), "openai-docs"),
  );
});

test("uses platform-specific archive validation files", () => {
  assert.equal(getOfficialArchiveValidationFile(createArchiveValidationItem("claude")), "SKILL.md");
  assert.equal(getOfficialArchiveValidationFile(createArchiveValidationItem("codex")), "SKILL.md");
  assert.equal(getOfficialArchiveValidationFile(createArchiveValidationItem("opencode")), "SKILL.md");
});

test("expands CODEX_HOME when it uses a home-prefixed path", () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const originalCodexHomeDir = process.env.CODEX_HOME_DIR;
  try {
    process.env.CODEX_HOME = "~/.codex";
    delete process.env.CODEX_HOME_DIR;
    assert.equal(
      resolveOfficialSkillInstallRoot("codex"),
      path.join(os.homedir(), ".codex", "skills"),
    );
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    if (originalCodexHomeDir === undefined) {
      delete process.env.CODEX_HOME_DIR;
    } else {
      process.env.CODEX_HOME_DIR = originalCodexHomeDir;
    }
  }
});
