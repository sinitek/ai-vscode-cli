export const LEGACY_GEMINI_CONFIG_PLATFORM = "gemini" as const;

export type CurrentConfigPlatform = "claude" | "codex" | "opencode" | "grok" | "dsh";
export type LegacyConfigPlatform = typeof LEGACY_GEMINI_CONFIG_PLATFORM;
export type ConfigPlatform = CurrentConfigPlatform | LegacyConfigPlatform;

export type ConfigOrder = Partial<Record<ConfigPlatform, string[]>>;

export type ConfigItem = {
  id: string;
  name: string;
  platform: ConfigPlatform;
  sourcePlatform?: "claude" | "codex";
  sourceId?: string;
  sourceName?: string;
  migrationVersion?: string;
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  codexSkills?: CodexSkillToggle[];
  claudeSkills?: ClaudeSkillToggle[];
  openCodeSkills?: OpenCodeSkillToggle[];
  grokSkills?: GrokSkillToggle[];
  createdAt: number;
  updatedAt: number;
};

export type ClaudeSkillItem = {
  name: string;
  path: string;
  description?: string;
};

export type ClaudeSkillToggle = ClaudeSkillItem & {
  enabled: boolean;
};

export type CodexSkillItem = {
  name: string;
  path: string;
  description?: string;
};

export type CodexSkillToggle = CodexSkillItem & {
  enabled: boolean;
};

export type GrokSkillSource = "project" | "user" | "bundled";

export type GrokSkillToggle = CodexSkillToggle & {
  source?: GrokSkillSource;
};

export type OpenCodeSkillItem = {
  name: string;
  path: string;
  description?: string;
};

export type OpenCodeSkillToggle = OpenCodeSkillItem & {
  enabled: boolean;
};

export type ApplyPayload = {
  profileId?: string;
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  codexSkills?: CodexSkillToggle[];
  claudeSkills?: ClaudeSkillToggle[];
  openCodeSkills?: OpenCodeSkillToggle[];
  grokSkills?: GrokSkillToggle[];
};

export type CopyConfigPayload = {
  sourcePlatform: ConfigPlatform;
  sourceId: string;
  targetPlatform: CurrentConfigPlatform;
  name?: string;
};

export type CurrentConfig = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
};
