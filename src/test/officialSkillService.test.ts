import test = require("node:test");
import assert = require("node:assert/strict");
import * as path from "path";

import {
  getOfficialArchiveValidationFile,
  getOfficialSkillTargetDir,
  isOfficialSkillPlatform,
  resolveOfficialSkillInstallRoot,
} from "../config/officialSkillService";
import { OfficialSkillCatalogItem } from "../config/types";

function createCatalogItem(overrides: Partial<OfficialSkillCatalogItem> = {}): OfficialSkillCatalogItem {
  return {
    id: "codex-openai-docs",
    platform: "codex",
    group: "docs",
    name: "openai-docs",
    description: "Official docs helper",
    archivePath: "official-skills/codex/openai-docs.zip",
    installFolderName: "openai-docs",
    sourceRepo: "openai/codex",
    sourceRef: "commit:repo-ref-1",
    sourcePath: "skills/openai-docs",
    sourceUrl: "https://example.com/openai-docs",
    ...overrides,
  };
}

test("recognizes supported official skill platforms", () => {
  assert.equal(isOfficialSkillPlatform("claude"), true);
  assert.equal(isOfficialSkillPlatform("codex"), true);
  assert.equal(isOfficialSkillPlatform("gemini"), true);
  assert.equal(isOfficialSkillPlatform("unknown"), false);
  assert.equal(isOfficialSkillPlatform(""), false);
});

test("resolves target directory under the platform install root", () => {
  const item = createCatalogItem({ platform: "codex", installFolderName: "openai-docs" });
  assert.equal(
    getOfficialSkillTargetDir(item),
    path.join(resolveOfficialSkillInstallRoot("codex"), "openai-docs"),
  );
});

test("uses platform-specific archive validation files", () => {
  assert.equal(getOfficialArchiveValidationFile(createCatalogItem({ platform: "claude" })), "SKILL.md");
  assert.equal(getOfficialArchiveValidationFile(createCatalogItem({ platform: "codex" })), "SKILL.md");
  assert.equal(getOfficialArchiveValidationFile(createCatalogItem({ platform: "gemini" })), "gemini-extension.json");
});
