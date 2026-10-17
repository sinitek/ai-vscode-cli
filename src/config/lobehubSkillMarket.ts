import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { fromBufferPromise, validateFileName, type Entry, type ZipFile } from "yauzl";
import { t } from "../i18n";
import { extractSkillDescription, skillDescriptionStrategies } from "./skillDiscovery";
import {
  installCliSkillDirectory,
  type CliGlobalSkillPlatform,
} from "./cliGlobalSkills";

const SEARCH_URL = "https://lobehub.com/api/discover/skills";
const DOWNLOAD_ORIGIN = "https://market.lobehub.com";
const SEARCH_HOSTS = new Set(["lobehub.com", "www.lobehub.com"]);
const DOWNLOAD_HOSTS = new Set(["market.lobehub.com"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const MARKET_USER_AGENT = "sinitek-cli-tools";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_REDIRECTS = 3;
const CLI_PLATFORMS: readonly CliGlobalSkillPlatform[] = ["claude", "codex", "opencode", "grok"];

export type LobehubSkillMarketItem = {
  identifier: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  installCount?: number;
  homepage?: string;
};

export type LobehubSkillMarketPage = {
  query: string;
  items: LobehubSkillMarketItem[];
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type LobehubSkillInstallTarget = {
  platform: CliGlobalSkillPlatform;
  name: string;
  status: "installed" | "failed";
  message?: string;
};

export type LobehubSkillInstallResult = {
  identifier: string;
  skills: Array<{ name: string; description?: string }>;
  targets: LobehubSkillInstallTarget[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LobehubSkillMarketOptions = {
  fetchImpl?: FetchLike;
  maxZipBytes?: number;
};

class SkillMarketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillMarketError";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return t("common.unknownError");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeQuery(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new SkillMarketError(t("skill.market.invalidQuery"));
  }
  const query = value.trim();
  if (query.length > 200) {
    throw new SkillMarketError(t("skill.market.invalidQuery"));
  }
  return query;
}

function normalizePage(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 1;
  }
  const page = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    throw new SkillMarketError(t("skill.market.invalidPage"));
  }
  return page;
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new SkillMarketError(t("skill.market.invalidIdentifier"));
  }
  return value;
}

function normalizePlatforms(value: unknown): CliGlobalSkillPlatform[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SkillMarketError(t("skill.market.invalidPlatforms"));
  }
  const platforms: CliGlobalSkillPlatform[] = [];
  for (const item of value) {
    if (!CLI_PLATFORMS.includes(item as CliGlobalSkillPlatform)) {
      throw new SkillMarketError(t("skill.global.invalidPlatform"));
    }
    const platform = item as CliGlobalSkillPlatform;
    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }
  return platforms;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readFrontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return undefined;
  }
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}:`)) {
      continue;
    }
    const raw = trimmed.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
    return raw || undefined;
  }
  return undefined;
}

function isSkillDirectoryName(name: string): boolean {
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
    throw new SkillMarketError(t("skill.market.downloadFailed", { error: "响应不是 ZIP" }));
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

async function fetchAllowed(
  url: string,
  allowedHosts: Set<string>,
  fetchImpl: FetchLike,
  maxBytes: number,
  failureKey: "skill.market.searchFailed" | "skill.market.downloadFailed",
): Promise<Buffer> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = new URL(current);
      if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
        throw new SkillMarketError(t(failureKey, { error: "不允许的地址" }));
      }
      const response = await fetchImpl(current, {
        redirect: "manual",
        headers: {
          Accept: failureKey === "skill.market.searchFailed" ? "application/json" : "application/zip",
          "User-Agent": MARKET_USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) {
          throw new SkillMarketError(t(failureKey, { error: "重定向无效" }));
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) {
        throw new SkillMarketError(t(failureKey, { error: `HTTP ${response.status}` }));
      }
      const declaredLength = Number(response.headers.get("content-length") || "");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new SkillMarketError(t("skill.market.tooLarge"));
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new SkillMarketError(t("skill.market.tooLarge"));
      }
      return buffer;
    }
  } catch (error) {
    if (error instanceof SkillMarketError) {
      throw error;
    }
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SkillMarketError(t(failureKey, { error: "请求超时" }));
    }
    throw new SkillMarketError(t(failureKey, { error: errorMessage(error) }));
  }
  throw new SkillMarketError(t(failureKey, { error: "重定向无效" }));
}

function parseMarketPage(payload: unknown, query: string, page: number): LobehubSkillMarketPage {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.items)) {
    throw new SkillMarketError(t("skill.market.searchFailed", { error: "响应格式不正确" }));
  }
  const items: LobehubSkillMarketItem[] = [];
  for (const item of record.items) {
    const source = asRecord(item);
    const identifier = optionalString(source?.identifier);
    const name = optionalString(source?.name);
    if (!source || !identifier || !IDENTIFIER_PATTERN.test(identifier) || !name) {
      continue;
    }
    const description = optionalString(source.description) ?? "";
    const parsed: LobehubSkillMarketItem = { identifier, name, description };
    const author = optionalString(source.author);
    const version = optionalString(source.version);
    const homepage = optionalString(source.homepage);
    const installCount = finiteNumber(source.installCount);
    if (author) {
      parsed.author = author;
    }
    if (version) {
      parsed.version = version;
    }
    if (homepage) {
      parsed.homepage = homepage;
    }
    if (installCount !== undefined) {
      parsed.installCount = installCount;
    }
    items.push(parsed);
  }
  const currentPage = positiveInteger(record.currentPage, page) || page;
  const pageSize = positiveInteger(record.pageSize, items.length);
  const totalCount = positiveInteger(record.totalCount, items.length);
  const totalPages = positiveInteger(record.totalPages, items.length > 0 ? 1 : 0);
  return { query, items, currentPage, pageSize, totalCount, totalPages };
}

async function findSkillPackages(root: string, identifier: string): Promise<Array<{ name: string; directory: string; description?: string }>> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      matches.push(directory);
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) {
        continue;
      }
      await visit(path.join(directory, entry.name));
    }
  };
  await visit(root);
  const skills: Array<{ name: string; directory: string; description?: string }> = [];
  for (const directory of matches) {
    const content = await fs.readFile(path.join(directory, "SKILL.md"), "utf8");
    const frontmatterName = readFrontmatterValue(content, "name");
    const directoryName = path.basename(directory);
    const name = [frontmatterName, directory === root ? undefined : directoryName, identifier].find(
      (candidate): candidate is string => !!candidate && isSkillDirectoryName(candidate),
    );
    if (!name) {
      throw new SkillMarketError(t("skill.market.noSkill"));
    }
    const description = extractSkillDescription(content, skillDescriptionStrategies.continueOnEmpty);
    const skill: { name: string; directory: string; description?: string } = { name, directory };
    if (description) {
      skill.description = description.trim();
    }
    skills.push(skill);
  }
  skills.sort((left, right) => left.name.localeCompare(right.name) || left.directory.localeCompare(right.directory));
  return skills;
}

export async function searchLobehubSkills(
  input: unknown,
  options: LobehubSkillMarketOptions = {},
): Promise<LobehubSkillMarketPage> {
  const record = asRecord(input) ?? {};
  const query = normalizeQuery(record.query);
  const page = normalizePage(record.page);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("locale", "zh");
  url.searchParams.set("page", String(page));
  if (query) {
    url.searchParams.set("q", query);
  }
  const buffer = await fetchAllowed(url.toString(), SEARCH_HOSTS, fetchImpl, MAX_SEARCH_BYTES, "skill.market.searchFailed");
  let payload: unknown;
  try {
    payload = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new SkillMarketError(t("skill.market.searchFailed", { error: "响应格式不正确" }));
  }
  return parseMarketPage(payload, query, page);
}

export async function installLobehubSkill(
  input: unknown,
  options: LobehubSkillMarketOptions = {},
): Promise<LobehubSkillInstallResult> {
  const record = asRecord(input) ?? {};
  const identifier = normalizeIdentifier(record.identifier);
  const platforms = normalizePlatforms(record.platforms);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxZipBytes = options.maxZipBytes ?? MAX_ZIP_BYTES;
  const downloadUrl = `${DOWNLOAD_ORIGIN}/api/v1/skills/${encodeURIComponent(identifier)}/download`;
  const zipBytes = await fetchAllowed(downloadUrl, DOWNLOAD_HOSTS, fetchImpl, maxZipBytes, "skill.market.downloadFailed");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-lobehub-skill-"));
  try {
    await extractZipToDirectory(zipBytes, tempRoot, maxZipBytes);
    const packages = await findSkillPackages(tempRoot, identifier);
    if (packages.length === 0) {
      throw new SkillMarketError(t("skill.market.noSkill"));
    }
    const targets: LobehubSkillInstallTarget[] = [];
    for (const skill of packages) {
      for (const platform of platforms) {
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
