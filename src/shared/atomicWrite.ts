import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

export type AtomicWriteOptions = {
  encoding?: BufferEncoding;
  mode?: number;
  followSymlinks?: boolean;
};

function createTempSiblingPath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `.sinitek-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
}

export function writeFileAtomicallySync(filePath: string, content: string): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = createTempSiblingPath(filePath);
  try {
    fsSync.writeFileSync(tempPath, content, "utf8");
    fsSync.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fsSync.rmSync(tempPath, { force: true });
    } catch {}
    throw error;
  }
}

export async function writeFileAtomically(
  filePath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<void> {
  let target = filePath;
  let existingMode: number | undefined;
  const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const symlink = existing?.isSymbolicLink();
  if (options.followSymlinks && symlink) target = await fs.realpath(target);
  const stat = options.followSymlinks && symlink ? await fs.stat(target) : existing;
  if (stat?.isFile()) {
    existingMode = stat.mode & 0o777;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tempPath = createTempSiblingPath(target);
  const encoding = options.encoding ?? "utf8";
  try {
    await fs.writeFile(tempPath, content, { encoding, mode: options.mode ?? existingMode });
    if (existingMode !== undefined && options.mode === undefined) await fs.chmod(tempPath, existingMode);
    await fs.rename(tempPath, target);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
