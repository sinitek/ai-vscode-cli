import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";
import {
  applyOpenCodeRuntimeModelOverlay,
  type OpenCodeConfigModelIssue,
} from "./opencodeconfigmodels";

export type OpenCodeRuntimeConfigOverlay = {
  configPath: string;
  envOverrides: Record<string, string>;
  cleanup: () => void;
};

export type OpenCodeRuntimeConfigOverlayResult = {
  ok: boolean;
  overlay: OpenCodeRuntimeConfigOverlay | null;
  issues: OpenCodeConfigModelIssue[];
};

export function createOpenCodeRuntimeConfigOverlay(input: {
  configContent: string;
  primaryModel: string;
  smallModel: string | null;
}): OpenCodeRuntimeConfigOverlayResult {
  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(input.configContent);
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
  if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
    return {
      ok: false,
      overlay: null,
      issues: [{
        code: "invalid-json",
        severity: "error",
        message: "OpenCode config must be a JSON object.",
      }],
    };
  }
  const applied = applyOpenCodeRuntimeModelOverlay(
    parsedConfig as Record<string, unknown>,
    { primary: input.primaryModel, small: input.smallModel }
  );
  if (!applied.ok || !applied.config) {
    return { ok: false, overlay: null, issues: applied.issues };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-opencode-"));
  fs.chmodSync(tempDir, 0o700);
  const configPath = path.join(tempDir, `config-${randomBytes(12).toString("hex")}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(applied.config, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  let cleaned = false;
  return {
    ok: true,
    issues: applied.issues,
    overlay: {
      configPath,
      envOverrides: { OPENCODE_CONFIG: configPath },
      cleanup: () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        fs.rmSync(tempDir, { recursive: true, force: true });
      },
    },
  };
}
