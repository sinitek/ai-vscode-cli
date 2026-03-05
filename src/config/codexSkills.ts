import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CodexSkillItem, CodexSkillToggle } from "./types";
import { AppLocale, resolveLocale, t } from "../i18n";

export const CODEX_SKILLS_BLOCK_START = "# --- sinitek codex skills start ---";
export const CODEX_SKILLS_BLOCK_END = "# --- sinitek codex skills end ---";

const LEGACY_CODEX_SKILLS_DIR = path.join(os.homedir(), ".codex", "skills");
const HOME_AGENTS_SKILLS_DIR = path.join(os.homedir(), ".agents", "skills");
const SYSTEM_CODEX_SKILLS_DIR = path.join(path.sep, "etc", "codex", "skills");
const WORKSPACE_CODEX_SKILLS_RELATIVE_DIR = path.join(".codex", "skills");
const WORKSPACE_AGENTS_SKILLS_RELATIVE_DIR = path.join(".agents", "skills");

const SKILL_DESC: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
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
  },
  en: {
    "algorithmic-art": "Generate algorithmic art and motion exploration for creative visualization.",
    "brand-guidelines": "Apply brand colors and typography to keep a consistent visual style.",
    "canvas-design": "Create posters, illustrations, and other visual designs quickly.",
    "doc-coauthoring": "Provide co-authoring workflows and templates for structured writing.",
    "docx": "Create and edit Word documents while preserving formatting and comments.",
    "frontend-design": "High-quality frontend UI design and layout for product showcases.",
    "internal-comms": "Internal comms copy and templates for common reporting scenarios.",
    "mcp-builder": "Build MCP servers and tools to integrate external capabilities.",
    "pdf": "Generate, parse, and edit PDFs for forms and reports.",
    "pptx": "Create and edit presentations with layouts and notes.",
    "skill-creator": "Create or update skill templates for reuse and extension.",
    "slack-gif-creator": "Create Slack-optimized GIFs with size and frame control.",
    "theme-factory": "Apply themes to outputs for consistent color and typography.",
    "web-artifacts-builder": "Build complex frontend artifacts with multi-component state.",
    "webapp-testing": "Use Playwright to test apps across common user flows.",
    "xlsx": "Create, edit, and analyze spreadsheets with formulas and formatting.",
  },
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

function toShortDescription(locale: AppLocale, name: string, description?: string): string {
  const raw = (description ?? "").trim();
  const hasChinese = /[\u4e00-\u9fff]/.test(raw);
  if (raw) {
    if (locale === "zh-CN") {
      if (hasChinese) {
        if (raw.length > 50) return raw.slice(0, 50);
        if (raw.length < 20) return `${raw}，适合日常使用。`;
        return raw;
      }
    } else if (!hasChinese) {
      if (raw.length > 90) return raw.slice(0, 90);
      if (raw.length < 30) return `${raw} Great for everyday use.`;
      return raw;
    }
  }
  const mapped = SKILL_DESC[locale][name];
  if (mapped) {
    return mapped;
  }
  return t("skill.descriptionMissing", undefined, locale);
}

function normalizeWorkspaceRoots(workspaceRoots: string[] | undefined): string[] {
  if (!Array.isArray(workspaceRoots)) {
    return [];
  }
  const unique = new Set<string>();
  workspaceRoots.forEach((root) => {
    if (typeof root !== "string") {
      return;
    }
    const normalized = root.trim();
    if (!normalized) {
      return;
    }
    unique.add(path.resolve(normalized));
  });
  return [...unique];
}

function collectAncestorDirs(startPath: string): string[] {
  const output: string[] = [];
  let current = path.resolve(startPath);
  while (true) {
    output.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return output;
}

function resolveCodexSkillRoots(workspaceRoots: string[] | undefined): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const append = (candidate: string | undefined): void => {
    if (!candidate) {
      return;
    }
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    roots.push(normalized);
  };

  normalizeWorkspaceRoots(workspaceRoots).forEach((workspaceRoot) => {
    collectAncestorDirs(workspaceRoot).forEach((ancestor) => {
      append(path.join(ancestor, WORKSPACE_CODEX_SKILLS_RELATIVE_DIR));
      append(path.join(ancestor, WORKSPACE_AGENTS_SKILLS_RELATIVE_DIR));
    });
  });

  append(HOME_AGENTS_SKILLS_DIR);
  append(LEGACY_CODEX_SKILLS_DIR);
  append(process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, "skills") : undefined);
  append(SYSTEM_CODEX_SKILLS_DIR);

  return roots;
}

async function listSkillDirNames(skillRoot: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(skillRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isDirectory()) {
      dirs.push(entry.name);
      continue;
    }
    if (!entry.isSymbolicLink()) {
      continue;
    }
    try {
      const linkTargetStat = await fs.promises.stat(path.join(skillRoot, entry.name));
      if (linkTargetStat.isDirectory()) {
        dirs.push(entry.name);
      }
    } catch {
      // Ignore broken symlinks.
    }
  }

  return dirs;
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

export async function listCodexSkills(workspaceRoots?: string[]): Promise<CodexSkillItem[]> {
  const locale = resolveLocale();
  const skillRoots = resolveCodexSkillRoots(workspaceRoots);
  const skillsByName = new Map<string, CodexSkillItem>();

  for (const skillRoot of skillRoots) {
    const dirs = await listSkillDirNames(skillRoot);
    for (const name of dirs) {
      if (skillsByName.has(name)) {
        continue;
      }
      const skillPath = path.join(skillRoot, name);
      try {
        const skillFile = path.join(skillPath, "SKILL.md");
        await fs.promises.access(skillFile);
        const content = await fs.promises.readFile(skillFile, "utf-8");
        const description = toShortDescription(locale, name, extractSkillDescription(content));
        skillsByName.set(name, { name, path: skillPath, description });
      } catch {
        // skip non-skill directories
      }
    }
  }

  const skills = [...skillsByName.values()];
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
