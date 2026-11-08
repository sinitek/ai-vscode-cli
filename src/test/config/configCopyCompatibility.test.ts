import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as TOML from "@iarna/toml";
import { installVscodeMock } from "../vscodeMock";
import type { ConfigItem, CopyConfigPayload, CurrentConfigPlatform } from "../../config/types";

installVscodeMock();

const platforms: readonly CurrentConfigPlatform[] = ["claude", "codex", "grok", "opencode", "dsh", "kimi-code", "zcode"];
const claudeDocument = { env: { CONTRACT_MODE: "synthetic" } };
const claudeMcp = { mcpServers: { fixture: { command: "synthetic-tool", args: ["--fixture"] } } };
const codexText = '# synthetic contract\nmodel = "synthetic-model"\n[mcp_servers.fixture]\ncommand = "synthetic-tool"\nargs = ["--fixture"]\nenabled = true\n';
const grokText = '# synthetic contract\nmodel = "synthetic-grok"\n';
const kimiText = 'default_model = "synthetic"\ndefault_permission_mode = "manual"\n[providers.fixture]\ntype = "openai"\nbase_url = "https://synthetic.invalid/v1"\napi_key = "placeholder"\n[models.synthetic]\nprovider = "fixture"\nmodel = "synthetic-model"\ncapabilities = ["thinking"]\nsupport_efforts = ["low", "high"]\n';
const dshDocument = {
  schemaVersion: 1, provider: "sinitek-custom", api: "openai-completions",
  apiKey: "placeholder", apiKeyEnv: "SINITEK_DSH_API_KEY", baseURL: "https://synthetic.invalid/v1",
  models: [{ id: "synthetic-model", name: "Synthetic", input: ["text"] }], acpModel: "synthetic-model",
};
const zcodeDocument = {
  schemaVersion: 1,
  config: {
    defaultModelSelection: { providerId: "fixture", modelId: "synthetic-model" },
    providerConfigRules: { providerRules: [{ providerId: "fixture", config: {
      group: "standard-personal", access: { type: "api-key", apiKey: "placeholder" },
      api: { type: "openai-responses", baseUrl: "https://synthetic.invalid/v1" },
      personalModelIds: ["synthetic-model"],
    } }] },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
  },
};
const openCodeText = '{\n// synthetic JSONC source\n"provider": {"fixture": {"models": {"synthetic-model": {},},},},\n"mcpServers": {"fixture": {"command": "synthetic-tool", "args": ["--fixture"],},},\n}\n';
const openCodeDocument = {
  provider: { fixture: { models: { "synthetic-model": {} } } },
  mcp: { fixture: { command: "synthetic-tool", args: ["--fixture"] } },
};

type Service = typeof import("../../config/configService");
type Fixture = {
  root: string;
  service: Service;
  profiles: Record<CurrentConfigPlatform, ConfigItem>;
  file: (platform: CurrentConfigPlatform, id: string) => string;
  write: (profile: ConfigItem) => Promise<void>;
};

function fixtureProfiles(root: string): Record<CurrentConfigPlatform, ConfigItem> {
  const skill = { name: "synthetic-skill", path: path.join(root, "synthetic-skill"), enabled: true };
  const profile = (platform: CurrentConfigPlatform, fields: Partial<ConfigItem>): ConfigItem => ({
    id: `source-${platform}`, name: `原名-${platform}`, platform, createdAt: 11, updatedAt: 22, ...fields,
  });
  return {
    claude: profile("claude", { content: JSON.stringify(claudeDocument), mcpContent: JSON.stringify(claudeMcp), claudeSkills: [skill] }),
    codex: profile("codex", { content: 'model = "ignored"\n', configContent: codexText, authContent: '{"token":"placeholder"}', codexSkills: [skill] }),
    grok: profile("grok", { content: grokText, configContent: grokText, grokSkills: [{ ...skill, source: "user" }] }),
    opencode: profile("opencode", { content: openCodeText, openCodeSkills: [skill] }),
    dsh: profile("dsh", { content: JSON.stringify(dshDocument) }),
    "kimi-code": profile("kimi-code", { content: kimiText }),
    zcode: profile("zcode", { content: JSON.stringify(zcodeDocument) }),
  };
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), target);
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, target);
      if (entry.isDirectory()) await visit(target);
      else files[path.relative(root, target)] = (await fs.readFile(target)).toString("base64");
    }
  };
  await visit(root);
  return files;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-copy-public-contract-"));
  const home = path.join(root, "home");
  const overrides: NodeJS.ProcessEnv = {
    HOME: home, USERPROFILE: home, HOMEDRIVE: path.parse(home).root, HOMEPATH: home.slice(path.parse(home).root.length),
    CODEX_HOME: path.join(home, ".codex"), CODEX_HOME_DIR: path.join(home, ".codex"),
    GROK_HOME: path.join(home, ".grok"), DSH_HOME: path.join(home, ".dsh"),
    KIMI_CODE_HOME: path.join(home, ".kimi-code"), ZCODE_DATA_BASE_DIR: home,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(home, ".zcode", "v2", "provider_config.json"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
  const previousEnvironment = Object.keys(overrides).map((key) => [key, process.env[key]] as const);
  const sourceRoot = path.resolve(__dirname, "../..");
  const isApplicationModule = (filename: string): boolean => filename.startsWith(`${sourceRoot}${path.sep}`)
    && !filename.startsWith(`${path.join(sourceRoot, "test")}${path.sep}`);
  const previousModules = Object.entries(require.cache).filter(([filename]) => isApplicationModule(filename));
  for (const [filename] of previousModules) delete require.cache[filename];
  Object.assign(process.env, overrides);
  try {
    assert.equal(path.resolve(os.homedir()), path.resolve(home));
    const paths = require("../../config/configPaths") as typeof import("../../config/configPaths");
    const { resolveZcodeProviderConfigPath } = require("../../config/zcodeConfig") as typeof import("../../config/zcodeConfig");
    for (const platform of platforms) {
      for (const target of Object.values(paths.CONFIG_PATHS[platform])) assertInside(root, target);
      assertInside(root, paths.getConfigFilePath(platform, `source-${platform}`));
    }
    assertInside(root, paths.resolveOpenCodeGlobalConfigPath());
    assertInside(root, resolveZcodeProviderConfigPath());
    const service = require("../../config/configService") as Service;
    const profiles = fixtureProfiles(root);
    const write = async (profile: ConfigItem): Promise<void> => {
      const target = paths.getConfigFilePath(profile.platform, profile.id);
      assertInside(root, target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify(profile));
    };
    for (const platform of platforms) {
      await service.saveConfig(profiles[platform]);
      const loaded = await service.getConfigById(platform, profiles[platform].id);
      assert.ok(loaded, platform);
      profiles[platform] = loaded;
      for (const [key, target] of Object.entries(paths.CONFIG_PATHS[platform])) {
        if (key === "configDir") continue;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, target.endsWith(".json") ? '{"syntheticRuntime":true}\n' : "# synthetic runtime sentinel\n");
      }
      const selection = await service.readSharedConfigSelection(platform, loaded.id);
      assert.equal(selection?.configId, loaded.id);
    }
    await run({ root, service, profiles, file: paths.getConfigFilePath, write });
  } finally {
    for (const filename of Object.keys(require.cache)) {
      if (isApplicationModule(filename)) delete require.cache[filename];
    }
    for (const [filename, cached] of previousModules) require.cache[filename] = cached;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function copyAndCheck(fixture: Fixture, payload: CopyConfigPayload): Promise<{ copied: ConfigItem; stored: ConfigItem; read: ConfigItem }> {
  const before = await snapshot(fixture.root);
  const started = Date.now();
  const copied = await fixture.service.copyConfig(payload);
  const finished = Date.now();
  assert.equal(copied.platform, payload.targetPlatform);
  assert.ok(copied.id.length > 0);
  assert.notEqual(copied.id, payload.sourceId);
  assert.ok(Number.isSafeInteger(copied.createdAt));
  assert.ok(copied.createdAt >= started && copied.createdAt <= finished);
  assert.equal(copied.updatedAt, copied.createdAt);
  const target = fixture.file(payload.targetPlatform, copied.id);
  assertInside(fixture.root, target);
  const after = await snapshot(fixture.root);
  const relative = path.relative(fixture.root, target);
  assert.equal(before[relative], undefined);
  assert.ok(after[relative]);
  delete after[relative];
  assert.deepEqual(after, before, "only the copied profile may be added; sources, runtime files and active identities stay unchanged");
  const stored = JSON.parse(await fs.readFile(target, "utf8")) as ConfigItem;
  const read = await fixture.service.getConfigById(payload.targetPlatform, copied.id);
  assert.ok(read);
  for (const result of [stored, read]) {
    for (const field of ["id", "name", "platform", "createdAt", "updatedAt"] as const) assert.equal(result[field], copied[field]);
  }
  return { copied, stored, read };
}

async function rejectsUnchanged(fixture: Fixture, payload: CopyConfigPayload, message: RegExp): Promise<void> {
  const before = await snapshot(fixture.root);
  await assert.rejects(() => fixture.service.copyConfig(payload), { message });
  assert.deepEqual(await snapshot(fixture.root), before, "failed copies must not change profiles, runtime files or active identities");
}

function assertCopyFields(copied: ConfigItem, source: ConfigItem, target: CurrentConfigPlatform, phase: "returned" | "stored" | "read"): void {
  if (target === "claude") {
    assert.deepEqual(JSON.parse(copied.content ?? "null"), source.platform === "claude" ? claudeDocument : {});
    assert.deepEqual(JSON.parse(copied.mcpContent ?? "null"), source.platform === "claude" ? claudeMcp
      : source.platform === "codex" ? { mcp: { fixture: { command: "synthetic-tool", args: ["--fixture"], enabled: "true" } } } : {});
    assert.deepEqual(copied.claudeSkills, source.platform === "claude" ? source.claudeSkills : []);
  } else if (target === "codex") {
    assert.equal(copied.content, source.platform === "codex" ? codexText : "");
    assert.equal(copied.configContent, source.platform === "codex" ? codexText : "");
    assert.deepEqual(JSON.parse(copied.authContent ?? "null"), source.platform === "codex" ? { token: "placeholder" } : {});
    assert.deepEqual(copied.codexSkills, source.platform === "codex" ? source.codexSkills : []);
  } else if (target === "grok") {
    assert.equal(copied.content, source.platform === "grok" ? grokText : "");
    assert.equal(copied.configContent, source.platform === "grok" ? grokText : "");
    assert.deepEqual(copied.grokSkills, source.platform === "grok" ? source.grokSkills : []);
  } else if (target === "opencode") {
    assert.deepEqual(JSON.parse(copied.content ?? "null"), openCodeDocument);
    assert.deepEqual(copied.openCodeSkills, source.openCodeSkills);
    assert.equal(copied.configContent, undefined);
  } else {
    assert.equal(copied.content, target === "zcode" && phase === "stored" ? JSON.stringify(zcodeDocument, null, 2) : source.configContent);
    assert.equal(copied.configContent, source.configContent);
    if (target === "dsh") assert.deepEqual(JSON.parse(copied.content ?? "null"), dshDocument);
    if (target === "zcode") assert.deepEqual(JSON.parse(copied.content ?? "null"), zcodeDocument);
    if (target === "kimi-code") assert.deepEqual(TOML.parse(copied.content ?? ""), TOML.parse(kimiText));
  }
  for (const field of ["envContent", "sourceId", "sourcePlatform", "sourceName", "migrationVersion"] as const) assert.equal(copied[field], undefined);
  for (const field of ["claudeSkills", "codexSkills", "openCodeSkills", "grokSkills"] as const) {
    const ownField = { claude: "claudeSkills", codex: "codexSkills", opencode: "openCodeSkills", grok: "grokSkills" };
    if (field !== ownField[target as keyof typeof ownField]) assert.equal(copied[field], undefined);
  }
}

test("copyConfig public compatibility contract", { concurrency: false }, async (context) => {
  await context.test("all 49 platform pairs use real save validation without activation", async (matrix) => {
    await withFixture(async (fixture) => {
      for (const sourcePlatform of platforms) {
        for (const targetPlatform of platforms) {
          await matrix.test(`${sourcePlatform} -> ${targetPlatform}`, async () => {
            const payload: CopyConfigPayload = { sourcePlatform, sourceId: fixture.profiles[sourcePlatform].id, targetPlatform, name: `matrix-${sourcePlatform}-${targetPlatform}` };
            if (sourcePlatform === targetPlatform || (["claude", "codex", "grok"].includes(sourcePlatform) && ["claude", "codex", "grok"].includes(targetPlatform))) {
              const { copied, stored, read } = await copyAndCheck(fixture, payload);
              assert.equal(copied.name, payload.name);
              assertCopyFields(copied, fixture.profiles[sourcePlatform], targetPlatform, "returned");
              assertCopyFields(stored, fixture.profiles[sourcePlatform], targetPlatform, "stored");
              assertCopyFields(read, fixture.profiles[sourcePlatform], targetPlatform, "read");
            } else {
              const expected = sourcePlatform === "opencode" || targetPlatform === "opencode"
                ? /^OpenCode configs can only be copied as OpenCode configs; Claude\/Codex configs are not converted\.$/
                : sourcePlatform === "dsh" || targetPlatform === "dsh"
                  ? /^DSH configs can only be copied as DSH configs\.$/
                  : sourcePlatform === "kimi-code" || targetPlatform === "kimi-code"
                    ? /^Kimi Code configs can only be copied as Kimi Code configs\.$/
                    : /^ZCode configs can only be copied as ZCode configs\.$/;
              await rejectsUnchanged(fixture, payload, expected);
            }
          });
        }
      }
    });
  });

  await context.test("missing source wins over compatibility rejection in all 49 pairs", async (missing) => {
    await withFixture(async (fixture) => {
      for (const sourcePlatform of platforms) {
        for (const targetPlatform of platforms) {
          await missing.test(`${sourcePlatform} -> ${targetPlatform}`, async () => {
            await rejectsUnchanged(fixture, { sourcePlatform, sourceId: "missing-source", targetPlatform }, /^配置不存在或已删除$/);
          });
        }
      }
    });
  });

  await context.test("names trim, default copies increment, and service accepts an explicit duplicate", async () => {
    await withFixture(async (fixture) => {
      const source = fixture.profiles.claude;
      const payload: CopyConfigPayload = { sourcePlatform: "claude", sourceId: source.id, targetPlatform: "claude" };
      const ids = new Set<string>([source.id]);
      for (const [name, expected] of [[undefined, `${source.name}_副本`], [" \n\t ", `${source.name}_副本2`], [undefined, `${source.name}_副本3`], ["  自定义副本 \t", "自定义副本"], [`  ${source.name}  `, source.name]] as const) {
        const { copied } = await copyAndCheck(fixture, { ...payload, name });
        assert.equal(copied.name, expected);
        assert.equal(ids.has(copied.id), false);
        ids.add(copied.id);
      }
      assert.equal((await fixture.service.getConfigList("claude")).filter((profile) => profile.name === source.name).length, 2);
    });
  });

  await context.test("explicit empty canonical content beats a nonempty legacy content field", async (empty) => {
    await withFixture(async (fixture) => {
      for (const platform of ["codex", "grok", "dsh", "kimi-code", "zcode"] as const) {
        await empty.test(platform, async () => {
          const source = { ...fixture.profiles[platform], id: `empty-${platform}`, configContent: "" };
          await fixture.write(source);
          const payload: CopyConfigPayload = { sourcePlatform: platform, sourceId: source.id, targetPlatform: platform };
          if (platform === "dsh") {
            await rejectsUnchanged(fixture, payload, /^DSH profile is empty\.$/);
          } else {
            const { copied, stored, read } = await copyAndCheck(fixture, payload);
            for (const result of [copied, stored, read]) {
              assert.equal(result.content, "");
              assert.equal(result.configContent, "");
            }
            if (platform === "codex") assert.deepEqual(JSON.parse(copied.authContent ?? "null"), { token: "placeholder" });
          }
        });
      }
    });
  });

  await context.test("legacy absent canonical content and absent auth/skills use public defaults", async (legacy) => {
    await withFixture(async (fixture) => {
      for (const platform of ["claude", "codex", "grok"] as const) {
        await legacy.test(platform, async () => {
          const source: ConfigItem = { id: `legacy-${platform}`, name: "Legacy", platform, content: platform === "claude" ? "{}" : codexText, createdAt: 1, updatedAt: 2 };
          await fixture.write(source);
          const { copied, stored, read } = await copyAndCheck(fixture, { sourcePlatform: platform, sourceId: source.id, targetPlatform: platform });
          for (const result of [copied, stored, read]) {
            if (platform === "claude") {
              assert.deepEqual(JSON.parse(result.mcpContent ?? "null"), {});
              assert.deepEqual(result.claudeSkills, []);
            } else {
              assert.equal(result.content, codexText);
              assert.equal(result.configContent, codexText);
              if (platform === "codex") {
                assert.deepEqual(JSON.parse(result.authContent ?? "null"), {});
                assert.deepEqual(result.codexSkills, []);
              } else assert.deepEqual(result.grokSkills, []);
            }
          }
        });
      }
    });
  });

  await context.test("returned construction and persisted normalization are separate contracts", async (normalization) => {
    await withFixture(async (fixture) => {
      for (const platform of ["claude", "codex", "dsh", "kimi-code", "zcode"] as const) {
        await normalization.test(platform, async () => {
          const content = platform === "claude" ? JSON.stringify(claudeDocument)
            : platform === "dsh" ? JSON.stringify(dshDocument)
              : platform === "zcode" ? JSON.stringify(zcodeDocument)
                : platform === "kimi-code" ? 'default_permission_mode="manual"\n' : codexText;
          const source: ConfigItem = { ...fixture.profiles[platform], id: `raw-${platform}`, content, configContent: content,
            authContent: '{"token":"placeholder"}', mcpContent: JSON.stringify(claudeMcp), envContent: "IGNORED=placeholder",
            claudeSkills: fixture.profiles.claude.claudeSkills, codexSkills: fixture.profiles.codex.codexSkills,
            openCodeSkills: fixture.profiles.opencode.openCodeSkills, grokSkills: fixture.profiles.grok.grokSkills,
            sourceId: "old-source", sourcePlatform: "claude", sourceName: "old-name", migrationVersion: "old-version" };
          await fixture.write(source);
          const { copied, stored, read } = await copyAndCheck(fixture, { sourcePlatform: platform, sourceId: source.id, targetPlatform: platform });
          assert.equal(copied.content, content);
          if (platform === "claude") {
            assert.equal(copied.mcpContent, JSON.stringify(claudeMcp));
            assert.equal(stored.mcpContent, JSON.stringify(claudeMcp, null, 2));
            assert.equal(stored.content, JSON.stringify(claudeDocument, null, 2));
          } else if (platform === "codex") {
            assert.equal(copied.authContent, '{"token":"placeholder"}');
            assert.equal(stored.authContent, JSON.stringify({ token: "placeholder" }, null, 2));
            assert.equal(stored.content, codexText);
          } else {
            for (const result of [copied, stored, read]) {
              for (const field of ["envContent", "authContent", "mcpContent", "claudeSkills", "codexSkills", "openCodeSkills", "grokSkills"] as const) assert.equal(result[field], undefined);
            }
            assert.notEqual(stored.content, copied.content);
            if (platform === "kimi-code") {
              assert.deepEqual(TOML.parse(stored.content ?? ""), { default_permission_mode: "manual" });
              assert.equal(stored.content, stored.configContent);
            } else {
              assert.deepEqual(JSON.parse(stored.content ?? "null"), platform === "dsh" ? dshDocument : zcodeDocument);
              if (platform === "dsh") assert.equal(stored.content, stored.configContent);
              else {
                assert.equal(stored.configContent, content);
                assert.equal(read.content, content);
              }
            }
          }
          for (const result of [copied, stored, read]) {
            for (const field of ["sourceId", "sourcePlatform", "sourceName", "migrationVersion", "envContent"] as const) assert.equal(result[field], undefined);
          }
        });
      }
    });
  });

  await context.test("legacy gemini source aliases OpenCode, including JSONC and legacy skills", async () => {
    await withFixture(async (fixture) => {
      const source = { ...fixture.profiles.opencode, id: "legacy-gemini", platform: "gemini" as const, openCodeSkills: undefined,
        geminiSkills: fixture.profiles.opencode.openCodeSkills, content: openCodeText, envContent: "IGNORED=placeholder" };
      await fixture.write(source);
      const { copied, stored, read } = await copyAndCheck(fixture, { sourcePlatform: "gemini", sourceId: source.id, targetPlatform: "opencode" });
      for (const result of [copied, stored, read]) {
        assert.equal(result.platform, "opencode");
        assert.deepEqual(JSON.parse(result.content ?? "null"), openCodeDocument);
        assert.deepEqual(result.openCodeSkills, source.geminiSkills);
        assert.equal(result.envContent, undefined);
        assert.equal("geminiSkills" in result, false);
      }
      await rejectsUnchanged(fixture, { sourcePlatform: "gemini", sourceId: source.id, targetPlatform: "codex" }, /^OpenCode configs can only be copied/);
      await rejectsUnchanged(fixture, { sourcePlatform: "gemini", sourceId: "missing", targetPlatform: "dsh" }, /^配置不存在或已删除$/);
    });
  });

  await context.test("invalid legacy sources propagate save failures without side effects", async (failures) => {
    await withFixture(async (fixture) => {
      const cases: { platform: CurrentConfigPlatform; fields: Partial<ConfigItem>; error: RegExp }[] = [
        { platform: "codex", fields: { authContent: "[]" }, error: /auth\.json.*JSON 格式错误/ },
        { platform: "grok", fields: { configContent: 'model = "unterminated' }, error: /config\.toml.*TOML 格式错误/ },
        { platform: "kimi-code", fields: { content: 'default_permission_mode = "unsupported"\n', configContent: 'default_permission_mode = "unsupported"\n' }, error: /default_permission_mode 无效/ },
        { platform: "opencode", fields: { content: '{"provider":{"myprovider":{"models":{"synthetic-model":{}}}}}' }, error: /placeholder provider/ },
      ];
      for (const { platform, fields, error } of cases) {
        await failures.test(platform, async () => {
          const source = { ...fixture.profiles[platform], ...fields, id: `invalid-${platform}` };
          await fixture.write(source);
          await rejectsUnchanged(fixture, { sourcePlatform: platform, sourceId: source.id, targetPlatform: platform }, error);
        });
      }
    });
  });

  await context.test("malformed legacy OpenCode JSONC currently copies as an empty object", async () => {
    await withFixture(async (fixture) => {
      const source = { ...fixture.profiles.opencode, id: "malformed-opencode", content: '{"provider": [}' };
      await fixture.write(source);
      const { copied, stored, read } = await copyAndCheck(fixture, { sourcePlatform: "opencode", sourceId: source.id, targetPlatform: "opencode" });
      for (const result of [copied, stored, read]) {
        assert.deepEqual(JSON.parse(result.content ?? "null"), {});
        assert.deepEqual(result.openCodeSkills, source.openCodeSkills);
      }
      assert.equal((await fixture.service.getConfigById("opencode", source.id))?.content, source.content);
    });
  });
});
