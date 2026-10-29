import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import test = require("node:test");
import * as zlib from "zlib";

import {
  installLocalSkillZip,
  installLocalSkillZipFromPath,
  installLobehubSkill,
  searchLobehubSkills,
} from "../../config/lobehubSkillMarket";
import { t } from "../../i18n";

const originalHomedir = os.homedir;
const originalCodexHome = process.env.CODEX_HOME;
const originalCodexHomeDir = process.env.CODEX_HOME_DIR;
const originalGrokHome = process.env.GROK_HOME;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalDshHome = process.env.DSH_HOME;
const originalKimiCodeHome = process.env.KIMI_CODE_HOME;
const originalZcodeDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
const originalDshApiKey = process.env.SINITEK_DSH_API_KEY;

type ZipEntry = {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  flags?: number;
  versionMadeBy?: number;
  externalAttributes?: number;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = (crc & 1) !== 0 ? 0xedb88320 : 0;
      crc = (crc >>> 1) ^ mask;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const stored = method === 8 ? zlib.deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, stored]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionMadeBy ?? 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

function skillMarkdown(name: string, description: string): Buffer {
  return Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}

function zipResponse(body: Buffer, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/zip", ...headers },
  });
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-lobehub-market-"));
  const homeDir = path.join(temp, "home");
  await fs.promises.mkdir(homeDir, { recursive: true });
  Object.defineProperty(os, "homedir", { configurable: true, value: () => homeDir });
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
    Object.defineProperty(os, "homedir", { configurable: true, value: originalHomedir });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalCodexHomeDir === undefined) delete process.env.CODEX_HOME_DIR;
    else process.env.CODEX_HOME_DIR = originalCodexHomeDir;
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    if (originalDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = originalDshHome;
    if (originalKimiCodeHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = originalKimiCodeHome;
    if (originalZcodeDataBaseDir === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = originalZcodeDataBaseDir;
    if (originalDshApiKey === undefined) delete process.env.SINITEK_DSH_API_KEY;
    else process.env.SINITEK_DSH_API_KEY = originalDshApiKey;
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}

test("config page exposes the LobeHub skills market beside import", () => {
  const uiSource = fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-ui.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-api.js"), "utf8");
  const importAt = uiSource.indexOf('onClick: openImportModal, children: "导入"');
  const marketAt = uiSource.indexOf('children: "Skills 市场"');
  assert.ok(importAt >= 0);
  assert.ok(marketAt > importAt);
  assert.match(uiSource, /searchLobehubSkills\(\{ query: nextQuery, page: nextPage \}\)/);
  assert.match(uiSource, /installLobehubSkill\(\{[\s\S]*?identifier: selected\.identifier/);
  assert.match(uiSource, /installLocalSkillZip\(\)/);
  assert.match(uiSource, /上传 ZIP 并选择 CLI/);
  assert.match(uiSource, /ZIP 内单个顶层目录作为技能目录/);
  assert.match(uiSource, /根目录含 SKILL\.md 时使用 ZIP 文件名/);
  assert.match(uiSource, /安装到 CLI（可多选）/);
  assert.match(uiSource, /sinitek-cli-skills-installed/);
  const installStart = uiSource.indexOf("const confirmInstall = async () => {");
  const installEnd = uiSource.indexOf("return be.jsx(xr,", installStart);
  const installBody = uiSource.slice(installStart, installEnd);
  assert.ok(installStart >= 0 && installEnd > installStart);
  assert.doesNotMatch(installBody, /onClose\(/);
  assert.match(installBody, /setSelectedId\(""\)/);
  assert.match(installBody, /setSelectedTargets\(\[\]\)/);
  assert.match(apiSource, /searchLobehubSkills = async \(payload\)/);
  assert.match(apiSource, /installLobehubSkill = async \(payload\)/);
  assert.match(apiSource, /installLocalSkillZip = async \(\)/);
});

test("installs local ZIP skills from a single wrapper directory or archive root", async () => {
  await withTempHome(async (homeDir) => {
    const wrappedZip = createZip([
      { name: "skill-folder/SKILL.md", data: skillMarkdown("frontmatter-name", "Wrapped skill"), method: 8 },
      { name: "skill-folder/scripts/run.js", data: Buffer.from("console.log('wrapped')\n", "utf8") },
    ]);
    const wrapped = await installLocalSkillZip(
      { platforms: ["opencode", "grok"] },
      { fileName: "unrelated-archive.zip", zipBytes: wrappedZip },
    );
    assert.deepEqual(wrapped.skills.map((skill) => skill.name), ["skill-folder"]);
    assert.deepEqual(wrapped.targets.map((target) => target.platform), ["opencode", "grok"]);
    assert.ok(wrapped.targets.every((target) => target.status === "installed"));
    assert.equal(
      await fs.promises.readFile(path.join(homeDir, ".config", "opencode", "skills", "skill-folder", "scripts", "run.js"), "utf8"),
      "console.log('wrapped')\n",
    );
    assert.equal(
      fs.existsSync(path.join(homeDir, ".config", "opencode", "skills", "unrelated-archive")),
      false,
    );

    const flatZip = createZip([
      { name: "SKILL.md", data: skillMarkdown("ignored-frontmatter", "Flat skill"), method: 8 },
      { name: "references/guide.md", data: Buffer.from("guide\n", "utf8") },
    ]);
    const flat = await installLocalSkillZip(
      { platforms: ["dsh"] },
      { fileName: "flat-skill.zip", zipBytes: flatZip },
    );
    assert.deepEqual(flat.skills.map((skill) => skill.name), ["flat-skill"]);
    assert.equal(flat.targets[0].status, "installed");
    assert.equal(
      await fs.promises.readFile(path.join(homeDir, ".dsh", "skills", "flat-skill", "references", "guide.md"), "utf8"),
      "guide\n",
    );

    const localZipPath = path.join(homeDir, "from-file.ZIP");
    await fs.promises.writeFile(localZipPath, flatZip);
    const fromPath = await installLocalSkillZipFromPath({ platforms: ["zcode"] }, localZipPath);
    assert.equal(fromPath.skills[0].name, "from-file");
    assert.equal(fromPath.targets[0].status, "installed");
    assert.equal(
      await fs.promises.readFile(path.join(homeDir, ".zcode", "skills", "from-file", "SKILL.md"), "utf8"),
      skillMarkdown("ignored-frontmatter", "Flat skill").toString("utf8"),
    );
  });
});

test("rejects unsafe or ambiguous local ZIP skill packages", async () => {
  await withTempHome(async () => {
    const validZip = createZip([{ name: "SKILL.md", data: skillMarkdown("name", "Description") }]);
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, { fileName: "not-a-zip.txt", zipBytes: validZip }),
      { message: t("skill.market.invalidLocalZip") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, { fileName: "corrupt.zip", zipBytes: Buffer.from("nope") }),
      { message: t("skill.market.badZip") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, {
        fileName: ".zip",
        zipBytes: validZip,
      }),
      { message: t("skill.market.invalidLocalZipName") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, {
        fileName: "bad-layout.zip",
        zipBytes: createZip([
          { name: "one/SKILL.md", data: skillMarkdown("one", "One") },
          { name: "two/SKILL.md", data: skillMarkdown("two", "Two") },
        ]),
      }),
      { message: t("skill.market.localZipLayout") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, {
        fileName: "missing-skill.zip",
        zipBytes: createZip([{ name: "README.md", data: Buffer.from("no skill", "utf8") }]),
      }),
      { message: t("skill.market.localZipLayout") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: ["claude"] }, {
        fileName: "escape.zip",
        zipBytes: createZip([{ name: "../SKILL.md", data: skillMarkdown("escape", "Bad") }]),
      }),
      { message: t("skill.market.badZip") },
    );
    await assert.rejects(
      () => installLocalSkillZip({ platforms: [] }, { fileName: "skill.zip", zipBytes: validZip }),
      { message: t("skill.market.invalidPlatforms") },
    );
  });
});

test("searches the public LobeHub skills market", async () => {
  const calls: string[] = [];
  const page = await searchLobehubSkills(
    { query: " pdf ", page: 2 },
    {
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({
          currentPage: 2,
          pageSize: 21,
          totalCount: 40,
          totalPages: 2,
          items: [
            {
              identifier: "anthropics-skills-pdf",
              name: "pdf",
              description: "处理 PDF",
              author: "anthropics",
              version: "1.0.5",
              installCount: 12,
              homepage: "https://github.com/anthropics/skills",
            },
            { identifier: "../bad", name: "bad", description: "skip" },
            { identifier: "missing-name" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  );
  const parsed = new URL(calls[0]);
  assert.equal(parsed.origin, "https://lobehub.com");
  assert.equal(parsed.pathname, "/api/discover/skills");
  assert.equal(parsed.searchParams.get("q"), "pdf");
  assert.equal(parsed.searchParams.get("page"), "2");
  assert.equal(parsed.searchParams.get("locale"), "zh");
  assert.equal(page.totalCount, 40);
  assert.deepEqual(page.items, [{
    identifier: "anthropics-skills-pdf",
    name: "pdf",
    description: "处理 PDF",
    author: "anthropics",
    version: "1.0.5",
    installCount: 12,
    homepage: "https://github.com/anthropics/skills",
  }]);
  await assert.rejects(
    () => searchLobehubSkills({ query: "x".repeat(201) }, { fetchImpl: async () => { throw new Error("should not fetch"); } }),
    { message: t("skill.market.invalidQuery") },
  );
  await assert.rejects(
    () => searchLobehubSkills({ page: 0 }, { fetchImpl: async () => { throw new Error("should not fetch"); } }),
    { message: t("skill.market.invalidPage") },
  );
});

test("installs a downloaded skill and replaces an existing directory", async () => {
  await withTempHome(async (homeDir) => {
    const escapeName = `sinitek-lobehub-escape-${Date.now()}.txt`;
    const zip = createZip([
      { name: "SKILL.md", data: skillMarkdown("pdf", "Portable PDF skill"), method: 8 },
      { name: "scripts/extract.py", data: Buffer.from("print('pdf')\n", "utf8") },
      { name: "pack/alpha/SKILL.md", data: skillMarkdown("alpha", "Alpha skill") },
      { name: "pack/beta/SKILL.md", data: skillMarkdown("beta", "Beta skill") },
    ]);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return zipResponse(zip);
    };
    const installed = await installLobehubSkill(
      { identifier: "anthropics-skills-pdf", platforms: ["claude", "claude", "codex"] },
      { fetchImpl },
    );
    assert.deepEqual(calls, ["https://market.lobehub.com/api/v1/skills/anthropics-skills-pdf/download"]);
    assert.deepEqual(installed.skills.map((skill) => skill.name), ["alpha", "beta", "pdf"]);
    assert.equal(installed.skills.find((skill) => skill.name === "pdf")?.description, "Portable PDF skill");
    assert.equal(installed.targets.filter((target) => target.status === "installed").length, 6);
    const claudePdfDir = path.join(homeDir, ".claude", "skills", "pdf");
    const claudePdf = path.join(claudePdfDir, "scripts", "extract.py");
    const codexAlphaDir = path.join(homeDir, ".codex", "skills", "alpha");
    const codexAlpha = path.join(codexAlphaDir, "SKILL.md");
    assert.equal(await fs.promises.readFile(claudePdf, "utf8"), "print('pdf')\n");
    assert.match(await fs.promises.readFile(codexAlpha, "utf8"), /Alpha skill/);
    await fs.promises.writeFile(path.join(claudePdfDir, "old-note.txt"), "stale\n", "utf8");
    const external = path.join(homeDir, "external-pdf");
    await fs.promises.mkdir(external, { recursive: true });
    await fs.promises.writeFile(path.join(external, "marker.txt"), "keep\n", "utf8");
    await fs.promises.symlink(path.join(external, "marker.txt"), path.join(claudePdfDir, "outside-link"));
    await fs.promises.rm(codexAlphaDir, { recursive: true, force: true });
    await fs.promises.symlink(external, codexAlphaDir, "dir");

    const again = await installLobehubSkill(
      { identifier: "anthropics-skills-pdf", platforms: ["claude", "codex"] },
      { fetchImpl },
    );
    assert.ok(again.targets.every((target) => target.status === "installed"));
    assert.equal(fs.existsSync(path.join(claudePdfDir, "old-note.txt")), false);
    assert.equal(await fs.promises.readFile(claudePdf, "utf8"), "print('pdf')\n");
    assert.equal(await fs.promises.readFile(path.join(external, "marker.txt"), "utf8"), "keep\n");
    const replacedAlpha = await fs.promises.lstat(codexAlphaDir);
    assert.equal(replacedAlpha.isSymbolicLink(), false);
    assert.equal(replacedAlpha.isDirectory(), true);
    assert.match(await fs.promises.readFile(codexAlpha, "utf8"), /Alpha skill/);

    const escapeZip = createZip([{ name: `../${escapeName}`, data: Buffer.from("nope", "utf8") }]);
    await assert.rejects(
      () => installLobehubSkill({ identifier: "escape-skill", platforms: ["grok"] }, { fetchImpl: async () => zipResponse(escapeZip) }),
      { message: t("skill.market.badZip") },
    );
    assert.equal(fs.existsSync(path.join(os.tmpdir(), escapeName)), false);

    const symlinkZip = createZip([{
      name: "SKILL.md",
      data: Buffer.from("link", "utf8"),
      versionMadeBy: (3 << 8) | 20,
      externalAttributes: (0o120777 << 16) >>> 0,
    }]);
    await assert.rejects(
      () => installLobehubSkill({ identifier: "symlink-skill", platforms: ["opencode"] }, { fetchImpl: async () => zipResponse(symlinkZip) }),
      { message: t("skill.market.badZip") },
    );
    assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "skills", "SKILL.md")), false);

    const emptyZip = createZip([{ name: "README.md", data: Buffer.from("hello", "utf8") }]);
    await assert.rejects(
      () => installLobehubSkill({ identifier: "empty-skill", platforms: ["claude"] }, { fetchImpl: async () => zipResponse(emptyZip) }),
      { message: t("skill.market.noSkill") },
    );

    await assert.rejects(
      () => installLobehubSkill({ identifier: "../bad", platforms: ["claude"] }, { fetchImpl: async () => { throw new Error("should not fetch"); } }),
      { message: t("skill.market.invalidIdentifier") },
    );
    await assert.rejects(
      () => installLobehubSkill({ identifier: "ok-skill", platforms: [] }, { fetchImpl: async () => { throw new Error("should not fetch"); } }),
      { message: t("skill.market.invalidPlatforms") },
    );

    let downloadCalls = 0;
    await assert.rejects(
      () => installLobehubSkill(
        { identifier: "redirect-skill", platforms: ["claude"] },
        {
          fetchImpl: async () => {
            downloadCalls += 1;
            return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/skill.zip" } });
          },
        },
      ),
      { message: t("skill.market.downloadFailed", { error: "不允许的地址" }) },
    );
    assert.equal(downloadCalls, 1);

    await assert.rejects(
      () => installLobehubSkill(
        { identifier: "large-skill", platforms: ["claude"] },
        { fetchImpl: async () => zipResponse(zip), maxZipBytes: 32 },
      ),
      { message: t("skill.market.tooLarge") },
    );
  });
});

test("installs a market skill to every non-Claude/Codex user skills root", async () => {
  await withTempHome(async (homeDir) => {
    const secret = "sk-fixturekey123456";
    process.env.XDG_CONFIG_HOME = path.join(homeDir, "xdg-config");
    process.env.GROK_HOME = path.join(homeDir, "grok-home");
    process.env.DSH_HOME = path.join(homeDir, "dsh-home");
    process.env.KIMI_CODE_HOME = path.join(homeDir, "kimi-home");
    process.env.ZCODE_DATA_BASE_DIR = path.join(homeDir, "zcode-data");
    process.env.SINITEK_DSH_API_KEY = secret;
    const zip = createZip([
      { name: "SKILL.md", data: skillMarkdown("pdf", "DSH PDF skill"), method: 8 },
      { name: "scripts/extract.py", data: Buffer.from("print('dsh')\n", "utf8") },
    ]);
    const opencodeSkill = path.join(homeDir, "xdg-config", "opencode", "skills", "pdf");
    const grokSkill = path.join(homeDir, "grok-home", "skills", "pdf");
    const dshSkill = path.join(homeDir, "dsh-home", "skills", "pdf");
    const kimiSkill = path.join(homeDir, "kimi-home", "skills", "pdf");
    const zcodeSkill = path.join(homeDir, "zcode-data", ".zcode", "skills", "pdf");
    await fs.promises.mkdir(dshSkill, { recursive: true });
    await fs.promises.writeFile(path.join(dshSkill, "old-note.txt"), "stale\n", "utf8");
    const installed = await installLobehubSkill(
      { identifier: "dsh-pdf", platforms: ["opencode", "grok", "dsh", "dsh", "kimi-code", "zcode"] },
      { fetchImpl: async () => zipResponse(zip) },
    );
    assert.deepEqual(installed.targets.map((target) => target.platform), ["opencode", "grok", "dsh", "kimi-code", "zcode"]);
    assert.ok(installed.targets.every((target) => target.status === "installed"));
    assert.equal(installed.targets.find((target) => target.platform === "dsh")?.message, undefined);
    assert.equal(JSON.stringify(installed).includes(secret), false);
    assert.equal(fs.existsSync(path.join(dshSkill, "old-note.txt")), false);
    assert.equal(await fs.promises.readFile(path.join(dshSkill, "scripts", "extract.py"), "utf8"), "print('dsh')\n");
    assert.equal(await fs.promises.readFile(path.join(opencodeSkill, "SKILL.md"), "utf8"), skillMarkdown("pdf", "DSH PDF skill").toString("utf8"));
    assert.equal(await fs.promises.readFile(path.join(grokSkill, "SKILL.md"), "utf8"), skillMarkdown("pdf", "DSH PDF skill").toString("utf8"));
    assert.equal(await fs.promises.readFile(path.join(kimiSkill, "SKILL.md"), "utf8"), skillMarkdown("pdf", "DSH PDF skill").toString("utf8"));
    assert.equal(await fs.promises.readFile(path.join(zcodeSkill, "SKILL.md"), "utf8"), skillMarkdown("pdf", "DSH PDF skill").toString("utf8"));
    assert.equal(fs.existsSync(path.join(homeDir, ".claude", "skills")), false);
    assert.equal(fs.existsSync(path.join(homeDir, ".codex", "skills")), false);
    assert.equal(fs.existsSync(path.join(homeDir, ".grok", "skills")), false);
    assert.equal(fs.existsSync(path.join(homeDir, ".config", "opencode", "skills")), false);
    await assert.rejects(
      () => installLobehubSkill(
        { identifier: "dsh-pdf", platforms: ["gemini"] },
        { fetchImpl: async () => { throw new Error(secret); } },
      ),
      (error: Error) => {
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message, t("skill.global.invalidPlatform"));
        return true;
      },
    );
  });
});
