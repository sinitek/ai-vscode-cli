import {
  MEMORY_HOT_FILES,
  type MemoryHotFileId,
  type MemoryLayer,
  type MemorySourceFileId,
  writeGeneratedMemoryArtifact,
  writeGeneratedMemoryJson,
} from "./memoryFiles";
import {
  buildWorkspaceMemoryIndex,
  type MemoryObservation,
  type WorkspaceMemoryIndex,
  writeWorkspaceMemoryIndex,
} from "./memoryIndexer";
import type { WorkspaceMemoryPaths } from "./memoryPaths";

export type MemoryRecallItem = {
  id: string;
  title: string;
  summary: string;
  sourcePath: string;
  score: number;
};

export type MemoryRecallSection = {
  fileId: MemorySourceFileId;
  title: string;
  layer: MemoryLayer;
  items: MemoryRecallItem[];
};

export type MemoryRecallPack = {
  generatedAt: string;
  focus: string;
  sections: MemoryRecallSection[];
  observationIds: string[];
};

export type BuildMemoryRecallPackOptions = {
  prompt: string;
  focusHints?: string[];
  maxObservations?: number;
};

type ScoredObservation = MemoryObservation & { score: number };

const FILE_PRIORITIES: Record<MemorySourceFileId, number> = {
  projectContext: 12,
  userPreferences: 11,
  pitfalls: 11,
  lessonsLearned: 10,
  activeRisks: 9,
  pendingItems: 8,
  eventMemory: 7,
  rollingSummary: 6,
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "need",
  "have",
  "about",
  "当前",
  "需要",
  "这个",
  "那个",
  "以及",
  "相关",
  "工作区",
]);

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractFocusTokens(value: string): string[] {
  const matched = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const seen = new Set<string>();
  matched.forEach((token) => {
    const normalized = token.toLowerCase();
    const hasHan = /\p{Script=Han}/u.test(normalized);
    if (!hasHan && normalized.length < 2) {
      return;
    }
    if (STOP_WORDS.has(normalized)) {
      return;
    }
    seen.add(normalized);
  });
  return [...seen];
}

function scoreObservation(observation: MemoryObservation, focusTokens: string[], focusText: string): number {
  const keywordSet = new Set(observation.keywords);
  let matchedCount = 0;
  focusTokens.forEach((token) => {
    if (keywordSet.has(token)) {
      matchedCount += 1;
    }
  });
  if (matchedCount === 0) {
    const normalizedFocus = focusText.toLowerCase();
    if (normalizedFocus.length < 4) {
      return 0;
    }
    if (
      observation.title.toLowerCase().includes(normalizedFocus)
      || observation.summary.toLowerCase().includes(normalizedFocus)
    ) {
      matchedCount = 1;
    }
  }
  if (matchedCount === 0) {
    return 0;
  }
  return matchedCount * 10 + FILE_PRIORITIES[observation.fileId];
}

function buildRecallPackMarkdown(pack: MemoryRecallPack): string {
  const lines = [
    "# Recall Pack",
    "",
    `Generated at: ${pack.generatedAt}`,
    `Focus: ${pack.focus || "(empty)"}`,
    "",
  ];
  if (!pack.sections.length) {
    lines.push("No relevant observations found for the current focus.");
    return lines.join("\n");
  }
  pack.sections.forEach((section) => {
    lines.push(`## ${section.title}`);
    section.items.forEach((item) => {
      lines.push(`- [${item.id}] ${item.title}: ${item.summary}`);
    });
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function buildSections(index: WorkspaceMemoryIndex, selected: ScoredObservation[]): MemoryRecallSection[] {
  const selectedByFile = new Map<MemorySourceFileId, ScoredObservation[]>();
  selected.forEach((item) => {
    const existing = selectedByFile.get(item.fileId) ?? [];
    existing.push(item);
    selectedByFile.set(item.fileId, existing);
  });

  const definitions: Array<{ id: MemorySourceFileId; title: string; layer: MemoryLayer }> = [
    ...MEMORY_HOT_FILES.map((definition) => ({
      id: definition.id,
      title: definition.title,
      layer: definition.layer,
    })),
    { id: "pitfalls", title: "Pitfalls", layer: "procedural" },
  ];

  return definitions
    .map((definition) => {
      const items = (selectedByFile.get(definition.id) ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        sourcePath: item.sourcePath,
        score: item.score,
      }));
      if (!items.length) {
        return null;
      }
      return {
        fileId: definition.id,
        title: definition.title,
        layer: definition.layer,
        items,
      };
    })
    .filter((item): item is MemoryRecallSection => Boolean(item));
}

export function buildWorkspaceMemoryRecallPack(
  paths: WorkspaceMemoryPaths,
  options: BuildMemoryRecallPackOptions,
): MemoryRecallPack {
  const index = buildWorkspaceMemoryIndex(paths);
  writeWorkspaceMemoryIndex(paths, index);

  const focus = compactWhitespace([options.prompt, ...(options.focusHints ?? [])].filter(Boolean).join(" "));
  const focusTokens = extractFocusTokens(focus);
  const scored = index.observations
    .map((item) => ({
      ...item,
      score: scoreObservation(item, focusTokens, focus),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    });

  const selected = scored.slice(0, Math.max(1, options.maxObservations ?? 6));
  const pack: MemoryRecallPack = {
    generatedAt: new Date().toISOString(),
    focus,
    sections: buildSections(index, selected),
    observationIds: selected.map((item) => item.id),
  };

  writeGeneratedMemoryArtifact(paths, "recall-pack.md", buildRecallPackMarkdown(pack));
  writeGeneratedMemoryJson(paths, "recall-summary.json", {
    generatedAt: pack.generatedAt,
    focus: pack.focus,
    observationIds: pack.observationIds,
    sectionCount: pack.sections.length,
  });

  return pack;
}
