import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";

const originalHomedir = os.homedir;
const originalCodexHome = process.env.CODEX_HOME;
const originalCodexHomeDir = process.env.CODEX_HOME_DIR;
const originalGrokHome = process.env.GROK_HOME;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalDshHome = process.env.DSH_HOME;
const originalKimiCodeHome = process.env.KIMI_CODE_HOME;
const originalZcodeDataBaseDir = process.env.ZCODE_DATA_BASE_DIR;
const originalDshApiKey = process.env.SINITEK_DSH_API_KEY;

type ZipEntry = {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  flags?: number;
  versionMadeBy?: number;
  externalAttributes?: number;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = (crc & 1) !== 0 ? 0xedb88320 : 0;
      crc = (crc >>> 1) ^ mask;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const stored = method === 8 ? zlib.deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, stored]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionMadeBy ?? 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(localRecord);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

export function skillMarkdown(name: string, description: string): Buffer {
  return Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}

export function zipResponse(body: Buffer, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/zip", ...headers },
  });
}

export async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinitek-lobehub-market-"));
  const homeDir = path.join(temp, "home");
  await fs.promises.mkdir(homeDir, { recursive: true });
  Object.defineProperty(os, "homedir", { configurable: true, value: () => homeDir });
  delete process.env.CODEX_HOME;
  delete process.env.CODEX_HOME_DIR;
  delete process.env.GROK_HOME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.DSH_HOME;
  delete process.env.KIMI_CODE_HOME;
  delete process.env.ZCODE_DATA_BASE_DIR;
  delete process.env.SINITEK_DSH_API_KEY;
  try {
    return await run(homeDir);
  } finally {
    Object.defineProperty(os, "homedir", { configurable: true, value: originalHomedir });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalCodexHomeDir === undefined) delete process.env.CODEX_HOME_DIR;
    else process.env.CODEX_HOME_DIR = originalCodexHomeDir;
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    if (originalDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = originalDshHome;
    if (originalKimiCodeHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = originalKimiCodeHome;
    if (originalZcodeDataBaseDir === undefined) delete process.env.ZCODE_DATA_BASE_DIR;
    else process.env.ZCODE_DATA_BASE_DIR = originalZcodeDataBaseDir;
    if (originalDshApiKey === undefined) delete process.env.SINITEK_DSH_API_KEY;
    else process.env.SINITEK_DSH_API_KEY = originalDshApiKey;
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}
