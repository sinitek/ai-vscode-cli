export function extractJsonObjectText(content: string): string | null {
  return extractJsonObjectTexts(content)[0] ?? null;
}

export function extractJsonObjectTexts(content: string, options?: { allowComments?: boolean }): string[] {
  const objects: string[] = [];
  for (let searchIndex = 0; searchIndex < content.length; searchIndex += 1) {
    const start = content.indexOf("{", searchIndex);
    if (start < 0) {
      break;
    }
    const end = findJsonObjectEnd(content, start, options?.allowComments === true);
    if (end === null) {
      searchIndex = start;
      continue;
    }
    objects.push(content.slice(start, end + 1).trim());
    searchIndex = end;
  }
  return objects;
}

function findJsonObjectEnd(content: string, start: number, allowComments: boolean): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
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
        while (index + 1 < content.length && content[index + 1] !== "\n" && content[index + 1] !== "\r") index += 1;
      } else if (next === "*") {
        const end = content.indexOf("*/", index + 2);
        if (end < 0) return null;
        index = end + 1;
      }
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}
