import { parse } from "@iarna/toml";

export function parseCodexConfigModel(content: string): string | null {
  try {
    const model = parse(content.replace(/^\uFEFF/, "")).model;
    return typeof model === "string" ? model.trim() || null : null;
  } catch {
    return null;
  }
}
