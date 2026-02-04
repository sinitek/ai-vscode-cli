export type ConfigPlatform = "claude" | "codex" | "gemini";

export type ConfigOrder = Record<ConfigPlatform, string[]>;

export type ConfigItem = {
  id: string;
  name: string;
  platform: ConfigPlatform;
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  codexSkills?: CodexSkillToggle[];
  createdAt: number;
  updatedAt: number;
};

export type CodexSkillItem = {
  name: string;
  path: string;
  description?: string;
};

export type CodexSkillToggle = CodexSkillItem & {
  enabled: boolean;
};

export type McpMarketplaceItem = {
  id: string;
  name: string;
  description: string;
  homepage: string;
  category: string;
  config: {
    command?: string;
    args?: string[];
    type?: string;
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
};

export type ApplyPayload = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  codexSkills?: CodexSkillToggle[];
};

export type CurrentConfig = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
};
