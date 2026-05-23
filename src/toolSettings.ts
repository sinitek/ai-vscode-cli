import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MacTaskShell } from "./cli/types";

export type ToolSettingsLocale = "auto" | "zh-CN" | "en";

export type ToolSettingsState = {
  debug?: boolean;
  autoAddEditorContextTags?: boolean;
  locale?: ToolSettingsLocale;
  macTaskShell?: MacTaskShell;
};

const TOOL_SETTINGS_FILE = path.join(os.homedir(), ".sinitek_cli", "settings.json");

let cachedToolSettings: ToolSettingsState | null = null;

function normalizeToolSettings(value: unknown): ToolSettingsState {
  const normalized: ToolSettingsState = {};
  if (!value || typeof value !== "object") {
    return normalized;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.debug === "boolean") {
    normalized.debug = record.debug;
  }
  if (typeof record.autoAddEditorContextTags === "boolean") {
    normalized.autoAddEditorContextTags = record.autoAddEditorContextTags;
  }
  if (record.locale === "auto" || record.locale === "zh-CN" || record.locale === "en") {
    normalized.locale = record.locale;
  }
  if (record.macTaskShell === "zsh" || record.macTaskShell === "bash") {
    normalized.macTaskShell = record.macTaskShell;
  }
  return normalized;
}

export function readToolSettings(): ToolSettingsState {
  if (cachedToolSettings) {
    return { ...cachedToolSettings };
  }
  try {
    if (!fs.existsSync(TOOL_SETTINGS_FILE)) {
      cachedToolSettings = {};
      return {};
    }
    const raw = fs.readFileSync(TOOL_SETTINGS_FILE, "utf8");
    cachedToolSettings = normalizeToolSettings(JSON.parse(raw));
    return { ...cachedToolSettings };
  } catch {
    cachedToolSettings = {};
    return {};
  }
}

export function writeToolSettings(next: ToolSettingsState): void {
  const normalized = normalizeToolSettings(next);
  fs.mkdirSync(path.dirname(TOOL_SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(TOOL_SETTINGS_FILE, JSON.stringify(normalized, null, 2), "utf8");
  cachedToolSettings = normalized;
}

export function getToolSettingsFilePath(): string {
  return TOOL_SETTINGS_FILE;
}
