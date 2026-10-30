import { mergeClaudeSkillsConfig } from "./claudeSkills";
import { mergeCodexSkillsConfig } from "./codexSkills";
import { mergeOpenCodeSkillsConfig } from "./geminiSkills";
import { commitDshDocument, createDshExampleProfileText } from "../cli/dshConfigModels";
import { commitGrokText, validateGrokDocument } from "./grokConfig";
import { commitKimiCodeText } from "./kimiCodeConfig";
import { mergeZcodeProviderConfigText } from "./zcodeConfig";
import { mergeGrokSkillsConfig } from "./grokSkills";
import { t } from "../i18n";
import { isPlainObject } from "../shared/jsonObject";
import type {
  ApplyPayload,
  ConfigItem,
  CurrentConfig,
  CurrentConfigPlatform,
} from "./types";

const RUNTIME_CONFIG_WRITE_VERIFY_ERROR = "未成功更新配置";

function assertRuntimeConfigTextApplied(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Error(RUNTIME_CONFIG_WRITE_VERIFY_ERROR);
  }
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertJsonPatchApplied(expectedText: string, actualText: string): void {
  const expected = parseJsonRecord(expectedText);
  const actual = parseJsonRecord(actualText);
  if (!expected || !actual) {
    assertRuntimeConfigTextApplied(expectedText, actualText);
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
      throw new Error(RUNTIME_CONFIG_WRITE_VERIFY_ERROR);
    }
  }
}

export type CliRuntimeInitialFields = {
  content?: string;
  mcpContent?: string;
  configContent?: string;
  authContent?: string;
  claudeSkills?: ConfigItem["claudeSkills"];
  codexSkills?: ConfigItem["codexSkills"];
  openCodeSkills?: ConfigItem["openCodeSkills"];
  grokSkills?: ConfigItem["grokSkills"];
};

export type CliRuntimeConfigStrategy = {
  readCurrent: () => Promise<CurrentConfig>;
  apply: (payload: ApplyPayload) => Promise<void>;
  backup: () => Promise<string[]>;
  readInitialFields: () => Promise<CliRuntimeInitialFields>;
  fallbackInitialFields: () => CliRuntimeInitialFields;
};

export type ClaudeRuntimeConfigIo = {
  readClaudeConfig: () => Promise<string>;
  readClaudeMcpConfig: () => Promise<string>;
  writeClaudeConfig: (content: string) => Promise<void>;
  writeClaudeMcpConfig: (content: string) => Promise<void>;
  backupClaudeConfig: () => Promise<string[]>;
};

export type CodexRuntimeConfigIo = {
  readCodexConfig: () => Promise<{ config: string; auth: string }>;
  writeCodexConfig: (config: string, auth?: string) => Promise<void>;
  backupCodexConfig: () => Promise<string[]>;
};

export type OpenCodeRuntimeConfigIo = {
  readOpenCodeConfig: () => Promise<{ config: string; env: string }>;
  writeOpenCodeConfig: (config: string, env?: string) => Promise<void>;
  backupOpenCodeConfig: () => Promise<string[]>;
};

export type GrokRuntimeConfigIo = {
  readGrokConfigText: () => Promise<string>;
  writeGrokConfigText: (content: string) => Promise<void>;
  backupGrokConfig: () => Promise<string[]>;
};

export type DshRuntimeConfigIo = {
  readDshConfigText: () => Promise<string>;
  writeDshConfigText: (content: string) => Promise<void>;
  backupDshConfig: () => Promise<string[]>;
};

export type ZcodeRuntimeConfigIo = {
  readZcodeConfigText: () => Promise<string>;
  writeZcodeConfigText: (content: string) => Promise<void>;
  backupZcodeConfig: () => Promise<string | null>;
  createDefaultConfigText: () => string;
};

export type KimiCodeRuntimeConfigIo = {
  readKimiCodeConfigText: () => Promise<string>;
  writeKimiCodeConfigText: (content: string) => Promise<void>;
  backupKimiCodeConfig: () => Promise<string[]>;
  createDefaultConfigText: () => string;
};

export type CliRuntimeConfigIoPorts = {
  claude: ClaudeRuntimeConfigIo;
  codex: CodexRuntimeConfigIo;
  opencode: OpenCodeRuntimeConfigIo;
  grok: GrokRuntimeConfigIo;
  dsh: DshRuntimeConfigIo;
  "kimi-code": KimiCodeRuntimeConfigIo;
  zcode: ZcodeRuntimeConfigIo;
};

type LegacyGeminiApplyPayload = ApplyPayload & {
  geminiSkills?: ApplyPayload["openCodeSkills"];
};

function createClaudeRuntimeConfigStrategy(io: ClaudeRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const [content, mcpContent] = await Promise.all([
        io.readClaudeConfig(),
        io.readClaudeMcpConfig(),
      ]);
      return { content, mcpContent };
    },
    async apply(payload) {
      const nextSettings = payload.claudeSkills === undefined
        ? payload.content ?? "{}"
        : mergeClaudeSkillsConfig(payload.content ?? "{}", payload.claudeSkills);
      await io.writeClaudeConfig(nextSettings);
      if (payload.mcpContent) {
        await io.writeClaudeMcpConfig(payload.mcpContent);
      }
      assertRuntimeConfigTextApplied(nextSettings, await io.readClaudeConfig());
      if (payload.mcpContent) {
        assertJsonPatchApplied(payload.mcpContent, await io.readClaudeMcpConfig());
      }
    },
    backup() {
      return io.backupClaudeConfig();
    },
    async readInitialFields() {
      const [content, mcpContent] = await Promise.all([
        io.readClaudeConfig(),
        io.readClaudeMcpConfig(),
      ]);
      return {
        content,
        mcpContent,
        claudeSkills: [],
      };
    },
    fallbackInitialFields() {
      return {
        content: "{}",
        mcpContent: "{}",
        claudeSkills: [],
      };
    },
  };
}

function createCodexRuntimeConfigStrategy(io: CodexRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const { config, auth } = await io.readCodexConfig();
      return { content: config, configContent: config, authContent: auth };
    },
    async apply(payload) {
      // Apply prefers payload.content. Profile save still prefers configContent.
      const configContent = payload.content ?? payload.configContent;
      if (configContent === undefined) {
        throw new Error(t("config.codexIncomplete"));
      }
      const current = payload.authContent === undefined ? await io.readCodexConfig() : undefined;
      const nextConfig = payload.codexSkills === undefined
        ? configContent
        : mergeCodexSkillsConfig(configContent, payload.codexSkills);
      const nextAuth = payload.authContent ?? current?.auth ?? "{}";
      await io.writeCodexConfig(nextConfig, nextAuth);
      const applied = await io.readCodexConfig();
      assertRuntimeConfigTextApplied(nextConfig, applied.config);
      assertRuntimeConfigTextApplied(nextAuth, applied.auth);
    },
    backup() {
      return io.backupCodexConfig();
    },
    async readInitialFields() {
      const { config, auth } = await io.readCodexConfig();
      return {
        content: config,
        configContent: config,
        authContent: auth,
        codexSkills: [],
      };
    },
    fallbackInitialFields() {
      return {
        content: "",
        configContent: "",
        authContent: "{}",
        codexSkills: [],
      };
    },
  };
}

function createOpenCodeRuntimeConfigStrategy(io: OpenCodeRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const { config } = await io.readOpenCodeConfig();
      return { content: config };
    },
    async apply(payload) {
      // Legacy profiles may still send geminiSkills. openCodeSkills wins when both are present.
      const legacyPayload = payload as LegacyGeminiApplyPayload;
      const openCodeSkills = payload.openCodeSkills ?? legacyPayload.geminiSkills;
      const nextSettings = openCodeSkills === undefined
        ? payload.content ?? "{}"
        : mergeOpenCodeSkillsConfig(payload.content ?? "{}", openCodeSkills);
      await io.writeOpenCodeConfig(nextSettings);
      const applied = await io.readOpenCodeConfig();
      assertRuntimeConfigTextApplied(nextSettings, applied.config);
    },
    backup() {
      return io.backupOpenCodeConfig();
    },
    async readInitialFields() {
      const { config } = await io.readOpenCodeConfig();
      return {
        content: config,
        openCodeSkills: [],
      };
    },
    fallbackInitialFields() {
      return {
        content: "{}",
        openCodeSkills: [],
      };
    },
  };
}

function createGrokRuntimeConfigStrategy(io: GrokRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const config = await io.readGrokConfigText();
      return { content: config, configContent: config };
    },
    async apply(payload) {
      const nextContent = payload.content ?? payload.configContent ?? "";
      if (!nextContent.trim()) {
        throw new Error(t("grok.invalidConfig"));
      }
      let contentToCommit = nextContent;
      if (payload.grokSkills !== undefined) {
        const merged = mergeGrokSkillsConfig(nextContent, payload.grokSkills);
        if (!merged.ok) {
          throw new Error(merged.error);
        }
        contentToCommit = merged.content;
        if (!contentToCommit.trim()) {
          throw new Error(t("grok.invalidConfig"));
        }
      }
      const current = await io.readGrokConfigText();
      const committed = commitGrokText(current, contentToCommit);
      if (!committed.ok) {
        throw new Error(committed.error || t("grok.invalidConfig"));
      }
      const fieldError = validateGrokDocument(committed.document);
      if (fieldError) {
        throw new Error(fieldError);
      }
      await io.writeGrokConfigText(committed.content);
      assertRuntimeConfigTextApplied(committed.content, await io.readGrokConfigText());
    },
    backup() {
      return io.backupGrokConfig();
    },
    async readInitialFields() {
      const config = await io.readGrokConfigText();
      return {
        content: config,
        configContent: config,
        grokSkills: [],
      };
    },
    fallbackInitialFields() {
      return {
        content: "",
        configContent: "",
        grokSkills: [],
      };
    },
  };
}

function createDshRuntimeConfigStrategy(io: DshRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const config = await io.readDshConfigText();
      return { content: config, configContent: config };
    },
    async apply(payload) {
      const nextContent = payload.content ?? payload.configContent ?? "";
      const committed = commitDshDocument(nextContent);
      if (!committed.ok) {
        throw new Error(committed.error);
      }
      await io.writeDshConfigText(committed.content);
      assertRuntimeConfigTextApplied(committed.content, await io.readDshConfigText());
    },
    backup() {
      return io.backupDshConfig();
    },
    async readInitialFields() {
      const config = await io.readDshConfigText();
      return {
        content: config,
        configContent: config,
      };
    },
    fallbackInitialFields() {
      const content = createDshExampleProfileText();
      return {
        content,
        configContent: content,
      };
    },
  };
}

function createZcodeRuntimeConfigStrategy(io: ZcodeRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const config = await io.readZcodeConfigText();
      return { content: config, configContent: config };
    },
    async apply(payload) {
      const nextContent = payload.content ?? payload.configContent ?? "";
      const current = await io.readZcodeConfigText();
      const committed = mergeZcodeProviderConfigText(current, nextContent);
      if (!committed.ok) {
        throw new Error(committed.error);
      }
      await io.backupZcodeConfig();
      await io.writeZcodeConfigText(committed.content);
      assertRuntimeConfigTextApplied(committed.content, await io.readZcodeConfigText());
    },
    async backup() {
      const backup = await io.backupZcodeConfig();
      return backup ? [backup] : [];
    },
    async readInitialFields() {
      const config = await io.readZcodeConfigText();
      if (!config.trim()) {
        const content = io.createDefaultConfigText();
        return { content, configContent: content };
      }
      return { content: config, configContent: config };
    },
    fallbackInitialFields() {
      const content = io.createDefaultConfigText();
      return { content, configContent: content };
    },
  };
}

function createKimiCodeRuntimeConfigStrategy(io: KimiCodeRuntimeConfigIo): CliRuntimeConfigStrategy {
  return {
    async readCurrent() {
      const config = await io.readKimiCodeConfigText();
      return { content: config, configContent: config };
    },
    async apply(payload) {
      const nextContent = payload.content ?? payload.configContent ?? "";
      const current = await io.readKimiCodeConfigText();
      const committed = commitKimiCodeText(current, nextContent);
      if (!committed.ok) {
        throw new Error(committed.error);
      }
      await io.writeKimiCodeConfigText(committed.content);
      assertRuntimeConfigTextApplied(committed.content, await io.readKimiCodeConfigText());
    },
    backup() {
      return io.backupKimiCodeConfig();
    },
    async readInitialFields() {
      const config = await io.readKimiCodeConfigText();
      // 本机还没有 config.toml 时给出一份能被 `kimi doctor config` 通过的范例，
      // 否则新建的 Kimi Code 档案既没有模型也没有 provider，用户必须先手写 TOML。
      if (!config.trim()) {
        const content = io.createDefaultConfigText();
        return {
          content,
          configContent: content,
        };
      }
      return {
        content: config,
        configContent: config,
      };
    },
    fallbackInitialFields() {
      const content = io.createDefaultConfigText();
      return {
        content,
        configContent: content,
      };
    },
  };
}

export function createCliRuntimeConfigStrategies(
  ports: CliRuntimeConfigIoPorts,
): Record<CurrentConfigPlatform, CliRuntimeConfigStrategy> {
  return {
    claude: createClaudeRuntimeConfigStrategy(ports.claude),
    codex: createCodexRuntimeConfigStrategy(ports.codex),
    opencode: createOpenCodeRuntimeConfigStrategy(ports.opencode),
    grok: createGrokRuntimeConfigStrategy(ports.grok),
    dsh: createDshRuntimeConfigStrategy(ports.dsh),
    "kimi-code": createKimiCodeRuntimeConfigStrategy(ports["kimi-code"]),
    zcode: createZcodeRuntimeConfigStrategy(ports.zcode),
  };
}
