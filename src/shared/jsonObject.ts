export type JsonObject = Record<string, unknown>;

export type JsonObjectParseMode = "strict" | "jsonc";

export type ParseJsonObjectOptions = {
  mode: JsonObjectParseMode;
  rootErrorMessage?: string;
};

export function isPlainObject(value: unknown): value is JsonObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "/" && next === "/") {
      index += 2;
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        result += " ";
        index += 1;
      }
      if (index < content.length) {
        result += content[index];
      }
      continue;
    }

    if (current === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          result += "  ";
          index += 1;
          break;
        }
        result += content[index] === "\n" || content[index] === "\r" ? content[index] : " ";
        index += 1;
      }
      continue;
    }

    result += current;
  }

  return result;
}

function stripTrailingCommas(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === ",") {
      let nextIndex = index + 1;
      while (nextIndex < content.length && /\s/.test(content[nextIndex])) {
        nextIndex += 1;
      }
      if (content[nextIndex] === "}" || content[nextIndex] === "]") {
        continue;
      }
    }

    result += current;
  }

  return result;
}

export function normalizeJsonObjectText(content: string, mode: JsonObjectParseMode): string {
  const normalized = content.replace(/^\uFEFF/, "").trim();
  return mode === "jsonc"
    ? stripTrailingCommas(stripJsonComments(normalized))
    : normalized;
}

export function parseJsonObjectText(
  content: string | null | undefined,
  options: ParseJsonObjectOptions,
): JsonObject {
  const normalized = normalizeJsonObjectText(content ?? "", options.mode);
  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error(options.rootErrorMessage ?? "JSON root must be an object.");
  }
  return parsed;
}
