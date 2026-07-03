import type { MemorySourceFileId } from "./memoryFiles";
import type { MemoryRecallPack } from "./memoryRecall";

export type MemoryPromptLocale = "zh-CN" | "en";

const SECTION_LABELS: Record<MemoryPromptLocale, Record<MemorySourceFileId, string>> = {
  en: {
    rollingSummary: "Recent Summary",
    eventMemory: "Relevant Events",
    projectContext: "Project Context",
    userPreferences: "User Preferences",
    pendingItems: "Open Items",
    activeRisks: "Active Risks",
    lessonsLearned: "Lessons Learned",
    pitfalls: "Pitfalls",
  },
  "zh-CN": {
    rollingSummary: "近期摘要",
    eventMemory: "相关事件",
    projectContext: "项目上下文",
    userPreferences: "用户偏好",
    pendingItems: "待办事项",
    activeRisks: "当前风险",
    lessonsLearned: "经验教训",
    pitfalls: "踩坑记录",
  },
};

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function buildLongTermMemoryPromptBlock(
  pack: MemoryRecallPack,
  locale: MemoryPromptLocale = "en",
): string {
  if (!pack.sections.length) {
    return "";
  }
  const labels = SECTION_LABELS[locale];
  const lines: string[] = [
    locale === "zh-CN" ? "[插件长期记忆上下文]" : "[Plugin Memory Context]",
  ];

  pack.sections.forEach((section) => {
    lines.push("");
    lines.push(`${labels[section.fileId] ?? section.title}:`);
    section.items.forEach((item) => {
      const summary = shorten(item.summary, 240);
      const prefix = item.title && item.title !== section.title
        ? `${item.title}: `
        : "";
      lines.push(`- ${prefix}${summary}`);
    });
  });

  lines.push("");
  lines.push(
    locale === "zh-CN"
      ? "仅在与当前任务相关时使用这些记忆；当前用户请求优先于过期记忆。"
      : "Use this memory only when relevant. Current user request overrides stale memory.",
  );

  return lines.join("\n");
}

export function injectLongTermMemoryPrompt(prompt: string, block: string): string {
  if (!block.trim()) {
    return prompt;
  }
  return [prompt, "", "----", block].join("\n");
}
