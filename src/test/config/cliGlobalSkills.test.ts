import assert = require("node:assert/strict");
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import test = require("node:test");

import {
  copyCliSkill,
  deleteCliSkill,
  getCliSkillsList,
  installCliSkillDirectory,
  openCliSkillsDirectory,
  readDshUnsupportedCapability,
} from "../../config/cliGlobalSkills";
import { buildDshSessionPromptParams } from "../../interactive/dshAppServerProtocol";
import { t } from "../../i18n";
import {
  resolveDshGlobalRulesPath,
  resolveDshGlobalSkillsDirectory,
  resolveDshHomeDir,
} from "../../shared/userHomePaths";

const originalHomedir = os.homedir;
const originalCodexHome = process.env.CODEX_HOME;
const originalCodexHomeDir = process.env.CODEX_HOME_DIR;
const originalGrokHome = process.env.GROK_HOME;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalDshHome = process.env.DSH_HOME;
const originalKimiCodeHome = process.env.KIMI_CODE_HOME;
const originalZcodeDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
const originalDshApiKey = process.env.SINITEK_DSH_API_KEY;

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-cli-global-skills-"));
  const homeDir = path.join(temp, "home");
  await fs.promises.mkdir(homeDir, { recursive: true });
  Object.defineProperty(os, "homedir", {
    configurable: true,
    value: () => homeDir,
  });
  delete process.env.CODEX_HOME;
  delete process.env.CODEX_HOME_DIR;
  delete process.env.GROK_HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.DSH_HOME;
  delete process.env.KIMI_CODE_HOME;
  delete process.env.ZCODE_DATA_BASE_DIR;
  delete process.env.SINITEK_DSH_API_KEY;
  try {
    return await run(homeDir);
  } finally {
    Object.defineProperty(os, "homedir", {
      configurable: true,
      value: originalHomedir,
    });
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
    if (originalGrokHome === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = originalGrokHome;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (originalDshHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = originalDshHome;
    }
    if (originalKimiCodeHome === undefined) {
      delete process.env.KIMI_CODE_HOME;
    } else {
      process.env.KIMI_CODE_HOME = originalKimiCodeHome;
    }
    if (originalZcodeDataBaseDir === undefined) {
      delete process.env.ZCODE_DATA_BASE_DIR;
    } else {
      process.env.ZCODE_DATA_BASE_DIR = originalZcodeDataBaseDir;
    }
    if (originalDshApiKey === undefined) {
      delete process.env.SINITEK_DSH_API_KEY;
    } else {
      process.env.SINITEK_DSH_API_KEY = originalDshApiKey;
    }
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}

async function writeSkill(root: string, name: string, description?: string): Promise<string> {
  const skillDir = path.join(root, name);
  await fs.promises.mkdir(skillDir, { recursive: true });
  const frontmatter = description ? `description: ${description}\n` : "";
  await fs.promises.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\n${frontmatter}---\n# ${name}\n`,
    "utf8",
  );
  await fs.promises.writeFile(path.join(skillDir, "marker.txt"), `${name}-marker`, "utf8");
  return skillDir;
}

test.describe("cli global skills", { concurrency: false }, () => {
  test("returns an empty list for an empty global skills directory", async () => {
    await withTempHome(async (homeDir) => {
      const directory = path.join(homeDir, ".claude", "skills");
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.mkdir(path.join(homeDir, ".agents", "skills", "agents-only"), { recursive: true });
      await fs.promises.writeFile(path.join(homeDir, ".agents", "skills", "agents-only", "SKILL.md"), "# nope\n", "utf8");

      const listed = await getCliSkillsList("claude");
      assert.equal(listed.directory, directory);
      assert.equal(listed.displayDirectory, "~/.claude/skills");
      assert.deepEqual(listed.skills, []);
      await assert.rejects(() => getCliSkillsList("gemini"), { message: t("skill.global.invalidPlatform") });
    });
  });

  test("lists only direct global skills that contain SKILL.md", async () => {
    await withTempHome(async (homeDir) => {
      const codexRoot = path.join(homeDir, ".codex", "skills");
      const zeta = await writeSkill(codexRoot, "zeta", "Zeta skill");
      const alpha = await writeSkill(codexRoot, "alpha");
      await fs.promises.mkdir(path.join(codexRoot, "notes-only"), { recursive: true });
      await fs.promises.writeFile(path.join(codexRoot, "notes-only", "README.md"), "no", "utf8");
      await fs.promises.mkdir(path.join(codexRoot, "alpha", "nested"), { recursive: true });
      await fs.promises.writeFile(path.join(codexRoot, "alpha", "nested", "SKILL.md"), "---\ndescription: nested\n---\n", "utf8");
      await fs.promises.mkdir(path.join(codexRoot, ".hidden"), { recursive: true });
      await fs.promises.writeFile(path.join(codexRoot, ".hidden", "SKILL.md"), "---\ndescription: hidden\n---\n", "utf8");
      await writeSkill(path.join(homeDir, ".agents", "skills"), "agents-skill", "not global");
      await writeSkill(path.join(homeDir, "workspace", ".codex", "skills"), "workspace-skill", "workspace");

      const listed = await getCliSkillsList("codex");
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["alpha", "zeta"]);
      assert.equal(listed.skills[0]?.path, alpha);
      assert.equal(listed.skills[0]?.description, undefined);
      assert.equal(listed.skills[1]?.path, zeta);
      assert.equal(listed.skills[1]?.description, "Zeta skill");
      assert.equal(listed.displayDirectory, "~/.codex/skills");
    });
  });

  test("deletes a listed skill and rejects a missing name", async () => {
    await withTempHome(async (homeDir) => {
      const root = path.join(homeDir, ".config", "opencode", "skills");
      const skillDir = await writeSkill(root, "remove-me", "gone soon");
      const removed = await deleteCliSkill("opencode", "remove-me");
      assert.equal(fs.existsSync(skillDir), false);
      assert.deepEqual(removed.skills, []);
      assert.equal(removed.directory, root);
      await assert.rejects(() => deleteCliSkill("opencode", "remove-me"), {
        message: t("skill.global.notFound", { name: "remove-me" }),
      });
    });
  });

  test("copies a skill and rejects an existing target without touching the source", async () => {
    await withTempHome(async (homeDir) => {
      const sourceRoot = path.join(homeDir, ".grok", "skills");
      const targetRoot = path.join(homeDir, ".codex", "skills");
      await writeSkill(sourceRoot, "shared", "from grok");
      await writeSkill(targetRoot, "shared", "keep target");
      await assert.rejects(() => copyCliSkill("grok", "shared", "codex"), {
        message: t("skill.global.targetExists", { name: "shared" }),
      });
      assert.equal(await fs.promises.readFile(path.join(targetRoot, "shared", "marker.txt"), "utf8"), "shared-marker");
      assert.equal(fs.existsSync(path.join(sourceRoot, "shared", "SKILL.md")), true);

      await fs.promises.rm(path.join(targetRoot, "shared"), { recursive: true });
      const copied = await copyCliSkill("grok", "shared", "codex");
      assert.deepEqual(copied.skills.map((skill) => skill.name), ["shared"]);
      assert.equal(copied.directory, sourceRoot);
      assert.equal(await fs.promises.readFile(path.join(targetRoot, "shared", "marker.txt"), "utf8"), "shared-marker");
      assert.equal(fs.existsSync(path.join(sourceRoot, "shared", "SKILL.md")), true);
      await assert.rejects(() => copyCliSkill("grok", "shared", "grok"), {
        message: t("skill.global.samePlatform"),
      });
    });
  });

  test("rejects path traversal and does not create directories outside the skill root", async () => {
    await withTempHome(async (homeDir) => {
      const outside = path.join(homeDir, "outside");
      await fs.promises.mkdir(outside, { recursive: true });
      const attacks = ["", " ", "..", "../outside", "foo/bar", "foo\\bar", "a/../../outside"];
      for (const name of attacks) {
        await assert.rejects(() => deleteCliSkill("claude", name), {
          message: t("skill.global.invalidName"),
        });
        await assert.rejects(() => copyCliSkill("claude", name, "codex"), {
          message: t("skill.global.invalidName"),
        });
      }
      assert.equal(fs.existsSync(path.join(outside, "SKILL.md")), false);
      assert.equal(fs.existsSync(path.join(homeDir, ".claude", "skills")), false);
    });
  });

  test("deletes a symlinked skill without deleting the link target", async () => {
    await withTempHome(async (homeDir) => {
      const external = path.join(homeDir, "external-skill");
      await writeSkill(path.dirname(external), path.basename(external), "linked");
      const root = path.join(homeDir, ".claude", "skills");
      await fs.promises.mkdir(root, { recursive: true });
      const linkPath = path.join(root, "linked-skill");
      await fs.promises.symlink(external, linkPath, "dir");

      const listed = await getCliSkillsList("claude");
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["linked-skill"]);

      const after = await deleteCliSkill("claude", "linked-skill");
      assert.equal(fs.existsSync(linkPath), false);
      assert.equal(fs.existsSync(path.join(external, "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(external, "marker.txt")), true);
      assert.deepEqual(after.skills, []);
    });
  });

  test("opens a platform skills directory by creating it when missing", async () => {
    await withTempHome(async (homeDir) => {
      const directory = await openCliSkillsDirectory("opencode");
      assert.equal(directory, path.join(homeDir, ".config", "opencode", "skills"));
      assert.equal(fs.existsSync(directory), true);
      const stat = await fs.promises.stat(directory);
      assert.equal(stat.isDirectory(), true);
    });
  });

  test("reads existing OpenCode global skills without modifying them or including project skills", async () => {
    await withTempHome(async (homeDir) => {
      const root = path.join(homeDir, ".config", "opencode", "skills");
      const existing = await writeSkill(root, "existing", "already installed");
      await writeSkill(path.join(homeDir, "workspace", ".opencode", "skills"), "project-only");
      const before = await fs.promises.readFile(path.join(existing, "SKILL.md"), "utf8");

      const listed = await getCliSkillsList("opencode");
      assert.equal(listed.directory, root);
      assert.equal(listed.displayDirectory, process.platform === "win32" ? root : "~/.config/opencode/skills");
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["existing"]);
      assert.equal(listed.skills[0]?.path, existing);
      assert.equal(await fs.promises.readFile(path.join(existing, "SKILL.md"), "utf8"), before);
      assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "skills")), false);
    });
  });

  test("uses XDG_CONFIG_HOME consistently for OpenCode listing, opening, copying and deleting", async () => {
    await withTempHome(async (homeDir) => {
      const configHome = path.join(path.dirname(homeDir), "custom-config");
      process.env.XDG_CONFIG_HOME = configHome;
      const root = path.join(configHome, "opencode", "skills");
      const empty = await getCliSkillsList("opencode");
      assert.equal(empty.directory, root);
      assert.deepEqual(empty.skills, []);
      assert.equal(fs.existsSync(root), false);
      assert.equal(await openCliSkillsDirectory("opencode"), root);

      const sourceRoot = path.join(homeDir, ".claude", "skills");
      await writeSkill(sourceRoot, "portable", "portable skill");
      await copyCliSkill("claude", "portable", "opencode");
      const listed = await getCliSkillsList("opencode");
      assert.equal(listed.displayDirectory, root);
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["portable"]);
      assert.equal(await fs.promises.readFile(path.join(root, "portable", "marker.txt"), "utf8"), "portable-marker");
      await assert.rejects(() => copyCliSkill("claude", "portable", "opencode"), {
        message: t("skill.global.targetExists", { name: "portable" }),
      });
      assert.equal(await fs.promises.readFile(path.join(root, "portable", "marker.txt"), "utf8"), "portable-marker");

      const copied = await copyCliSkill("opencode", "portable", "codex");
      assert.equal(copied.directory, root);
      assert.equal(fs.existsSync(path.join(homeDir, ".codex", "skills", "portable", "SKILL.md")), true);
      const deleted = await deleteCliSkill("opencode", "portable");
      assert.deepEqual(deleted.skills, []);
      assert.equal(fs.existsSync(path.join(sourceRoot, "portable", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(homeDir, ".opencode", "skills")), false);
      assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "skills")), false);
    });
  });

  test("expands a home-relative XDG_CONFIG_HOME for OpenCode skills", async () => {
    await withTempHome(async (homeDir) => {
      process.env.XDG_CONFIG_HOME = "~/custom-config";
      const root = path.join(homeDir, "custom-config", "opencode", "skills");
      await writeSkill(root, "custom-home");
      const listed = await getCliSkillsList("opencode");
      assert.equal(listed.directory, root);
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["custom-home"]);
    });
  });

  test("falls back to the default OpenCode config directory for blank XDG_CONFIG_HOME", async () => {
    await withTempHome(async (homeDir) => {
      process.env.XDG_CONFIG_HOME = "   ";
      const listed = await getCliSkillsList("opencode");
      assert.equal(listed.directory, path.join(homeDir, ".config", "opencode", "skills"));
      assert.deepEqual(listed.skills, []);
    });
  });

  test("installs Kimi Code and ZCode skills under their user-level roots", async () => {
    await withTempHome(async (homeDir) => {
      const cases = [
        {
          platform: "kimi-code",
          home: path.join(homeDir, ".kimi-code"),
          envKey: "KIMI_CODE_HOME",
          customHome: path.join(homeDir, "kimi-code-custom"),
        },
        {
          platform: "zcode",
          home: path.join(homeDir, ".zcode"),
          envKey: "ZCODE_DATA_BASE_DIR",
          customHome: path.join(homeDir, "zcode-data"),
        },
      ] as const;

      for (const item of cases) {
        const defaultListing = await getCliSkillsList(item.platform);
        assert.equal(defaultListing.directory, path.join(item.home, "skills"));

        process.env[item.envKey] = item.customHome;
        const customListing = await getCliSkillsList(item.platform);
        const expectedDirectory = item.platform === "zcode"
          ? path.join(item.customHome, ".zcode", "skills")
          : path.join(item.customHome, "skills");
        assert.equal(customListing.directory, expectedDirectory);

        const sourceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), `sinitek-${item.platform}-skill-`));
        try {
          const source = await writeSkill(sourceRoot, "market-skill", item.platform);
          await installCliSkillDirectory(item.platform, "market-skill", source);
          const installed = await getCliSkillsList(item.platform);
          assert.equal(installed.directory, expectedDirectory);
          assert.deepEqual(installed.skills.map((skill) => skill.name), ["market-skill"]);
          assert.equal(fs.existsSync(path.join(expectedDirectory, "market-skill", "SKILL.md")), true);
        } finally {
          await fs.promises.rm(sourceRoot, { recursive: true, force: true });
        }
      }
    });
  });

  test("respects GROK_HOME and does not list bundled skills", async () => {
    await withTempHome(async () => {
      const custom = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-home-"));
      process.env.GROK_HOME = custom;
      try {
        await writeSkill(path.join(custom, "bundled", "skills"), "bundled-only", "bundled");
        await writeSkill(path.join(custom, "skills"), "user-only", "user");
        const listed = await getCliSkillsList("grok");
        assert.equal(listed.directory, path.join(custom, "skills"));
        assert.deepEqual(listed.skills.map((skill) => skill.name), ["user-only"]);
        assert.equal(listed.displayDirectory, path.join(custom, "skills"));
      } finally {
        delete process.env.GROK_HOME;
        await fs.promises.rm(custom, { recursive: true, force: true });
      }
    });
  });

  test("resolves DSH skills under DSH_HOME for macOS, Linux, and Windows", () => {
    const home = path.join(path.sep, "Users", "tester");
    assert.equal(
      resolveDshGlobalSkillsDirectory({}, home, "darwin"),
      path.join(home, ".dsh", "skills"),
    );
    assert.equal(
      resolveDshGlobalSkillsDirectory({}, home, "linux"),
      path.join(home, ".dsh", "skills"),
    );
    assert.equal(
      resolveDshGlobalSkillsDirectory({ DSH_HOME: "~/.dsh-custom" }, home, "darwin"),
      path.join(home, ".dsh-custom", "skills"),
    );
    assert.equal(
      resolveDshGlobalSkillsDirectory({ DSH_HOME: "   " }, home, "linux"),
      path.join(home, ".dsh", "skills"),
    );
    const windowsEnv = { DSH_HOME: "%USERPROFILE%\\dsh-home", USERPROFILE: "/Users/tester" };
    const windowsHome = resolveDshHomeDir(windowsEnv, home, "win32");
    assert.equal(windowsHome.includes("%USERPROFILE%"), false);
    assert.equal(windowsHome.includes("dsh-home"), true);
    assert.equal(resolveDshGlobalSkillsDirectory(windowsEnv, home, "win32"), path.join(windowsHome, "skills"));
    assert.equal(resolveDshGlobalRulesPath(windowsEnv, home, "win32"), path.join(windowsHome, "AGENTS.md"));
    assert.equal(resolveDshGlobalRulesPath({}, home, "linux"), path.join(home, ".dsh", "AGENTS.md"));
  });

  test("lists, copies, and replaces DSH skills without moving other CLI roots", async () => {
    await withTempHome(async (homeDir) => {
      const customHome = path.join(path.dirname(homeDir), "dsh-custom");
      process.env.DSH_HOME = customHome;
      const secret = "sk-fixturekey123456";
      process.env.SINITEK_DSH_API_KEY = secret;
      const root = path.join(customHome, "skills");
      await writeSkill(root, "demo", "from dsh");
      await fs.promises.writeFile(path.join(root, "demo", "SKILL.md"), `---\ndescription: from dsh\n---\n${secret}\n`, "utf8");
      const listed = await getCliSkillsList("dsh");
      assert.equal(listed.directory, root);
      assert.equal(listed.displayDirectory, root);
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["demo"]);
      assert.equal(listed.skills[0]?.description, "from dsh");
      assert.equal(JSON.stringify(listed).includes(secret), false);

      const claude = await getCliSkillsList("claude");
      const codex = await getCliSkillsList("codex");
      const opencode = await getCliSkillsList("opencode");
      const grok = await getCliSkillsList("grok");
      assert.equal(claude.directory, path.join(homeDir, ".claude", "skills"));
      assert.equal(codex.directory, path.join(homeDir, ".codex", "skills"));
      assert.equal(opencode.directory, path.join(homeDir, ".config", "opencode", "skills"));
      assert.equal(grok.directory, path.join(homeDir, ".grok", "skills"));

      await copyCliSkill("dsh", "demo", "claude");
      assert.equal(fs.existsSync(path.join(homeDir, ".claude", "skills", "demo", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(root, "demo", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(homeDir, ".codex", "skills")), false);
      assert.equal(fs.existsSync(path.join(homeDir, ".grok", "skills")), false);

      const replacement = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-skill-src-"));
      try {
        await writeSkill(replacement, "demo", "replaced");
        await fs.promises.writeFile(path.join(root, "demo", "old-note.txt"), "keep-until-replace\n", "utf8");
        assert.equal(await installCliSkillDirectory("dsh", "demo", path.join(replacement, "demo")), "installed");
        assert.equal(fs.existsSync(path.join(root, "demo", "old-note.txt")), false);
        assert.match(await fs.promises.readFile(path.join(root, "demo", "SKILL.md"), "utf8"), /replaced/);
        assert.equal(fs.existsSync(path.join(root, ".demo.sinitek-replacing")), false);
      } finally {
        await fs.promises.rm(replacement, { recursive: true, force: true });
      }
    });
  });

  test("rolls back a failed DSH skill replacement and does not leak secrets", async () => {
    if (process.platform === "win32") {
      return;
    }
    await withTempHome(async (homeDir) => {
      const secret = "sk-fixturekey123456";
      process.env.DSH_HOME = homeDir;
      process.env.SINITEK_DSH_API_KEY = secret;
      const root = path.join(homeDir, "skills");
      await writeSkill(root, "demo", "original");
      await fs.promises.writeFile(path.join(root, "demo", "marker.txt"), "original-marker", "utf8");
      const source = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-dsh-skill-fail-"));
      const sourceSkill = path.join(source, "demo");
      await writeSkill(sourceSkill, "nested", "ignored");
      await fs.promises.writeFile(
        path.join(source, "demo", "SKILL.md"),
        `---\ndescription: next\n---\n${secret}\n`,
        "utf8",
      );
      const socketName = `blocked-${secret}.sock`;
      const server = net.createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(path.join(source, "demo", socketName), () => resolve());
        });
        await assert.rejects(
          () => installCliSkillDirectory("dsh", "demo", path.join(source, "demo")),
          (error: Error) => {
            assert.equal(error.message.includes(secret), false);
            assert.match(error.message, /\[redacted\]/);
            return true;
          },
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await fs.promises.rm(source, { recursive: true, force: true });
      }
      assert.equal(await fs.promises.readFile(path.join(root, "demo", "marker.txt"), "utf8"), "original-marker");
      assert.equal(fs.existsSync(path.join(root, "demo", socketName)), false);
      assert.equal(fs.existsSync(path.join(root, ".demo.sinitek-replacing")), false);
      assert.equal(fs.existsSync(path.join(homeDir, ".claude", "skills")), false);
    });
  });

  test("keeps DSH rules on disk and does not inject them into prompts", () => {
    const home = path.join(path.sep, "Users", "tester");
    const rules = "UNIQUE_DSH_RULE_SENTINEL_do_not_inject";
    assert.equal(resolveDshGlobalRulesPath({ DSH_HOME: home }, home, "linux"), path.join(home, "AGENTS.md"));
    const promptSource = fs.readFileSync(path.join(process.cwd(), "src/promptRuntime.ts"), "utf8");
    assert.equal(promptSource.includes("AGENTS.md"), false);
    assert.equal(promptSource.includes(rules), false);
    const params = buildDshSessionPromptParams("session-1", "do the task");
    assert.deepEqual(params.prompt, [{ type: "text", text: "do the task" }]);
    assert.equal(JSON.stringify(params).includes(rules), false);
    assert.equal(readDshUnsupportedCapability("explicitSkillsApi").supported, false);
    assert.match(readDshUnsupportedCapability("explicitSkillsApi").reason, /<DSH_HOME>\/skills/);
    assert.equal(readDshUnsupportedCapability("nativeCompaction").supported, false);
    assert.match(readDshUnsupportedCapability("nativeCompaction").reason, /compactSession/);
    const turnSource = fs.readFileSync(path.join(process.cwd(), "src/extensionHost/interactiveTurnDsh.ts"), "utf8");
    assert.match(turnSource, /runner\.prompt\(port\.attemptPrompt/);
    assert.equal(turnSource.includes("AGENTS.md"), false);
  });
});
