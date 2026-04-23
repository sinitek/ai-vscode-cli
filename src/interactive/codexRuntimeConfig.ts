import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const CODEX_HOME_DIRECTORY_NAME = ".codex";
const CODEX_CONFIG_FILE_NAME = "config.toml";
const CODEX_HOME_DIR_ENV_KEY = "CODEX_HOME_DIR";
const TRUST_LEVEL_LINE = 'trust_level = "trusted"';
const CODEX_CHILD_ENV_KEYS_TO_UNSET = ["npm_config_prefix", "NPM_CONFIG_PREFIX"] as const;

export type CodexChildEnvResult = {
  env: NodeJS.ProcessEnv;
  codexHomeDir: string;
  removedEnvKeys: string[];
};

export type CodexProjectTrustResult = {
  status: "updated" | "already_trusted";
  configPath: string;
  projectRoot: string;
};

type CodexProjectTrustContentResult = {
  status: "updated" | "already_trusted";
  content: string;
};

function expandHomePath(value: string | undefined): string {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }
  if (normalizedValue === "~") {
    return os.homedir();
  }
  if (normalizedValue.startsWith("~/") || normalizedValue.startsWith("~\\")) {
    return path.join(os.homedir(), normalizedValue.slice(2));
  }
  return normalizedValue;
}

function normalizeContent(content: string): string {
  return String(content || "").replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function isSectionHeaderLine(line: string): boolean {
  return /^\s*\[.+\]\s*$/.test(line);
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveCodexHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const configuredCodexHomeDir =
    expandHomePath(env[CODEX_HOME_DIR_ENV_KEY])
    || expandHomePath(env.CODEX_HOME);
  return configuredCodexHomeDir || path.join(os.homedir(), CODEX_HOME_DIRECTORY_NAME);
}

export function resolveCodexConfigPath(codexHomeDir?: string): string {
  return path.join(expandHomePath(codexHomeDir) || resolveCodexHomeDir(), CODEX_CONFIG_FILE_NAME);
}

export function buildCodexChildEnv(env: NodeJS.ProcessEnv = process.env): CodexChildEnvResult {
  const codexHomeDir = resolveCodexHomeDir(env);
  const spawnedEnv: NodeJS.ProcessEnv = {
    ...env,
    CODEX_HOME: codexHomeDir,
    CODEX_HOME_DIR: codexHomeDir,
  };
  const removedEnvKeys: string[] = [];
  for (const key of CODEX_CHILD_ENV_KEYS_TO_UNSET) {
    if (Object.prototype.hasOwnProperty.call(spawnedEnv, key)) {
      removedEnvKeys.push(key);
    }
    delete spawnedEnv[key];
  }
  return { env: spawnedEnv, codexHomeDir, removedEnvKeys };
}

export async function resolveCodexProjectPath(projectRoot: string): Promise<string> {
  const normalizedProjectRoot = path.resolve(String(projectRoot || "").trim());
  if (!normalizedProjectRoot) {
    throw new Error("projectRoot is required.");
  }
  try {
    return await fs.realpath(normalizedProjectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return normalizedProjectRoot;
    }
    throw error;
  }
}

export function buildCodexWorkspaceTrustConfigOverride(workspaceDir: string): string {
  const normalizedWorkspaceDir = path.resolve(String(workspaceDir || "").trim());
  return `projects.${JSON.stringify(normalizedWorkspaceDir)}.trust_level="trusted"`;
}

function ensureCodexProjectTrustedContent(content: string, projectRoot: string): CodexProjectTrustContentResult {
  const normalizedProjectRoot = path.resolve(String(projectRoot || "").trim());
  if (!normalizedProjectRoot) {
    throw new Error("projectRoot is required.");
  }

  const normalizedContent = normalizeContent(content);
  const sectionHeader = `[projects.${JSON.stringify(normalizedProjectRoot)}]`;
  const lines = normalizedContent ? normalizedContent.split("\n") : [];
  const sectionStartIndex = lines.findIndex((line) => line.trim() === sectionHeader);

  if (sectionStartIndex < 0) {
    const baseContent = normalizedContent.trimEnd();
    const nextContent = baseContent
      ? `${baseContent}\n\n${sectionHeader}\n${TRUST_LEVEL_LINE}\n`
      : `${sectionHeader}\n${TRUST_LEVEL_LINE}\n`;
    return { status: "updated", content: nextContent };
  }

  let sectionEndIndex = lines.length;
  for (let index = sectionStartIndex + 1; index < lines.length; index += 1) {
    if (isSectionHeaderLine(lines[index])) {
      sectionEndIndex = index;
      break;
    }
  }

  const trustLineIndex = lines.findIndex((line, index) => {
    return index > sectionStartIndex && index < sectionEndIndex && /^\s*trust_level\s*=/.test(line);
  });

  if (trustLineIndex >= 0) {
    if (lines[trustLineIndex].trim() === TRUST_LEVEL_LINE) {
      return { status: "already_trusted", content: normalizedContent ? ensureTrailingNewline(normalizedContent) : "" };
    }
    lines[trustLineIndex] = TRUST_LEVEL_LINE;
    return { status: "updated", content: ensureTrailingNewline(lines.join("\n").replace(/\n+$/g, "")) };
  }

  let insertIndex = sectionEndIndex;
  while (insertIndex > sectionStartIndex + 1 && !lines[insertIndex - 1].trim()) {
    insertIndex -= 1;
  }
  lines.splice(insertIndex, 0, TRUST_LEVEL_LINE);
  return { status: "updated", content: ensureTrailingNewline(lines.join("\n").replace(/\n+$/g, "")) };
}

export async function ensureCodexProjectTrusted(input: {
  projectRoot: string;
  codexHomeDir: string;
}): Promise<CodexProjectTrustResult> {
  const projectRoot = await resolveCodexProjectPath(input.projectRoot);
  const configPath = resolveCodexConfigPath(input.codexHomeDir);
  const existingContent = await readTextFile(configPath);
  const ensuredContent = ensureCodexProjectTrustedContent(existingContent, projectRoot);

  if (ensuredContent.status === "updated") {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await writeFileAtomically(configPath, ensuredContent.content);
  }

  return {
    status: ensuredContent.status,
    configPath,
    projectRoot,
  };
}
