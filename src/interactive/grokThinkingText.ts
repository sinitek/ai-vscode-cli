const LIST_OR_HEADING_LINE = /^(?:[-*+]|\d+\.)\s|^#{1,6}\s/;

export function joinGrokThinkingSoftBreaks(content: string): string {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const paragraphs = normalized.split(/\n{2,}/);
  const joined = paragraphs.map((paragraph) => {
    const lines = paragraph.split("\n");
    let result = "";
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (index === 0) {
        result = line.replace(/[ \t]+$/g, "");
        continue;
      }
      const next = line.trim();
      if (!next) {
        continue;
      }
      if (LIST_OR_HEADING_LINE.test(next)) {
        result = `${result.replace(/[ \t]+$/g, "")}\n${next}`;
        continue;
      }
      const needsSpace = result.length > 0 && !/\s$/.test(result);
      result += `${needsSpace ? " " : ""}${next}`;
    }
    return result.trim();
  }).filter((paragraph) => paragraph.length > 0);
  return joined.join("\n\n");
}
