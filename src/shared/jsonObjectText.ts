export function extractJsonObjectText(content: string): string | null {
  return extractJsonObjectTexts(content)[0] ?? null;
}

export function extractJsonObjectTexts(content: string): string[] {
  const objects: string[] = [];
  for (let searchIndex = 0; searchIndex < content.length; searchIndex += 1) {
    const start = content.indexOf("{", searchIndex);
    if (start < 0) {
      break;
    }
    const end = findJsonObjectEnd(content, start);
    if (end === null) {
      searchIndex = start;
      continue;
    }
    objects.push(content.slice(start, end + 1).trim());
    searchIndex = end;
  }
  return objects;
}

function findJsonObjectEnd(content: string, start: number): number | null {
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
