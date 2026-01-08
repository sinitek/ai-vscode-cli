export type ConfigPlatform = "claude" | "codex" | "gemini";

export type ConfigItem = {
  id: string;
  name: string;
  platform: ConfigPlatform;
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
  createdAt: number;
  updatedAt: number;
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
};

export type CurrentConfig = {
  content?: string;
  mcpContent?: string;
  envContent?: string;
  configContent?: string;
  authContent?: string;
};
