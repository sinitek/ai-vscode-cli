import * as fs from "fs";
import * as os from "os";
import { createHash, randomBytes } from "crypto";

let localHostScope: string | undefined;

export function configureLoopTaskLockHost(machineId: string | undefined): void {
  localHostScope = undefined;
  if (!machineId?.trim()) return;
  try {
    const host = [machineId, os.hostname(), process.platform];
    if (process.platform === "linux") host.push(fs.readlinkSync("/proc/self/ns/pid"), fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
    localHostScope = createHash("sha256").update(JSON.stringify(host)).digest("hex");
  } catch { return; }
}

export function recordLoopTaskLockOwner(fd: number): void {
  if (localHostScope) fs.writeFileSync(fd, JSON.stringify({ version: 1, host: localHostScope, pid: process.pid, token: randomBytes(16).toString("hex") }));
}

function readLock(lockFile: string) {
  const stat = fs.lstatSync(lockFile);
  if (!stat.isFile() || stat.size === 0 || stat.size > 1024) return null;
  return { stat, bytes: fs.readFileSync(lockFile, "utf8") };
}

export function recoverExitedLoopTaskLock(lockFile: string): boolean {
  if (!localHostScope) return false;
  try {
    const original = readLock(lockFile);
    if (!original) return false;
    const marker = JSON.parse(original.bytes);
    if (marker?.version !== 1 || marker.host !== localHostScope || typeof marker.token !== "string"
      || !/^[a-f0-9]{32}$/u.test(marker.token) || !Number.isSafeInteger(marker.pid) || marker.pid <= 0) return false;
    try { process.kill(marker.pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }

    const claim = `${lockFile}.${marker.token}.recover`;
    fs.mkdirSync(claim, { mode: 0o700 });
    try {
      const current = readLock(lockFile);
      if (!current || current.bytes !== original.bytes || current.stat.dev !== original.stat.dev || current.stat.ino !== original.stat.ino) return false;
      fs.unlinkSync(lockFile);
      return true;
    } finally { fs.rmdirSync(claim); }
  } catch { return false; }
}

export function describeLoopTaskLock(lockFile: string): { lockAgeMs?: number; holderPid?: number } {
  try {
    const lock = readLock(lockFile);
    if (!lock) return {};
    const age = { lockAgeMs: Math.max(0, Date.now() - Math.trunc(lock.stat.mtimeMs)) };
    try {
      const marker = JSON.parse(lock.bytes);
      if (localHostScope && marker?.version === 1 && marker.host === localHostScope && Number.isSafeInteger(marker.pid) && marker.pid > 0) {
        return { ...age, holderPid: marker.pid };
      }
    } catch {}
    return age;
  } catch { return {}; }
}
