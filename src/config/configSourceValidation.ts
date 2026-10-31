import * as TOML from "@iarna/toml";
import { normalizeJsonObjectText, isPlainObject } from "../shared/jsonObject";
import type { ConfigItem } from "./types";

export function assertConfigSourceFormat(config: ConfigItem): void {
  const toml = config.platform === "codex" || config.platform === "grok" || config.platform === "kimi-code";
  const source = config.platform === "codex" || config.platform === "grok" || config.platform === "kimi-code"
    || config.platform === "dsh" || config.platform === "zcode"
    ? config.configContent ?? config.content
    : config.content;
  const file = toml ? "config.toml" : config.platform === "zcode" ? "provider_config.json"
    : config.platform === "dsh" ? "profile.json" : config.platform === "opencode" ? "config.json" : "settings.json";
  assertSource(source, toml ? "TOML" : "JSON", file, config.platform === "opencode");
  if (config.platform === "codex") {
    assertSource(config.authContent, "JSON", "auth.json");
  }
  if (config.mcpContent?.trim()) {
    assertSource(config.mcpContent, "JSON", "MCP 配置");
  }
}

function assertSource(source: string | undefined, format: "JSON" | "TOML", file: string, jsonc = false): void {
  if (source === undefined || source.trim() === "") return;
  try {
    if (format === "TOML") {
      TOML.parse(source.replace(/^\uFEFF/, ""));
    } else {
      const parsed: unknown = JSON.parse(normalizeJsonObjectText(source, jsonc ? "jsonc" : "strict"));
      if (!isPlainObject(parsed)) throw new Error("配置根节点必须是对象，不能是数组或基础类型。");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "无法解析配置内容。";
    const location = error as { line?: number; col?: number };
    const position = typeof location?.line === "number" && typeof location?.col === "number"
      ? `（第 ${location.line + 1} 行，第 ${location.col + 1} 列）` : "";
    throw new Error(`${file}：${format} 格式错误${position}：${detail}`);
  }
}
