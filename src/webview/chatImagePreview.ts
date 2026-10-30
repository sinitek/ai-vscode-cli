export function createChatSvgImageSource(value: unknown): string | null {
  const maxSvgBytes = 256 * 1024;
  if (typeof value !== "string" || value.length > maxSvgBytes || new TextEncoder().encode(value).byteLength > maxSvgBytes) {
    return null;
  }
  const markup = value.trim().replace(/^<\?xml[\s\S]*?\?>\s*/i, "");
  const openingTag = markup.match(/^<svg(?=[\s/>])[^>]*>/i)?.[0];
  const completeRoot = openingTag && (openingTag.endsWith("/>") ? markup === openingTag : /<\/svg\s*>$/i.test(markup));
  if (!completeRoot || /<!DOCTYPE|<!ENTITY/i.test(markup)) {
    return null;
  }
  let normalized = /\sxmlns\s*=/.test(openingTag)
    ? markup
    : markup.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const viewBox = openingTag.match(/\sviewBox\s*=\s*(["'])([^"']+)\1/i)?.[2]
    .trim().split(/[\s,]+/).map(Number);
  if (!/\s(?:width|height)\s*=/.test(openingTag) && viewBox?.length === 4
    && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    normalized = normalized.replace(/^<svg\b/i, '<svg width="' + viewBox[2] + '" height="' + viewBox[3] + '"');
  }
  const repaired = repairStraySvgEndTags(normalized);
  if (!repaired || new TextEncoder().encode(repaired).byteLength > maxSvgBytes) {
    return null;
  }
  try {
    return "data:image/svg+xml," + encodeURIComponent(repaired);
  } catch {
    return null;
  }

  function readSvgTag(source: string, start: number): { raw: string; name: string; closing: boolean; selfClosing: boolean; end: number } | null {
    let cursor = start + 1;
    if (source[cursor] === "/") {
      cursor += 1;
    }
    const name = /^[A-Za-z][\w:.-]*/.exec(source.slice(cursor))?.[0];
    if (!name) {
      return null;
    }
    cursor += name.length;
    let quote = "";
    let selfClosingSlash = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) {
          quote = "";
        }
        cursor += 1;
        continue;
      }
      if (character === ">") {
        const closing = source[start + 1] === "/";
        return {
          raw: source.slice(start, cursor + 1),
          name,
          closing,
          selfClosing: !closing && selfClosingSlash,
          end: cursor + 1,
        };
      }
      if (character === "\"" || character === "'") {
        quote = character;
        selfClosingSlash = false;
      } else if (character === "/") {
        selfClosingSlash = true;
      } else if (!/\s/.test(character)) {
        selfClosingSlash = false;
      }
      cursor += 1;
    }
    return null;
  }

  function repairStraySvgEndTags(source: string): string | null {
    const stack: string[] = [];
    let result = "";
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf("<", cursor);
      if (start < 0) {
        result += source.slice(cursor);
        break;
      }
      result += source.slice(cursor, start);
      if (source.startsWith("<!--", start)) {
        const end = source.indexOf("-->", start + 4);
        if (end < 0) {
          return null;
        }
        result += source.slice(start, end + 3);
        cursor = end + 3;
        continue;
      }
      if (source.startsWith("<![CDATA[", start)) {
        const end = source.indexOf("]]>", start + 9);
        if (end < 0) {
          return null;
        }
        result += source.slice(start, end + 3);
        cursor = end + 3;
        continue;
      }
      const tag = readSvgTag(source, start);
      if (!tag) {
        return null;
      }
      if (tag.closing) {
        if (stack[stack.length - 1] !== tag.name) {
          if (!stack.includes(tag.name)) {
            cursor = tag.end;
            continue;
          }
          return null;
        }
        stack.pop();
      } else if (!tag.selfClosing) {
        stack.push(tag.name);
      }
      result += tag.raw;
      cursor = tag.end;
    }
    return stack.length === 0 ? result : null;
  }
}

export function normalizeChatImageSource(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const source = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(source)) {
    return null;
  }
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/]+={0,2}$/i.test(source)) {
    return source;
  }
  if (/^data:image\/svg\+xml(?:;charset=utf-8)?(?:;base64)?,/i.test(source)) {
    if (source.length > 3 * 1024 * 1024) {
      return null;
    }
    try {
      const separator = source.indexOf(",");
      const payload = source.slice(separator + 1);
      const markup = /;base64$/i.test(source.slice(0, separator))
        ? new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)))
        : decodeURIComponent(payload);
      return createChatSvgImageSource(markup);
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(source);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
      if (/^file\+[^/]*\.vscode-resource\.vscode-cdn\.net$/i.test(url.hostname)) {
        return normalizeChatImageSource("file://" + url.pathname);
      }
      return url.href;
    }
    if (url.protocol === "file:" && !url.search && !url.hash && /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(url.pathname)) {
      return url.href;
    }
  } catch {}
  if (!source.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(source.replace(/^[a-z]:[\\/]/i, ""))
    && /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(source)) {
    return source;
  }
  return null;
}

export function buildChatImagePreviewHtml(source: string, alt: string): string {
  const safeSource = normalizeChatImageSource(source);
  if (!safeSource || !/^https?:|^data:/i.test(safeSource)) {
    throw new Error("不支持的图片地址");
  }
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>图片预览</title><style>
body { margin: 0; padding: 16px; box-sizing: border-box; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
p { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
</style></head><body><img src="${escape(safeSource)}" alt="${escape(alt)}" referrerpolicy="no-referrer"><p>${escape(alt)}</p></body></html>`;
}
