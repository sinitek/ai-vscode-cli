import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

export type AtomicWriteOptions = {
  encoding?: BufferEncoding;
  mode?: number;
};

export function writeFileAtomicallySync(filePath: string, content: string): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
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
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const encoding = options.encoding ?? "utf8";
  try {
    await fs.writeFile(tempPath, content, options.mode === undefined
      ? { encoding }
      : { encoding, mode: options.mode });
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (process.platform !== "win32") {
        throw error;
      }
      await fs.rm(filePath, { force: true });
      await fs.rename(tempPath, filePath);
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
