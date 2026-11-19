import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { sameExecution, fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "./departmentexecutionidentity";
import { randomBytes } from "crypto";
import { runCliProcess } from "../cli/cliProcessRuntime";
import { createOpenCodeRuntimeConfigOverlay } from "../cli/opencoderuntimeconfig";
import { record } from "./departmentexecutionidentity";

/** Private fork payload, never part of the public Owner protocol. Issued only
 * by the same-host producer from an original stopped client and retired root. */
export type DepartmentOpenCodeRetiredSession = {
  identity: DepartmentExecutionIdentity;
  selection: DepartmentExecutionSelection;
  directory: string;
};
export function assertRetiredOpenCodeSession(source: DepartmentOpenCodeRetiredSession,
  target: DepartmentExecutionIdentity, selection: DepartmentExecutionSelection): void {
  const i = source.identity, f = fingerprintDepartmentExecutionSelection(selection);
  if (i.cli !== "opencode" || target.cli !== "opencode" || i.role !== target.role
    || i.session.state !== "bound" || target.session.state !== "bound" || i.session.id !== target.session.id
    || i.workspace !== target.workspace || i.rootTaskId !== target.rootTaskId || i.leaderTaskId !== target.leaderTaskId
    || i.moduleId !== target.moduleId || i.generation > target.generation || i.ownerId === target.ownerId
    || i.executionId === target.executionId || sameExecution(i, target)
    || i.configFingerprint !== f.configFingerprint || i.profileFingerprint !== f.profileFingerprint
    || JSON.stringify(source.selection) !== JSON.stringify(selection)
    || i.role === "leader" && i.generation === target.generation
    || i.role === "employee" && (!i.subtaskId || !i.attemptId || target.role !== "employee" || i.attemptId === target.attemptId)
    || !path.isAbsolute(source.directory) || path.normalize(source.directory) !== source.directory
    || fs.lstatSync(source.directory, { throwIfNoEntry: false })) throw new Error("native-session-retired-source-conflict");
}
export type OpenCodeNativeSessionPreparation = {
  workspaceDirectory: string;
  sessionState: "unbound" | "bound";
  sessionId?: string;
  /** Leader generations require the native event directory to equal the owned root. */
  requireDirectory?: true;
  retired?: DepartmentOpenCodeRetiredSession;
  /** Original root/configuration/phase capability; rechecked across every await. */
  assertCurrent?: () => void | Promise<void>;
  launch: {
    command: string;
    args: string[];
    cwd?: string;
    baseEnvironment?: NodeJS.ProcessEnv;
    envOverrides?: Record<string, string>;
    processLabel?: string;
    macTaskShell?: "bash" | "zsh";
  };
  overlay: Parameters<typeof createOpenCodeRuntimeConfigOverlay>[0] | null;
};

/** Private worker capability: only this invocation's authenticated loopback server is used.
 * No prompt endpoint, shared service adoption, native database writes or invented IDs. */
export async function createDepartmentOpenCodeSession(input: OpenCodeNativeSessionPreparation, signal: AbortSignal): Promise<string> {
  const check = async () => {
    if (signal.aborted) throw new Error("native-session-preparation-revoked");
    await input.assertCurrent?.();
    if (input.retired && fs.lstatSync(input.retired.directory, { throwIfNoEntry: false }))
      throw new Error("native-session-retired-root-reoccupied");
  };
  await check();
  if (input.retired && (input.sessionState !== "bound" || input.retired.identity.session.state !== "bound"
    || input.retired.identity.session.id !== input.sessionId)) throw new Error("native-session-retired-source-conflict");
  const runIndex = input.launch.args.indexOf("run");
  if ((input.sessionState !== "unbound" && input.sessionState !== "bound")
    || (input.sessionState === "bound" && !/^ses_[A-Za-z0-9]+$/.test(input.sessionId ?? ""))
    || runIndex < 0 || signal.aborted) throw new Error("native-session-preparation-revoked");
  const overlayResult = input.overlay ? createOpenCodeRuntimeConfigOverlay(input.overlay) : null;
  if (overlayResult && (!overlayResult.ok || !overlayResult.overlay)) throw new Error("native-session-overlay-unavailable");
  const overlay = overlayResult?.overlay ?? null;
  const password = randomBytes(32).toString("hex");
  let output = "", resolveReady!: (url: string) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const child = runCliProcess({ ...input.launch, cwd: input.workspaceDirectory, overlay,
    args: [...input.launch.args.slice(0, runIndex), "serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"],
    envOverrides: { ...input.launch.envOverrides, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password },
  }, {
    onStdout(chunk) {
      if (output.length + chunk.length > 65536) { rejectReady(new Error("native-server-output-limit")); return; }
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:([0-9]{1,5})(?=\s)/);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) resolveReady(match[0]);
    },
    onStderr: () => undefined,
    onError: () => rejectReady(new Error("native-server-error")),
    onExit: () => rejectReady(new Error("native-server-closed")),
  }, "ignore");
  let stopRequested = false;
  const stop = () => { if (!stopRequested) { stopRequested = true; child.kill(); } };
  const abort = () => { rejectReady(new Error("native-session-preparation-revoked")); stop(); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => rejectReady(new Error("native-server-start-timeout")), 10000);
  let id: string;
  try {
    if (signal.aborted) abort();
    const url = await ready;
    clearTimeout(timer); await check();
    const request = async (method: "POST" | "GET", pathname: string, body?: unknown) => {
      await check();
      const value = await requestJson(url, method, pathname, input.workspaceDirectory, password, signal, body);
      await check(); return value;
    };
    const created = input.sessionState === "unbound" ? await request("POST", "/session")
      : await request("GET", `/session/${encodeURIComponent(input.sessionId!)}`);
    if (signal.aborted || !record(created) || typeof created.id !== "string" || !/^ses_[A-Za-z0-9]+$/.test(created.id)) {
      throw new Error("native-session-create-invalid");
    }
    if (input.sessionState === "bound" && created.id !== input.sessionId) throw new Error("native-session-create-conflict");
    const assertDirectory = (value: Record<string, unknown>) => {
      if (input.requireDirectory && (typeof value.directory !== "string"
        || fs.realpathSync(value.directory) !== fs.realpathSync(input.workspaceDirectory))) {
        throw new Error("native-session-directory-conflict");
      }
    };
    if (input.retired) {
      // Source path is the canonical value fixed by the original capability;
      // it has been removed, so re-realpath would manufacture a new identity.
      if (created.directory !== input.retired.directory || created.parentID || created.workspaceID)
        throw new Error("native-session-retired-source-conflict");
      const moved = await request("POST", "/experimental/control-plane/move-session", {
        sessionID: created.id, destination: { directory: fs.realpathSync(input.workspaceDirectory) }, moveChanges: false,
      });
      if (moved !== null) throw new Error("native-session-move-response-invalid");
    } else assertDirectory(created);
    id = created.id; // Freeze the single response; never issue a second POST on failure.
    const verified = await request("GET", `/session/${encodeURIComponent(id)}`);
    if (signal.aborted || !record(verified) || verified.id !== id) throw new Error("native-session-create-conflict");
    assertDirectory(verified);
    if (input.retired && (verified.projectID !== created.projectID || verified.parentID || verified.workspaceID))
      throw new Error("native-session-move-readback-conflict");
    await check();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    stop();
    // A kill/timeout/error is never close or drain proof. Hold the config lease until this join.
    const facts = await child.lifecycle;
    if (!facts || facts.processTerminal.status !== "confirmed" || facts.streams.status !== "confirmed"
      || overlay && facts.temp.status !== "confirmed") throw new Error("native-server-close-unobservable");
  }
  await check();
  return id;
}

function requestJson(base: string, method: "POST" | "GET", pathname: string, directory: string, password: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, base); url.searchParams.set("directory", directory);
    const request = http.request(url, { method, signal, headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("error", () => reject(new Error("native-session-response-error")));
      response.on("data", (chunk: string) => {
        if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > 1024 * 1024) request.destroy(new Error("native-session-response-limit"));
        else body += chunk;
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { reject(new Error("native-session-http-error")); return; }
        try { resolve(body ? JSON.parse(body) : null); } catch { reject(new Error("native-session-response-invalid")); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error("native-session-request-timeout")), 10000);
    request.once("close", () => clearTimeout(deadline));
    request.on("error", () => reject(new Error("native-session-request-failed")));
    request.end(method === "POST" ? JSON.stringify(body ?? {}) : undefined);
  });
}
