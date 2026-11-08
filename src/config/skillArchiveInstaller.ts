import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { fromBufferPromise, validateFileName, type Entry, type ZipFile } from "yauzl";
import { t } from "../i18n";
import { installCliSkillDirectory, isCliGlobalSkillPlatform, type CliGlobalSkillPlatform } from "./cliGlobalSkills";

export const MAX_SKILL_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;

export type SkillArchiveInstallTarget = {
  platform: CliGlobalSkillPlatform;
  name: string;
  status: "installed" | "failed";
  message?: string;
};

export type SkillArchiveInstallResult = {
  identifier: string;
  skills: Array<{ name: string; description?: string }>;
  targets: SkillArchiveInstallTarget[];
};

export type SkillArchivePackage = { name: string; directory: string; description?: string };

export type SkillArchiveInstallerOptions = {
  zipBytes: Buffer;
  maxZipBytes: number;
  tempPrefix: string;
  platforms: CliGlobalSkillPlatform[];
  resolvePackages: (tempRoot: string) => Promise<{ identifier: string; packages: SkillArchivePackage[] }>;
};

export class SkillMarketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillMarketError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return t("common.unknownError");
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function normalizePlatforms(value: unknown): CliGlobalSkillPlatform[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SkillMarketError(t("skill.market.invalidPlatforms"));
  }
  const platforms: CliGlobalSkillPlatform[] = [];
  for (const item of value) {
    if (!isCliGlobalSkillPlatform(item)) {
      throw new SkillMarketError(t("skill.global.invalidPlatform"));
    }
    const platform = item;
    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }
  return platforms;
}

export function isSkillDirectoryName(name: string): boolean {
  return (
    name.length > 0 &&
    name.trim() === name &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    name !== "."
  );
}

function isZipSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

function resolveInside(root: string, relativeName: string): string {
  const parts = relativeName.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new SkillMarketError(t("skill.market.badZip"));
  }
  const target = path.resolve(root, ...parts);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SkillMarketError(t("skill.market.badZip"));
  }
  return target;
}

async function readEntryStream(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw new SkillMarketError(t("skill.market.tooLarge"));
      }
      chunks.push(buffer);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks, total);
}

async function extractZipToDirectory(zipBytes: Buffer, destination: string, maxZipBytes: number): Promise<void> {
  if (zipBytes.length > maxZipBytes) {
    throw new SkillMarketError(t("skill.market.tooLarge"));
  }
  if (zipBytes.length < 4 || zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) {
    throw new SkillMarketError(t("skill.market.badZip"));
  }
  let zipfile: ZipFile;
  try {
    zipfile = await fromBufferPromise(zipBytes, {
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch (error) {
    throw new SkillMarketError(t("skill.market.badZip"));
  }
  let totalUncompressed = 0;
  let entryCount = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof SkillMarketError ? error : new SkillMarketError(t("skill.market.badZip")));
      };
      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      zipfile.on("error", fail);
      zipfile.on("end", succeed);
      zipfile.on("entry", (entry) => {
        void (async () => {
          entryCount += 1;
          if (entryCount > MAX_ZIP_ENTRIES || isZipSymlink(entry) || entry.isEncrypted() || !entry.canDecodeFileData()) {
            throw new SkillMarketError(t("skill.market.badZip"));
          }
          const invalidName = validateFileName(entry.fileName);
          if (invalidName) {
            throw new SkillMarketError(t("skill.market.badZip"));
          }
          const isDirectory = entry.fileName.endsWith("/");
          const relativeName = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName;
          if (!relativeName) {
            if (isDirectory) {
              return;
            }
            throw new SkillMarketError(t("skill.market.badZip"));
          }
          const target = resolveInside(destination, relativeName);
          if (isDirectory) {
            await fs.mkdir(target, { recursive: true });
            return;
          }
          if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
            throw new SkillMarketError(t("skill.market.tooLarge"));
          }
          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            throw new SkillMarketError(t("skill.market.tooLarge"));
          }
          await fs.mkdir(path.dirname(target), { recursive: true });
          const stream = await zipfile.openReadStreamPromise(entry);
          const content = await readEntryStream(stream, MAX_ENTRY_BYTES);
          await fs.writeFile(target, content);
        })().then(
          () => {
            if (!settled) {
              zipfile.readEntry();
            }
          },
          fail,
        );
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

export async function installSkillArchive(options: SkillArchiveInstallerOptions): Promise<SkillArchiveInstallResult> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), options.tempPrefix));
  try {
    await extractZipToDirectory(options.zipBytes, tempRoot, options.maxZipBytes);
    const { identifier, packages } = await options.resolvePackages(tempRoot);
    const targets: SkillArchiveInstallTarget[] = [];
    for (const skill of packages) {
      for (const platform of options.platforms) {
        try {
          const status = await installCliSkillDirectory(platform, skill.name, skill.directory);
          targets.push({ platform, name: skill.name, status });
        } catch (error) {
          targets.push({
            platform,
            name: skill.name,
            status: "failed",
            message: errorMessage(error),
          });
        }
      }
    }
    return {
      identifier,
      skills: packages.map((skill) => {
        const summary: { name: string; description?: string } = { name: skill.name };
        if (skill.description) {
          summary.description = skill.description;
        }
        return summary;
      }),
      targets,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
