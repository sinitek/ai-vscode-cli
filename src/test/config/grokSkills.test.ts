import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseGrokToml } from "../../config/grokToml";
import { listGrokOfficialSkills, listGrokSkills, mergeGrokSkillsConfig } from "../../config/grokSkills";

async function writeSkill(root: string, name: string, description: string): Promise<string> {
  const skillDir = path.join(root, name);
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
    "utf8",
  );
  return skillDir;
}

async function withGrokHome<T>(run: (grokHome: string, workspace: string) => Promise<T>): Promise<T> {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-skills-"));
  const grokHome = path.join(temp, "grok-home");
  const workspace = path.join(temp, "workspace");
  await fs.promises.mkdir(grokHome, { recursive: true });
  await fs.promises.mkdir(workspace, { recursive: true });
  const previous = process.env.GROK_HOME;
  process.env.GROK_HOME = grokHome;
  try {
    return await run(grokHome, workspace);
  } finally {
    if (previous === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = previous;
    }
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}

test.describe("grok skills", { concurrency: false }, () => {
  test("returns an empty list when skill directories are missing or empty", async () => {
    await withGrokHome(async (grokHome, workspace) => {
      assert.deepEqual(await listGrokSkills([workspace]), []);
      assert.deepEqual(await listGrokSkills(undefined), []);
      await fs.promises.mkdir(path.join(workspace, ".grok", "skills"), { recursive: true });
      await fs.promises.mkdir(path.join(grokHome, "skills"), { recursive: true });
      await fs.promises.mkdir(path.join(workspace, ".grok", "skills", "notes-only"), { recursive: true });
      await fs.promises.writeFile(path.join(workspace, ".grok", "skills", "notes-only", "README.md"), "no skill", "utf8");
      assert.deepEqual(await listGrokSkills([workspace]), []);
      assert.deepEqual(await listGrokOfficialSkills(), []);
    });
  });

  test("project skills override same-named user skills and bundled skills stay labeled", async () => {
    await withGrokHome(async (grokHome, workspace) => {
      const projectDir = await writeSkill(path.join(workspace, ".grok", "skills"), "shared", "from project");
      await writeSkill(path.join(grokHome, "skills"), "shared", "from user");
      await writeSkill(path.join(grokHome, "skills"), "user-only", "from user only");
      const bundledDir = await writeSkill(path.join(grokHome, "bundled", "skills"), "shared", "from bundled");
      await writeSkill(path.join(grokHome, "bundled", "skills"), "bundled-only", "from bundled only");

      const skills = await listGrokSkills([workspace]);
      const shared = skills.find((skill) => skill.name === "shared");
      const userOnly = skills.find((skill) => skill.name === "user-only");
      const bundledOnly = skills.find((skill) => skill.name === "bundled-only");
      assert.equal(shared?.path, projectDir);
      assert.equal(shared?.source, undefined);
      assert.equal(userOnly?.path, path.join(grokHome, "skills", "user-only"));
      assert.equal(bundledOnly?.path, path.join(grokHome, "bundled", "skills", "bundled-only"));
      assert.equal(bundledOnly?.source, "bundled");
      assert.equal(skills.some((skill) => skill.path === bundledDir), false);

      const official = await listGrokOfficialSkills();
      assert.deepEqual(
        official.map((skill) => skill.name),
        ["bundled-only", "shared"],
      );
      official.forEach((skill) => {
        assert.equal(skill.source, "bundled");
        assert.equal(skill.canInstall, false);
        assert.equal(skill.canUpdate, false);
        assert.equal(skill.canUninstall, false);
      });
    });
  });

  test("official list is empty when the bundled directory is missing", async () => {
    await withGrokHome(async () => {
      assert.deepEqual(await listGrokOfficialSkills(), []);
    });
  });

  test("merge adds and removes disabled while keeping api_key, marketplace, ui, and other tables", () => {
    const original = [
      "[model.demo]",
      'api_key = "secret-key"',
      'marketplace = "keep-market"',
      "",
      "[marketplace]",
      'name = "keep-market-table"',
      "",
      "[ui]",
      'theme = "dark"',
      "",
      "[skills]",
      'paths = ["~/team"]',
      'ignore = ["~/team/wip"]',
      'disabled = ["kept", "alpha"]',
      "",
      "[extra]",
      'note = "stay"',
      "",
    ].join("\n");

    const disabled = mergeGrokSkillsConfig(original, [
      { name: "alpha", path: "/tmp/alpha", enabled: true },
      { name: "beta", path: "/tmp/beta", enabled: true },
      { name: "gamma", path: "/tmp/gamma", enabled: false },
    ]);
    assert.equal(disabled.ok, true);
    if (!disabled.ok) {
      return;
    }
    const disabledDocument = parseGrokToml(disabled.content);
    assert.equal(disabledDocument.ok, true);
    if (!disabledDocument.ok) {
      return;
    }
    const model = disabledDocument.value.model;
    assert.equal(typeof model, "object");
    assert.ok(model && !Array.isArray(model));
    const demo = (model as { demo: { api_key: string; marketplace: string } }).demo;
    assert.equal(demo.api_key, "secret-key");
    assert.equal(demo.marketplace, "keep-market");
    assert.equal((disabledDocument.value.marketplace as { name: string }).name, "keep-market-table");
    assert.equal((disabledDocument.value.ui as { theme: string }).theme, "dark");
    assert.equal((disabledDocument.value.extra as { note: string }).note, "stay");
    const skills = disabledDocument.value.skills as { disabled: string[]; paths: string[]; ignore: string[] };
    assert.deepEqual(skills.disabled, ["kept", "gamma"]);
    assert.deepEqual(skills.paths, ["~/team"]);
    assert.deepEqual(skills.ignore, ["~/team/wip"]);
    assert.doesNotMatch(disabled.content, /\[\[skills\.config\]\]/);
    assert.doesNotMatch(disabled.content, /enabled = false/);
    assert.doesNotMatch(disabled.content, /sinitek codex skills/);
    assert.doesNotMatch(disabled.content, /\[features\]/);

    const enabled = mergeGrokSkillsConfig(disabled.content, [
      { name: "alpha", path: "/tmp/alpha", enabled: true },
      { name: "gamma", path: "/tmp/gamma", enabled: true },
      { name: "kept", path: "/tmp/kept", enabled: true },
    ]);
    assert.equal(enabled.ok, true);
    if (!enabled.ok) {
      return;
    }
    const enabledDocument = parseGrokToml(enabled.content);
    assert.equal(enabledDocument.ok, true);
    if (!enabledDocument.ok) {
      return;
    }
    const remaining = enabledDocument.value.skills as { disabled?: string[]; paths: string[]; ignore: string[] };
    assert.equal(remaining.disabled, undefined);
    assert.deepEqual(remaining.paths, ["~/team"]);
    assert.deepEqual(remaining.ignore, ["~/team/wip"]);
    const enabledModel = enabledDocument.value.model as { demo: { api_key: string; marketplace: string } };
    assert.equal(enabledModel.demo.api_key, "secret-key");
    assert.equal(enabledModel.demo.marketplace, "keep-market");
    assert.equal((enabledDocument.value.marketplace as { name: string }).name, "keep-market-table");
    assert.equal((enabledDocument.value.ui as { theme: string }).theme, "dark");
  });

  test("invalid TOML is returned unchanged", () => {
    const invalid = "[\nthis is not toml";
    const result = mergeGrokSkillsConfig(invalid, [
      { name: "alpha", path: "/tmp/alpha", enabled: false },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.content, invalid);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  });
});
