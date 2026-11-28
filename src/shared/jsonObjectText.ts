export function extractJsonObjectText(content: string): string | null {
  return extractJsonObjectTexts(content)[0] ?? null;
}

export function extractJsonObjectTexts(content: string, options?: { allowComments?: boolean }): string[] {
  const objects: string[] = [];
  const allowComments = options?.allowComments === true;
  for (let searchIndex = 0; searchIndex < content.length; searchIndex += 1) {
    const start = content.indexOf("{", searchIndex);
    if (start < 0) {
      break;
    }
    const scan = scanJsonObjectEnd(content, start, allowComments, content.length, null);
    if (scan.kind === "unclosed") {
      searchIndex = start;
      continue;
    }
    objects.push(content.slice(start, scan.index + 1).trim());
    searchIndex = scan.index;
  }
  return objects;
}

export type JsonObjectCandidate = {
  text: string;
  closed: boolean;
};

/**
 * 按外层对象的起止边界列出候选。闭合对象只出现一次，内层留在其中。
 * 未闭合对象停在所在区域的末尾：回复末尾，或 Markdown 围栏结束行。
 * 不把区域内的内层对象提升出来，也不把区域外的括号拼进该对象。
 */
export function collectJsonObjectCandidates(
  content: string,
  options?: { allowComments?: boolean },
): JsonObjectCandidate[] {
  const allowComments = options?.allowComments === true;
  const candidates: JsonObjectCandidate[] = [];
  let index = 0;
  while (index < content.length) {
    if (isLineStart(content, index)) {
      const opened = readFenceMarkerLine(content, index, null);
      if (opened) {
        index = collectInsideFence(content, opened.afterLine, { marker: opened.marker, minCount: opened.count }, allowComments, candidates);
        continue;
      }
    }
    if (content[index] === "{") {
      const scan = scanJsonObjectEnd(content, index, allowComments, content.length, null);
      candidates.push(scan.kind === "closed"
        ? { text: content.slice(index, scan.index + 1).trim(), closed: true }
        : { text: content.slice(index, scan.stopAt).trimEnd(), closed: false });
      if (scan.kind === "unclosed") break;
      index = scan.index + 1;
      continue;
    }
    index += 1;
  }
  return candidates;
}

type FenceMarker = { marker: string; minCount: number };

function collectInsideFence(
  content: string,
  bodyStart: number,
  fence: FenceMarker,
  allowComments: boolean,
  candidates: JsonObjectCandidate[],
): number {
  let index = bodyStart;
  while (index < content.length) {
    if (isLineStart(content, index)) {
      const closing = readFenceMarkerLine(content, index, fence);
      if (closing) return closing.afterLine;
    }
    if (content[index] === "{") {
      const scan = scanJsonObjectEnd(content, index, allowComments, content.length, fence);
      if (scan.kind === "closed") {
        candidates.push({ text: content.slice(index, scan.index + 1).trim(), closed: true });
        index = scan.index + 1;
        continue;
      }
      candidates.push({ text: content.slice(index, scan.stopAt).trimEnd(), closed: false });
      if (scan.stopAt >= content.length) return content.length;
      const closing = readFenceMarkerLine(content, scan.stopAt, fence);
      return closing ? closing.afterLine : content.length;
    }
    index += 1;
  }
  return content.length;
}

type JsonObjectScan = { kind: "closed"; index: number } | { kind: "unclosed"; stopAt: number };

function scanJsonObjectEnd(
  content: string,
  start: number,
  allowComments: boolean,
  limit: number,
  fence: FenceMarker | null,
): JsonObjectScan {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const endLimit = Math.min(limit, content.length);
  for (let index = start; index < endLimit; index += 1) {
    // 字符串里的围栏字符仍属于字符串。只有字符串和转义之外的围栏结束行才结束该区域。
    if (!inString && !escaped && fence && isLineStart(content, index) && readFenceMarkerLine(content, index, fence)) {
      return { kind: "unclosed", stopAt: index };
    }
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (allowComments && char === "/") {
      const next = content[index + 1];
      if (next === "/") {
        while (index + 1 < endLimit && content[index + 1] !== "\n" && content[index + 1] !== "\r") index += 1;
      } else if (next === "*") {
        const commentEnd = content.indexOf("*/", index + 2);
        if (commentEnd < 0 || commentEnd + 1 >= endLimit) {
          return { kind: "unclosed", stopAt: regionStop(content, index, endLimit, fence) };
        }
        index = commentEnd + 1;
      }
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { kind: "closed", index };
      }
    }
  }
  return { kind: "unclosed", stopAt: endLimit };
}

function regionStop(content: string, from: number, endLimit: number, fence: FenceMarker | null): number {
  if (!fence) return endLimit;
  let index = from;
  if (!isLineStart(content, index)) {
    while (index < endLimit && content[index] !== "\n") index += 1;
    if (index < endLimit) index += 1;
  }
  while (index < endLimit) {
    if (readFenceMarkerLine(content, index, fence)) return index;
    while (index < endLimit && content[index] !== "\n") index += 1;
    if (index < endLimit) index += 1;
  }
  return endLimit;
}

function isLineStart(content: string, index: number): boolean {
  return index === 0 || content[index - 1] === "\n";
}

function readFenceMarkerLine(
  content: string,
  lineStart: number,
  closing: FenceMarker | null,
): { marker: string; count: number; afterLine: number } | null {
  let index = lineStart;
  let spaces = 0;
  while (spaces < 3 && content[index] === " ") {
    spaces += 1;
    index += 1;
  }
  const marker = content[index];
  if (marker !== "`" && marker !== "~") return null;
  if (closing && marker !== closing.marker) return null;
  let count = 0;
  while (content[index] === marker) {
    count += 1;
    index += 1;
  }
  if (count < 3 || (closing !== null && count < closing.minCount)) return null;
  while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
    const char = content[index];
    if (closing) {
      if (char !== " " && char !== "\t") return null;
    } else if (marker === "`" && char === "`") {
      return null;
    }
    index += 1;
  }
  if (content[index] === "\r") index += 1;
  if (content[index] === "\n") index += 1;
  return { marker, count, afterLine: index };
}
