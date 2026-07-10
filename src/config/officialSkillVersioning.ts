import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";

import {
  OfficialSkillCatalogItem,
  OfficialSkillInstallState,
  OfficialSkillPlatform,
} from "./types";

export const OFFICIAL_SKILL_METADATA_FILE = ".sinitek-official-skill.json";
const OFFICIAL_SKILL_METADATA_SCHEMA_VERSION = 2;
const OFFICIAL_SKILL_CONTENT_HASH_PREFIX = "sha256:";
type CurrentOfficialSkillPlatform = Exclude<OfficialSkillPlatform, "gemini"> | "opencode";
type WritableOfficialSkillCatalogItem = Omit<OfficialSkillCatalogItem, "platform"> & {
  platform: OfficialSkillPlatform | "opencode";
};

export type OfficialSkillMetadataV1 = {
  schemaVersion: 1;
  platform: CurrentOfficialSkillPlatform;
  skillId: string;
  name: string;
  sourceRepo: string;
  sourceRef: string;
  sourcePath: string;
  archivePath: string;
  installedAt: string;
};

export type OfficialSkillMetadataV2 = {
  schemaVersion: 2;
  platform: CurrentOfficialSkillPlatform;
  skillId: string;
  name: string;
  sourceRepo: string;
  sourceRef: string;
  sourcePath: string;
  archivePath: string;
  installedAt: string;
  version?: string;
  versionSource?: string;
  contentHash?: string;
  sourceCommit?: string;
};

export type OfficialSkillMetadata = OfficialSkillMetadataV1 | OfficialSkillMetadataV2;

export type ResolvedOfficialSkillInstallState = {
  installed: boolean;
  installState: OfficialSkillInstallState;
  installedPath: string;
  installedSourceRef?: string;
  installedSourceRepo?: string;
  installedVersion?: string;
  installedVersionSource?: string;
  installedContentHash?: string;
  installedSourceCommit?: string;
};

export type ResolveOfficialSkillInstallStateOptions = {
  item: OfficialSkillCatalogItem;
  targetDir: string;
  metadata: OfficialSkillMetadata | null;
  computedInstalledContentHash?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isOfficialSkillPlatform(value: string): value is CurrentOfficialSkillPlatform {
  return value === "claude" || value === "codex" || value === "opencode";
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function toStablePosixRelativePath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function normalizeOfficialSkillContentHash(contentHash: string | undefined): string | undefined {
  if (!hasString(contentHash)) {
    return undefined;
  }

  const normalizedDigest = contentHash.startsWith(OFFICIAL_SKILL_CONTENT_HASH_PREFIX)
    ? contentHash.slice(OFFICIAL_SKILL_CONTENT_HASH_PREFIX.length)
    : contentHash;
  const trimmedDigest = normalizedDigest.trim().toLowerCase();
  if (!trimmedDigest) {
    return undefined;
  }
  return `${OFFICIAL_SKILL_CONTENT_HASH_PREFIX}${trimmedDigest}`;
}

export function getOfficialSkillMetadataPath(skillDir: string): string {
  return path.join(skillDir, OFFICIAL_SKILL_METADATA_FILE);
}

export function buildOfficialSkillMetadata(item: WritableOfficialSkillCatalogItem): OfficialSkillMetadataV2 {
  if (!isOfficialSkillPlatform(item.platform)) {
    throw new Error(`Unsupported official skill platform: ${item.platform}`);
  }
  return {
    schemaVersion: OFFICIAL_SKILL_METADATA_SCHEMA_VERSION,
    platform: item.platform,
    skillId: item.id,
    name: item.name,
    sourceRepo: item.sourceRepo,
    sourceRef: item.sourceRef,
    sourcePath: item.sourcePath,
    archivePath: item.archivePath,
    installedAt: new Date().toISOString(),
    version: item.version,
    versionSource: item.versionSource,
    contentHash: normalizeOfficialSkillContentHash(item.contentHash),
    sourceCommit: item.sourceCommit,
  };
}

export async function writeOfficialSkillMetadata(
  skillDir: string,
  item: WritableOfficialSkillCatalogItem,
): Promise<void> {
  const metadataPath = getOfficialSkillMetadataPath(skillDir);
  const content = JSON.stringify(buildOfficialSkillMetadata(item), null, 2);
  await fs.writeFile(metadataPath, `${content}\n`, "utf-8");
}

function parseOfficialSkillMetadataV1(parsed: Record<string, unknown>): OfficialSkillMetadataV1 | null {
  if (parsed.schemaVersion !== 1) {
    return null;
  }
  const platform = String(parsed.platform ?? "");
  if (!isOfficialSkillPlatform(platform)) {
    return null;
  }
  if (
    !hasString(parsed.skillId)
    || !hasString(parsed.name)
    || !hasString(parsed.sourceRepo)
    || !hasString(parsed.sourceRef)
    || !hasString(parsed.sourcePath)
    || !hasString(parsed.archivePath)
    || !hasString(parsed.installedAt)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    platform,
    skillId: parsed.skillId,
    name: parsed.name,
    sourceRepo: parsed.sourceRepo,
    sourceRef: parsed.sourceRef,
    sourcePath: parsed.sourcePath,
    archivePath: parsed.archivePath,
    installedAt: parsed.installedAt,
  };
}

function parseOfficialSkillMetadataV2(parsed: Record<string, unknown>): OfficialSkillMetadataV2 | null {
  if (parsed.schemaVersion !== OFFICIAL_SKILL_METADATA_SCHEMA_VERSION) {
    return null;
  }
  const platform = String(parsed.platform ?? "");
  if (!isOfficialSkillPlatform(platform)) {
    return null;
  }
  if (
    !hasString(parsed.skillId)
    || !hasString(parsed.name)
    || !hasString(parsed.sourceRepo)
    || !hasString(parsed.sourceRef)
    || !hasString(parsed.sourcePath)
    || !hasString(parsed.archivePath)
    || !hasString(parsed.installedAt)
  ) {
    return null;
  }
  return {
    schemaVersion: OFFICIAL_SKILL_METADATA_SCHEMA_VERSION,
    platform,
    skillId: parsed.skillId,
    name: parsed.name,
    sourceRepo: parsed.sourceRepo,
    sourceRef: parsed.sourceRef,
    sourcePath: parsed.sourcePath,
    archivePath: parsed.archivePath,
    installedAt: parsed.installedAt,
    version: hasString(parsed.version) ? parsed.version : undefined,
    versionSource: hasString(parsed.versionSource) ? parsed.versionSource : undefined,
    contentHash: normalizeOfficialSkillContentHash(hasString(parsed.contentHash) ? parsed.contentHash : undefined),
    sourceCommit: hasString(parsed.sourceCommit) ? parsed.sourceCommit : undefined,
  };
}

export async function readOfficialSkillMetadata(skillDir: string): Promise<OfficialSkillMetadata | null> {
  try {
    const content = await fs.readFile(getOfficialSkillMetadataPath(skillDir), "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }
    return parseOfficialSkillMetadataV2(parsed) ?? parseOfficialSkillMetadataV1(parsed);
  } catch {
    return null;
  }
}

type OfficialSkillContentManifestFile = {
  absolutePath: string;
  relativePath: string;
};

async function collectOfficialSkillContentManifest(
  rootDir: string,
  currentDir: string,
  directories: string[],
  files: OfficialSkillContentManifestFile[],
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => compareStableStrings(left.name, right.name));

  for (const entry of entries) {
    if (entry.name === OFFICIAL_SKILL_METADATA_FILE) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = toStablePosixRelativePath(rootDir, absolutePath);
    if (entry.isDirectory()) {
      directories.push(relativePath);
      await collectOfficialSkillContentManifest(rootDir, absolutePath, directories, files);
      continue;
    }

    if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath,
      });
    }
  }
}

export async function computeOfficialSkillContentHash(skillDir: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(skillDir);
    if (!stats.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const directories: string[] = [];
  const files: OfficialSkillContentManifestFile[] = [];
  await collectOfficialSkillContentManifest(skillDir, skillDir, directories, files);

  directories.sort(compareStableStrings);
  files.sort((left, right) => compareStableStrings(left.relativePath, right.relativePath));

  const hasher = createHash("sha256");
  for (const relativeDir of directories) {
    hasher.update(`D\t${relativeDir}\n`);
  }
  for (const file of files) {
    const [content, stats] = await Promise.all([
      fs.readFile(file.absolutePath),
      fs.stat(file.absolutePath),
    ]);
    const fileHash = createHash("sha256").update(content).digest("hex");
    hasher.update(`F\t${file.relativePath}\t${stats.size}\t${fileHash}\n`);
  }
  return `${OFFICIAL_SKILL_CONTENT_HASH_PREFIX}${hasher.digest("hex")}`;
}

function isSameOfficialSkillSource(
  metadata: OfficialSkillMetadata,
  item: OfficialSkillCatalogItem,
): boolean {
  return metadata.sourceRepo === item.sourceRepo && metadata.sourcePath === item.sourcePath;
}

export function resolveOfficialSkillInstallState(
  options: ResolveOfficialSkillInstallStateOptions,
): ResolvedOfficialSkillInstallState {
  const { item, targetDir, metadata, computedInstalledContentHash } = options;
  const normalizedCatalogContentHash = normalizeOfficialSkillContentHash(item.contentHash);
  const normalizedMetadataContentHash = normalizeOfficialSkillContentHash(
    metadata && "contentHash" in metadata ? metadata.contentHash : undefined,
  );
  const normalizedComputedContentHash = normalizeOfficialSkillContentHash(computedInstalledContentHash);
  const baseState: ResolvedOfficialSkillInstallState = {
    installed: true,
    installedPath: targetDir,
    installedSourceRef: metadata?.sourceRef,
    installedSourceRepo: metadata?.sourceRepo,
    installedVersion: metadata && "version" in metadata ? metadata.version : undefined,
    installedVersionSource: metadata && "versionSource" in metadata ? metadata.versionSource : undefined,
    installedContentHash: normalizedComputedContentHash ?? normalizedMetadataContentHash,
    installedSourceCommit: metadata && "sourceCommit" in metadata ? metadata.sourceCommit : undefined,
    installState: "unknown_source",
  };

  if (!metadata || !isSameOfficialSkillSource(metadata, item)) {
    return baseState;
  }

  const installedContentHash = baseState.installedContentHash;
  if (hasString(normalizedCatalogContentHash) && hasString(installedContentHash)) {
    return {
      ...baseState,
      installState: installedContentHash === normalizedCatalogContentHash ? "installed" : "update_available",
    };
  }

  return {
    ...baseState,
    installState: metadata.sourceRef === item.sourceRef ? "installed" : "update_available",
  };
}

export function buildResolvedOfficialSkillCatalogItem(
  item: OfficialSkillCatalogItem,
  installState: ResolvedOfficialSkillInstallState,
): OfficialSkillCatalogItem {
  return {
    ...item,
    installed: installState.installed,
    installedPath: installState.installedPath,
    installedSourceRef: installState.installedSourceRef,
    installedSourceRepo: installState.installedSourceRepo,
    installedVersion: installState.installedVersion,
    installedVersionSource: installState.installedVersionSource,
    installedContentHash: installState.installedContentHash,
    installedSourceCommit: installState.installedSourceCommit,
    installState: installState.installState,
    canInstall: false,
    canUpdate: installState.installState === "update_available" || installState.installState === "unknown_source",
    canUninstall: true,
  };
}
