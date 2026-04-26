import { createHash } from "crypto";

import { ThinkingMode } from "./types";

export const GEMINI_SYSTEM_SETTINGS_ENV_KEY = "GEMINI_CLI_SYSTEM_SETTINGS_PATH";

export type GeminiThinkingRuntimeProfile = {
  baseModel: string | null;
  runtimeModel: string | null;
  requestedMode: "off" | "low" | "high";
  effectiveMode: "off" | "low" | "high";
  strategy: "level" | "budget" | "passthrough";
  systemSettings: Record<string, unknown> | null;
};

type GeminiThinkingLevel = "MINIMAL" | "LOW" | "HIGH";

function normalizeModelName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRequestedMode(mode: ThinkingMode): "off" | "low" | "high" {
  if (mode === "off") {
    return "off";
  }
  if (mode === "low") {
    return "low";
  }
  return "high";
}

function supportsGeminiBudgetThinking(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes("2.5") || lower === "auto-gemini-2.5";
}

function supportsGeminiLevelThinking(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes("flash-lite")) {
    return false;
  }
  if (lower === "pro" || lower === "flash" || lower === "auto-gemini-3") {
    return true;
  }
  return lower.includes("gemini-3") || lower === "chat-base-3";
}

function isGeminiProLikeModel(model: string): boolean {
  const lower = model.toLowerCase();
  return lower === "pro" || lower.includes("pro");
}

function buildThinkingLevelConfig(
  model: string,
  requestedMode: "off" | "low" | "high",
): { effectiveMode: "off" | "low" | "high"; thinkingLevel: GeminiThinkingLevel } | null {
  if (!supportsGeminiLevelThinking(model)) {
    return null;
  }
  if (isGeminiProLikeModel(model)) {
    if (requestedMode === "high") {
      return { effectiveMode: "high", thinkingLevel: "HIGH" };
    }
    return { effectiveMode: "low", thinkingLevel: "LOW" };
  }
  if (requestedMode === "high") {
    return { effectiveMode: "high", thinkingLevel: "HIGH" };
  }
  if (requestedMode === "low") {
    return { effectiveMode: "low", thinkingLevel: "LOW" };
  }
  return { effectiveMode: "off", thinkingLevel: "MINIMAL" };
}

function buildThinkingBudgetConfig(
  model: string,
  requestedMode: "off" | "low" | "high",
): { effectiveMode: "off" | "low" | "high"; thinkingBudget: number } | null {
  if (!supportsGeminiBudgetThinking(model)) {
    return null;
  }
  if (requestedMode === "high") {
    return { effectiveMode: "high", thinkingBudget: 8192 };
  }
  if (requestedMode === "low") {
    return { effectiveMode: "low", thinkingBudget: 1024 };
  }
  return { effectiveMode: "off", thinkingBudget: 0 };
}

function sanitizeAliasSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "model";
}

function buildManagedAliasName(
  baseModel: string,
  requestedMode: "off" | "low" | "high",
  strategy: "level" | "budget",
): string {
  const safeBase = sanitizeAliasSegment(baseModel).slice(0, 48);
  const hash = createHash("sha1").update(`${baseModel}:${strategy}:${requestedMode}`).digest("hex").slice(0, 8);
  return `sinitek-${strategy}-${requestedMode}-${safeBase}-${hash}`;
}

export function buildGeminiThinkingRuntimeProfile(
  baseModel: string | null | undefined,
  thinkingMode: ThinkingMode,
): GeminiThinkingRuntimeProfile {
  const normalizedBaseModel = normalizeModelName(baseModel);
  const requestedMode = normalizeRequestedMode(thinkingMode);
  if (!normalizedBaseModel) {
    return {
      baseModel: null,
      runtimeModel: null,
      requestedMode,
      effectiveMode: requestedMode,
      strategy: "passthrough",
      systemSettings: null,
    };
  }

  const levelConfig = buildThinkingLevelConfig(normalizedBaseModel, requestedMode);
  if (levelConfig) {
    const runtimeModel = buildManagedAliasName(normalizedBaseModel, requestedMode, "level");
    return {
      baseModel: normalizedBaseModel,
      runtimeModel,
      requestedMode,
      effectiveMode: levelConfig.effectiveMode,
      strategy: "level",
      systemSettings: {
        modelConfigs: {
          customAliases: {
            [runtimeModel]: {
              extends: normalizedBaseModel,
              modelConfig: {
                generateContentConfig: {
                  thinkingConfig: {
                    thinkingLevel: levelConfig.thinkingLevel,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  const budgetConfig = buildThinkingBudgetConfig(normalizedBaseModel, requestedMode);
  if (budgetConfig) {
    const runtimeModel = buildManagedAliasName(normalizedBaseModel, requestedMode, "budget");
    return {
      baseModel: normalizedBaseModel,
      runtimeModel,
      requestedMode,
      effectiveMode: budgetConfig.effectiveMode,
      strategy: "budget",
      systemSettings: {
        modelConfigs: {
          customAliases: {
            [runtimeModel]: {
              extends: normalizedBaseModel,
              modelConfig: {
                generateContentConfig: {
                  thinkingConfig: {
                    thinkingBudget: budgetConfig.thinkingBudget,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    baseModel: normalizedBaseModel,
    runtimeModel: normalizedBaseModel,
    requestedMode,
    effectiveMode: requestedMode,
    strategy: "passthrough",
    systemSettings: null,
  };
}
