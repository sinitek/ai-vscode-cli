import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { spawn } from "cross-spawn";
import { resolveCliCommand, splitConfiguredCliCommand } from "../cli/commandResolution";
import { getMacTaskShell } from "../cli/config";
import { buildShellCommandLine, killProcessTree } from "./codexRunnerProcess";

export type CodexThreadUnloadCapability = {
  supported: boolean;
  reason: "supported" | "unsupported" | "unknown";
  version?: string;
};

type Input = { command: string; cwd?: string; env?: NodeJS.ProcessEnv };
type Launch = { command: string; args: string[]; identity: string[] };
const UNKNOWN: CodexThreadUnloadCapability = { supported: false, reason: "unknown" };
const CACHE_LIMIT = 64;
const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;
const OUTPUT_LIMIT = 4_096;
const MAX_PENDING_PROBES = 4;

// Exact upstream contracts, NOT a semver range or an adjacent npm package version.
// https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/config.schema.json
// https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/core/config.schema.json
// Both define this uint64 field, default 60, and explicitly document zero as immediate.
// 0.162.1 resolves it at server startup; 0.167.0 resolves it on each thread load.
// https://github.com/openai/codex/blob/rust-v0.100.0/codex-rs/core/config.schema.json
// The last schema has no such field. Other versions (including prereleases) are unknown.
const VERSION_CONTRACTS = new Map<string, boolean>([
  ["0.162.1", true],
  ["0.167.0", true],
  ["0.100.0", false],
]);

const cache = new Map<string, { expires: number; result: CodexThreadUnloadCapability }>();
const pending = new Map<string, Promise<CodexThreadUnloadCapability>>();
// Timed-out probes still own a process/isolated HOME until close proves otherwise.
// Keep their slots occupied even after the bounded capability result has returned.
let liveProbes = 0;

// Only resolution/runtime necessities enter the probe. No auth, original HOME/config,
// NODE_OPTIONS/preloads, model/provider variables, or user session state are forwarded.
const PROBE_ENV_KEYS = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC"]);

function fileIdentity(filename: string): string {
  try {
    const real = fs.realpathSync(filename);
    const stat = fs.statSync(real);
    return JSON.stringify([real, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
  } catch {
    return JSON.stringify([filename, "missing"]);
  }
}

function launcherIdentity(command: string): string[] {
  const identities = [fileIdentity(command)];
  // npm shims can remain unchanged when the native payload is replaced. Track payloads
  // as identities only; package.json versions never decide capability support.
  const real = fs.realpathSync(command);
  const roots = [
    path.join(path.dirname(command), "node_modules", "@openai", "codex"),
    ...(path.basename(real) === "codex.js" ? [path.dirname(path.dirname(real))] : []),
  ];
  const triple = ({
    "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc",
    "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl",
  } as Record<string, string>)[`${process.platform}-${process.arch}`];
  for (const root of roots) {
    identities.push(fileIdentity(path.join(root, "bin", "codex.js")));
    if (triple) {
      const binary = path.join("vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex");
      identities.push(fileIdentity(path.join(root, binary)));
      identities.push(fileIdentity(path.join(root, "node_modules", "@openai", `codex-${process.platform}-${process.arch}`, binary)));
      identities.push(fileIdentity(path.join(path.dirname(root), `codex-${process.platform}-${process.arch}`, binary)));
    }
  }
  return identities;
}

function resolveLaunch(input: Input): Launch | undefined {
  const env = input.env ?? process.env;
  // An existing whole path may contain spaces without quoting, as in the runner.
  const whole = resolveCliCommand(input.command, { cwd: input.cwd, env });
  const parts = whole ? [whole.command] : splitConfiguredCliCommand(input.command);
  const executable = parts[0];
  if (!executable) { return undefined; }
  // Never pass arbitrary configured flags (-c, --profile, tokens, prompts) to a probe.
  // Node + one script is a supported wrapper; package managers / shell expressions
  // are deliberately unknown, since probing them could install or run other commands.
  let prefix: string[] = [];
  if (parts.length > 1) {
    if (parts.length !== 2 || !/^node(?:\.exe)?$/i.test(path.basename(executable)) || !/\.[cm]?js$/i.test(parts[1])) {
      return undefined;
    }
    prefix = [path.resolve(input.cwd ?? process.cwd(), parts[1])];
  }
  const resolved = whole ?? resolveCliCommand(executable, { cwd: input.cwd, env });
  if (resolved) {
    return {
      command: path.resolve(resolved.command), args: [...prefix, "--version"],
      identity: [...launcherIdentity(resolved.command), ...prefix.flatMap(launcherIdentity)],
    };
  }
  if (process.platform !== "darwin" || prefix.length) { return undefined; }
  // Match the runner's macOS login-shell fallback and argument escaping. Shell-only
  // resolution has no observable executable identity, so it is never cached as supported.
  const shell = getMacTaskShell() === "bash" ? "/bin/bash" : "/bin/zsh";
  return { command: shell, args: ["-lc", buildShellCommandLine(executable, ["--version"])], identity: [] };
}

async function probe(launch: Launch, env: NodeJS.ProcessEnv): Promise<CodexThreadUnloadCapability> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-codex-capability-"));
  const cleanup = (): void => {
    try { fs.rmSync(temp, { recursive: true, force: true }); }
    catch { /* Leave an unremoved isolated directory; never claim cleanup succeeded. */ }
  };
  let ownsChild = false;
  try {
    const isolatedEnv: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
      if (PROBE_ENV_KEYS.has(key.toUpperCase())) { isolatedEnv[key] = value; }
    }
    Object.assign(isolatedEnv, {
      HOME: temp, USERPROFILE: temp, CODEX_HOME: temp, CODEX_HOME_DIR: temp,
      APPDATA: temp, LOCALAPPDATA: temp, XDG_CONFIG_HOME: temp, XDG_DATA_HOME: temp,
      XDG_STATE_HOME: temp, XDG_CACHE_HOME: temp, TMPDIR: temp, TMP: temp, TEMP: temp,
    });
    return await new Promise<CodexThreadUnloadCapability>((resolve) => {
      let settled = false;
      let output = "";
      let bytes = 0;
      let timer: NodeJS.Timeout | undefined;
      const child = spawn(launch.command, launch.args, {
        cwd: temp, env: isolatedEnv, windowsHide: true, detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      ownsChild = true;
      liveProbes += 1;
      const finish = (result: CodexThreadUnloadCapability, terminate = false): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        if (terminate) {
          // This handle belongs exclusively to this probe. Never kill by discovered PID.
          // A kill request is not exit evidence. Keep draining pipes and retain HOME
          // and the live slot until close; an unresponsive child cannot bypass the cap.
          try { killProcessTree(child, "SIGKILL"); } catch { /* Still await close. */ }
        }
        resolve(result);
      };
      const consume = (data: Buffer, stdout: boolean): void => {
        if (settled) { return; }
        bytes += data.length;
        if (bytes > OUTPUT_LIMIT) { finish(UNKNOWN, true); return; }
        if (stdout) { output += data.toString("utf8"); }
      };
      child.stdout?.on("data", (data: Buffer) => consume(data, true));
      child.stderr?.on("data", (data: Buffer) => consume(data, false));
      child.once("error", () => finish(UNKNOWN, true));
      child.once("close", (code) => {
        liveProbes -= 1;
        cleanup();
        const version = /^codex-cli (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/u.exec(output.trim())?.[1];
        if (code !== 0 || !version) { finish(UNKNOWN); return; }
        const supported = launch.identity.length ? VERSION_CONTRACTS.get(version) : undefined;
        finish({ supported: supported === true, reason: supported === undefined ? "unknown" : supported ? "supported" : "unsupported", version });
      });
      timer = setTimeout(() => finish(UNKNOWN, true), PROBE_TIMEOUT_MS);
    });
  } finally {
    // spawn throwing creates no child. All successfully created children clean up
    // exclusively on close, including error, output-limit and timeout paths.
    if (!ownsChild) { cleanup(); }
  }
}

/** Resolve only before plugin-owned app-server startup; this is not writer-release evidence. */
export async function resolveCodexThreadUnloadCapability(input: Input): Promise<CodexThreadUnloadCapability> {
  try {
    const launch = resolveLaunch(input);
    if (!launch) { return { ...UNKNOWN }; }
    const env = input.env ?? process.env;
    // Hash context so neither credentials nor original config values are retained in keys.
    const key = createHash("sha256").update(JSON.stringify([
      process.platform, process.arch, path.resolve(input.cwd ?? process.cwd()), launch,
      Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
    ])).digest("hex");
    const now = Date.now();
    for (const [oldKey, value] of cache) {
      if (value.expires <= now) { cache.delete(oldKey); }
    }
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); cache.set(key, cached);
      return { ...cached.result };
    }
    const current = pending.get(key);
    if (current) { return { ...await current }; }
    if (pending.size >= MAX_PENDING_PROBES || liveProbes >= MAX_PENDING_PROBES) { return { ...UNKNOWN }; }
    const operation = probe(launch, env).catch(() => ({ ...UNKNOWN }));
    pending.set(key, operation);
    try {
      const result = await operation;
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
      while (cache.size > CACHE_LIMIT) { cache.delete(cache.keys().next().value!); }
      return { ...result };
    } finally {
      pending.delete(key);
    }
  } catch {
    return { ...UNKNOWN };
  }
}
