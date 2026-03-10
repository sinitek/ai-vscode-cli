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
  claudeSkills?: ClaudeSkillToggle[];
  geminiSkills?: GeminiSkillToggle[];
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

export type GeminiSkillItem = {
  name: string;
  path: string;
  description?: string;
};

export type GeminiSkillToggle = GeminiSkillItem & {
  enabled: boolean;
};

export type McpMarketplaceItem = {
  id: string;
  name: string;
  description: string;
  homepage: string;
  signupUrl?: string;
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

export type CodexMcpInstallResult = {
  serverId: string;
  commandArgs: string[];
  warnings: string[];
};

export type McpHealthStatus = "healthy" | "unhealthy" | "unknown";

export type McpHealthItem = {
  platform: ConfigPlatform;
  serverId: string;
  installed: boolean;
  enabled: boolean;
  status: McpHealthStatus;
  checkedAt?: string;
  latencyMs?: number;
  details: string;
};

export type CodexMcpHealthStatus = McpHealthStatus;
export type CodexMcpHealthItem = McpHealthItem;

export type ApplyPayload = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  codexSkills?: CodexSkillToggle[];
  claudeSkills?: ClaudeSkillToggle[];
  geminiSkills?: GeminiSkillToggle[];
};

export type CurrentConfig = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
};
