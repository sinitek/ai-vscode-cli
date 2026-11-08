import * as fs from "fs/promises";
import * as path from "path";
import { t } from "../i18n";
import { type CliGlobalSkillPlatform } from "./cliGlobalSkills";
import { extractSkillDescription, skillDescriptionStrategies } from "./skillDiscovery";
import {
  asRecord,
  installSkillArchive,
  isSkillDirectoryName,
  MAX_SKILL_ZIP_BYTES,
  normalizePlatforms,
  SkillMarketError,
  type SkillArchiveInstallResult,
  type SkillArchivePackage,
} from "./skillArchiveInstaller";

export type LocalSkillZipOptions = {
  fileName: string;
  zipBytes: Buffer;
};

function isPortableSkillDirectoryName(name: string): boolean {
  return isSkillDirectoryName(name)
    && !/[<>:"|?*\u0000-\u001f]/.test(name)
    && !/[. ]$/.test(name)
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name);
}

function skillNameFromZipFileName(fileName: string): string {
  const archiveName = path.basename(fileName);
  if (!/\.zip$/i.test(archiveName)) {
    throw new SkillMarketError(t("skill.market.invalidLocalZip"));
  }
  const baseName = archiveName.replace(/\.zip$/i, "");
  if (!isPortableSkillDirectoryName(baseName)) {
    throw new SkillMarketError(t("skill.market.invalidLocalZipName"));
  }
  return baseName;
}

async function resolveLocalSkillPackage(
  tempRoot: string,
  fileName: string,
): Promise<{ identifier: string; packages: SkillArchivePackage[] }> {
  const entries = (await fs.readdir(tempRoot, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "__MACOSX");
  const rootSkillFile = path.join(tempRoot, "SKILL.md");
  let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
  try {
    stat = await fs.stat(rootSkillFile);
  } catch {
    stat = undefined;
  }
  let skillDirectory: string;
  let skillName: string;
  if (stat?.isFile()) {
    skillDirectory = tempRoot;
    skillName = skillNameFromZipFileName(fileName);
  } else if (entries.length === 1 && entries[0].isDirectory() && isPortableSkillDirectoryName(entries[0].name)) {
    skillDirectory = path.join(tempRoot, entries[0].name);
    skillName = entries[0].name;
    try {
      const wrappedSkillStat = await fs.stat(path.join(skillDirectory, "SKILL.md"));
      if (!wrappedSkillStat.isFile()) {
        throw new SkillMarketError(t("skill.market.localZipLayout"));
      }
    } catch (error) {
      if (error instanceof SkillMarketError) {
        throw error;
      }
      throw new SkillMarketError(t("skill.market.localZipLayout"));
    }
  } else {
    throw new SkillMarketError(t("skill.market.localZipLayout"));
  }
  const skillStat = await fs.lstat(path.join(skillDirectory, "SKILL.md"));
  if (!skillStat.isFile()) {
    throw new SkillMarketError(t("skill.market.localZipLayout"));
  }
  const content = await fs.readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
  const description = extractSkillDescription(content, skillDescriptionStrategies.continueOnEmpty);
  return {
    identifier: skillName,
    packages: [{ name: skillName, directory: skillDirectory, ...(description ? { description: description.trim() } : {}) }],
  };
}

async function installLocalSkillArchive(
  options: LocalSkillZipOptions,
  platforms: CliGlobalSkillPlatform[],
): Promise<SkillArchiveInstallResult> {
  if (typeof options.fileName !== "string" || !/\.zip$/i.test(path.basename(options.fileName))) {
    throw new SkillMarketError(t("skill.market.invalidLocalZip"));
  }
  return installSkillArchive({
    zipBytes: options.zipBytes,
    maxZipBytes: MAX_SKILL_ZIP_BYTES,
    tempPrefix: "sinitek-local-skill-",
    platforms,
    resolvePackages: (tempRoot) => resolveLocalSkillPackage(tempRoot, options.fileName),
  });
}

export async function installLocalSkillZip(
  input: unknown,
  options: LocalSkillZipOptions,
): Promise<SkillArchiveInstallResult> {
  const record = asRecord(input) ?? {};
  const platforms = normalizePlatforms(record.platforms);
  if (!options || !Buffer.isBuffer(options.zipBytes) || typeof options.fileName !== "string") {
    throw new SkillMarketError(t("skill.market.invalidLocalZip"));
  }
  return installLocalSkillArchive(options, platforms);
}

export async function installLocalSkillZipFromPath(input: unknown, filePath: string): Promise<SkillArchiveInstallResult> {
  if (typeof filePath !== "string" || !/\.zip$/i.test(path.basename(filePath))) {
    throw new SkillMarketError(t("skill.market.invalidLocalZip"));
  }
  const fileStat = await fs.stat(filePath);
  if (!fileStat.isFile()) {
    throw new SkillMarketError(t("skill.market.invalidLocalZip"));
  }
  if (fileStat.size > MAX_SKILL_ZIP_BYTES) {
    throw new SkillMarketError(t("skill.market.tooLarge"));
  }
  const zipBytes = await fs.readFile(filePath);
  return installLocalSkillZip(input, { fileName: path.basename(filePath), zipBytes });
}
