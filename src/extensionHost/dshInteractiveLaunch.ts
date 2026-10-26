import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { commitDshDocument, containsDshSecret, serializeDshPatchYaml } from "../cli/dshConfigModels";
import {
  profileFilePath,
  readDshActivation,
  readDshActiveProfileText,
  resolveDshConfigPaths,
} from "../config/dshConfig";
import { writeFileAtomically } from "../shared/atomicWrite";
import {
  buildDshChildEnv,
  DSH_FOREIGN_CREDENTIAL_ENV_KEYS,
  redactDshDiagnostic,
} from "../interactive/dshAppServerProtocol";
import {
  DSH_GLOBAL_RULES_FILE_NAME,
  DSH_GLOBAL_SKILLS_DIRECTORY_NAME,
  resolveDshHomeDir,
} from "../shared/userHomePaths";

export type DshInteractiveLaunch = {
  agentArgs: string[];
  env: NodeJS.ProcessEnv;
  isolatedHome: string;
  patchPath: string;
};

export async function prepareDshIsolatedLaunch(input: {
  sessionKey: string;
  parentEnv?: NodeJS.ProcessEnv;
  patchSourcePath?: string | null;
}): Promise<DshInteractiveLaunch> {
  const parentEnv = input.parentEnv ?? process.env;
  const paths = resolveDshConfigPaths(parentEnv);
  const hasExternalPatch = input.patchSourcePath !== undefined && input.patchSourcePath !== null;
  const sourcePath = input.patchSourcePath ?? await readActivePatchPath(parentEnv);
  if (!sourcePath) {
    throw new Error("DSH profile patch is not active.");
  }
  const sourcePatchText = await fs.readFile(sourcePath, "utf8");
  let activeProfile: Extract<ReturnType<typeof commitDshDocument>, { ok: true }> | null = null;
  let activeProfileText = "";
  let storedProfile: StoredDshProfile | null = null;
  if (!hasExternalPatch) {
    const activation = await readDshActivation(paths);
    activeProfileText = await readDshActiveProfileText(paths);
    if (activation.activeProfileId && isSafeProfileId(activation.activeProfileId)) {
      storedProfile = await readStoredDshProfile(paths, activation.activeProfileId);
      if (storedProfile) {
        const committed = commitDshDocument(storedProfile.profileText);
        if (!committed.ok) {
          throw new Error("DSH active profile is invalid.");
        }
        activeProfile = committed;
      }
    }
    if (!activeProfile) {
      if (activeProfileText) {
        const committed = commitDshDocument(activeProfileText);
        if (!committed.ok) {
          throw new Error("DSH active profile is invalid.");
        }
        activeProfile = committed;
      }
    }
  }
  const patchText = activeProfile?.ok
    ? serializeDshPatchYaml(activeProfile.document)
    : sourcePatchText;
  if (containsDshSecret(patchText)) {
    throw new Error("DSH patch must not contain a credential value.");
  }
  if (activeProfile?.ok && sourcePath === paths.patchPath && !hasExternalPatch) {
    if (sourcePatchText !== patchText) {
      await writeFileAtomically(paths.patchPath, patchText, { mode: 0o600 });
    }
    if (storedProfile && storedProfile.profileText !== activeProfile.content) {
      await storedProfile.writeCanonical(activeProfile.content);
    }
    if (activeProfileText !== activeProfile.content) {
      await writeFileAtomically(paths.appliedProfilePath, activeProfile.content, { mode: 0o600 });
    }
  }
  const isolatedHome = path.join(os.tmpdir(), "sinitek-dsh-acp", sanitizeSessionKey(input.sessionKey));
  await fs.mkdir(isolatedHome, { recursive: true });
  const patchPath = path.join(isolatedHome, "acp-patch.yaml");
  await fs.writeFile(patchPath, patchText, "utf8");
  const env = buildDshChildEnv(undefined, parentEnv);
  if (activeProfile?.ok) {
    if (activeProfile.document.apiKey) {
      env.SINITEK_DSH_API_KEY = activeProfile.document.apiKey;
    }
  }
  env.DSH_HOME = isolatedHome;
  env.DSH_PERMISSION_MODE = "danger-full-access";
  const agentArgs = ["--patch", patchPath];
  try {
    await mirrorDshGlobalSurface(resolveDshHomeDir(parentEnv), isolatedHome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "DSH global skills and rules could not be mirrored.";
    throw new Error(redactDshDiagnostic(message, env));
  }
  assertLaunchHasNoCredential(agentArgs, env, parentEnv);
  return { agentArgs, env, isolatedHome, patchPath };
}

type StoredDshProfile = {
  profileText: string;
  writeCanonical: (content: string) => Promise<void>;
};

async function readStoredDshProfile(paths: ReturnType<typeof resolveDshConfigPaths>, profileId: string): Promise<StoredDshProfile | null> {
  const filePath = profileFilePath(paths, profileId);
  let rawText: string;
  try {
    rawText = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }
  const stored = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const profileText = stored && typeof stored.configContent === "string"
    ? stored.configContent
    : stored && typeof stored.content === "string"
      ? stored.content
      : rawText;
  return {
    profileText,
    writeCanonical: async (content: string) => {
      if (stored && (typeof stored.configContent === "string" || typeof stored.content === "string")) {
        if (typeof stored.configContent === "string") stored.configContent = content;
        if (typeof stored.content === "string") stored.content = content;
        await writeFileAtomically(filePath, JSON.stringify(stored, null, 2), { mode: 0o600 });
        return;
      }
      await writeFileAtomically(filePath, content, { mode: 0o600 });
    },
  };
}

function isSafeProfileId(profileId: string): boolean {
  return Boolean(profileId.trim())
    && !profileId.includes("/")
    && !profileId.includes("\\")
    && !profileId.includes("..");
}

const MIRRORED_SKIP_NAMES = new Set(["settings.yaml", ".credentials.yaml", "config.toml"]);

async function mirrorDshGlobalSurface(sourceHome: string, isolatedHome: string): Promise<void> {
  await mirrorSkills(sourceHome, isolatedHome);
  await mirrorRulesFile(sourceHome, isolatedHome);
}

async function mirrorSkills(sourceHome: string, isolatedHome: string): Promise<void> {
  const source = path.join(sourceHome, DSH_GLOBAL_SKILLS_DIRECTORY_NAME);
  const target = path.join(isolatedHome, DSH_GLOBAL_SKILLS_DIRECTORY_NAME);
  let sourceStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    sourceStat = await fs.lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.rm(target, { recursive: true, force: true });
      return;
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error("DSH skills root must be a real directory under <DSH_HOME>/skills.");
  }
  await replaceCopiedDirectory(source, target);
}

async function mirrorRulesFile(sourceHome: string, isolatedHome: string): Promise<void> {
  const source = path.join(sourceHome, DSH_GLOBAL_RULES_FILE_NAME);
  const target = path.join(isolatedHome, DSH_GLOBAL_RULES_FILE_NAME);
  let sourceStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    sourceStat = await fs.lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.rm(target, { force: true });
      return;
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    await fs.rm(target, { force: true });
    return;
  }
  const backup = `${target}.sinitek-replacing`;
  await fs.rm(backup, { force: true });
  let moved = false;
  try {
    await fs.rename(target, backup);
    moved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await fs.copyFile(source, target);
  } catch (error) {
    await fs.rm(target, { force: true });
    if (moved) {
      await fs.rename(backup, target);
    }
    throw error;
  }
  if (moved) {
    await fs.rm(backup, { force: true });
  }
}

async function replaceCopiedDirectory(source: string, target: string): Promise<void> {
  const backup = `${target}.sinitek-replacing`;
  await fs.rm(backup, { recursive: true, force: true });
  let moved = false;
  try {
    await fs.rename(target, backup);
    moved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await fs.cp(source, target, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      filter: async (entryPath) => {
        const name = path.basename(entryPath);
        if (!name || name === "." || name === ".." || MIRRORED_SKIP_NAMES.has(name)) {
          return false;
        }
        const stat = await fs.lstat(entryPath);
        return !stat.isSymbolicLink();
      },
    });
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    if (moved) {
      await fs.rename(backup, target);
    }
    throw error;
  }
  if (moved) {
    await fs.rm(backup, { recursive: true, force: true });
  }
}

async function readActivePatchPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const paths = resolveDshConfigPaths(env);
  const activation = await readDshActivation(paths);
  if (!activation.patchPath) {
    return null;
  }
  try {
    await fs.access(activation.patchPath);
    return activation.patchPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sanitizeSessionKey(sessionKey: string): string {
  const safe = sessionKey.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return safe || "session";
}

function assertLaunchHasNoCredential(
  agentArgs: readonly string[],
  env: NodeJS.ProcessEnv,
  parentEnv: NodeJS.ProcessEnv,
): void {
  const serializedArgs = agentArgs.join("\n");
  if (containsDshSecret(serializedArgs)) {
    throw new Error("DSH launch args must not contain a credential value.");
  }
  const key = parentEnv.SINITEK_DSH_API_KEY;
  if (typeof key === "string" && key.length > 0 && serializedArgs.includes(key)) {
    throw new Error("DSH launch args must not contain SINITEK_DSH_API_KEY.");
  }
  for (const foreign of DSH_FOREIGN_CREDENTIAL_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, foreign)) {
      throw new Error(`DSH child env must not include ${foreign}.`);
    }
  }
}
