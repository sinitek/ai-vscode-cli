import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createChatSvgImageSource, normalizeChatImageSource } from "./chatImagePreview";

export const MAX_CHAT_IMAGE_BYTES = 20 * 1024 * 1024;

export type ChatImageResource = {
  bytes: Buffer;
  mime: string;
  filename: string;
  source: string;
};

export function resolveChatImagePath(source: string, baseDirectory: string, homeDirectory = os.homedir()): string {
  if (source.startsWith("file:")) {
    const url = new URL(source);
    if (/^\/[a-z]:\//i.test(url.pathname)) {
      return path.win32.normalize(decodeURIComponent(url.pathname).slice(1));
    }
    if (url.hostname && url.hostname !== "localhost") {
      return path.win32.normalize("\\\\" + url.hostname + decodeURIComponent(url.pathname));
    }
    return fileURLToPath(url);
  }
  try {
    source = decodeURIComponent(source);
  } catch {}
  if (path.win32.isAbsolute(source) && !source.startsWith("/")) {
    return path.win32.normalize(source);
  }
  if (/^~[\\/]/.test(source)) {
    return path.resolve(homeDirectory, source.slice(2));
  }
  if (path.win32.isAbsolute(baseDirectory) && !baseDirectory.startsWith("/")) {
    return path.win32.resolve(baseDirectory, source);
  }
  return path.resolve(baseDirectory, source);
}

export function createChatImageResource(bytes: Buffer, filename = "图片"): ChatImageResource {
  if (!bytes.length || bytes.length > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("图片为空或超过 20 MiB 限制");
  }
  let mime = "";
  let extension = "";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = "image/png";
    extension = "png";
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = "image/jpeg";
    extension = "jpg";
  } else if (/^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) {
    mime = "image/gif";
    extension = "gif";
  } else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    mime = "image/webp";
    extension = "webp";
  } else if (bytes.toString("ascii", 0, 2) === "BM") {
    mime = "image/bmp";
    extension = "bmp";
  } else if (bytes.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(bytes.toString("ascii", 8, 32))) {
    mime = "image/avif";
    extension = "avif";
  } else {
    const svgSource = createChatSvgImageSource(bytes.toString("utf8"));
    if (svgSource) {
      return { bytes, mime: "image/svg+xml", filename: imageFilename(filename, "svg"), source: svgSource };
    }
    throw new Error("文件不是支持的图片或 SVG 格式");
  }
  return { bytes, mime, filename: imageFilename(filename, extension), source: "data:" + mime + ";base64," + bytes.toString("base64") };
}

function imageFilename(filename: string, extension: string): string {
  const basename = path.win32.basename(filename).replace(/\.[^.]*$/, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100);
  return (basename || "图片") + "." + extension;
}

export async function loadChatImageResource(source: unknown, baseDirectory: string): Promise<ChatImageResource> {
  const normalized = normalizeChatImageSource(source);
  if (!normalized) {
    throw new Error("不支持的图片地址");
  }
  if (normalized.startsWith("data:")) {
    const separator = normalized.indexOf(",");
    const payload = normalized.slice(separator + 1);
    if (payload.length > Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4) {
      throw new Error("图片超过 20 MiB 限制");
    }
    const bytes = /;base64$/i.test(normalized.slice(0, separator))
      ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return createChatImageResource(bytes);
  }
  if (/^https?:/.test(normalized)) {
    const response = await fetch(normalized, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) {
      throw new Error("图片下载失败（HTTP " + response.status + "）");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get("content-length")) > MAX_CHAT_IMAGE_BYTES) {
        throw new Error("图片超过 20 MiB 限制");
      }
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        size += chunk.value.byteLength;
        if (size > MAX_CHAT_IMAGE_BYTES) {
          throw new Error("图片超过 20 MiB 限制");
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel();
    }
    let filename = "图片";
    try {
      filename = decodeURIComponent(new URL(normalized).pathname.split("/").pop() || filename);
    } catch {}
    return createChatImageResource(Buffer.concat(chunks), filename);
  }
  const filePath = resolveChatImagePath(normalized, baseDirectory);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_CHAT_IMAGE_BYTES) {
    throw new Error("不是普通图片文件或超过 20 MiB 限制");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_CHAT_IMAGE_BYTES) {
      throw new Error("图片超过 20 MiB 限制");
    }
    chunks.push(bytes);
  }
  return createChatImageResource(Buffer.concat(chunks), path.basename(filePath));
}
