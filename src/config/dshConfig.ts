import * as fs from "fs/promises";
import * as path from "path";
import {
  commitDshDocument,
  createDshExampleProfileText,
  serializeDshPatchYaml,
  type DshProfileDocument,
} from "../cli/dshConfigModels";
import { writeFileAtomically } from "../shared/atomicWrite";
import { resolveDshHomeDir } from "../shared/userHomePaths";

export const DSH_PROFILE_DIR_NAME = "__config";
export const DSH_ACTIVE_FILE = "active.json";
export const DSH_ACTIVE_PATCH_FILE = "active-patch.yaml";
export const DSH_ACTIVE_PROFILE_FILE = "active-profile.json";
export const DSH_FORBIDDEN_RUNTIME_FILES = ["settings.yaml", ".credentials.yaml", "config.toml"] as const;

export type DshConfigPaths = {
  homeDir: string;
  configDir: string;
  activePath: string;
  patchPath: string;
  appliedProfilePath: string;
};

export type DshActivationStatus = {
  activeProfileId: string | null;
  patchPath: string | null;
  activatedAt: number | null;
};

export type DshActivateResult =
  | { ok: true; activated: true; profileId: string; patchPath: string }
  | { ok: false; activated: false; error: string; profileId: string | null };

type DshActivationRecord = {
  profileId: string;
  patchPath: string;
  activatedAt: number;
};

export function resolveDshConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir?: string,
  platform: NodeJS.Platform = process.platform,
): DshConfigPaths {
  const resolvedHome = resolveDshHomeDir(env, homeDir, platform);
  const configDir = path.join(resolvedHome, DSH_PROFILE_DIR_NAME);
  return {
    homeDir: resolvedHome,
    configDir,
    activePath: path.join(configDir, DSH_ACTIVE_FILE),
    patchPath: path.join(configDir, DSH_ACTIVE_PATCH_FILE),
    appliedProfilePath: path.join(configDir, DSH_ACTIVE_PROFILE_FILE),
  };
}

export function profileFilePath(paths: DshConfigPaths, profileId: string): string {
  return path.join(paths.configDir, `${profileId}.json`);
}

export async function readDshActivation(paths: DshConfigPaths = resolveDshConfigPaths()): Promise<DshActivationStatus> {
  try {
    const raw = await fs.readFile(paths.activePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DshActivationRecord>;
    if (!parsed || typeof parsed.profileId !== "string" || !parsed.profileId.trim()) {
      return inactive();
    }
    if (parsed.patchPath !== paths.patchPath) {
      return inactive();
    }
    return {
      activeProfileId: parsed.profileId,
      patchPath: paths.patchPath,
      activatedAt: typeof parsed.activatedAt === "number" ? parsed.activatedAt : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return inactive();
    }
    return inactive();
  }
}

export async function readDshActiveProfileText(
  paths: DshConfigPaths = resolveDshConfigPaths(),
): Promise<string> {
  try {
    return await fs.readFile(paths.appliedProfilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function writeDshAppliedProfile(content: string, paths: DshConfigPaths = resolveDshConfigPaths()): Promise<void> {
  const committed = commitDshDocument(content);
  if (!committed.ok) {
    throw new Error(committed.error);
  }
  const forbiddenBefore = await snapshotForbiddenFiles(paths.homeDir);
  await ensurePrivateConfigDir(paths.configDir);
  await writeFileAtomically(paths.patchPath, serializeDshPatchYaml(committed.document), { mode: 0o600 });
  await writeFileAtomically(paths.appliedProfilePath, committed.content, { mode: 0o600 });
  await assertForbiddenFilesUnchanged(paths.homeDir, forbiddenBefore);
}

export async function activateDshProfile(options: {
  profileId: string;
  content: string;
  paths?: DshConfigPaths;
  now?: number;
}): Promise<DshActivateResult> {
  const profileId = options.profileId.trim();
  const paths = options.paths ?? resolveDshConfigPaths();
  if (!profileId || profileId.includes("/") || profileId.includes("\\") || profileId.includes("..")) {
    return failed(profileId || null, "DSH profile id is not a single path segment.");
  }
  const committed = commitDshDocument(options.content);
  if (!committed.ok) {
    return failed(profileId, committed.error);
  }
  const previous = await readDshActivation(paths);
  const forbiddenBefore = await snapshotForbiddenFiles(paths.homeDir);
  const marker = `${JSON.stringify({
    profileId,
    patchPath: paths.patchPath,
    activatedAt: options.now ?? Date.now(),
  }, null, 2)}\n`;
  try {
    await ensurePrivateConfigDir(paths.configDir);
    await writeFileAtomically(paths.patchPath, serializeDshPatchYaml(committed.document), { mode: 0o600 });
    await writeFileAtomically(paths.appliedProfilePath, committed.content, { mode: 0o600 });
    await assertForbiddenFilesUnchanged(paths.homeDir, forbiddenBefore);
    await writeFileAtomically(paths.activePath, marker, { mode: 0o600 });
    await assertForbiddenFilesUnchanged(paths.homeDir, forbiddenBefore);
  } catch (error) {
    await restoreActivationMarker(paths, previous);
    return failed(previous.activeProfileId, error instanceof Error ? error.message : "DSH activation failed.");
  }
  const activation = await readDshActivation(paths);
  if (activation.activeProfileId !== profileId || activation.patchPath !== paths.patchPath) {
    return failed(previous.activeProfileId, "DSH activation was not recorded.");
  }
  return {
    ok: true,
    activated: true,
    profileId,
    patchPath: paths.patchPath,
  };
}

export function renderDshPatch(document: DshProfileDocument): string {
  return serializeDshPatchYaml(document);
}

export function fallbackDshProfileText(): string {
  return createDshExampleProfileText();
}

async function ensurePrivateConfigDir(configDir: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.chmod(configDir, 0o700);
}

async function restoreActivationMarker(paths: DshConfigPaths, previous: DshActivationStatus): Promise<void> {
  try {
    if (!previous.activeProfileId || !previous.patchPath) {
      await fs.rm(paths.activePath, { force: true });
      return;
    }
    await writeFileAtomically(paths.activePath, `${JSON.stringify({
      profileId: previous.activeProfileId,
      patchPath: previous.patchPath,
      activatedAt: previous.activatedAt ?? 0,
    }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // The caller still reports failure. A marker restore error must not become success.
  }
}

async function snapshotForbiddenFiles(homeDir: string): Promise<Record<string, string | null>> {
  const snapshot: Record<string, string | null> = {};
  for (const name of DSH_FORBIDDEN_RUNTIME_FILES) {
    snapshot[name] = await fileStamp(path.join(homeDir, name));
  }
  return snapshot;
}

async function assertForbiddenFilesUnchanged(
  homeDir: string,
  before: Record<string, string | null>,
): Promise<void> {
  for (const name of DSH_FORBIDDEN_RUNTIME_FILES) {
    const current = await fileStamp(path.join(homeDir, name));
    if (current !== before[name]) {
      throw new Error(`DSH activation must not create or modify ${name}.`);
    }
  }
}

async function fileStamp(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function inactive(): DshActivationStatus {
  return { activeProfileId: null, patchPath: null, activatedAt: null };
}

function failed(profileId: string | null, error: string): DshActivateResult {
  return { ok: false, activated: false, error, profileId };
}
