import { resolveChatImagePath } from "./chatImageResource";

export function normalizeChatLinkSource(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  let source = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(source) || source.startsWith("#") || source.startsWith("//")) {
    return null;
  }
  if (/^sandbox:/i.test(source)) {
    source = source.slice("sandbox:".length);
    if (!source.startsWith("/") || source.startsWith("//")) {
      return null;
    }
  }
  if (/^https?:\/\//i.test(source) || /^file:/i.test(source)) {
    try {
      const url = new URL(source);
      if (url.username || url.password) {
        return null;
      }
      if (url.protocol === "file:") {
        return url.search ? null : url.href;
      }
      if (/^file\+[^/]*\.vscode-resource\.vscode-cdn\.net$/i.test(url.hostname)) {
        return normalizeChatLinkSource("file://" + url.pathname + url.hash);
      }
      return url.href;
    } catch {
      return null;
    }
  }
  const pathSource = source.replace(/(\.[a-z\d]+):\d+(?::\d+)?$/i, "$1").replace(/^[a-z]:[\\/]/i, "");
  if (/^[a-z][a-z\d+.-]*:/i.test(pathSource)) {
    return null;
  }
  return source;
}

export type ChatLocalLink = {
  path: string;
  fragment: string;
  line?: number;
  column?: number;
};

export function resolveChatLocalLink(source: string, baseDirectory: string): ChatLocalLink {
  let fragment = "";
  const fragmentIndex = source.indexOf("#");
  if (fragmentIndex >= 0) {
    fragment = source.slice(fragmentIndex + 1);
    source = source.slice(0, fragmentIndex);
  }
  const position = fragment.match(/^L?(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i);
  const suffix = !/^file:/i.test(source) && source.match(/:(\d+)(?::(\d+))?$/);
  if (suffix) {
    source = source.slice(0, suffix.index);
  }
  const line = Number(position?.[1] || (suffix && suffix[1]));
  const column = Number(position?.[2] || (suffix && suffix[2]) || 1);
  return {
    path: resolveChatImagePath(source, baseDirectory),
    fragment: position ? "" : fragment,
    ...(Number.isSafeInteger(line) && line > 0 && Number.isSafeInteger(column) && column > 0 ? { line, column } : {}),
  };
}
