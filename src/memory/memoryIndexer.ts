import { createHash } from "crypto";

import {
  readMemoryHotFiles,
  readPitfallsMemoryFile,
  type MemoryHotFileId,
  type MemoryLayer,
  type MemoryHotFileSnapshot,
  type MemorySourceFileId,
  type SupplementalMemoryFileSnapshot,
  writeGeneratedMemoryArtifact,
  writeGeneratedMemoryJson,
} from "./memoryFiles";
import type { WorkspaceMemoryPaths } from "./memoryPaths";

export type MemoryObservation = {
  id: string;
  fileId: MemorySourceFileId;
  layer: MemoryLayer;
  title: string;
  summary: string;
  sourcePath: string;
  contentHash: string;
  readCost: number;
  updatedAt: string | null;
  keywords: string[];
};

export type WorkspaceMemoryIndex = {
  generatedAt: string;
  sourceFiles: Array<{
    fileId: MemorySourceFileId;
    title: string;
    relativePath: string;
    updatedAt: string | null;
    observationCount: number;
  }>;
  observations: MemoryObservation[];
};

type WorkspaceMemorySourceFile = WorkspaceMemoryIndex["sourceFiles"][number];

type MemorySection = {
  title: string;
  body: string;
};

type MemorySourceSnapshot = Pick<
  MemoryHotFileSnapshot,
  "id" | "title" | "layer" | "relativePath" | "updatedAt" | "sanitizedContent"
> | Pick<
  SupplementalMemoryFileSnapshot,
  "id" | "title" | "layer" | "relativePath" | "updatedAt" | "sanitizedContent"
>;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function stripPrimaryHeading(content: string): string {
  return content.replace(/^#\s+[^\n]+\n?/u, "").trim();
}

function parseMemorySections(file: MemorySourceSnapshot): MemorySection[] {
  const body = stripPrimaryHeading(file.sanitizedContent);
  if (!body) {
    return [];
  }
  const lines = body.split(/\r?\n/);
  const sections: MemorySection[] = [];
  let currentTitle = file.title;
  let currentLines: string[] = [];
  let sawSectionHeading = false;

  const pushCurrent = (): void => {
    const normalizedBody = compactWhitespace(currentLines.join("\n"));
    if (!normalizedBody) {
      currentLines = [];
      return;
    }
    sections.push({ title: currentTitle, body: normalizedBody });
    currentLines = [];
  };

  lines.forEach((line) => {
    const matchedHeading = line.match(/^##\s+(.+)$/u);
    if (matchedHeading) {
      pushCurrent();
      currentTitle = matchedHeading[1].trim() || file.title;
      sawSectionHeading = true;
      return;
    }
    currentLines.push(line);
  });
  pushCurrent();

  if (!sawSectionHeading && sections.length > 0) {
    return sections.map((section) => ({
      title: file.title,
      body: section.body,
    }));
  }
  return sections;
}

function buildHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function slugifyAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function extractKeywords(value: string): string[] {
  const seen = new Set<string>();
  const tokens = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  tokens.forEach((token) => {
    const normalized = token.toLowerCase();
    const hasHan = /\p{Script=Han}/u.test(normalized);
    if (!hasHan && normalized.length < 2) {
      return;
    }
    seen.add(normalized);
  });
  return [...seen];
}

function estimateReadCost(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function buildObservation(file: MemoryHotFileSnapshot, section: MemorySection): MemoryObservation {
  const summary = shorten(section.body, 320);
  const anchor = slugifyAnchor(section.title);
  const sourcePath = anchor
    ? `${file.relativePath}#${anchor}`
    : file.relativePath;
  const contentHash = buildHash(`${section.title}\n${summary}`);
  return {
    id: `mem-${contentHash.slice(0, 12)}`,
    fileId: file.id,
    layer: file.layer,
    title: section.title,
    summary,
    sourcePath,
    contentHash,
    readCost: estimateReadCost(summary),
    updatedAt: file.updatedAt,
    keywords: extractKeywords(`${section.title}\n${summary}`),
  };
}

function buildSupplementalObservation(
  file: SupplementalMemoryFileSnapshot,
  section: MemorySection,
): MemoryObservation {
  const summary = shorten(section.body, 320);
  const anchor = slugifyAnchor(section.title);
  const sourcePath = anchor
    ? `${file.relativePath}#${anchor}`
    : file.relativePath;
  const contentHash = buildHash(`${section.title}\n${summary}`);
  return {
    id: `mem-${contentHash.slice(0, 12)}`,
    fileId: file.id,
    layer: file.layer,
    title: section.title,
    summary,
    sourcePath,
    contentHash,
    readCost: estimateReadCost(summary),
    updatedAt: file.updatedAt,
    keywords: extractKeywords(`${section.title}\n${summary}`),
  };
}

export function buildWorkspaceMemoryIndex(paths: WorkspaceMemoryPaths): WorkspaceMemoryIndex {
  const files = readMemoryHotFiles(paths);
  const pitfallsFile = readPitfallsMemoryFile(paths);
  const observations = [
    ...files.flatMap((file) => parseMemorySections(file).map((section) => buildObservation(file, section))),
    ...parseMemorySections(pitfallsFile).map((section) =>
      buildSupplementalObservation(pitfallsFile, section),
    ),
  ];
  const sourceFiles: WorkspaceMemorySourceFile[] = files.map((file) => ({
    fileId: file.id,
    title: file.title,
    relativePath: file.relativePath,
    updatedAt: file.updatedAt,
    observationCount: observations.filter((item) => item.fileId === file.id).length,
  }));
  sourceFiles.push({
    fileId: pitfallsFile.id,
    title: pitfallsFile.title,
    relativePath: pitfallsFile.relativePath,
    updatedAt: pitfallsFile.updatedAt,
    observationCount: observations.filter((item) => item.fileId === pitfallsFile.id).length,
  });
  return {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    observations,
  };
}

function buildIndexMarkdown(index: WorkspaceMemoryIndex): string {
  const lines = [
    "# Memory Index",
    "",
    `Generated at: ${index.generatedAt}`,
    "",
    "## Source Files",
  ];
  index.sourceFiles.forEach((file) => {
    lines.push(`- ${file.title}: \`${file.relativePath}\` (${file.observationCount} observations)`);
  });
  lines.push("");
  lines.push(`Total observations: ${index.observations.length}`);
  return lines.join("\n");
}

function buildRecallIndexMarkdown(index: WorkspaceMemoryIndex): string {
  const lines = [
    "# Recall Index",
    "",
    `Generated at: ${index.generatedAt}`,
    "",
  ];
  index.sourceFiles.forEach((file) => {
    lines.push(`## ${file.title}`);
    const matched = index.observations.filter((item) => item.fileId === file.fileId);
    if (!matched.length) {
      lines.push("- No observations yet.");
      lines.push("");
      return;
    }
    matched.forEach((item) => {
      lines.push(`- [${item.id}] ${item.title}: ${item.summary}`);
    });
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

export function writeWorkspaceMemoryIndex(paths: WorkspaceMemoryPaths, index: WorkspaceMemoryIndex): void {
  writeGeneratedMemoryArtifact(paths, "index.md", buildIndexMarkdown(index));
  writeGeneratedMemoryArtifact(paths, "recall-index.md", buildRecallIndexMarkdown(index));
  writeGeneratedMemoryArtifact(
    paths,
    "observations.jsonl",
    index.observations.map((item) => JSON.stringify(item)).join("\n"),
  );
  writeGeneratedMemoryJson(paths, "manifest.json", {
    generatedAt: index.generatedAt,
    observationCount: index.observations.length,
    sourceFiles: index.sourceFiles,
  });
}
