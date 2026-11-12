import * as fs from "fs/promises";
import * as path from "path";
import * as TOML from "@iarna/toml";
import { createHash } from "crypto";
import { isPlainObject } from "../shared/jsonObject";
import { resolveCodexHomeDir } from "../shared/userHomePaths";
import { resolveCodexProjectPath } from "../interactive/codexRuntimeConfig";

// Tag every value so dates, bigint, non-finite numbers and user objects cannot
// collide. Sorting applies only to object keys; array order remains meaningful.
function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Array.isArray(value)) return ["array", value.map(canonicalValue)];
  if (value !== null && typeof value === "object") {
    return ["object", Object.keys(value).sort().map((key) => [
      key, canonicalValue((value as Record<string, unknown>)[key]),
    ])];
  }
  if (typeof value === "number") return ["number", Object.is(value, -0) ? "-0" : String(value)];
  if (typeof value === "bigint") return ["bigint", String(value)];
  return [typeof value, value];
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // Never include parser diagnostics or file contents (including credentials).
    throw new Error("无法读取 Codex 运行配置，已停止复用连接。");
  }
}

function containsDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative)
    && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function effectiveProjectConfig(config: Record<string, unknown>, cwd?: string): Promise<void> {
  const projects = config.projects;
  if (projects !== undefined && !isPlainObject(projects)) {
    throw new Error("Codex 项目配置无效，已停止复用连接。");
  }
  for (const settings of Object.values(projects ?? {})) {
    if (!isPlainObject(settings) || (settings.trust_level !== undefined
      && settings.trust_level !== "trusted" && settings.trust_level !== "untrusted")) {
      throw new Error("Codex 项目配置无效，已停止复用连接。");
    }
  }
  if (!cwd?.trim()) return;
  const projectPath = await resolveCodexProjectPath(cwd);
  const verifiedCwd = await fs.realpath(cwd).catch(() => null);
  const retained: Record<string, unknown> = Object.create(null);
  for (const [project, settings] of Object.entries(projects ?? {})) {
    // Relative/foreign-platform paths or unresolvable records are ambiguous.
    // Keep them rather than guessing that they cannot affect this invocation.
    let unrelated = false;
    if (verifiedCwd && path.isAbsolute(project)) {
      try {
        const resolved = await fs.realpath(project);
        unrelated = !containsDirectory(resolved, projectPath)
          && !containsDirectory(path.resolve(project), path.resolve(cwd));
      } catch {
        // A missing target may have a symlink ancestor; do not prune it.
      }
    }
    if (!unrelated) retained[project] = settings;
  }
  const current = retained[projectPath];
  if (current !== undefined && !isPlainObject(current)) {
    throw new Error("Codex 当前项目配置无效，已停止复用连接。");
  }
  // This exact realpath key is passed as a CLI override by CodexInteractiveRunner
  // before it opens a connection, then persisted by ensureCodexProjectTrusted.
  // Only this leaf is overridden; ancestor trust and unknown project settings stay.
  retained[projectPath] = { ...(current as Record<string, unknown> | undefined), trust_level: "trusted" };
  config.projects = retained;
}

async function resolveSourcePath(source: string): Promise<string> {
  try {
    return await fs.realpath(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && path.dirname(source) !== source) {
      const entry = await fs.lstat(source).catch((statError: NodeJS.ErrnoException) => {
        if (statError.code === "ENOENT") return null;
        throw new Error("无法解析 Codex 配置来源，已停止复用连接。");
      });
      if (entry?.isSymbolicLink()) throw new Error("Codex 配置来源链接无效，已停止复用连接。");
      // Creating an ordinary config file must not change its source identity.
      return path.join(await resolveSourcePath(path.dirname(source)), path.basename(source));
    }
    throw new Error("无法解析 Codex 配置来源，已停止复用连接。");
  }
}

export async function readCodexRuntimeConfigIdentity(workingDirectory?: string): Promise<string> {
  // Resolve at invocation time, like buildCodexChildEnv, rather than using the
  // config editor's module-time path snapshot after HOME has changed.
  const home = path.resolve(resolveCodexHomeDir());
  const configPath = path.join(home, "config.toml");
  const authPath = path.join(home, "auth.json");
  const [configText, authText] = await Promise.all([readOptionalFile(configPath), readOptionalFile(authPath)]);
  let config: Record<string, unknown>;
  let auth: unknown;
  try {
    config = TOML.parse(configText ?? "");
    auth = authText === null ? null : JSON.parse(authText);
    if (authText !== null && !isPlainObject(auth)) throw new Error();
  } catch {
    throw new Error("Codex 运行配置格式无效，已停止复用连接。");
  }
  await effectiveProjectConfig(config, workingDirectory);
  // Preserve configured source and symlink target identity even for equal values.
  const sources = await Promise.all([home, configPath, authPath].map(async (source) => [source, await resolveSourcePath(source)]));
  return createHash("sha256").update(JSON.stringify(canonicalValue({ sources, config, auth }))).digest("hex");
}
