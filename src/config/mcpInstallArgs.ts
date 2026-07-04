import { McpMarketplaceItem } from "./types";

function isPlaceholderEnvValue(value: string): boolean {
  const trimmed = value.trim();
  return /^<[^>]+>$/.test(trimmed) || /^\$\{?YOUR_/i.test(trimmed) || /^YOUR_/i.test(trimmed);
}

function extractBearerTokenEnvVar(value: string): string | null {
  const trimmed = value.trim();
  const plainMatch = /^Bearer\s+\$([A-Za-z_][A-Za-z0-9_]*)$/i.exec(trimmed);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }
  const wrappedMatch = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i.exec(trimmed);
  if (wrappedMatch?.[1]) {
    return wrappedMatch[1];
  }
  return null;
}

function uniqueWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function collectManagedMcpEnvEntries(
  item: McpMarketplaceItem,
  warnings: string[],
  envOverrides?: Record<string, string>,
): Array<[string, string]> {
  const envEntries: Array<[string, string]> = [];
  const envRecord = item.config?.env;
  if (!envRecord || typeof envRecord !== "object") {
    return envEntries;
  }

  for (const [envName, envValue] of Object.entries(envRecord)) {
    if (!envName || typeof envValue !== "string") {
      continue;
    }
    const overrideValue = envOverrides?.[envName];
    const trimmedValue = typeof overrideValue === "string" && overrideValue.trim().length > 0
      ? overrideValue.trim()
      : envValue.trim();
    if (!trimmedValue || isPlaceholderEnvValue(trimmedValue)) {
      warnings.push(`MCP ${item.id}: skipped template env ${envName}.`);
      continue;
    }
    envEntries.push([envName, trimmedValue]);
  }

  return envEntries;
}

function collectManagedMcpHeaders(item: McpMarketplaceItem): string[] {
  const headers = item.config?.headers;
  if (!headers || typeof headers !== "object") {
    return [];
  }

  return Object.entries(headers)
    .filter(([headerName, headerValue]) => Boolean(headerName) && typeof headerValue === "string")
    .map(([headerName, headerValue]) => `${headerName}: ${headerValue.trim()}`)
    .filter((headerValue) => headerValue.length > 2);
}

export function buildCodexMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const isHttp = config.type === "http" || typeof config.url === "string";

  if (isHttp) {
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing http url.`);
    }

    const commandArgs = ["mcp", "add", item.id, "--url", url];
    const headers = config.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;

    if (typeof authHeader === "string" && authHeader.trim()) {
      const bearerTokenEnvVar = extractBearerTokenEnvVar(authHeader);
      if (bearerTokenEnvVar) {
        commandArgs.push("--bearer-token-env-var", bearerTokenEnvVar);
      } else {
        warnings.push(
          `MCP ${item.id}: authorization header cannot be converted, please set bearer token env var manually.`,
        );
      }
    }

    const unsupportedHeaderKeys = Object.keys(headers).filter(
      (key) => key.toLowerCase() !== "authorization",
    );
    if (unsupportedHeaderKeys.length > 0) {
      warnings.push(
        `MCP ${item.id}: custom headers are not supported by codex mcp add (${unsupportedHeaderKeys.join(", ")}).`,
      );
    }

    return { commandArgs, warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const commandArgs = ["mcp", "add", item.id];
  for (const [envName, envValue] of collectManagedMcpEnvEntries(item, warnings, envOverrides)) {
    commandArgs.push("--env", `${envName}=${envValue}`);
  }

  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  commandArgs.push("--", command, ...mcpArgs);

  return { commandArgs, warnings: uniqueWarnings(warnings) };
}

export function buildClaudeMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const transport = config.type === "http" || config.type === "sse" ? config.type : typeof config.url === "string" ? "http" : "stdio";

  if (transport === "http" || transport === "sse") {
    const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport, item.id];
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing ${transport} url.`);
    }
    for (const header of collectManagedMcpHeaders(item)) {
      commandArgs.push("--header", header);
    }
    return { commandArgs: [...commandArgs, url], warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const env = Object.fromEntries(collectManagedMcpEnvEntries(item, warnings, envOverrides));
  const payload = JSON.stringify({
    type: "stdio",
    command,
    args: mcpArgs,
    env,
  });

  return {
    commandArgs: ["mcp", "add-json", "--scope", "user", item.id, payload],
    warnings: uniqueWarnings(warnings),
  };
}

export function buildGeminiMcpInstallArgs(
  item: McpMarketplaceItem,
  envOverrides?: Record<string, string>,
): { commandArgs: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const config = item.config ?? {};
  const transport = config.type === "http" || config.type === "sse" ? config.type : typeof config.url === "string" ? "http" : "stdio";

  if (transport === "http" || transport === "sse") {
    const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport, item.id];
    const url = config.url?.trim();
    if (!url) {
      throw new Error(`MCP ${item.id} is missing ${transport} url.`);
    }
    for (const header of collectManagedMcpHeaders(item)) {
      commandArgs.push("--header", header);
    }
    return { commandArgs: [...commandArgs, url], warnings: uniqueWarnings(warnings) };
  }

  const command = config.command?.trim();
  if (!command) {
    throw new Error(`MCP ${item.id} is missing command.`);
  }

  const commandArgs = ["mcp", "add", "--scope", "user", "--transport", transport];
  for (const [envName, envValue] of collectManagedMcpEnvEntries(item, warnings, envOverrides)) {
    commandArgs.push("--env", `${envName}=${envValue}`);
  }
  const mcpArgs = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  commandArgs.push(item.id, command, ...mcpArgs);
  return { commandArgs, warnings: uniqueWarnings(warnings) };
}

export function parseCodexMcpServerIds(rawContent: string): string[] {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid codex mcp list output.");
  }

  return parsed
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      const record = item as Record<string, unknown>;
      return typeof record.name === "string" ? record.name.trim() : "";
    })
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}
