import { CodexSkillToggle } from "./types";

export const CODEX_SKILLS_BLOCK_START = "# --- sinitek codex skills start ---";
export const CODEX_SKILLS_BLOCK_END = "# --- sinitek codex skills end ---";

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
