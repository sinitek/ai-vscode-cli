import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";
import { parseJsonObjectText } from "../shared/jsonObject";
import {
  applyOpenCodeRuntimeModelOverlay,
  type OpenCodeConfigModelIssue,
} from "./opencodeconfigmodels";

export type OpenCodeRuntimeConfigOverlay = {
  configPath: string;
  envOverrides: Record<string, string>;
  cleanup: () => CleanupResult;
};

export type OpenCodeRuntimeConfigOverlayResult = {
  ok: boolean;
  overlay: OpenCodeRuntimeConfigOverlay | null;
  issues: OpenCodeConfigModelIssue[];
};

export function createOpenCodeRuntimeConfigOverlay(input: {
  configContent: string;
  mainModel?: string | null;
  subtaskModel?: string | null;
  mainVariant?: string | null;
  subtaskVariant?: string | null;
  /** @deprecated Use mainModel. */
  primaryModel: string;
  /** @deprecated Use subtaskModel. */
  smallModel: string | null;
  /** @deprecated Use mainVariant. */
  primaryVariant?: string | null;
  /** @deprecated Use subtaskVariant. */
  smallVariant?: string | null;
}): OpenCodeRuntimeConfigOverlayResult {
  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = parseJsonObjectText(input.configContent, {
      mode: "jsonc",
      rootErrorMessage: "OpenCode config must be a JSON object.",
    });
  } catch (error) {
    return {
      ok: false,
      overlay: null,
      issues: [{
        code: "invalid-json",
        severity: "error",
        message: `OpenCode config JSON is invalid: ${(error as Error).message}`,
      }],
    };
  }
  const applied = applyOpenCodeRuntimeModelOverlay(
    parsedConfig,
    {
      main: input.mainModel ?? input.primaryModel,
      subtask: input.subtaskModel ?? input.smallModel,
      mainVariant: input.mainVariant ?? input.primaryVariant ?? null,
      subtaskVariant: input.subtaskVariant ?? input.smallVariant ?? null,
    }
  );
  if (!applied.ok || !applied.config) {
    return { ok: false, overlay: null, issues: applied.issues };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-opencode-"));
  try {
    fs.chmodSync(tempDir, 0o700);
  } catch {
  }
  const configPath = path.join(tempDir, `config-${randomBytes(12).toString("hex")}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(applied.config, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  const created = fs.lstatSync(tempDir);
  return {
    ok: true,
    issues: applied.issues,
    overlay: {
      configPath,
      envOverrides: { OPENCODE_CONFIG: configPath },
      cleanup: () => {
        try {
          const current = fs.lstatSync(tempDir);
          if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== created.dev || current.ino !== created.ino) {
            return { status: "failed", reason: "overlay-directory-identity-changed" };
          }
          // This root contains private configuration. Do not recursively delete
          // unknown additions or a substituted path to manufacture a receipt.
          if (fs.readdirSync(tempDir).some((name) => name !== path.basename(configPath))) {
            return { status: "failed", reason: "overlay-directory-has-unknown-content" };
          }
          try { fs.unlinkSync(configPath); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          fs.rmdirSync(tempDir);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            return { status: "failed", reason: "overlay-removal-failed" };
          }
        }
        try {
          fs.lstatSync(tempDir);
          return { status: "failed", reason: "overlay-directory-remains" };
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ENOENT"
            ? { status: "confirmed", evidence: "owned-overlay-directory-absent" }
            : { status: "unobservable", reason: "overlay-removal-unobservable" };
        }
      },
    },
  };
}
