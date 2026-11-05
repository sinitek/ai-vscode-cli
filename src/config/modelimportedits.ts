import { applyEdits, findNodeAtLocation, getNodeValue, modify, parse as parseJsonc, parseTree } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import { BLOCKED_KEYS, safeIdentifier, safeModelId } from "./modelimportshared";

export function jsoncEdit(content: string, path: (string | number)[], value: unknown, label: string): string {
  if (path.some((part) => typeof part === "string" && BLOCKED_KEYS.has(part))) throw new Error(`${label} path is invalid.`);
  const source = content.trim() ? content : "{}";
  const errors: ParseError[] = [];
  parseJsonc(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`${label} cannot be modified safely.`);
  const edits = modify(source, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } });
  return applyEdits(source, edits);
}

export function appendJsoncObjectProperties(
  content: string,
  path: (string | number)[],
  entries: Array<[string, unknown]>,
  label: string,
): string {
  const source = content.trim() ? content : "{}";
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, { allowTrailingComma: true });
  if (!tree || errors.length || path.some((part) => typeof part === "string" && BLOCKED_KEYS.has(part))) {
    throw new Error(`${label} cannot be modified safely.`);
  }
  if (entries.some(([key]) => BLOCKED_KEYS.has(key))) throw new Error(`${label} path is invalid.`);
  const target = findNodeAtLocation(tree, path);
  if (!target) return jsoncEdit(source, path, Object.fromEntries(entries), label);
  if (target.type !== "object" || source[target.offset] !== "{" || source[target.offset + target.length - 1] !== "}") {
    throw new Error(`${label} model object cannot be modified safely.`);
  }
  const properties = target.children ?? [];
  const existing = new Set<string>();
  for (const property of properties) {
    const keyNode = property.children?.[0];
    const key = keyNode ? getNodeValue(keyNode) : undefined;
    if (typeof key !== "string" || existing.has(key)) throw new Error(`${label} model object contains duplicate or invalid keys.`);
    existing.add(key);
  }
  const additions = entries.filter(([key]) => !existing.has(key));
  if (additions.length === 0) return source;
  if (properties.length === 0) {
    const close = target.offset + target.length - 1;
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const closeLineStart = source.lastIndexOf("\n", close - 1) + 1;
    const closeIndent = /^\s*$/.test(source.slice(closeLineStart, close)) ? source.slice(closeLineStart, close) : "";
    const propertyIndent = `${closeIndent}  `;
    const formatted = additions.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    const insertion = `${eol}${propertyIndent}${formatted.join(`,${eol}${propertyIndent}`)}${eol}${closeIndent}`;
    return `${source.slice(0, close)}${insertion}${source.slice(close)}`;
  }

  const lastProperty = properties[properties.length - 1];
  const valueNode = lastProperty.children?.[1];
  if (!valueNode) throw new Error(`${label} model object cannot be modified safely.`);
  const valueEnd = valueNode.offset + valueNode.length;
  const close = target.offset + target.length - 1;
  const trivia = source.slice(valueEnd, close);
  const hasTrailingComma = firstJsoncToken(trivia) === ",";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const previousLineStart = source.lastIndexOf("\n", lastProperty.offset - 1) + 1;
  const previousIndent = source.slice(previousLineStart, lastProperty.offset);
  const closeLineStart = source.lastIndexOf("\n", close - 1) + 1;
  const closeIndent = /^\s*$/.test(source.slice(closeLineStart, close))
    ? source.slice(closeLineStart, close)
    : "";
  const multiline = /\r?\n/.test(source.slice(lastProperty.offset, close));
  const propertyIndent = /^\s*$/.test(previousIndent) && previousLineStart < lastProperty.offset
    ? previousIndent
    : `${closeIndent}  `;
  const formatted = additions.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const withComma = hasTrailingComma ? source : `${source.slice(0, valueEnd)},${source.slice(valueEnd)}`;
  const adjustedClose = close + (hasTrailingComma ? 0 : 1);
  const insertion = multiline
    ? `${formatted.join(`,${eol}${propertyIndent}`)}${eol}${closeIndent}`
    : formatted.join(", ");
  return `${withComma.slice(0, adjustedClose)}${insertion}${withComma.slice(adjustedClose)}`;
}

function firstJsoncToken(trivia: string): string | undefined {
  let offset = 0;
  while (offset < trivia.length) {
    if (/\s/.test(trivia[offset])) {
      offset += 1;
      continue;
    }
    if (trivia.startsWith("//", offset)) {
      offset += 2;
      while (offset < trivia.length && trivia[offset] !== "\n" && trivia[offset] !== "\r") offset += 1;
      continue;
    }
    if (trivia.startsWith("/*", offset)) {
      const end = trivia.indexOf("*/", offset + 2);
      if (end < 0) throw new Error("JSONC block comment is not closed.");
      offset = end + 2;
      continue;
    }
    return trivia[offset];
  }
  return undefined;
}

export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function appendTomlTable(content: string, path: string[], values: Record<string, string>): string {
  if (path.some((item) => !safeModelId(item) && !safeIdentifier(item))) throw new Error("TOML import path is invalid.");
  const lines = [`[${path.map((item) => /^[A-Za-z0-9_-]+$/.test(item) ? item : tomlString(item)).join(".")}]`];
  for (const [key, value] of Object.entries(values)) lines.push(`${key} = ${tomlString(value)}`);
  const prefix = content.trimEnd();
  return `${prefix}${prefix ? "\n\n" : ""}${lines.join("\n")}\n`;
}

export function replaceTomlRootString(content: string, key: string, value: string): string {
  const lines = content.split(/(?<=\n)/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tableLine = /^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?(?:\r?\n)?$/;
  let inRoot = true;
  const matches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (tableLine.test(lines[index])) {
      inRoot = false;
      continue;
    }
    if (inRoot && new RegExp(`^\\s*${escapedKey}\\s*=`).test(lines[index])) matches.push(index);
  }
  if (matches.length > 1) throw new Error("Codex root model setting cannot be modified safely.");
  if (matches.length === 1) {
    const index = matches[0];
    const pattern = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(?:'(?:[^']|'')*'|"(?:\\\\.|[^"\\\\])*")(\\s*(?:#.*)?(?:\\r?\\n)?)$`);
    const match = pattern.exec(lines[index]);
    if (!match) throw new Error("Codex root model setting cannot be modified safely.");
    lines[index] = `${match[1]}${tomlString(value)}${match[2]}`;
    return lines.join("");
  }
  const firstTableIndex = lines.findIndex((line) => tableLine.test(line));
  const insertion = `${key} = ${tomlString(value)}\n`;
  if (firstTableIndex >= 0) {
    lines.splice(firstTableIndex, 0, `${insertion}\n`);
    return lines.join("");
  }
  return `${insertion}${content}`;
}
