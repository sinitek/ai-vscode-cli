import { readFileSync } from "fs";
import * as path from "path";
import { logError } from "../logger";

let cachedMarkedScript: string | undefined;
let cachedJsonFormatterScript: string | undefined;

export function getMarkedScript(): string {
  if (cachedMarkedScript !== undefined) {
    return cachedMarkedScript;
  }
  const candidates = [
    path.join(__dirname, "..", "..", "media", "marked.min.js"),
    path.join(__dirname, "..", "..", "node_modules", "marked", "marked.min.js"),
  ];
  for (const scriptPath of candidates) {
    try {
      cachedMarkedScript = readFileSync(scriptPath, "utf8");
      return cachedMarkedScript;
    } catch {
      // Keep checking next candidate.
    }
  }
  void logError("webview-marked-script-missing", { candidates });
  cachedMarkedScript = "";
  return cachedMarkedScript;
}

export function getJsonFormatterScript(): string {
  if (cachedJsonFormatterScript !== undefined) {
    return cachedJsonFormatterScript;
  }
  const candidates = [
    path.join(__dirname, "..", "..", "node_modules", "json-formatter-js", "dist", "json-formatter.umd.js"),
    path.join(__dirname, "..", "..", "media", "json-formatter.umd.js"),
  ];
  for (const scriptPath of candidates) {
    try {
      cachedJsonFormatterScript = readFileSync(scriptPath, "utf8");
      return cachedJsonFormatterScript;
    } catch {
      // Keep checking next candidate.
    }
  }
  void logError("webview-json-formatter-script-missing", { candidates });
  cachedJsonFormatterScript = "";
  return cachedJsonFormatterScript;
}
