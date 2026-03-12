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

export type OfficialSkillPlatform = "claude" | "codex";

export type OfficialSkillCatalogPlatformMeta = {
  repo: string;
  ref: string;
  sourceUrl: string;
  installRootHint: string;
  notes?: string;
};

export type OfficialSkillInstallState = "not_installed" | "installed" | "update_available" | "unknown_source";

export type OfficialSkillCatalogItem = {
  id: string;
  platform: OfficialSkillPlatform;
  group: string;
  groupDescription?: string;
  name: string;
  description?: string;
  archivePath: string;
  installFolderName: string;
  sourceRepo: string;
  sourceRef: string;
  sourcePath: string;
  sourceUrl: string;
  installed?: boolean;
  installedPath?: string;
  installedSourceRef?: string;
  installedSourceRepo?: string;
  installState?: OfficialSkillInstallState;
  canInstall?: boolean;
  canUpdate?: boolean;
  canUninstall?: boolean;
};

export type OfficialSkillCatalog = {
  generatedAt: string;
  platforms: Partial<Record<OfficialSkillPlatform, OfficialSkillCatalogPlatformMeta>>;
  skills: OfficialSkillCatalogItem[];
};

export type OfficialSkillInstallResult = {
  platform: OfficialSkillPlatform;
  skillId: string;
  skillName: string;
  targetDir: string;
  action: "install" | "update" | "uninstall";
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
