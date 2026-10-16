export type GrokTomlTable = { [key: string]: GrokTomlValue };

export type GrokTomlValue =
  | string
  | number
  | boolean
  | GrokTomlValue[]
  | GrokTomlTable;

export type GrokTomlParseResult =
  | { ok: true; value: GrokTomlTable }
  | { ok: false; error: string };

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function parseGrokToml(content: string): GrokTomlParseResult {
  if (typeof content !== "string") {
    return { ok: false, error: "Grok TOML 输入无效。" };
  }
  const text = content.replace(/^\uFEFF/, "");
  if (text.trim() === "") {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: parseDocument(text) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "非法 TOML。",
    };
  }
}

export function serializeGrokToml(value: GrokTomlTable): { ok: true; content: string } | { ok: false; error: string } {
  try {
    const lines = serializeTable(value, []);
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return { ok: true, content: lines.length > 0 ? `${lines.join("\n")}\n` : "" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "无法序列化 TOML。",
    };
  }
}

export function cloneGrokToml(value: GrokTomlTable): GrokTomlTable {
  return cloneValue(value) as GrokTomlTable;
}

export function isGrokTomlTable(value: unknown): value is GrokTomlTable {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDocument(content: string): GrokTomlTable {
  const root: GrokTomlTable = {};
  let current: GrokTomlTable = root;
  const lines = content.split(/\r?\n/);
  let pending = "";
  let multiline: "basic" | "literal" | null = null;

  const consume = (line: string): void => {
    const trimmed = stripComment(line).trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
      const path = parseKeyPath(trimmed.slice(2, -2).trim());
      current = enterTable(root, path, true);
      return;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const path = parseKeyPath(trimmed.slice(1, -1).trim());
      current = enterTable(root, path, false);
      return;
    }
    const assignment = splitAssignment(trimmed);
    if (!assignment) {
      throw new Error("非法 TOML。");
    }
    const path = parseKeyPath(assignment.key);
    const value = parseValue(stripComment(assignment.value).trim());
    assign(current, path, value);
  };

  for (const line of lines) {
    if (multiline) {
      pending += `\n${line}`;
      if (hasMultilineClose(line, multiline)) {
        consume(pending);
        pending = "";
        multiline = null;
      }
      continue;
    }
    const opener = findMultilineOpener(line);
    if (opener && !hasMultilineClose(line, opener)) {
      multiline = opener;
      pending = line;
      continue;
    }
    consume(line);
  }
  if (multiline) {
    throw new Error("TOML 字符串未闭合。");
  }
  return root;
}

function findMultilineOpener(line: string): "basic" | "literal" | null {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === "\"" && char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (line.startsWith('"""', index)) {
      return "basic";
    }
    if (line.startsWith("'''", index)) {
      return "literal";
    }
    if (char === "\"" || char === "'") {
      quote = char;
    }
  }
  return null;
}

function hasMultilineClose(line: string, kind: "basic" | "literal"): boolean {
  const token = kind === "basic" ? '"""' : "'''";
  const first = line.indexOf(token);
  if (first < 0) {
    return false;
  }
  return line.indexOf(token, first + 3) >= 0 || (first > 0 && line.trimEnd().endsWith(token));
}

function stripComment(input: string): string {
  let quote: "\"" | "'" | null = null;
  let triple = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (triple && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = null;
        triple = false;
        continue;
      }
      if (!triple && quote === "\"" && char === "\\") {
        index += 1;
        continue;
      }
      if (!triple && char === quote) {
        quote = null;
      }
      continue;
    }
    if (input.startsWith('"""', index)) {
      quote = "\"";
      triple = true;
      index += 2;
      continue;
    }
    if (input.startsWith("'''", index)) {
      quote = "'";
      triple = true;
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      triple = false;
      continue;
    }
    if (char === "#") {
      return input.slice(0, index);
    }
  }
  if (quote) {
    throw new Error("TOML 字符串未闭合。");
  }
  return input;
}

function splitAssignment(line: string): { key: string; value: string } | null {
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === "\"" && char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "=") {
      return {
        key: line.slice(0, index).trim(),
        value: line.slice(index + 1).trim(),
      };
    }
  }
  return null;
}

function parseKeyPath(input: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (index < input.length) {
    while (input[index] === " " || input[index] === "\t") {
      index += 1;
    }
    if (index >= input.length) {
      break;
    }
    if (input[index] === "\"" || input[index] === "'") {
      const parsed = readQuoted(input, index);
      keys.push(parsed.value);
      index = parsed.next;
    } else {
      const start = index;
      while (
        index < input.length
        && input[index] !== "."
        && input[index] !== " "
        && input[index] !== "\t"
      ) {
        index += 1;
      }
      const bare = input.slice(start, index);
      if (!BARE_KEY.test(bare)) {
        throw new Error(`非法 TOML 键：${bare}`);
      }
      keys.push(bare);
    }
    while (input[index] === " " || input[index] === "\t") {
      index += 1;
    }
    if (input[index] === ".") {
      index += 1;
      continue;
    }
    if (index < input.length) {
      throw new Error("非法 TOML 键。");
    }
  }
  if (keys.length === 0 || keys.some((key) => key.length === 0)) {
    throw new Error("空 TOML 键。");
  }
  return keys;
}

function enterTable(root: GrokTomlTable, path: string[], arrayTable: boolean): GrokTomlTable {
  let cursor = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = childTable(cursor, path[index]);
  }
  const leaf = path[path.length - 1];
  if (arrayTable) {
    const existing = cursor[leaf];
    if (existing === undefined) {
      cursor[leaf] = [];
    } else if (!Array.isArray(existing)) {
      throw new Error("TOML 表类型冲突。");
    }
    const row: GrokTomlTable = {};
    (cursor[leaf] as GrokTomlValue[]).push(row);
    return row;
  }
  const existing = cursor[leaf];
  if (existing === undefined) {
    const created: GrokTomlTable = {};
    cursor[leaf] = created;
    return created;
  }
  if (!isGrokTomlTable(existing)) {
    throw new Error("TOML 表类型冲突。");
  }
  return existing;
}

function childTable(cursor: GrokTomlTable, key: string): GrokTomlTable {
  const existing = cursor[key];
  if (existing === undefined) {
    const created: GrokTomlTable = {};
    cursor[key] = created;
    return created;
  }
  if (Array.isArray(existing)) {
    const last = existing[existing.length - 1];
    if (!isGrokTomlTable(last)) {
      throw new Error("非法表路径。");
    }
    return last;
  }
  if (!isGrokTomlTable(existing)) {
    throw new Error("TOML 表类型冲突。");
  }
  return existing;
}

function assign(table: GrokTomlTable, path: string[], value: GrokTomlValue): void {
  let cursor = table;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (cursor[key] === undefined) {
      cursor[key] = {};
    }
    const next = cursor[key];
    if (!isGrokTomlTable(next)) {
      throw new Error("TOML 键冲突。");
    }
    cursor = next;
  }
  const leaf = path[path.length - 1];
  if (Object.prototype.hasOwnProperty.call(cursor, leaf)) {
    throw new Error(`重复 TOML 键：${leaf}`);
  }
  cursor[leaf] = value;
}

function parseValue(value: string): GrokTomlValue {
  if (!value) {
    throw new Error("缺少 TOML 值。");
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.startsWith("\"") || value.startsWith("'")) {
    const parsed = readQuoted(value, 0);
    if (value.slice(parsed.next).trim() !== "") {
      throw new Error("非法 TOML 值。");
    }
    return parsed.value;
  }
  if (value.startsWith("[")) {
    return parseArray(value);
  }
  if (value.startsWith("{")) {
    return parseInlineTable(value);
  }
  if (/^[+-]?(?:\d+_)*\d+(?:\.(?:\d+_)*\d+)?(?:[eE][+-]?(?:\d+_)*\d+)?$/.test(value)) {
    return Number(value.replace(/_/g, ""));
  }
  throw new Error(`无法解析 TOML 值：${value.slice(0, 40)}`);
}

function parseArray(value: string): GrokTomlValue[] {
  if (!value.endsWith("]")) {
    throw new Error("TOML 数组未闭合。");
  }
  const body = value.slice(1, -1).trim();
  if (!body) {
    return [];
  }
  const parts = splitTopLevel(body, ",");
  if (parts.some((part) => part.trim() === "")) {
    throw new Error("TOML 数组语法无效。");
  }
  return parts.map((part) => parseValue(part.trim()));
}

function parseInlineTable(value: string): GrokTomlTable {
  if (!value.endsWith("}")) {
    throw new Error("TOML 内联表未闭合。");
  }
  const body = value.slice(1, -1).trim();
  const table: GrokTomlTable = {};
  if (!body) {
    return table;
  }
  const parts = splitTopLevel(body, ",");
  if (parts.some((part) => part.trim() === "")) {
    throw new Error("TOML 内联表语法无效。");
  }
  parts.forEach((part) => {
    const assignment = splitAssignment(part.trim());
    if (!assignment) {
      throw new Error("TOML 内联表语法无效。");
    }
    assign(table, parseKeyPath(assignment.key), parseValue(assignment.value.trim()));
  });
  return table;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: "\"" | "'" | null = null;
  let triple = false;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (triple && input.startsWith(quote.repeat(3), index)) {
        index += 2;
        quote = null;
        triple = false;
        continue;
      }
      if (!triple && quote === "\"" && char === "\\") {
        index += 1;
        continue;
      }
      if (!triple && char === quote) {
        quote = null;
      }
      continue;
    }
    if (input.startsWith('"""', index) || input.startsWith("'''", index)) {
      quote = input[index] as "\"" | "'";
      triple = true;
      index += 2;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth < 0) {
        throw new Error("非法 TOML 值。");
      }
      continue;
    }
    if (char === separator && depth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  if (quote || depth !== 0) {
    throw new Error("非法 TOML 值。");
  }
  parts.push(input.slice(start));
  return parts;
}

function readQuoted(input: string, start: number): { value: string; next: number } {
  const quote = input[start];
  if (quote !== "\"" && quote !== "'") {
    throw new Error("TOML 字符串无效。");
  }
  if (input.startsWith(quote.repeat(3), start)) {
    const end = input.indexOf(quote.repeat(3), start + 3);
    if (end < 0) {
      throw new Error("TOML 字符串未闭合。");
    }
    const raw = input.slice(start + 3, end);
    return {
      value: quote === "\"" ? unescapeBasic(raw) : raw,
      next: end + 3,
    };
  }
  let value = "";
  for (let index = start + 1; index < input.length; index += 1) {
    const char = input[index];
    if (quote === "\"" && char === "\\") {
      const escaped = input[index + 1];
      if (!escaped) {
        throw new Error("TOML 转义无效。");
      }
      value += unescapeChar(escaped);
      index += 1;
      continue;
    }
    if (char === quote) {
      return { value, next: index + 1 };
    }
    if (char === "\n") {
      throw new Error("TOML 字符串未闭合。");
    }
    value += char;
  }
  throw new Error("TOML 字符串未闭合。");
}

function unescapeBasic(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const escaped = value[index + 1];
    if (!escaped) {
      throw new Error("TOML 转义无效。");
    }
    result += unescapeChar(escaped);
    index += 1;
  }
  return result;
}

function unescapeChar(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "\\":
      return "\\";
    case "\"":
      return "\"";
    case "b":
      return "\b";
    case "f":
      return "\f";
    default:
      throw new Error("TOML 转义无效。");
  }
}

function serializeTable(table: GrokTomlTable, path: string[]): string[] {
  const lines: string[] = [];
  const scalars: string[] = [];
  const nested: string[] = [];
  Object.entries(table).forEach(([key, value]) => {
    if (isGrokTomlTable(value)) {
      nested.push(...serializeTable(value, [...path, key]));
      return;
    }
    if (Array.isArray(value) && value.every((item) => isGrokTomlTable(item))) {
      value.forEach((item) => {
        nested.push(`[[${formatPath([...path, key])}]]`);
        nested.push(...serializeTable(item, []).filter((line) => line !== ""));
        nested.push("");
      });
      return;
    }
    scalars.push(`${quoteKey(key)} = ${formatScalar(value)}`);
  });
  if (path.length > 0 && (scalars.length > 0 || nested.length === 0)) {
    lines.push(`[${formatPath(path)}]`);
  }
  lines.push(...scalars);
  if ((scalars.length > 0 || path.length === 0) && nested.length > 0) {
    lines.push("");
  }
  lines.push(...nested);
  if (path.length > 0 && lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  return lines;
}

function formatPath(path: string[]): string {
  return path.map((segment) => quoteKey(segment)).join(".");
}

function quoteKey(key: string): string {
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}

function formatScalar(value: GrokTomlValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("非法 TOML 数值。");
    }
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (Array.isArray(value)) {
    if (value.some((item) => isGrokTomlTable(item) || Array.isArray(item))) {
      throw new Error("暂不序列化嵌套 TOML 数组。");
    }
    return `[${value.map((item) => formatScalar(item)).join(", ")}]`;
  }
  throw new Error("非法 TOML 值。");
}

function cloneValue(value: GrokTomlValue): GrokTomlValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (isGrokTomlTable(value)) {
    const clone: GrokTomlTable = {};
    Object.entries(value).forEach(([key, item]) => {
      clone[key] = cloneValue(item);
    });
    return clone;
  }
  return value;
}
