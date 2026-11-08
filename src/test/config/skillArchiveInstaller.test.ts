import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import test = require("node:test");
import * as cliGlobalSkills from "../../config/cliGlobalSkills";
import * as facade from "../../config/lobehubSkillMarket";
import type {
  LocalSkillZipOptions,
  LobehubSkillInstallResult,
  LobehubSkillInstallTarget,
  LobehubSkillMarketItem,
  LobehubSkillMarketOptions,
  LobehubSkillMarketPage,
} from "../../config/lobehubSkillMarket";
import * as local from "../../config/localSkillZip";
import { installSkillArchive, MAX_SKILL_ZIP_BYTES, SkillMarketError } from "../../config/skillArchiveInstaller";
import { t } from "../../i18n";
import { createZip, skillMarkdown, withTempHome, zipResponse } from "./skillArchiveFixtures";

const nonportableSkillNames = ["CON", "aux.txt", "LPT9", "bad:name", "trailing.", "trailing ", "bad..name"];

async function observeArchiveTemps(context: test.TestContext, run: (roots: string[]) => Promise<void>): Promise<void> {
  const roots: string[] = [];
  const original = fs.promises.mkdtemp;
  const mock = context.mock.method(fs.promises, "mkdtemp", async (prefix: string) => {
    const root = await original(prefix);
    if (/^sinitek-(?:local|lobehub)-skill-/.test(path.basename(prefix))) {
      roots.push(root);
    }
    return root;
  });
  try {
    await run(roots);
  } finally {
    mock.mock.restore();
    for (const root of roots) {
      assert.equal(fs.existsSync(root), false, `temporary archive remains: ${root}`);
    }
  }
}

test("keeps the old facade runtime exports and all exported type contracts", async () => {
  const options: LocalSkillZipOptions = { fileName: "compat.zip", zipBytes: createZip([]) };
  const marketOptions: LobehubSkillMarketOptions = { maxZipBytes: MAX_SKILL_ZIP_BYTES };
  const item: LobehubSkillMarketItem = { identifier: "compat", name: "compat", description: "" };
  const page: LobehubSkillMarketPage = { query: "", items: [item], currentPage: 1, pageSize: 1, totalCount: 1, totalPages: 1 };
  const target: LobehubSkillInstallTarget = { platform: "claude", name: item.name, status: "failed" };
  const result: LobehubSkillInstallResult = { identifier: item.identifier, skills: [{ name: item.name }], targets: [target] };
  assert.equal(result.identifier, page.items[0].identifier);
  assert.equal(marketOptions.maxZipBytes, 32 * 1024 * 1024);
  assert.deepEqual(Object.keys(facade).sort(), [
    "MAX_SKILL_ZIP_BYTES", "installLocalSkillZip", "installLocalSkillZipFromPath", "installLobehubSkill", "searchLobehubSkills",
  ].sort());
  assert.equal(facade.installLocalSkillZip, local.installLocalSkillZip);
  assert.equal(facade.installLocalSkillZipFromPath, local.installLocalSkillZipFromPath);
  assert.equal(facade.MAX_SKILL_ZIP_BYTES, MAX_SKILL_ZIP_BYTES);
  const pending = facade.installLocalSkillZip({ platforms: [] }, options);
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, { name: "SkillMarketError", message: t("skill.market.invalidPlatforms") });
  const serviceSource = await fs.promises.readFile(path.join(process.cwd(), "src/config/configService.ts"), "utf8");
  assert.match(serviceSource, /export \{\s*searchLobehubSkills,\s*installLobehubSkill,\s*installLocalSkillZip,\s*installLocalSkillZipFromPath,\s*\} from "\.\/lobehubSkillMarket";/);
});

test("prefers local root layout and preserves hidden content rather than filtering installation", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async (roots) => {
    const zip = createZip([
      { name: "SKILL.md", data: skillMarkdown("ignored-frontmatter", "Root description") },
      { name: "wrapper/SKILL.md", data: skillMarkdown("also-ignored", "Nested description") },
      { name: ".hidden/settings.json", data: Buffer.from("hidden") },
      { name: "__MACOSX/metadata", data: Buffer.from("metadata") },
    ]);
    const result = await facade.installLocalSkillZip(
      { platforms: ["codex", "claude", "codex", "claude"] },
      { fileName: "Root-name.ZIP", zipBytes: zip },
    );
    assert.deepEqual(result, {
      identifier: "Root-name",
      skills: [{ name: "Root-name", description: "Root description" }],
      targets: [
        { platform: "codex", name: "Root-name", status: "installed" },
        { platform: "claude", name: "Root-name", status: "installed" },
      ],
    });
    const installed = path.join(homeDir, ".codex", "skills", "Root-name");
    assert.equal(await fs.promises.readFile(path.join(installed, ".hidden", "settings.json"), "utf8"), "hidden");
    assert.equal(await fs.promises.readFile(path.join(installed, "__MACOSX", "metadata"), "utf8"), "metadata");
    assert.ok(fs.existsSync(path.join(installed, "wrapper", "SKILL.md")));
    assert.equal(roots.length, 1);
    assert.match(path.basename(roots[0]), /^sinitek-local-skill-/);
  }));
});

test("uses wrapper directory naming and ignores only layout metadata, not wrapper contents", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async () => {
    const zip = createZip([
      { name: ".metadata", data: Buffer.from("ignored for layout") },
      { name: "__MACOSX/file", data: Buffer.from("ignored for layout") },
      { name: "wrapper-name/SKILL.md", data: Buffer.from("# No description\n") },
      { name: "wrapper-name/.hidden", data: Buffer.from("keep") },
    ]);
    const result = await facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "CON.zip", zipBytes: zip });
    assert.deepEqual(result.skills, [{ name: "wrapper-name" }]);
    assert.equal(result.identifier, "wrapper-name");
    const installed = path.join(homeDir, ".claude", "skills", "wrapper-name");
    assert.equal(await fs.promises.readFile(path.join(installed, ".hidden"), "utf8"), "keep");
    assert.equal(fs.existsSync(path.join(installed, ".metadata")), false);
  }));
});

test("keeps market nested discovery, duplicate names, sorting, fallbacks and missing descriptions", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async (roots) => {
    const zip = createZip([
      { name: "SKILL.md", data: Buffer.from("# Root without name\n") },
      { name: "parent/SKILL.md", data: skillMarkdown("alpha", "Parent") },
      { name: "parent/nested/SKILL.md", data: skillMarkdown("beta", "Nested") },
      { name: "a/SKILL.md", data: skillMarkdown("duplicate", "First") },
      { name: "b/SKILL.md", data: skillMarkdown("duplicate", "Last") },
      { name: "fallback/SKILL.md", data: skillMarkdown("../invalid", "Fallback") },
      { name: ".hidden/SKILL.md", data: skillMarkdown("not-discovered", "Hidden") },
    ]);
    const result = await facade.installLobehubSkill(
      { identifier: "market-id", platforms: ["codex", "claude", "codex"] },
      { fetchImpl: async () => zipResponse(zip), maxZipBytes: zip.length },
    );
    assert.equal(result.identifier, "market-id");
    assert.deepEqual(result.skills, [
      { name: "alpha", description: "Parent" },
      { name: "beta", description: "Nested" },
      { name: "duplicate", description: "First" },
      { name: "duplicate", description: "Last" },
      { name: "fallback", description: "Fallback" },
      { name: "market-id" },
    ]);
    assert.deepEqual(result.targets, result.skills.flatMap(({ name }) => [
      { platform: "codex", name, status: "installed" },
      { platform: "claude", name, status: "installed" },
    ]));
    assert.match(await fs.promises.readFile(path.join(homeDir, ".codex", "skills", "duplicate", "SKILL.md"), "utf8"), /Last/);
    assert.equal(roots.length, 1);
    assert.match(path.basename(roots[0]), /^sinitek-lobehub-skill-/);
  }));
});

test("does not apply local portable names to market frontmatter", async () => {
  await withTempHome(async (homeDir) => {
    await fs.promises.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fs.promises.writeFile(path.join(homeDir, ".claude", "skills"), "blocked");
    const zip = createZip([{ name: "skill/SKILL.md", data: skillMarkdown("CON", "Market name") }]);
    const result = await facade.installLobehubSkill(
      { identifier: "market-id", platforms: ["claude"] }, { fetchImpl: async () => zipResponse(zip) },
    );
    assert.deepEqual(result.skills, [{ name: "CON", description: "Market name" }]);
    assert.equal(result.targets[0].name, "CON");
    assert.equal(result.targets[0].status, "failed");
    assert.ok(result.targets[0].message);
  });
});

test("continues per-target failures and returns results even when every target fails", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async (roots) => {
    await fs.promises.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.promises.writeFile(path.join(homeDir, ".codex", "skills"), "blocked");
    const zip = createZip([
      { name: "b/SKILL.md", data: skillMarkdown("beta", "Beta") },
      { name: "a/SKILL.md", data: skillMarkdown("alpha", "Alpha") },
    ]);
    const partial = await facade.installLobehubSkill(
      { identifier: "partial", platforms: ["codex", "claude", "codex"] }, { fetchImpl: async () => zipResponse(zip) },
    );
    assert.deepEqual(partial.targets.map(({ name, platform, status }) => ({ name, platform, status })), [
      { name: "alpha", platform: "codex", status: "failed" },
      { name: "alpha", platform: "claude", status: "installed" },
      { name: "beta", platform: "codex", status: "failed" },
      { name: "beta", platform: "claude", status: "installed" },
    ]);
    assert.ok(partial.targets.filter(({ status }) => status === "failed").every(({ message }) => !!message?.trim()));
    const failed = await facade.installLobehubSkill(
      { identifier: "failed", platforms: ["codex"] }, { fetchImpl: async () => zipResponse(zip) },
    );
    assert.deepEqual(failed.targets.map(({ status }) => status), ["failed", "failed"]);
    const localFailed = await facade.installLocalSkillZip(
      { platforms: ["codex"] }, { fileName: "local.zip", zipBytes: createZip([{ name: "SKILL.md", data: Buffer.from("# Local") }]) },
    );
    assert.deepEqual(localFailed.skills, [{ name: "local" }]);
    assert.equal(localFailed.targets[0].status, "failed");
    assert.ok(localFailed.targets[0].message);
    assert.equal(roots.length, 3);
  }));
});

test("rejects empty or invalid layouts with shared errors and always cleans extracted archives", async (context) => {
  await withTempHome(async () => observeArchiveTemps(context, async (roots) => {
    for (const entries of [[], [{ name: "README.md", data: Buffer.from("empty") }]]) {
      const zip = createZip(entries);
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "empty.zip", zipBytes: zip }),
        (error: unknown) => error instanceof SkillMarketError && error.message === t("skill.market.localZipLayout"));
      await assert.rejects(facade.installLobehubSkill({ identifier: "empty", platforms: ["claude"] }, { fetchImpl: async () => zipResponse(zip) }),
        (error: unknown) => error instanceof SkillMarketError && error.message === t("skill.market.noSkill"));
    }
    await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "broken.zip", zipBytes: Buffer.from("invalid") }),
      (error: unknown) => error instanceof SkillMarketError && error.name === "SkillMarketError" && error.message === t("skill.market.badZip"));
    await assert.rejects(facade.searchLobehubSkills({ query: 3 }),
      (error: unknown) => error instanceof SkillMarketError && error.message === t("skill.market.invalidQuery"));
    assert.equal(roots.length, 5);
  }));
});

test("rejects nonportable local root file names without creating those paths", async (context) => {
  await withTempHome(async () => observeArchiveTemps(context, async (roots) => {
    for (const name of nonportableSkillNames) {
      const root = createZip([{ name: "SKILL.md", data: skillMarkdown("valid-name", "Ignored") }]);
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: `${name}.zip`, zipBytes: root }),
        { name: "SkillMarketError", message: t("skill.market.invalidLocalZipName") });
    }
    assert.equal(roots.length, nonportableSkillNames.length);
  }));
});

test("rejects nonportable wrapper names reported by archive discovery", async (context) => {
  await withTempHome(async () => observeArchiveTemps(context, async (roots) => {
    const zipBytes = createZip([{ name: "wrapper-name/SKILL.md", data: skillMarkdown("valid-name", "Ignored") }]);
    const originalReaddir = fs.promises.readdir;
    for (const name of nonportableSkillNames) {
      let injected = 0;
      const archiveIndex = roots.length;
      const mock = context.mock.method(fs.promises, "readdir", async (...args: Parameters<typeof originalReaddir>) => {
        const entries = await originalReaddir(...args);
        if (args[0] === roots[archiveIndex]) {
          assert.equal(entries.length, 1);
          injected += 1;
          return entries.map((entry) => Object.assign(Object.create(entry), { name }));
        }
        return entries;
      });
      try {
        await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "valid.zip", zipBytes }),
          { name: "SkillMarketError", message: t("skill.market.localZipLayout") });
        assert.equal(injected, 1);
        assert.equal(roots.length, archiveIndex + 1);
      } finally {
        mock.mock.restore();
      }
    }
  }));
});

test("rejects a portable filesystem wrapper name disallowed by the business rule", async (context) => {
  await withTempHome(async () => observeArchiveTemps(context, async (roots) => {
    const zipBytes = createZip([{ name: "bad..name/SKILL.md", data: skillMarkdown("valid-name", "Ignored") }]);
    await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "valid.zip", zipBytes }),
      { name: "SkillMarketError", message: t("skill.market.localZipLayout") });
    assert.equal(roots.length, 1);
  }));
});

test("maps archive mkdir rejection to badZip without installing and cleans the temporary archive", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async (roots) => {
    const zipBytes = createZip([{ name: "wrapper-name/SKILL.md", data: skillMarkdown("valid-name", "Ignored") }]);
    const originalMkdir = fs.promises.mkdir;
    const originalInstall = cliGlobalSkills.installCliSkillDirectory;
    let refused = 0;
    let installCalls = 0;
    const mkdirMock = context.mock.method(fs.promises, "mkdir", async (...args: Parameters<typeof originalMkdir>) => {
      if (roots.length === 1 && args[0] === path.join(roots[0], "wrapper-name")) {
        refused += 1;
        throw Object.assign(new Error("simulated archive filesystem refusal"), { code: "EACCES" });
      }
      return originalMkdir(...args);
    });
    const installMock = context.mock.method(cliGlobalSkills, "installCliSkillDirectory", async (...args: Parameters<typeof originalInstall>) => {
      if (roots.length === 1 && args[2] === path.join(roots[0], "wrapper-name")) {
        installCalls += 1;
      }
      return originalInstall(...args);
    });
    try {
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "valid.zip", zipBytes }),
        (error: unknown) => error instanceof SkillMarketError && error.name === "SkillMarketError" && error.message === t("skill.market.badZip"));
      assert.equal(refused, 1);
      assert.equal(installCalls, 0);
      assert.equal(installMock.mock.callCount(), 0);
      assert.equal(roots.length, 1);
      assert.equal(fs.existsSync(roots[0]), false);
      assert.deepEqual(await fs.promises.readdir(homeDir), []);
    } finally {
      installMock.mock.restore();
      mkdirMock.mock.restore();
    }
  }));
});

test("keeps extension, stat, size, read and platform validation side-effect order for paths", async (context) => {
  await withTempHome(async (homeDir) => observeArchiveTemps(context, async (roots) => {
    const file = path.join(homeDir, "input.zip");
    const zip = createZip([{ name: "SKILL.md", data: Buffer.from("# Input") }]);
    await fs.promises.writeFile(file, zip);
    const events: string[] = [];
    const originalStat = fs.promises.stat;
    const originalRead = fs.promises.readFile;
    context.mock.method(fs.promises, "stat", async (...args: Parameters<typeof originalStat>) => {
      events.push("stat");
      return originalStat(...args);
    });
    context.mock.method(fs.promises, "readFile", async (...args: Parameters<typeof originalRead>) => {
      events.push("read");
      return originalRead(...args);
    });
    await assert.rejects(facade.installLocalSkillZipFromPath({ platforms: [] }, `${file}.txt`), { message: t("skill.market.invalidLocalZip") });
    assert.deepEqual(events, []);
    await assert.rejects(facade.installLocalSkillZipFromPath({ platforms: [] }, file), { message: t("skill.market.invalidPlatforms") });
    assert.deepEqual(events.splice(0), ["stat", "read"]);
    await fs.promises.truncate(file, MAX_SKILL_ZIP_BYTES + 1);
    await assert.rejects(facade.installLocalSkillZipFromPath({ platforms: [] }, file), { message: t("skill.market.tooLarge") });
    assert.deepEqual(events.splice(0), ["stat"]);
    await fs.promises.rm(file);
    await assert.rejects(facade.installLocalSkillZipFromPath({ platforms: [] }, file), { code: "ENOENT" });
    assert.deepEqual(events.splice(0), ["stat"]);
    await fs.promises.mkdir(file);
    await assert.rejects(facade.installLocalSkillZipFromPath({ platforms: [] }, file), { message: t("skill.market.invalidLocalZip") });
    assert.deepEqual(events, ["stat"]);
    assert.equal(roots.length, 0);
  }));
});

test("does not create temporary directories until download or local preprocessing succeeds", async (context) => {
  await observeArchiveTemps(context, async (roots) => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error("offline download failure"); };
    await assert.rejects(facade.installLobehubSkill({ identifier: "ok", platforms: ["invalid"] }, { fetchImpl }),
      { message: t("skill.global.invalidPlatform") });
    assert.equal(calls, 0);
    await assert.rejects(facade.installLobehubSkill({ identifier: "ok", platforms: ["claude"] }, { fetchImpl }),
      { message: t("skill.market.downloadFailed", { error: "offline download failure" }) });
    assert.equal(calls, 1);
    await assert.rejects(facade.installLocalSkillZip({ platforms: [] }, { fileName: "bad.txt", zipBytes: Buffer.alloc(0) }),
      { message: t("skill.market.invalidPlatforms") });
    await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "bad.txt", zipBytes: Buffer.alloc(0) }),
      { message: t("skill.market.invalidLocalZip") });
    const zip = createZip([{ name: "SKILL.md", data: Buffer.from("# Skill") }]);
    await assert.rejects(facade.installLobehubSkill({ identifier: "ok", platforms: ["claude"] }, {
      fetchImpl: async () => zipResponse(zip), maxZipBytes: zip.length - 1,
    }), { message: t("skill.market.tooLarge") });
    assert.equal(roots.length, 0);
  });
});

test("template cleans up after discovery rejects and propagates the original rejection", async (context) => {
  await observeArchiveTemps(context, async (roots) => {
    const expected = new Error("discovery failed");
    await assert.rejects(installSkillArchive({
      zipBytes: createZip([{ name: "SKILL.md", data: Buffer.from("# Skill") }]),
      maxZipBytes: MAX_SKILL_ZIP_BYTES,
      tempPrefix: "sinitek-local-skill-",
      platforms: ["claude"],
      resolvePackages: async (root) => {
        assert.ok(fs.existsSync(path.join(root, "SKILL.md")));
        throw expected;
      },
    }), (error: unknown) => error === expected);
    assert.equal(roots.length, 1);
  });
});

test("template preserves cleanup rejection even after a successful install or discovery failure", async (context) => {
  await withTempHome(async () => observeArchiveTemps(context, async (roots) => {
    const cleanupError = new Error("cleanup failed");
    const original = fs.promises.rm;
    const mock = context.mock.method(fs.promises, "rm", async (target: fs.PathLike, options: fs.RmOptions) => {
      await original(target, options);
      if (path.basename(String(target)).startsWith("sinitek-local-skill-")) {
        throw cleanupError;
      }
    });
    try {
      const zip = createZip([{ name: "SKILL.md", data: Buffer.from("# Skill") }]);
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "success.zip", zipBytes: zip }),
        (error: unknown) => error === cleanupError);
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "empty.zip", zipBytes: createZip([]) }),
        (error: unknown) => error === cleanupError);
      assert.equal(roots.length, 2);
    } finally {
      mock.mock.restore();
    }
  }));
});

test("preserves ZIP entry, encryption, decoding and size guards in the shared extractor", async (context) => {
  await observeArchiveTemps(context, async (roots) => {
    const cases = [
      createZip(Array.from({ length: 501 }, (_, index) => ({ name: `entry-${index}`, data: Buffer.alloc(0) }))),
      createZip([{ name: "SKILL.md", data: Buffer.from("encrypted"), flags: 1 }]),
      createZip([{ name: "SKILL.md", data: Buffer.from("undecodable"), method: 99 as 0 }]),
    ];
    for (const zipBytes of cases) {
      await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "unsafe.zip", zipBytes }),
        { name: "SkillMarketError", message: t("skill.market.badZip") });
    }
    const oversized = createZip([{ name: "SKILL.md", data: Buffer.alloc(16 * 1024 * 1024 + 1), method: 8 }]);
    await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, { fileName: "large.zip", zipBytes: oversized }),
      { message: t("skill.market.tooLarge") });
    await assert.rejects(facade.installLocalSkillZip({ platforms: ["claude"] }, {
      fileName: "large.zip", zipBytes: Buffer.alloc(MAX_SKILL_ZIP_BYTES + 1),
    }), { message: t("skill.market.tooLarge") });
    assert.equal(roots.length, 5);
  });
});
