import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodexSkillItem, CodexSkillToggle } from "./types";

export const CODEX_SKILLS_BLOCK_START = "# --- sinitek codex skills start ---";
export const CODEX_SKILLS_BLOCK_END = "# --- sinitek codex skills end ---";

const CODEX_SKILLS_DIR = path.join(os.homedir(), ".codex", "skills");

const SKILL_CN_DESC: Record<string, string> = {
  "algorithmic-art": "生成算法艺术与动效探索，适合创意可视化。",
  "brand-guidelines": "套用品牌色与排版规范，保持一致视觉风格。",
  "canvas-design": "生成海报/插画等视觉设计，快速输出成品。",
  "doc-coauthoring": "提供协作文档流程与模板，适合规范化写作。",
  "docx": "创建与编辑 Word 文档，保留格式与批注信息。",
  "frontend-design": "高质量前端界面设计与布局，适合产品展示。",
  "internal-comms": "内部沟通文案与模板，适配常见汇报场景。",
  "mcp-builder": "构建 MCP 服务与工具，便于接入外部能力。",
  "pdf": "生成、解析与编辑 PDF，适合表单与报告处理。",
  "pptx": "创建与编辑演示文稿，支持版式与备注。",
  "skill-creator": "创建或更新技能模板，便于复用与扩展能力。",
  "slack-gif-creator": "制作适配 Slack 的 GIF，控制体积与帧率。",
  "theme-factory": "为产物应用主题风格，快速统一色彩与字体。",
  "web-artifacts-builder": "构建复杂前端工件，适合多组件与状态管理。",
  "webapp-testing": "使用 Playwright 测试应用，覆盖常见交互流程。",
  "xlsx": "创建、编辑与分析表格，支持公式与格式。",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function stripCodexSkillsBlock(content: string): string {
  const start = escapeRegExp(CODEX_SKILLS_BLOCK_START);
  const end = escapeRegExp(CODEX_SKILLS_BLOCK_END);
  const regex = new RegExp(`${start}[\\s\\S]*?${end}\\s*`, "g");
  return content.replace(regex, "").trimEnd();
}

function buildCodexSkillsBlock(disabled: CodexSkillToggle[]): string {
  const lines: string[] = [CODEX_SKILLS_BLOCK_START];
  disabled.forEach((skill, index) => {
    lines.push("[[skills.config]]");
    lines.push(`path = "${escapeTomlString(skill.path)}"`);
    lines.push("enabled = false");
    if (index !== disabled.length - 1) {
      lines.push("");
    }
  });
  lines.push(CODEX_SKILLS_BLOCK_END);
  return lines.join("\n");
}

function ensureFeaturesSkillsEnabled(content: string): string {
  if (!content.trim()) {
    return "[features]\nskills = true\n";
  }
  const featuresRegex = /\[features\][\s\S]*?(?=\n\[|$)/;
  const match = content.match(featuresRegex);
  if (!match) {
    return `${content.trimEnd()}\n\n[features]\nskills = true\n`;
  }
  const block = match[0];
  const lines = block.split("\n");
  let hasSkills = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("skills")) {
      hasSkills = true;
      return "skills = true";
    }
    return line;
  });
  if (!hasSkills) {
    nextLines.push("skills = true");
  }
  const nextBlock = nextLines.join("\n");
  return content.replace(featuresRegex, nextBlock);
}

function extractSkillDescription(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!match) {
    return undefined;
  }
  const lines = match[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("description:")) {
      const raw = trimmed.slice("description:".length).trim();
      const unquoted = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      return unquoted.trim() || undefined;
    }
  }
  return undefined;
}

function toShortChineseDescription(name: string, description?: string): string {
  const raw = (description ?? "").trim();
  if (raw && /[\u4e00-\u9fff]/.test(raw)) {
    if (raw.length > 50) return raw.slice(0, 50);
    if (raw.length < 20) return `${raw}，适合日常使用。`;
    return raw;
  }
  const mapped = SKILL_CN_DESC[name];
  if (mapped) {
    return mapped;
  }
  return "技能说明暂缺";
}

export function mergeCodexSkillsConfig(
  baseConfig: string,
  skills: CodexSkillToggle[] | undefined
): string {
  const normalized = stripCodexSkillsBlock(baseConfig ?? "");
  const disabled = (skills ?? []).filter((skill) => skill.enabled === false);
  const enabledCount = (skills ?? []).filter((skill) => skill.enabled !== false).length;
  let nextContent = normalized;
  if (enabledCount > 0) {
    nextContent = ensureFeaturesSkillsEnabled(nextContent);
  }
  if (disabled.length === 0) {
    return nextContent ? `${nextContent}\n` : "";
  }
  const block = buildCodexSkillsBlock(disabled);
  return nextContent ? `${nextContent}\n\n${block}\n` : `${block}\n`;
}

export async function listCodexSkills(): Promise<CodexSkillItem[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(CODEX_SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  const skills: CodexSkillItem[] = [];
  for (const name of dirs) {
    const skillPath = path.join(CODEX_SKILLS_DIR, name);
    try {
      const skillFile = path.join(skillPath, "SKILL.md");
      await fs.promises.access(skillFile);
      const content = await fs.promises.readFile(skillFile, "utf-8");
      const description = toShortChineseDescription(
        name,
        extractSkillDescription(content)
      );
      skills.push({ name, path: skillPath, description });
    } catch {
      // skip non-skill directories
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
