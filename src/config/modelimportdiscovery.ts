import {
  containsCredential,
  decodedUrlPart,
  sameOrigin,
  record,
  redactCredential,
  visibleModelId,
  stringValue,
  urlContainsCredential,
  urlForRequest,
} from "./modelimportshared";
import type {
  InternalProvider,
  ModelImportFetch,
  ModelImportModel,
  ModelImportOptions,
  WireProtocol,
} from "./modelimporttypes";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_MODELS = 500;

export function modelListEndpoint(base: string, protocol: WireProtocol): URL {
  const url = urlForRequest(base);
  if (/%(?:2f|2e|5c)/i.test(url.pathname)) throw new Error("Provider URL contains an encoded path separator.");
  const path = decodedUrlPart(url.pathname).replace(/\/+$/, "");
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Provider URL contains an unsafe path.");
  }
  if (protocol === "ollama-native") {
    if (/(?:^|\/)api$/i.test(path)) url.pathname = `${path}/tags`;
    else if (!/(?:^|\/)api\/tags$/i.test(path)) url.pathname = `${path}/api/tags` || "/api/tags";
    return url;
  }
  if (/(?:^|\/)models$/i.test(path)) {
    url.pathname = path;
    return url;
  }
  const hasVersion = /(?:^|\/)v\d+(?:beta\d*|alpha\d*)?$/i.test(path);
  if (hasVersion) {
    url.pathname = `${path}/models`;
  } else if (!path) {
    url.pathname = protocol === "google-genai" ? "/v1beta/models" : "/v1/models";
  } else if (protocol === "anthropic-messages") {
    url.pathname = `${path}/v1/models`;
  } else if (protocol === "google-genai") {
    url.pathname = `${path}/v1beta/models`;
  } else {
    url.pathname = `${path}/models`;
  }
  return url;
}

function authHeaders(providerValue: InternalProvider): Record<string, string> {
  const key = providerValue.apiKey;
  if (!key) return {};
  switch (providerValue.protocolKind) {
    case "anthropic-messages": return providerValue.anthropicAuthToken
      ? { authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" }
      : { "x-api-key": key, "anthropic-version": "2023-06-01" };
    case "google-genai": return { "x-goog-api-key": key };
    default: return { authorization: `Bearer ${key}` };
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Provider response is too large.");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > limit) throw new Error("Provider response is too large.");
  return text;
}

function modelFromResponse(value: unknown, providerValue: InternalProvider): ModelImportModel | null {
  const item = record(value);
  if (!item) return null;
  const rawId = stringValue(item.id) || stringValue(item.name).replace(/^models\//, "");
  if (!visibleModelId(rawId, providerValue)) return null;
  const rawLabel = stringValue(item.display_name) || stringValue(item.displayName) || stringValue(item.name) || rawId;
  return { id: rawId, label: redactCredential(rawLabel, providerValue).slice(0, 160) || rawId };
}

async function fetchJson(providerValue: InternalProvider, url: URL, options: ModelImportOptions): Promise<{ value: unknown; headers: Headers }> {
  const fetcher = options.fetch ?? ((globalThis as { fetch?: ModelImportFetch }).fetch);
  if (!fetcher) throw new Error("模型发现需要 Node fetch 支持。");
  const timeout = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
  const limit = Math.max(1024, Math.min(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 8 * 1024 * 1024));
  let current = url;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("模型发现请求超时。"));
      }, timeout);
    });
    let response: Response;
    try {
      response = await Promise.race([
        fetcher(current.toString(), {
          method: "GET",
          headers: { accept: "application/json", ...authHeaders(providerValue) },
          redirect: "manual",
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (timedOut || (error as { name?: string }).name === "AbortError") throw new Error("模型发现请求超时。");
      throw new Error("模型发现请求失败。");
    }
    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Provider redirect is missing a location.");
        let next: URL;
        try {
          next = urlForRequest(new URL(location, current).toString());
        } catch {
          throw new Error("Provider redirect target is invalid and was rejected.");
        }
        if (!sameOrigin(current, next)) throw new Error("Provider redirect crosses origins and was rejected.");
        if (providerValue.apiKey && urlContainsCredential(next, providerValue.apiKey)) {
          throw new Error("Provider redirect contains credential material and was rejected.");
        }
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
      const text = await Promise.race([readLimited(response, limit), timeoutPromise]);
      try {
        return { value: JSON.parse(text) as unknown, headers: response.headers };
      } catch {
        throw new Error("Provider returned invalid JSON.");
      }
    } catch (error) {
      if (timedOut || (error as { name?: string }).name === "AbortError") throw new Error("模型发现请求超时。");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error("Provider redirect limit exceeded.");
}

function nextPage(value: Record<string, unknown>, headers: Headers): string | null {
  for (const candidate of [value.next, value.next_cursor, record(value.meta)?.next_cursor]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const link = headers.get("link");
  const match = link?.match(/<([^>]+)>;\s*rel=["']?next["']?/i);
  return match?.[1] ?? null;
}

export async function discover(providerValue: InternalProvider, options: ModelImportOptions): Promise<ModelImportModel[]> {
  if (providerValue.disabledReason) throw new Error(providerValue.disabledReason);
  if (!providerValue.protocolKind) throw new Error("Provider protocol is not supported for model discovery.");
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 10));
  const maxModels = Math.max(1, Math.min(options.maxModels ?? DEFAULT_MAX_MODELS, 1000));
  let cursor: string | null = null;
  const result: ModelImportModel[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const url = modelListEndpoint(providerValue.requestBaseUrl, providerValue.protocolKind);
    if (providerValue.protocolKind === "google-genai") {
      url.searchParams.set("pageSize", String(Math.min(maxModels, 100)));
    }
    if (cursor) {
      if (cursor.length > 2048 || /[\u0000-\u001f\u007f]/.test(cursor)) {
        throw new Error("Provider pagination cursor is invalid.");
      }
      if (/^(?:https?:\/\/|\/|\?|\.\.?\/)/i.test(cursor)) {
        let next: URL;
        try { next = urlForRequest(new URL(cursor, url).toString()); } catch { throw new Error("Provider pagination URL is invalid and was rejected."); }
        if (!sameOrigin(url, next)) throw new Error("Provider pagination crosses origins and was rejected.");
        if (providerValue.apiKey && urlContainsCredential(next, providerValue.apiKey)) {
          throw new Error("Provider pagination contains credential material and was rejected.");
        }
        url.href = next.href;
      } else {
        if (containsCredential(cursor, providerValue)) {
          throw new Error("Provider pagination cursor contains credential material and was rejected.");
        }
        const cursorKey = providerValue.protocolKind === "google-genai" ? "pageToken"
          : providerValue.protocolKind === "anthropic-messages" ? "after_id" : "after";
        url.searchParams.set(cursorKey, cursor);
      }
    }
    const response = await fetchJson(providerValue, url, options);
    const body = record(response.value) ?? {};
    const rawModels = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    for (const raw of rawModels) {
      const model = modelFromResponse(raw, providerValue);
      if (model && !seen.has(model.id)) {
        seen.add(model.id);
        result.push(model);
        if (result.length >= maxModels) return result;
      }
    }
    const next = providerValue.protocolKind === "google-genai"
      ? stringValue(body.nextPageToken) || null
      : stringValue(body.next_page) || nextPage(body, response.headers)
        || (body.has_more === true && rawModels.length
          ? stringValue(body.last_id) || stringValue(record(rawModels[rawModels.length - 1])?.id) || null
          : null);
    if (!next) break;
    cursor = next;
  }
  return result;
}
