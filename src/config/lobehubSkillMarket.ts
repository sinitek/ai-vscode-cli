import * as fs from "fs/promises";
import * as path from "path";
import { t } from "../i18n";
import { extractSkillDescription, skillDescriptionStrategies } from "./skillDiscovery";
import {
  asRecord,
  errorMessage,
  installSkillArchive,
  isSkillDirectoryName,
  MAX_SKILL_ZIP_BYTES,
  normalizePlatforms,
  SkillMarketError,
  type SkillArchiveInstallResult,
  type SkillArchiveInstallTarget,
} from "./skillArchiveInstaller";

export { MAX_SKILL_ZIP_BYTES } from "./skillArchiveInstaller";
export { installLocalSkillZip, installLocalSkillZipFromPath, type LocalSkillZipOptions } from "./localSkillZip";

const SEARCH_URL = "https://lobehub.com/api/discover/skills";
const DOWNLOAD_ORIGIN = "https://market.lobehub.com";
const SEARCH_HOSTS = new Set(["lobehub.com", "www.lobehub.com"]);
const DOWNLOAD_HOSTS = new Set(["market.lobehub.com"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const MARKET_USER_AGENT = "sinitek-cli-tools";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

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

export type LobehubSkillInstallTarget = SkillArchiveInstallTarget;
export type LobehubSkillInstallResult = SkillArchiveInstallResult;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LobehubSkillMarketOptions = {
  fetchImpl?: FetchLike;
  maxZipBytes?: number;
};

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
  const maxZipBytes = options.maxZipBytes ?? MAX_SKILL_ZIP_BYTES;
  const downloadUrl = `${DOWNLOAD_ORIGIN}/api/v1/skills/${encodeURIComponent(identifier)}/download`;
  const zipBytes = await fetchAllowed(downloadUrl, DOWNLOAD_HOSTS, fetchImpl, maxZipBytes, "skill.market.downloadFailed");
  return installSkillArchive({
    zipBytes,
    maxZipBytes,
    tempPrefix: "sinitek-lobehub-skill-",
    platforms,
    resolvePackages: async (tempRoot) => {
      const packages = await findSkillPackages(tempRoot, identifier);
      if (packages.length === 0) {
        throw new SkillMarketError(t("skill.market.noSkill"));
      }
      return { identifier, packages };
    },
  });
}
