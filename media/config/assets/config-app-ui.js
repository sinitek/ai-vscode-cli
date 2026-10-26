// Icons
const GH = (e, t) => c.createElement(Qr, ip({}, e, { ref: t, icon: UH })),
  KH = c.forwardRef(GH);

const DEFAULT_RUN_COMMANDS = {
    claude: "claude --dangerously-skip-permissions",
    codex: "codex --dangerously-bypass-approvals-and-sandbox",
    opencode: "opencode --auto",
    grok: "grok --always-approve",
    dsh: "dsh",
  };

const DEFAULT_INSTALL_COMMANDS = {
    claude: "npm install -g @anthropic-ai/claude-code",
    codex: "npm i -g @openai/codex",
    opencode: "npm install -g opencode-ai",
    grok: "curl -fsSL https://x.ai/cli/install.sh | bash",
    dsh: "npm install -g @deepseek-ai/dsh",
  };

const DSH_UI_PROVIDER = "sinitek-custom";
const DSH_UI_API = "openai-completions";
const DSH_UI_API_KEY_ENV = "SINITEK_DSH_API_KEY";
const DSH_UI_MODEL_ID = "deepseek-v4.1-flash";
const DSH_UI_EXAMPLE_BASE_URL = "https://gateway.example/v1";
const DSH_UI_DISPLAY_NAME = "Sinitek custom";
const DSH_UI_SUPPORTS_MODEL_LIST = true;
const DSH_UI_SECRET_ASSIGNMENT = /(?:^|[\s,{])(?:SINITEK_DSH_API_KEY|DEEPSEEK_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*\S+/i;
const DSH_UI_SECRET_TOKEN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/;
const DSH_UI_SECRET_ERROR = "DSH profile contains a credential value. Reference SINITEK_DSH_API_KEY only.";
const DSH_UI_API_KEY_ERROR = "DSH apiKey must be a single-line string.";
const DSH_UI_KEY_ERROR = "DSH credentials must reference SINITEK_DSH_API_KEY.";
const DSH_UI_MODEL_LIST_ERROR = "DSH models must list at least one complete model id.";
const DSH_UI_MODEL_ID_REQUIRED_ERROR = "模型 id 为必填项，请在右侧填写后再保存。";
const DSH_UI_ACP_ERROR = "DSH acpModel must be one of the configured model ids.";
const DSH_UI_PROFILE_KEYS = [
  "schemaVersion",
  "provider",
  "api",
  "apiKey",
  "apiKeyEnv",
  "baseURL",
  "displayName",
  "timeoutMs",
  "streamIdleTimeoutMs",
  "retryPolicy",
  "models",
  "acpModel",
];
const DSH_UI_MODEL_KEYS = ["id", "name", "input", "maxTokens", "contextWindow"];
const DSH_UI_UNVERIFIED = [
  "headers",
  "thinkingBudgets",
  "cacheRetention",
  "transport",
  "defaultContextWindow",
  "defaultInput",
  "contextWindow",
  "reasoningEfforts",
  "compat",
  "modelOverrides",
  "apiKey",
  "api_key",
  "token",
  "password",
];
const DSH_UI_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const configPlatformLabel = (platform) =>
  platform === "claude"
    ? "Claude"
    : platform === "codex"
      ? "Codex"
      : platform === "opencode"
        ? "OpenCode"
        : platform === "grok"
          ? "Grok"
          : platform === "dsh"
            ? "DSH"
            : "OpenCode";

function dshUiContainsSecret(value) {
  return DSH_UI_SECRET_ASSIGNMENT.test(String(value || "")) || DSH_UI_SECRET_TOKEN.test(String(value || ""));
}

function dshUiContainsProfileSecret(value) {
  const source = String(value || "");
  try {
    const profile = JSON.parse(source);
    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      const publicFields = { ...profile };
      delete publicFields.apiKey;
      return dshUiContainsSecret(JSON.stringify(publicFields));
    }
  } catch {}
  return dshUiContainsSecret(source);
}

function dshUiEmptyFields() {
  return {
    provider: "",
    baseURL: "",
    modelId: "",
    apiKey: "",
    apiKeyEnv: DSH_UI_API_KEY_ENV,
    models: [],
    acpModel: "",
  };
}

function dshUiDocumentFromParts(parts) {
  return {
    schemaVersion: 1,
    provider: DSH_UI_PROVIDER,
    api: DSH_UI_API,
    ...(parts.apiKey !== undefined ? { apiKey: parts.apiKey } : {}),
    apiKeyEnv: DSH_UI_API_KEY_ENV,
    baseURL: parts.baseURL,
    models: parts.models.map((id) => ({
      id,
      name: id,
      input: ["text"],
    })),
    acpModel: parts.acpModel,
  };
}

function dshUiSerializeRaw(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function createDshUiProfileText(baseURL) {
  const candidate = typeof baseURL === "string" && baseURL.trim() ? baseURL.trim() : DSH_UI_EXAMPLE_BASE_URL;
  const resolved = dshUiContainsSecret(candidate) ? DSH_UI_EXAMPLE_BASE_URL : candidate;
  return dshUiSerializeRaw(dshUiDocumentFromParts({
    baseURL: resolved,
    models: [DSH_UI_MODEL_ID],
    acpModel: DSH_UI_MODEL_ID,
    apiKey: "",
  }));
}

function dshUiFailed(error, fields) {
  return { ok: false, error, fields: fields || dshUiEmptyFields(), document: null, content: "" };
}

function dshUiModelIdError(value, seen) {
  if (typeof value !== "string" || value.length === 0) return DSH_UI_MODEL_ID_REQUIRED_ERROR;
  if (value !== value.trim() || /\s/.test(value) || value.includes("\\")) {
    return "DSH model id must be a non-empty complete id without whitespace or backslashes.";
  }
  if (dshUiContainsSecret(value)) return DSH_UI_SECRET_ERROR;
  if (seen && seen.has(value)) return "DSH model ids must stay unique in configuration order.";
  return "";
}

function dshUiLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped) return dshUiIpv4Loopback(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return ((high >> 8) & 255) === 127;
  }
  return dshUiIpv4Loopback(host);
}

function dshUiIpv4Loopback(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 127;
}

function dshUiCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function dshUiBlockedKey(key, path = "") {
  if (/^models\[\d+\]$/.test(path) && (key === "reasoningEfforts" || key === "compat" || key === "contextWindow")) return false;
  return DSH_UI_BLOCKED_KEYS.has(key) || DSH_UI_UNVERIFIED.includes(key);
}

function dshUiFindUnverified(value, path) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = dshUiFindUnverified(value[index], `${path || ""}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (dshUiBlockedKey(key, path)) return fieldPath;
    const found = dshUiFindUnverified(child, fieldPath);
    if (found) return found;
  }
  return "";
}

function dshUiHasModelsAndOverrides(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => dshUiHasModelsAndOverrides(item));
  if (Object.prototype.hasOwnProperty.call(value, "models") && Object.prototype.hasOwnProperty.call(value, "modelOverrides")) {
    return true;
  }
  return Object.values(value).some((child) => dshUiHasModelsAndOverrides(child));
}

function dshUiPreserved(record, known, path) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (known.includes(key)) continue;
    const fieldPath = path ? `${path}.${key}` : key;
    if (dshUiBlockedKey(key, path)) return { ok: false, error: `DSH profile field ${fieldPath} is not part of the verified contract.` };
    let cloned;
    try {
      cloned = dshUiCloneJson(value);
    } catch {
      return { ok: false, error: `DSH profile field ${fieldPath} is not part of the verified contract.` };
    }
    const blocked = dshUiFindUnverified(cloned, fieldPath);
    if (blocked) return { ok: false, error: `DSH profile field ${blocked} is not part of the verified contract.` };
    fields[key] = cloned;
  }
  return { ok: true, fields };
}

function dshUiRetryError(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const extra = Object.keys(policy).find((key) => !["mode", "maxRetries", "backoff"].includes(key));
  if (extra) return `DSH profile field retryPolicy.${extra} is not part of the verified contract.`;
  if (policy.mode !== "normal" || policy.maxRetries !== 1) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const backoff = policy.backoff;
  if (!backoff || typeof backoff !== "object" || Array.isArray(backoff)) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  const backoffExtra = Object.keys(backoff).find((key) => !["initialDelayMs", "maxDelayMs"].includes(key));
  if (backoffExtra) return `DSH profile field retryPolicy.backoff.${backoffExtra} is not part of the verified contract.`;
  if (backoff.initialDelayMs !== 200 || backoff.maxDelayMs !== 1000) {
    return "DSH retryPolicy must stay mode=normal with the verified backoff.";
  }
  return "";
}

function dshUiCanonicalBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value) || value.includes("\\") || dshUiContainsSecret(value)) {
    return "";
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.username || url.password || url.search || url.hash) return "";
  const loopbackHttp = url.protocol === "http:" && dshUiLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) return "";
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function readDshUiDocument(content) {
  const fields = dshUiEmptyFields();
  const text = String(content || "");
  if (!text.trim()) return dshUiFailed("DSH profile is empty.", fields);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return dshUiFailed("DSH profile must be the verified JSON document, not TOML or an arbitrary string.", fields);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return dshUiFailed("DSH profile must be an object.", fields);
  }
  if (parsed.apiKey !== undefined && (typeof parsed.apiKey !== "string" || /[\r\n\0]/.test(parsed.apiKey))) {
    return dshUiFailed(DSH_UI_API_KEY_ERROR, fields);
  }
  const publicFields = { ...parsed };
  delete publicFields.apiKey;
  if (dshUiContainsSecret(JSON.stringify(publicFields))) {
    return dshUiFailed(DSH_UI_SECRET_ERROR, fields);
  }
  const provider = parsed.provider === DSH_UI_PROVIDER ? parsed.provider : "";
  const baseURL = dshUiCanonicalBaseUrl(parsed.baseURL);
  const nextFields = {
    ...fields,
    provider,
    baseURL,
    apiKeyEnv: DSH_UI_API_KEY_ENV,
  };
  if (!provider) {
    return dshUiFailed("DSH provider route must be sinitek-custom. Do not split the model id on '/'.", nextFields);
  }
  if (parsed.apiKeyEnv !== undefined && parsed.apiKeyEnv !== DSH_UI_API_KEY_ENV) {
    return dshUiFailed(DSH_UI_KEY_ERROR, nextFields);
  }
  if (parsed.api !== DSH_UI_API) return dshUiFailed("DSH api must be openai-completions.", nextFields);
  if (parsed.schemaVersion !== 1) return dshUiFailed("DSH profile schemaVersion must be 1.", nextFields);
  if (parsed.displayName !== undefined && parsed.displayName !== DSH_UI_DISPLAY_NAME) {
    return dshUiFailed("DSH displayName must stay Sinitek custom.", nextFields);
  }
  if (parsed.timeoutMs !== undefined && parsed.timeoutMs !== 45000) {
    return dshUiFailed("DSH timeoutMs must stay at the verified value 45000.", nextFields);
  }
  if (parsed.streamIdleTimeoutMs !== undefined && parsed.streamIdleTimeoutMs !== 60000) {
    return dshUiFailed("DSH streamIdleTimeoutMs must stay at the verified value 60000.", nextFields);
  }
  const retryError = parsed.retryPolicy === undefined ? "" : dshUiRetryError(parsed.retryPolicy);
  if (retryError) return dshUiFailed(retryError, nextFields);
  if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
    return dshUiFailed(DSH_UI_MODEL_LIST_ERROR, nextFields);
  }
  if (!DSH_UI_SUPPORTS_MODEL_LIST && parsed.models.length !== 1) {
    return dshUiFailed("DSH models must list only the verified complete model id.", nextFields);
  }
  const ids = [];
  const seen = new Set();
  for (const entry of parsed.models) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return dshUiFailed("DSH model entry must be an object.", { ...nextFields, modelId: "" });
    }
    const idError = dshUiModelIdError(entry.id, seen);
    if (idError) return dshUiFailed(idError, { ...nextFields, modelId: "" });
    if (entry.name !== undefined && typeof entry.name !== "string") {
      return dshUiFailed("模型名称必须是字符串。", { ...nextFields, modelId: "" });
    }
    if (!Array.isArray(entry.input) || entry.input.length !== 1 || entry.input[0] !== "text") {
      return dshUiFailed("DSH model input must be [text].", { ...nextFields, modelId: "" });
    }
    if (entry.maxTokens !== undefined && (!Number.isSafeInteger(entry.maxTokens) || entry.maxTokens <= 0)) {
      return dshUiFailed("最大输出 tokens 必须是正整数。", { ...nextFields, modelId: "" });
    }
    if (entry.contextWindow !== undefined && (!Number.isSafeInteger(entry.contextWindow) || entry.contextWindow <= 0)) {
      return dshUiFailed("上下文窗口必须是正整数。", { ...nextFields, modelId: "" });
    }
    seen.add(entry.id);
    ids.push(entry.id);
  }
  if (typeof parsed.acpModel !== "string" || !ids.includes(parsed.acpModel)) {
    return dshUiFailed(DSH_UI_ACP_ERROR, { ...nextFields, modelId: "", models: ids });
  }
  if (!baseURL) {
    return dshUiFailed("DSH baseURL must be https, or http on a loopback host, without embedded credentials.", nextFields);
  }
  if (dshUiHasModelsAndOverrides(parsed)) {
    return dshUiFailed("DSH providers.models and modelOverrides cannot be used together.", nextFields);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "initialize")) {
    return dshUiFailed("DSH initialize acceptance is not an executable model list.", nextFields);
  }
  const unverified = dshUiFindUnverified(publicFields, "");
  if (unverified) return dshUiFailed(`DSH profile field ${unverified} is not part of the verified contract.`, nextFields);
  const preserved = dshUiPreserved(parsed, DSH_UI_PROFILE_KEYS, "");
  if (!preserved.ok) return dshUiFailed(preserved.error, nextFields);
  const modelObjects = [];
  for (let index = 0; index < parsed.models.length; index += 1) {
    const entry = parsed.models[index];
    const modelPreserved = dshUiPreserved(entry, DSH_UI_MODEL_KEYS, `models[${index}]`);
    if (!modelPreserved.ok) return dshUiFailed(modelPreserved.error, nextFields);
    modelObjects.push(Object.assign({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : entry.id,
      input: ["text"],
      ...(typeof entry.maxTokens === "number" ? { maxTokens: entry.maxTokens } : {}),
      ...(typeof entry.contextWindow === "number" ? { contextWindow: entry.contextWindow } : {}),
    }, modelPreserved.fields));
  }
  const document = Object.assign(dshUiDocumentFromParts({
    baseURL,
    models: ids,
    acpModel: parsed.acpModel,
    apiKey: parsed.apiKey,
  }), preserved.fields);
  if (parsed.displayName !== undefined) document.displayName = DSH_UI_DISPLAY_NAME;
  if (parsed.timeoutMs !== undefined) document.timeoutMs = 45000;
  if (parsed.streamIdleTimeoutMs !== undefined) document.streamIdleTimeoutMs = 60000;
  if (parsed.retryPolicy !== undefined) {
    document.retryPolicy = {
      mode: "normal",
      maxRetries: 1,
      backoff: { initialDelayMs: 200, maxDelayMs: 1000 },
    };
  }
  document.models = modelObjects;
  return {
    ok: true,
    error: "",
    fields: {
      provider: DSH_UI_PROVIDER,
      baseURL,
      modelId: parsed.acpModel,
      apiKeyEnv: DSH_UI_API_KEY_ENV,
      models: ids,
      acpModel: parsed.acpModel,
    },
    document,
    content: dshUiSerializeRaw(document),
  };
}

function dshUiHasDraftModel(document) {
  return Boolean(document && Array.isArray(document.models) && document.models.some((model) => model.id === ""));
}

function dshUiDraftChange(document) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  return { ok: true, error: "", document: dshUiCloneJson(document), content: dshUiSerializeRaw(document) };
}

function dshUiChange(document) {
  if (dshUiHasDraftModel(document)) return dshUiDraftChange(document);
  const content = dshUiSerializeRaw(document);
  const parsed = readDshUiDocument(content);
  if (!parsed.ok) return { ok: false, error: parsed.error, document: null, content: "" };
  return { ok: true, error: "", document: parsed.document, content: parsed.content };
}

function dshUiUpdateModelId(document, previousId, nextId) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  const ids = document.models.map((model) => model.id);
  const index = ids.indexOf(previousId);
  if (index < 0) return { ok: false, error: DSH_UI_ACP_ERROR, document: null, content: "" };
  if (nextId === previousId) return dshUiChange(document);
  if (nextId === "") {
    if (ids.some((id, currentIndex) => currentIndex !== index && id === "")) {
      return { ok: false, error: DSH_UI_MODEL_ID_REQUIRED_ERROR, document: null, content: "" };
    }
    const next = dshUiCloneJson(document);
    next.models[index].id = "";
    next.models[index].name = "";
    if (next.acpModel === previousId) {
      next.acpModel = next.models.find((model) => model.id)?.id || "";
    }
    return dshUiDraftChange(next);
  }
  const seen = new Set(ids.filter((id) => id !== previousId));
  const idError = dshUiModelIdError(nextId, seen);
  if (idError) return { ok: false, error: idError, document: null, content: "" };
  const next = dshUiCloneJson(document);
  if (next.models[index].name === previousId || !next.models[index].name) {
    next.models[index].name = nextId;
  }
  next.models[index].id = nextId;
  if (next.acpModel === previousId || !next.acpModel) next.acpModel = nextId;
  return dshUiChange(next);
}

function dshUiUpdateModelName(document, modelId, value) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  const index = document.models.findIndex((model) => model.id === modelId);
  if (index < 0) return { ok: false, error: DSH_UI_ACP_ERROR, document: null, content: "" };
  if (typeof value !== "string" || dshUiContainsSecret(value)) {
    return { ok: false, error: DSH_UI_SECRET_ERROR, document: null, content: "" };
  }
  const next = dshUiCloneJson(document);
  next.models[index].name = value.trim() || next.models[index].id;
  return dshUiChange(next);
}

function dshUiUpdateModelInteger(document, modelId, key, value, label) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  const index = document.models.findIndex((model) => model.id === modelId);
  if (index < 0) return { ok: false, error: DSH_UI_ACP_ERROR, document: null, content: "" };
  if (value !== "" && (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) {
    return { ok: false, error: `${label}必须是正整数。`, document: null, content: "" };
  }
  const next = dshUiCloneJson(document);
  if (value === "") delete next.models[index][key];
  else next.models[index][key] = Number(value);
  return dshUiChange(next);
}

function dshUiUpdateModelContextWindow(document, modelId, value) {
  return dshUiUpdateModelInteger(document, modelId, "contextWindow", value, "上下文窗口");
}

function dshUiAddModel(document, rawId) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  if (rawId === void 0) {
    if (dshUiHasDraftModel(document)) {
      return { ok: false, error: DSH_UI_MODEL_ID_REQUIRED_ERROR, document: null, content: "" };
    }
    const next = dshUiCloneJson(document);
    next.models.push({ id: "", name: "", input: ["text"] });
    return dshUiDraftChange(next);
  }
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const ids = document.models.map((model) => model.id);
  const idError = dshUiModelIdError(id, new Set(ids));
  if (idError) return { ok: false, error: idError, document: null, content: "" };
  const next = dshUiCloneJson(document);
  next.models.push({ id, name: id, input: ["text"] });
  return dshUiChange(next);
}

function dshUiDeleteModel(document, id) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  if (!Array.isArray(document.models) || document.models.length <= 1) {
    return { ok: false, error: DSH_UI_MODEL_LIST_ERROR, document: null, content: "" };
  }
  const ids = document.models.map((model) => model.id);
  const index = ids.indexOf(id);
  if (index < 0) return { ok: false, error: DSH_UI_ACP_ERROR, document: null, content: "" };
  const next = dshUiCloneJson(document);
  next.models.splice(index, 1);
  if (next.acpModel === id) next.acpModel = next.models.find((model) => model.id)?.id || "";
  return dshUiChange(next);
}

function dshUiSetAcpModel(document, id) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  if (!document.models.some((model) => model.id === id)) {
    return { ok: false, error: DSH_UI_ACP_ERROR, document: null, content: "" };
  }
  const next = dshUiCloneJson(document);
  next.acpModel = id;
  return dshUiChange(next);
}

function dshUiUpdateBaseUrl(document, value) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  if (dshUiContainsSecret(value)) return { ok: false, error: DSH_UI_SECRET_ERROR, document: null, content: "" };
  const baseURL = dshUiCanonicalBaseUrl(value);
  if (!baseURL) {
    return {
      ok: false,
      error: "DSH baseURL must be https, or http on a loopback host, without embedded credentials.",
      document: null,
      content: "",
    };
  }
  const next = dshUiCloneJson(document);
  next.baseURL = baseURL;
  return dshUiChange(next);
}

function dshUiUpdateApiKeyEnv(document, value) {
  if (dshUiContainsSecret(value)) return { ok: false, error: DSH_UI_SECRET_ERROR, document: null, content: "" };
  if (value !== DSH_UI_API_KEY_ENV) return { ok: false, error: DSH_UI_KEY_ERROR, document: null, content: "" };
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  return dshUiChange(document);
}

function dshUiUpdateApiKey(document, value) {
  if (!document) return { ok: false, error: "DSH profile is empty.", document: null, content: "" };
  if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
    return { ok: false, error: DSH_UI_API_KEY_ERROR, document: null, content: "" };
  }
  const next = dshUiCloneJson(document);
  if (value.trim()) next.apiKey = value.trim();
  else delete next.apiKey;
  return dshUiChange(next);
}

function dshUiSwitchMode(input) {
  const nextMode = input && input.nextMode === "json" ? "json" : "visual";
  const text = input && typeof input.text === "string" ? input.text : "";
  const document = input && input.document ? input.document : null;
  if (nextMode === "visual") {
    if (!text.trim()) {
      const draft = dshUiDocumentFromParts({
        baseURL: DSH_UI_EXAMPLE_BASE_URL,
        models: [DSH_UI_MODEL_ID],
        acpModel: DSH_UI_MODEL_ID,
        apiKey: "",
      });
      return { ok: true, error: "", mode: "visual", text: dshUiSerializeRaw(draft), document: draft };
    }
    const parsed = readDshUiDocument(text);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, mode: input.mode || "json", text, document };
    }
    return { ok: true, error: "", mode: "visual", text: parsed.content, document: parsed.document };
  }
  if (!document) return { ok: true, error: "", mode: "json", text, document: null };
  const serialized = dshUiChange(document);
  if (!serialized.ok) {
    return { ok: false, error: serialized.error, mode: input.mode || "visual", text, document };
  }
  return { ok: true, error: "", mode: "json", text: serialized.content, document: serialized.document };
}

const DshConfigPageUtils = {
  containsSecret: dshUiContainsSecret,
  containsProfileSecret: dshUiContainsProfileSecret,
  createProfileText: createDshUiProfileText,
  readDocument: readDshUiDocument,
  updateModelId: dshUiUpdateModelId,
  updateModelName: dshUiUpdateModelName,
  updateModelContextWindow: dshUiUpdateModelContextWindow,
  addModel: dshUiAddModel,
  deleteModel: dshUiDeleteModel,
  setAcpModel: dshUiSetAcpModel,
  updateBaseUrl: dshUiUpdateBaseUrl,
  updateApiKeyEnv: dshUiUpdateApiKeyEnv,
  updateApiKey: dshUiUpdateApiKey,
  switchMode: dshUiSwitchMode,
  provider: DSH_UI_PROVIDER,
  apiKeyEnv: DSH_UI_API_KEY_ENV,
  modelId: DSH_UI_MODEL_ID,
  exampleBaseUrl: DSH_UI_EXAMPLE_BASE_URL,
  supportsMultipleModels: DSH_UI_SUPPORTS_MODEL_LIST,
};

const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS = 500;
const CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS = CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS / 2;
const CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX = 220;
const CONFIG_PROVIDER_CARD_ORIGINAL_MIN_WIDTH_PX = 190;
const CONFIG_PROVIDER_CARD_WIDTH_SCALE = 0.6;
const CONFIG_PROVIDER_CARD_WIDTH_PX = Math.round(
  CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX * CONFIG_PROVIDER_CARD_WIDTH_SCALE,
);
const CONFIG_PROVIDER_CARD_MIN_WIDTH_PX = Math.round(
  CONFIG_PROVIDER_CARD_ORIGINAL_MIN_WIDTH_PX * CONFIG_PROVIDER_CARD_WIDTH_SCALE,
);

const { confirm: uk } = xr;

const isConfigPlatformEnabled = (platform, enabledByName) => {
  if (!enabledByName || typeof enabledByName !== "object") {
    return true;
  }
  return enabledByName[platform] !== false;
};

// Config list panel
const ConfigListPanel = ({ onMobileClose } = {}) => {
    const {
        configs: e,
        activeConfigIds: t,
        selectedConfigId: n,
        selectedConfigPlatform: r,
        setSelectedConfig: o,
        addConfig: l,
        updateConfig: s,
        deleteConfig: u,
        duplicateConfig: f,
        setActiveConfig: m,
        reorderConfigs: v,
      } = useConfigStore(),
      [p, h] = c.useState(null),
      [b, x] = c.useState(null),
      [S, y] = c.useState(null),
      [exportOpen, setExportOpen] = c.useState(!1),
      [exportResult, setExportResult] = c.useState(""),
      [importOpen, setImportOpen] = c.useState(!1),
      [exportSelection, setExportSelection] = c.useState({}),
      [importItems, setImportItems] = c.useState(null),
      [importError, setImportError] = c.useState(""),
      [isImporting, setIsImporting] = c.useState(!1),
      [skillsMarketOpen, setSkillsMarketOpen] = c.useState(!1),
      [cliEnabledByName, setCliEnabledByName] = c.useState(() =>
        window.sinitekCliEnabledByName && typeof window.sinitekCliEnabledByName === "object"
          ? window.sinitekCliEnabledByName
          : null,
      ),
      $ = c.useMemo(() => e.filter((k) => k.platform === "claude"), [e]),
      w = c.useMemo(() => e.filter((k) => k.platform === "codex"), [e]),
      O = c.useMemo(() => e.filter((k) => k.platform === "opencode"), [e]),
      grokConfigs = c.useMemo(() => e.filter((k) => k.platform === "grok"), [e]),
      dshConfigs = c.useMemo(() => e.filter((k) => k.platform === "dsh"), [e]),
      exportSelectedCount = c.useMemo(
        () => e.reduce((k, L) => k + (exportSelection[L.id] ? 1 : 0), 0),
        [e, exportSelection],
      ),
      exportAllChecked = e.length > 0 && exportSelectedCount === e.length,
      exportAnySelected = exportSelectedCount > 0,
      I = (k) => {
        const L = configPlatformLabel(k);
        xr.confirm({
          title: `添加${L}配置`,
          content: be.jsx(zi, {
            id: "config-name-input",
            placeholder: "请输入配置名称",
            defaultValue: `${L} 配置 ${Date.now()}`,
          }),
          onOk: async () => {
            const U = document
              .getElementById("config-name-input")
              ?.value?.trim();
            if (!U) return (Kt.error("配置名称不能为空"), Promise.reject());
            try {
              let T;
              (k === "claude"
                ? (T = await l({
                    name: U,
                    platform: k,
                    content: "{}",
                    mcpContent: "{}",
                    claudeSkills: [],
                  }))
                : k === "opencode"
	                  ? (T = await l({
	                      name: U,
	                      platform: k,
	                      content: "{}",
	                      openCodeSkills: [],
	                    }))
                  : k === "grok"
                    ? (T = await l({
                        name: U,
                        platform: k,
                        content: "",
                        configContent: "",
                      }))
                  : k === "dsh"
                    ? (T = await l({
                        name: U,
                        platform: k,
                        content: createDshUiProfileText(),
                        configContent: createDshUiProfileText(),
                      }))
                  : (T = await l({
                      name: U,
                      platform: k,
                      configContent: "",
                      authContent: "{}",
                      codexSkills: [],
                    })),
                o(T.id, T.platform),
                Kt.success("添加成功"));
            } catch (T) {
              return (Kt.error("添加失败: " + T), Promise.reject(T));
            }
          },
        });
      },
      R = async (k, L) => {
        try {
          if (navigator.clipboard?.writeText)
            await navigator.clipboard.writeText(k);
          else {
            const G = document.createElement("textarea");
            ((G.value = k),
              document.body.appendChild(G),
              G.select(),
              document.execCommand("copy"),
              document.body.removeChild(G));
          }
          Kt.success(`${L} 已复制: ${k}`);
        } catch {
          Kt.error("复制失败，请手动复制");
        }
      },
      P = (k) => (k === "claude" ? $ : k === "codex" ? w : k === "grok" ? grokConfigs : k === "dsh" ? dshConfigs : O),
      _ = (k) => {
        x(k);
      },
      M = () => {
        (x(null), y(null));
      },
      N = (k, L) => {
        (k.preventDefault(), y(L));
      },
      z = (k, L, G) => {
        if ((k.preventDefault(), k.stopPropagation(), !b || b === G)) {
          M();
          return;
        }
        const U = P(L),
          T = U.findIndex((Y) => Y.id === b),
          F = U.findIndex((Y) => Y.id === G);
        if (T === -1 || F === -1) {
          M();
          return;
        }
        (v(L, T, F), M());
      },
      D = (k, L) => {
        if ((k.preventDefault(), k.stopPropagation(), !b)) {
          M();
          return;
        }
        const G = P(L),
          U = G.findIndex((T) => T.id === b);
        if (U === -1) {
          M();
          return;
        }
        (v(L, U, G.length - 1), M());
      },
      B = async (k, L) => {
        k.stopPropagation();
        try {
          (h(L.id),
            await backupConfigItem(L.platform),
            L.platform === "claude"
              ? await applyConfigItem(L.platform, {
                  content: L.content,
                })
              : L.platform === "opencode"
	                ? await applyConfigItem(L.platform, {
	                    content: L.content,
	                  })
                : L.platform === "grok"
                  ? await applyConfigItem(L.platform, {
                      content: L.configContent || L.content || "",
                      configContent: L.configContent || L.content || "",
                    })
                : L.platform === "dsh"
                  ? await applyConfigItem(L.platform, {
                      content: L.configContent || L.content || "",
                      configContent: L.configContent || L.content || "",
                      profileId: L.id,
                    })
                : await applyConfigItem(L.platform, {
                    configContent: L.configContent,
                    authContent: L.authContent,
                  }),
            m(L.platform, L.id),
            Kt.success(`已应用配置: ${L.name}`));
        } catch (G) {
          Kt.error(`应用配置失败: ${G}`);
        } finally {
          h(null);
        }
      },
      A = (k, L) => {
        (k.stopPropagation(),
          uk({
            title: "确认删除",
            content: `确定要删除配置"${L.name}"吗？`,
            okText: "确认",
            cancelText: "取消",
            okType: "danger",
            onOk: async () => {
              try {
                (await u(L.platform, L.id), Kt.success("删除成功"));
              } catch (G) {
                Kt.error("删除失败: " + G);
              }
            },
          }));
      },
      V = async (k, L) => {
        k.stopPropagation();
        const G = [
          { label: configPlatformLabel(L.platform), value: L.platform },
        ];
        const Y = G[0].label;
        let copyTargetPlatform = L.platform;
        xr.confirm({
          title: "复制配置",
          content: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "8px" },
            children: [
              be.jsx("div", { children: `从 ${L.name} 复制到 ${Y}` }),
              be.jsx($l, {
                defaultValue: G[G.length - 1].value,
                onChange: (K) => {
                  copyTargetPlatform = K || L.platform;
                },
                options: G,
                allowClear: !1,
                showSearch: !1,
                style: { width: "100%" },
                getPopupContainer: (K) => K.parentElement || document.body,
              }),
            ],
          }),
          okText: "确认",
          cancelText: "取消",
          onOk: async () => {
            try {
              const Q = await f(L.id, copyTargetPlatform);
              (o(Q.id, Q.platform), Kt.success(`已复制配置: ${Q.name}`));
            } catch (Q) {
              return (Kt.error(`复制失败: ${Q}`), Promise.reject(Q));
            }
          },
        });
      },
      W = (k, L) => {
        (k.stopPropagation(),
          xr.confirm({
            title: "重命名配置",
            content: be.jsx(zi, {
              id: "rename-input",
              placeholder: "请输入新的配置名称",
              defaultValue: L.name,
            }),
            onOk: async () => {
              const U = document.getElementById("rename-input")?.value?.trim();
              if (!U) return (Kt.error("配置名称不能为空"), Promise.reject());
              if (U === L.name) {
                Kt.info("配置名称未改变");
                return;
              }
              try {
                (await s(L.id, { name: U }), Kt.success("重命名成功"));
              } catch (T) {
                return (Kt.error("重命名失败: " + T), Promise.reject(T));
              }
            },
          }));
      },
      openExportModal = () => {
        setExportSelection((k) => {
          const L = {};
          e.forEach((G) => {
            L[G.id] = k[G.id] ?? !1;
          });
          return L;
        });
        setExportResult("");
        setExportOpen(!0);
      },
      openImportModal = () => {
        setImportOpen(!0);
        setImportItems(null);
        setImportError("");
      },
      toggleExportAll = (k) => {
        const L = {};
        e.forEach((G) => {
          L[G.id] = k;
        });
        setExportSelection(L);
      },
      toggleExportItem = (k, L) => {
        setExportSelection((G) => ({ ...G, [k]: L }));
      },
      doExport = async () => {
        const selected = e.filter((L) => exportSelection[L.id]);
        const skippedSecret = selected.some((L) =>
          L.platform === "dsh" && dshUiContainsSecret(`${L.content || ""}\n${L.configContent || ""}`),
        );
        const k = selected.filter((L) =>
          L.platform !== "dsh" || !dshUiContainsSecret(`${L.content || ""}\n${L.configContent || ""}`),
        );
        if (skippedSecret) {
          Kt.warning("已跳过包含密钥的 DSH 配置");
        }
        if (k.length === 0) {
          Kt.warning("请选择要导出的配置");
          return;
        }
        const L = {
          version: 1,
          exportedAt: Date.now(),
	          configs: k.map((G) => ({
	            name: G.name,
	            platform: G.platform,
	            content: G.content,
	            mcpContent: G.mcpContent,
            envContent: G.platform === "codex" || G.platform === "opencode" || G.platform === "grok" || G.platform === "dsh" ? void 0 : G.envContent,
	            configContent: G.configContent,
	            authContent: G.authContent,
	          })),
        };
        const G = JSON.stringify(L, null, 2);
        const Y = `sinitek-cli-configs-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.json`;
        try {
          const U = await exportConfigsItem({ fileName: Y, content: G });
          const T = U?.path || U?.fileName || Y;
          setExportResult(T);
          if (U?.downloadsDir) {
            window.sinitekConfigBridge?.openPath?.(U.downloadsDir);
          }
          Kt.success(`已导出到: ${T}`);
        } catch (U) {
          const T = new Blob([G], { type: "application/json" });
          const F = URL.createObjectURL(T);
          const K = document.createElement("a");
          (K.href = F),
            (K.download = Y),
            document.body.appendChild(K),
            K.click(),
            document.body.removeChild(K),
            URL.revokeObjectURL(F);
          setExportResult(Y);
          Kt.warning("导出已触发下载，请检查浏览器下载目录");
        }
      },
      readFileText = (k) =>
        new Promise((L, G) => {
          const U = new FileReader();
          (U.onload = () => L(String(U.result || ""))),
            (U.onerror = () => G(U.error || new Error("读取文件失败"))),
            U.readAsText(k);
        }),
      normalizeImportItem = (k) => {
        if (!k || !k.platform) return null;
        const L = k.platform,
          G = k.name || `${L} 配置 ${Date.now()}`;
        if (L === "claude") {
          return {
            name: G,
            platform: L,
            content: k.content ?? "{}",
            mcpContent: k.mcpContent ?? "{}",
          };
        }
	        if (L === "opencode") {
	          return {
	            name: G,
	            platform: L,
	            content: k.content ?? "{}",
	          };
	        }
        if (L === "codex") {
          return {
            name: G,
            platform: L,
            configContent: k.configContent ?? "",
            authContent: k.authContent ?? "{}",
          };
        }
        if (L === "grok") {
          const grokContent = k.configContent ?? k.content ?? "";
          return {
            name: G,
            platform: L,
            content: grokContent,
            configContent: grokContent,
          };
        }
        if (L === "dsh") {
          const dshContent = k.configContent ?? k.content ?? "";
          if (dshUiContainsSecret(dshContent)) return null;
          return {
            name: G,
            platform: L,
            content: dshContent,
            configContent: dshContent,
          };
        }
        return null;
      },
      handleImportFile = async (k) => {
        if (!k) return;
        setImportError("");
        setImportItems(null);
        try {
          const L = await readFileText(k),
            G = JSON.parse(L),
            U = Array.isArray(G) ? G : G?.configs;
          if (!Array.isArray(U)) throw new Error("导入文件格式不正确");
          const T = U.map(normalizeImportItem).filter(Boolean);
          if (T.length === 0) throw new Error("未找到可导入配置");
          setImportItems(T);
        } catch (L) {
          setImportError(`解析失败: ${L && L.message ? L.message : L}`);
        }
      },
      applyImport = async () => {
        if (!importItems || importItems.length === 0) {
          Kt.warning("没有可导入的配置");
          return;
        }
        setIsImporting(!0);
        try {
          const k = new Map(e.map((L) => [`${L.platform}::${L.name}`, L]));
          for (const L of importItems) {
            const G = k.get(`${L.platform}::${L.name}`);
            if (G) {
              await s(G.id, L);
            } else {
              const U = await l(L);
              k.set(`${U.platform}::${U.name}`, U);
            }
          }
          Kt.success(`已导入 ${importItems.length} 项配置`);
          setImportOpen(!1);
        } catch (k) {
          Kt.error("导入失败: " + k);
        } finally {
          setIsImporting(!1);
        }
      },
      H = (k, L) => {
        const G = configPlatformLabel(k),
          U = DEFAULT_RUN_COMMANDS[k],
          T = DEFAULT_INSTALL_COMMANDS[k];
        return be.jsx(aa, {
          title: be.jsx("div", {
            style: { display: "flex", flexDirection: "column", gap: 2 },
            children: be.jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 4 },
              children: [
                be.jsx("span", { children: G }),
                be.jsxs($s, {
                  size: 2,
                  children: [
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => R(T, "安装命令"),
                      children: "安装命令",
                    }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => R(U, "启动命令"),
                      children: "启动命令",
                    }),
                  ],
                }),
              ],
            }),
          }),
          extra: be.jsx(xn, {
            className: "config-standard-action-button",
            type: "primary",
            size: "small",
            icon: be.jsx(oO, {}),
            onClick: () => I(k),
            children: "添加",
          }),
          headStyle: { paddingLeft: "4px", paddingRight: "4px" },
          bodyStyle: { paddingLeft: "4px", paddingRight: "4px" },
          style: { marginBottom: "8px" },
          children: be.jsx("div", {
            role: "radiogroup",
            "aria-label": `${G}配置`,
            onDragOver: (F) => N(F, ""),
            onDrop: (F) => D(F, k),
            children: be.jsx(Bs, {
              className: "config-list",
              dataSource: L,
              rowKey: (F) => F.id,
              locale: { emptyText: "暂无配置" },
              renderItem: (F) => {
                const Y = t[k] === F.id,
                  K = n === F.id && r === F.platform,
                  Q = p === F.id,
                  J = S === F.id;
                return be.jsx(Bs.Item, {
                  className: K ? "config-list-item config-list-item-selected" : "config-list-item",
                  draggable: !0,
                  onClick: () => {
                    (o(F.id, F.platform), onMobileClose?.());
                  },
                  onDragStart: () => _(F.id),
                  onDragOver: (ae) => {
                    (ae.stopPropagation(), N(ae, F.id));
                  },
                  onDragEnd: M,
                  onDrop: (ae) => z(ae, k, F.id),
                  style: {
                    cursor: "pointer",
                    padding: "0",
                    borderRadius: "6px",
                    transition: "all 0.2s ease-in-out",
                    border: J
                      ? "1px dashed var(--border-color)"
                      : "1px solid transparent",
                  },
                  extra: be.jsxs($s, {
                    className: "config-list-actions",
                    size: 4,
                    children: [
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        icon: be.jsx(zH, {}),
                        onClick: (ae) => V(ae, F),
                        title: "复制配置",
                      }),
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        icon: be.jsx(FH, {}),
                        onClick: (ae) => W(ae, F),
                        title: "重命名",
                      }),
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        danger: !0,
                        icon: be.jsx(AH, {}),
                        onClick: (ae) => A(ae, F),
                        title: "删除配置",
                      }),
                    ],
                  }),
                  children: be.jsxs($s, {
                    className: "config-list-main",
                    children: [
                      be.jsx("input", {
                        type: "radio",
                        className: Y
                          ? "config-activate-radio config-activate-radio-active"
                          : "config-activate-radio",
                        name: `config-active-${k}`,
                        checked: Y,
                        disabled: Boolean(p),
                        "aria-label": "激活",
                        title: "激活",
                        onClick: (ae) => {
                          ae.stopPropagation();
                          if (!Y && !p) B(ae, F);
                        },
                        onChange: () => {},
                      }),
                      be.jsx("span", {
                        className: "config-name",
                        style: { fontWeight: K ? 600 : 500 },
                        children: F.name,
                      }),
                      Y &&
                        be.jsx("span", {
                          className: "config-active-tag",
                          children: "✓",
                        }),
                    ],
                  }),
                });
              },
            }),
          }),
        });
      };
    c.useEffect(() => {
      const applyEnabled = (value) => {
        setCliEnabledByName(value && typeof value === "object" ? value : {});
      };
      const handleEnabled = (event) => applyEnabled(event && event.detail);
      window.addEventListener("sinitek-cli-enabled", handleEnabled);
      const readEnabled = window.electronAPI && window.electronAPI.config && window.electronAPI.config.getCliEnabled;
      if (typeof readEnabled === "function") {
        Promise.resolve(readEnabled())
          .then((data) => applyEnabled(data && data.cliEnabledByName ? data.cliEnabledByName : data))
          .catch(() => applyEnabled({}));
      }
      return () => window.removeEventListener("sinitek-cli-enabled", handleEnabled);
    }, []);
    c.useEffect(() => {
      if (!r || !cliEnabledByName || typeof cliEnabledByName !== "object") {
        return;
      }
      if (cliEnabledByName[r] === false) {
        o(null, null);
      }
    }, [r, cliEnabledByName, o]);
    return be.jsxs("div", {
      className: "config-sidebar-panel",
      style: { height: "100%", padding: "4px", overflow: "auto" },
      children: [
        be.jsxs("div", {
          className: "config-list-toolbar",
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "4px",
            marginBottom: "4px",
          },
          children: [
            be.jsx(xn, {
              type: "text",
              size: "small",
              className: "config-mobile-close-button",
              "aria-label": "关闭配置目录",
              onClick: onMobileClose,
              children: be.jsx("span", {
                className: "config-mobile-close-icon",
                "aria-hidden": "true",
                children: "×",
              }),
            }),
            be.jsx(xn, { size: "small", onClick: openExportModal, children: "导出" }),
            be.jsx(xn, { size: "small", onClick: openImportModal, children: "导入" }),
            be.jsx(xn, { size: "small", onClick: () => setSkillsMarketOpen(!0), children: "Skills 市场" }),
          ],
        }),
        skillsMarketOpen ? be.jsx(SkillsMarketModal, { onClose: () => setSkillsMarketOpen(!1) }) : null,
        isConfigPlatformEnabled("claude", cliEnabledByName) ? H("claude", $) : null,
        isConfigPlatformEnabled("codex", cliEnabledByName) ? H("codex", w) : null,
        isConfigPlatformEnabled("opencode", cliEnabledByName) ? H("opencode", O) : null,
        isConfigPlatformEnabled("grok", cliEnabledByName) ? H("grok", grokConfigs) : null,
        isConfigPlatformEnabled("dsh", cliEnabledByName) ? H("dsh", dshConfigs) : null,
        ["claude", "codex", "opencode", "grok", "dsh"].every((platform) => !isConfigPlatformEnabled(platform, cliEnabledByName))
          ? be.jsx("div", {
              className: "config-empty-state",
              style: {
                color: "var(--text-color-secondary)",
                fontSize: "12px",
                padding: "8px 4px",
              },
              children: "没有已启用的 CLI",
            })
          : null,
        be.jsx(xr, {
          title: "导出配置",
          open: exportOpen,
          onCancel: () => setExportOpen(!1),
          width: 720,
          footer: null,
          destroyOnClose: !0,
          children: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "12px" },
            children: [
              be.jsxs("div", {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                },
                children: [
                  be.jsxs("label", {
                    style: { display: "flex", alignItems: "center", gap: "8px" },
                    children: [
                      be.jsx("input", {
                        type: "checkbox",
                        checked: exportAllChecked,
                        disabled: e.length === 0,
                        onChange: (k) => toggleExportAll(k.target.checked),
                      }),
                      be.jsx("span", { children: "全选" }),
                    ],
                  }),
                  be.jsx("div", {
                    style: {
                      color: "var(--text-color-secondary)",
                      fontSize: "12px",
                    },
                    children: `已选择 ${exportSelectedCount} / ${e.length}`,
                  }),
                ],
              }),
              be.jsx("div", {
                style: {
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "8px",
                  maxHeight: "360px",
                  overflow: "auto",
                  background: "var(--bg-color-layout)",
                },
                children:
                  e.length === 0
                    ? be.jsx("div", {
                        style: {
                          color: "var(--text-color-secondary)",
                          fontSize: "12px",
                        },
                        children: "暂无配置可导出",
                      })
                    : e.map((k) =>
                        be.jsx(
                          "div",
                          {
                            style: {
                              display: "flex",
                              gap: "10px",
                              padding: "8px",
                              borderRadius: "6px",
                              background: "var(--bg-color-container)",
                              border: "1px solid var(--border-color)",
                              marginBottom: "8px",
                            },
                            children: be.jsxs("div", {
                              style: { display: "flex", gap: "8px", width: "100%" },
                              children: [
                                be.jsx("input", {
                                  type: "checkbox",
                                  checked: exportSelection[k.id] === !0,
                                  onChange: (L) => toggleExportItem(k.id, L.target.checked),
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                    flex: 1,
                                  },
                                  children: [
                                    be.jsx("div", { children: k.name }),
                                    be.jsx("div", {
                                      style: {
                                        color: "var(--text-color-secondary)",
                                        fontSize: "12px",
                                      },
                                      children:
                                        configPlatformLabel(k.platform),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          },
                          k.id,
                        ),
                      ),
              }),
              exportResult
                ? be.jsxs("div", {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: "var(--bg-color-container)",
                      border: "1px solid var(--border-color)",
                    },
                    children: [
                      be.jsxs("div", {
                        style: {
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          minWidth: 0,
                        },
                        children: [
                          be.jsx("div", {
                            style: { fontSize: "12px", color: "var(--text-color-secondary)" },
                            children: "已导出到",
                          }),
                          be.jsx("div", {
                            style: {
                              fontSize: "12px",
                              wordBreak: "break-all",
                              color: "var(--text-color)",
                            },
                            children: exportResult,
                          }),
                        ],
                      }),
                      window.sinitekConfigBridge?.downloadsDir
                        ? be.jsx(xn, {
                            size: "small",
                            onClick: () =>
                              window.sinitekConfigBridge?.openPath?.(
                                window.sinitekConfigBridge?.downloadsDir,
                              ),
                            children: "打开下载文件夹",
                          })
                        : null,
                    ],
                  })
                : null,
              be.jsxs("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                children: [
                  be.jsx(xn, { onClick: () => setExportOpen(!1), children: "取消" }),
                  be.jsx(xn, {
                    type: "primary",
                    disabled: !exportAnySelected,
                    onClick: doExport,
                    children: `导出 (${exportSelectedCount})`,
                  }),
                ],
              }),
            ],
          }),
        }),
        be.jsx(xr, {
          title: "导入配置",
          open: importOpen,
          onCancel: () => {
            setImportOpen(!1);
            setImportItems(null);
            setImportError("");
          },
          width: 720,
          footer: null,
          destroyOnClose: !0,
          children: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "12px" },
            children: [
              be.jsx("div", {
                style: { color: "var(--text-color-secondary)", fontSize: "12px" },
                children: "请选择导出的 JSON 文件进行导入",
              }),
              be.jsx("input", {
                type: "file",
                accept: "application/json",
                onChange: (k) => {
                  const L = k.target.files?.[0];
                  L && handleImportFile(L);
                  k.target.value = "";
                },
              }),
              importError
                ? be.jsx("div", {
                    style: { color: "var(--error-color)", fontSize: "12px" },
                    children: importError,
                  })
                : null,
              importItems
                ? be.jsxs("div", {
                    style: { display: "flex", flexDirection: "column", gap: "8px" },
                    children: [
                      be.jsx("div", {
                        style: {
                          color: "var(--text-color-secondary)",
                          fontSize: "12px",
                        },
                        children: `准备导入 ${importItems.length} 项配置`,
                      }),
                      be.jsx("div", {
                        style: {
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          padding: "8px",
                          maxHeight: "320px",
                          overflow: "auto",
                          background: "var(--bg-color-layout)",
                        },
                        children: importItems.map((k, L) =>
                          be.jsx(
                            "div",
                            {
                              style: {
                                display: "flex",
                                flexDirection: "column",
                                gap: "2px",
                                padding: "8px",
                                borderRadius: "6px",
                                background: "var(--bg-color-container)",
                                border: "1px solid var(--border-color)",
                                marginBottom: "8px",
                              },
                              children: [
                                be.jsx("div", { children: k.name }),
                                be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children:
                                    configPlatformLabel(k.platform),
                                }),
                              ],
                            },
                            `${k.platform}_${k.name}_${L}`,
                          ),
                        ),
                      }),
                    ],
                  })
                : null,
              be.jsxs("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                children: [
                  be.jsx(xn, {
                    onClick: () => {
                      setImportOpen(!1);
                      setImportItems(null);
                      setImportError("");
                    },
                    children: "取消",
                  }),
                  be.jsx(xn, {
                    type: "primary",
                    loading: isImporting,
                    disabled: !importItems || importItems.length === 0,
                    onClick: applyImport,
                    children: importItems ? `导入 (${importItems.length})` : "导入",
                  }),
                ],
              }),
            ],
          }),
        }),
      ],
    });
  };
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function fk(e, t) {
  let n = e.slice(0, t).split(/\r\n|\n|\r/g);
  return [n.length, n.pop().length + 1];
}
function mk(e, t, n) {
  let r = e.split(/\r\n|\n|\r/g),
    o = "",
    l = (Math.log10(t + 1) | 0) + 1;
  for (let s = t - 1; s <= t + 1; s++) {
    let u = r[s - 1];
    u &&
      ((o += s.toString().padEnd(l, " ")),
      (o += ":  "),
      (o += u),
      (o += `
`),
      s === t &&
        ((o += " ".repeat(l + n + 2)),
        (o += `^
`)));
  }
  return o;
}
class qt extends Error {
  line;
  column;
  codeblock;
  constructor(t, n) {
    const [r, o] = fk(n.toml, n.ptr),
      l = mk(n.toml, r, o);
    (super(
      `Invalid TOML document: ${t}

${l}`,
      n,
    ),
      (this.line = r),
      (this.column = o),
      (this.codeblock = l));
  }
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function vk(e, t) {
  let n = 0;
  for (; e[t - ++n] === "\\"; );
  return --n && n % 2;
}
function sd(e, t = 0, n = e.length) {
  let r = e.indexOf(
    `
`,
    t,
  );
  return (e[r - 1] === "\r" && r--, r <= n ? r : -1);
}
function fh(e, t) {
  for (let n = t; n < e.length; n++) {
    let r = e[n];
    if (
      r ===
      `
`
    )
      return n;
    if (
      r === "\r" &&
      e[n + 1] ===
        `
`
    )
      return n + 1;
    if ((r < " " && r !== "	") || r === "")
      throw new qt("control characters are not allowed in comments", {
        toml: e,
        ptr: t,
      });
  }
  return e.length;
}
function Zo(e, t, n, r) {
  let o;
  for (
    ;
    (o = e[t]) === " " ||
    o === "	" ||
    (!n &&
      (o ===
        `
` ||
        (o === "\r" &&
          e[t + 1] ===
            `
`)));
  )
    t++;
  return r || o !== "#" ? t : Zo(e, fh(e, t), n);
}
function f1(e, t, n, r, o = !1) {
  if (!r) return ((t = sd(e, t)), t < 0 ? e.length : t);
  for (let l = t; l < e.length; l++) {
    let s = e[l];
    if (s === "#") l = sd(e, l);
    else {
      if (s === n) return l + 1;
      if (
        s === r ||
        (o &&
          (s ===
            `
` ||
            (s === "\r" &&
              e[l + 1] ===
                `
`)))
      )
        return l;
    }
  }
  throw new qt("cannot find end of structure", { toml: e, ptr: t });
}
function aO(e, t) {
  let n = e[t],
    r = n === e[t + 1] && e[t + 1] === e[t + 2] ? e.slice(t, t + 3) : n;
  t += r.length - 1;
  do t = e.indexOf(r, ++t);
  while (t > -1 && n !== "'" && vk(e, t));
  return (
    t > -1 &&
      ((t += r.length), r.length > 1 && (e[t] === n && t++, e[t] === n && t++)),
    t
  );
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let gk =
  /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}:\d{2}(?:\.\d+)?)?(Z|[-+]\d{2}:\d{2})?$/i;
class nl extends Date {
  #t = !1;
  #n = !1;
  #e = null;
  constructor(t) {
    let n = !0,
      r = !0,
      o = "Z";
    if (typeof t == "string") {
      let l = t.match(gk);
      l
        ? (l[1] || ((n = !1), (t = `0000-01-01T${t}`)),
          (r = !!l[2]),
          r && t[10] === " " && (t = t.replace(" ", "T")),
          l[2] && +l[2] > 23
            ? (t = "")
            : ((o = l[3] || null),
              (t = t.toUpperCase()),
              !o && r && (t += "Z")))
        : (t = "");
    }
    (super(t),
      isNaN(this.getTime()) || ((this.#t = n), (this.#n = r), (this.#e = o)));
  }
  isDateTime() {
    return this.#t && this.#n;
  }
  isLocal() {
    return !this.#t || !this.#n || !this.#e;
  }
  isDate() {
    return this.#t && !this.#n;
  }
  isTime() {
    return this.#n && !this.#t;
  }
  isValid() {
    return this.#t || this.#n;
  }
  toISOString() {
    let t = super.toISOString();
    if (this.isDate()) return t.slice(0, 10);
    if (this.isTime()) return t.slice(11, 23);
    if (this.#e === null) return t.slice(0, -1);
    if (this.#e === "Z") return t;
    let n = +this.#e.slice(1, 3) * 60 + +this.#e.slice(4, 6);
    return (
      (n = this.#e[0] === "-" ? n : -n),
      new Date(this.getTime() - n * 6e4).toISOString().slice(0, -1) + this.#e
    );
  }
  static wrapAsOffsetDateTime(t, n = "Z") {
    let r = new nl(t);
    return ((r.#e = n), r);
  }
  static wrapAsLocalDateTime(t) {
    let n = new nl(t);
    return ((n.#e = null), n);
  }
  static wrapAsLocalDate(t) {
    let n = new nl(t);
    return ((n.#n = !1), (n.#e = null), n);
  }
  static wrapAsLocalTime(t) {
    let n = new nl(t);
    return ((n.#t = !1), (n.#e = null), n);
  }
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let pk = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/,
  hk = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/,
  yk = /^[+-]?0[0-9_]/,
  bk = /^[0-9a-f]{4,8}$/i,
  m1 = {
    b: "\b",
    t: "	",
    n: `
`,
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
function lO(e, t = 0, n = e.length) {
  let r = e[t] === "'",
    o = e[t++] === e[t] && e[t] === e[t + 1];
  o &&
    ((n -= 2),
    e[(t += 2)] === "\r" && t++,
    e[t] ===
      `
` && t++);
  let l = 0,
    s,
    u = "",
    f = t;
  for (; t < n - 1; ) {
    let m = e[t++];
    if (
      m ===
        `
` ||
      (m === "\r" &&
        e[t] ===
          `
`)
    ) {
      if (!o)
        throw new qt("newlines are not allowed in strings", {
          toml: e,
          ptr: t - 1,
        });
    } else if ((m < " " && m !== "	") || m === "")
      throw new qt("control characters are not allowed in strings", {
        toml: e,
        ptr: t - 1,
      });
    if (s) {
      if (((s = !1), m === "u" || m === "U")) {
        let v = e.slice(t, (t += m === "u" ? 4 : 8));
        if (!bk.test(v))
          throw new qt("invalid unicode escape", { toml: e, ptr: l });
        try {
          u += String.fromCodePoint(parseInt(v, 16));
        } catch {
          throw new qt("invalid unicode escape", { toml: e, ptr: l });
        }
      } else if (
        o &&
        (m ===
          `
` ||
          m === " " ||
          m === "	" ||
          m === "\r")
      ) {
        if (
          ((t = Zo(e, t - 1, !0)),
          e[t] !==
            `
` && e[t] !== "\r")
        )
          throw new qt(
            "invalid escape: only line-ending whitespace may be escaped",
            { toml: e, ptr: l },
          );
        t = Zo(e, t);
      } else if (m in m1) u += m1[m];
      else throw new qt("unrecognized escape sequence", { toml: e, ptr: l });
      f = t;
    } else !r && m === "\\" && ((l = t - 1), (s = !0), (u += e.slice(f, l)));
  }
  return u + e.slice(f, n - 1);
}
function Ck(e, t, n, r) {
  if (e === "true") return !0;
  if (e === "false") return !1;
  if (e === "-inf") return -1 / 0;
  if (e === "inf" || e === "+inf") return 1 / 0;
  if (e === "nan" || e === "+nan" || e === "-nan") return NaN;
  if (e === "-0") return r ? 0n : 0;
  let o = pk.test(e);
  if (o || hk.test(e)) {
    if (yk.test(e))
      throw new qt("leading zeroes are not allowed", { toml: t, ptr: n });
    e = e.replace(/_/g, "");
    let s = +e;
    if (isNaN(s)) throw new qt("invalid number", { toml: t, ptr: n });
    if (o) {
      if ((o = !Number.isSafeInteger(s)) && !r)
        throw new qt("integer value cannot be represented losslessly", {
          toml: t,
          ptr: n,
        });
      (o || r === !0) && (s = BigInt(e));
    }
    return s;
  }
  const l = new nl(e);
  if (!l.isValid()) throw new qt("invalid value", { toml: t, ptr: n });
  return l;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function Sk(e, t, n, r) {
  let o = e.slice(t, n),
    l = o.indexOf("#");
  l > -1 && (fh(e, l), (o = o.slice(0, l)));
  let s = o.trimEnd();
  if (!r) {
    let u = o.indexOf(
      `
`,
      s.length,
    );
    if (u > -1)
      throw new qt("newlines are not allowed in inline tables", {
        toml: e,
        ptr: t + u,
      });
  }
  return [s, l];
}
function mh(e, t, n, r, o) {
  if (r === 0)
    throw new qt("document contains excessively nested structures. aborting.", {
      toml: e,
      ptr: t,
    });
  let l = e[t];
  if (l === "[" || l === "{") {
    let [f, m] = l === "[" ? $k(e, t, r, o) : wk(e, t, r, o),
      v = n ? f1(e, m, ",", n) : m;
    if (m - v && n === "}") {
      let p = sd(e, m, v);
      if (p > -1)
        throw new qt("newlines are not allowed in inline tables", {
          toml: e,
          ptr: p,
        });
    }
    return [f, v];
  }
  let s;
  if (l === '"' || l === "'") {
    s = aO(e, t);
    let f = lO(e, t, s);
    if (n) {
      if (
        ((s = Zo(e, s, n !== "]")),
        e[s] &&
          e[s] !== "," &&
          e[s] !== n &&
          e[s] !==
            `
` &&
          e[s] !== "\r")
      )
        throw new qt("unexpected character encountered", { toml: e, ptr: s });
      s += +(e[s] === ",");
    }
    return [f, s];
  }
  s = f1(e, t, ",", n);
  let u = Sk(e, t, s - +(e[s - 1] === ","), n === "]");
  if (!u[0])
    throw new qt("incomplete key-value declaration: no value specified", {
      toml: e,
      ptr: t,
    });
  return (
    n && u[1] > -1 && ((s = Zo(e, t + u[1])), (s += +(e[s] === ","))),
    [Ck(u[0], e, t, o), s]
  );
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let xk = /^[a-zA-Z0-9-_]+[ \t]*$/;
function ap(e, t, n = "=") {
  let r = t - 1,
    o = [],
    l = e.indexOf(n, t);
  if (l < 0)
    throw new qt("incomplete key-value: cannot find end of key", {
      toml: e,
      ptr: t,
    });
  do {
    let s = e[(t = ++r)];
    if (s !== " " && s !== "	")
      if (s === '"' || s === "'") {
        if (s === e[t + 1] && s === e[t + 2])
          throw new qt("multiline strings are not allowed in keys", {
            toml: e,
            ptr: t,
          });
        let u = aO(e, t);
        if (u < 0)
          throw new qt("unfinished string encountered", { toml: e, ptr: t });
        r = e.indexOf(".", u);
        let f = e.slice(u, r < 0 || r > l ? l : r),
          m = sd(f);
        if (m > -1)
          throw new qt("newlines are not allowed in keys", {
            toml: e,
            ptr: t + r + m,
          });
        if (f.trimStart())
          throw new qt("found extra tokens after the string part", {
            toml: e,
            ptr: u,
          });
        if (l < u && ((l = e.indexOf(n, u)), l < 0))
          throw new qt("incomplete key-value: cannot find end of key", {
            toml: e,
            ptr: t,
          });
        o.push(lO(e, t, u));
      } else {
        r = e.indexOf(".", t);
        let u = e.slice(t, r < 0 || r > l ? l : r);
        if (!xk.test(u))
          throw new qt(
            "only letter, numbers, dashes and underscores are allowed in keys",
            { toml: e, ptr: t },
          );
        o.push(u.trimEnd());
      }
  } while (r + 1 && r < l);
  return [o, Zo(e, l + 1, !0, !0)];
}
function wk(e, t, n, r) {
  let o = {},
    l = new Set(),
    s,
    u = 0;
  for (t++; (s = e[t++]) !== "}" && s; ) {
    let f = { toml: e, ptr: t - 1 };
    if (
      s ===
      `
`
    )
      throw new qt("newlines are not allowed in inline tables", f);
    if (s === "#") throw new qt("inline tables cannot contain comments", f);
    if (s === ",") throw new qt("expected key-value, found comma", f);
    if (s !== " " && s !== "	") {
      let m,
        v = o,
        p = !1,
        [h, b] = ap(e, t - 1);
      for (let y = 0; y < h.length; y++) {
        if (
          (y && (v = p ? v[m] : (v[m] = {})),
          (m = h[y]),
          (p = Object.hasOwn(v, m)) && (typeof v[m] != "object" || l.has(v[m])))
        )
          throw new qt("trying to redefine an already defined value", {
            toml: e,
            ptr: t,
          });
        !p &&
          m === "__proto__" &&
          Object.defineProperty(v, m, {
            enumerable: !0,
            configurable: !0,
            writable: !0,
          });
      }
      if (p)
        throw new qt("trying to redefine an already defined value", {
          toml: e,
          ptr: t,
        });
      let [x, S] = mh(e, b, "}", n - 1, r);
      (l.add(x), (v[m] = x), (t = S), (u = e[t - 1] === "," ? t - 1 : 0));
    }
  }
  if (u)
    throw new qt("trailing commas are not allowed in inline tables", {
      toml: e,
      ptr: u,
    });
  if (!s) throw new qt("unfinished table encountered", { toml: e, ptr: t });
  return [o, t];
}
function $k(e, t, n, r) {
  let o = [],
    l;
  for (t++; (l = e[t++]) !== "]" && l; ) {
    if (l === ",")
      throw new qt("expected value, found comma", { toml: e, ptr: t - 1 });
    if (l === "#") t = fh(e, t);
    else if (
      l !== " " &&
      l !== "	" &&
      l !==
        `
` &&
      l !== "\r"
    ) {
      let s = mh(e, t - 1, "]", n - 1, r);
      (o.push(s[0]), (t = s[1]));
    }
  }
  if (!l) throw new qt("unfinished array encountered", { toml: e, ptr: t });
  return [o, t];
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function v1(e, t, n, r) {
  let o = t,
    l = n,
    s,
    u = !1,
    f;
  for (let m = 0; m < e.length; m++) {
    if (m) {
      if (
        ((o = u ? o[s] : (o[s] = {})),
        (l = (f = l[s]).c),
        r === 0 && (f.t === 1 || f.t === 2))
      )
        return null;
      if (f.t === 2) {
        let v = o.length - 1;
        ((o = o[v]), (l = l[v].c));
      }
    }
    if (((s = e[m]), (u = Object.hasOwn(o, s)) && l[s]?.t === 0 && l[s]?.d))
      return null;
    u ||
      (s === "__proto__" &&
        (Object.defineProperty(o, s, {
          enumerable: !0,
          configurable: !0,
          writable: !0,
        }),
        Object.defineProperty(l, s, {
          enumerable: !0,
          configurable: !0,
          writable: !0,
        })),
      (l[s] = { t: m < e.length - 1 && r === 2 ? 3 : r, d: !1, i: 0, c: {} }));
  }
  if (
    ((f = l[s]),
    (f.t !== r && !(r === 1 && f.t === 3)) ||
      (r === 2 &&
        (f.d || ((f.d = !0), (o[s] = [])),
        o[s].push((o = {})),
        (f.c[f.i++] = f = { t: 1, d: !1, i: 0, c: {} })),
      f.d))
  )
    return null;
  if (((f.d = !0), r === 1)) o = u ? o[s] : (o[s] = {});
  else if (r === 0 && u) return null;
  return [s, o, f.c];
}
function g1(e, { maxDepth: t = 1e3, integersAsBigInt: n } = {}) {
  let r = {},
    o = {},
    l = r,
    s = o;
  for (let u = Zo(e, 0); u < e.length; ) {
    if (e[u] === "[") {
      let f = e[++u] === "[",
        m = ap(e, (u += +f), "]");
      if (f) {
        if (e[m[1] - 1] !== "]")
          throw new qt("expected end of table declaration", {
            toml: e,
            ptr: m[1] - 1,
          });
        m[1]++;
      }
      let v = v1(m[0], r, o, f ? 2 : 1);
      if (!v)
        throw new qt("trying to redefine an already defined table or value", {
          toml: e,
          ptr: u,
        });
      ((s = v[2]), (l = v[1]), (u = m[1]));
    } else {
      let f = ap(e, u),
        m = v1(f[0], l, s, 0);
      if (!m)
        throw new qt("trying to redefine an already defined table or value", {
          toml: e,
          ptr: u,
        });
      let v = mh(e, f[1], void 0, t, n);
      ((m[1][m[0]] = v[0]), (u = v[1]));
    }
    if (
      ((u = Zo(e, u, !0)),
      e[u] &&
        e[u] !==
          `
` &&
        e[u] !== "\r")
    )
      throw new qt(
        "each key-value declaration must be followed by an end-of-line",
        { toml: e, ptr: u },
      );
    u = Zo(e, u);
  }
  return r;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let sO = /^[a-z0-9-_]+$/i;
function sc(e) {
  let t = typeof e;
  if (t === "object") {
    if (Array.isArray(e)) return "array";
    if (e instanceof Date) return "date";
  }
  return t;
}
function Ek(e) {
  for (let t = 0; t < e.length; t++) if (sc(e[t]) !== "object") return !1;
  return e.length != 0;
}
function vh(e) {
  return JSON.stringify(e).replace(/\x7f/g, "\\u007f");
}
function gh(e, t, n, r) {
  if (n === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  if (t === "number")
    return isNaN(e)
      ? "nan"
      : e === 1 / 0
        ? "inf"
        : e === -1 / 0
          ? "-inf"
          : r && Number.isInteger(e)
            ? e.toFixed(1)
            : e.toString();
  if (t === "bigint" || t === "boolean") return e.toString();
  if (t === "string") return vh(e);
  if (t === "date") {
    if (isNaN(e.getTime()))
      throw new TypeError("cannot serialize invalid date");
    return e.toISOString();
  }
  if (t === "object") return Ok(e, n, r);
  if (t === "array") return Rk(e, n, r);
}
function Ok(e, t, n) {
  let r = Object.keys(e);
  if (r.length === 0) return "{}";
  let o = "{ ";
  for (let l = 0; l < r.length; l++) {
    let s = r[l];
    (l && (o += ", "),
      (o += sO.test(s) ? s : vh(s)),
      (o += " = "),
      (o += gh(e[s], sc(e[s]), t - 1, n)));
  }
  return o + " }";
}
function Rk(e, t, n) {
  if (e.length === 0) return "[]";
  let r = "[ ";
  for (let o = 0; o < e.length; o++) {
    if ((o && (r += ", "), e[o] === null || e[o] === void 0))
      throw new TypeError("arrays cannot contain null or undefined values");
    r += gh(e[o], sc(e[o]), t - 1, n);
  }
  return r + " ]";
}
function Pk(e, t, n, r) {
  if (n === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  let o = "";
  for (let l = 0; l < e.length; l++)
    ((o += `${
      o &&
      `
`
    }[[${t}]]
`),
      (o += ph(0, e[l], t, n, r)));
  return o;
}
function ph(e, t, n, r, o) {
  if (r === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  let l = "",
    s = "",
    u = Object.keys(t);
  for (let f = 0; f < u.length; f++) {
    let m = u[f];
    if (t[m] !== null && t[m] !== void 0) {
      let v = sc(t[m]);
      if (v === "symbol" || v === "function")
        throw new TypeError(`cannot serialize values of type '${v}'`);
      let p = sO.test(m) ? m : vh(m);
      if (v === "array" && Ek(t[m]))
        s +=
          (s &&
            `
`) + Pk(t[m], n ? `${n}.${p}` : p, r - 1, o);
      else if (v === "object") {
        let h = n ? `${n}.${p}` : p;
        s +=
          (s &&
            `
`) + ph(h, t[m], h, r - 1, o);
      } else
        ((l += p),
          (l += " = "),
          (l += gh(t[m], v, r, o)),
          (l += `
`));
    }
  }
  return (
    e &&
      (l || !s) &&
      (l = l
        ? `[${e}]
${l}`
        : `[${e}]`),
    l && s
      ? `${l}
${s}`
      : l || s
  );
}
function Ik(e, { maxDepth: t = 1e3, numbersAsFloat: n = !1 } = {}) {
  if (sc(e) !== "object")
    throw new TypeError("stringify can only be called with an object");
  let r = ph(0, e, "", t, n);
  return r[r.length - 1] !==
    `
`
    ? r +
        `
`
    : r;
}
const CLI_GLOBAL_SKILL_TARGETS = [
  { id: "claude", label: "Claude" },
  { id: "opencode", label: "OpenCode" },
  { id: "grok", label: "Grok" },
  { id: "codex", label: "Codex" },
  { id: "dsh", label: "DSH" },
];

function skillsTitleByPlatform(platform) {
  const match = CLI_GLOBAL_SKILL_TARGETS.find((item) => item.id === platform);
  return match ? `${match.label} Skills` : "Skills";
}

const SkillsCopyModal = ({ skill, platform, onClose, onCopy }) => {
  const [selectedTargets, setSelectedTargets] = c.useState([]);
  const [copiedTargets, setCopiedTargets] = c.useState([]);
  const [copyErrors, setCopyErrors] = c.useState([]);
  const [copying, setCopying] = c.useState(!1);
  const submittingRef = c.useRef(!1);
  const targets = CLI_GLOBAL_SKILL_TARGETS.filter((item) => item.id !== platform);
  const closeModal = () => {
    if (!submittingRef.current) onClose();
  };
  const confirmCopy = async () => {
    if (submittingRef.current || selectedTargets.length === 0) return;
    submittingRef.current = !0;
    setCopying(!0);
    setCopyErrors([]);
    const succeeded = [];
    const errors = [];
    try {
      for (const targetPlatform of selectedTargets) {
        const target = targets.find((item) => item.id === targetPlatform);
        try {
          await onCopy(skill, targetPlatform);
          succeeded.push(target);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${target.label}：${message || "复制 Skill 失败"}`);
        }
      }
      setCopiedTargets((previous) => [...previous, ...succeeded.map((item) => item.id)]);
      setSelectedTargets((previous) => previous.filter((id) => !succeeded.some((item) => item.id === id)));
      setCopyErrors(errors);
      if (succeeded.length > 0) {
        Kt.success(`已复制 ${skill.name} 到 ${succeeded.map((item) => item.label).join("、")}`);
      }
      if (errors.length === 0) onClose();
    } finally {
      submittingRef.current = !1;
      setCopying(!1);
    }
  };
  return be.jsx(xr, {
    title: "复制 Skill 到其他 CLI",
    open: !0,
    width: 440,
    rootClassName: "skills-copy-modal",
    onCancel: closeModal,
    onOk: confirmCopy,
    okText: copying ? "复制中..." : copyErrors.length > 0 ? "重试复制" : "复制",
    cancelText: "取消",
    confirmLoading: copying,
    okButtonProps: { disabled: selectedTargets.length === 0 || copying },
    cancelButtonProps: { disabled: copying },
    closable: !copying,
    maskClosable: !copying,
    keyboard: !copying,
    children: be.jsxs("div", {
      className: "skills-copy-content",
      children: [
        be.jsx("div", { className: "skills-copy-name", children: skill.name }),
        be.jsx("div", {
          className: "skills-manager-muted",
          children: "可多选，复制到所选 CLI 的全局 Skills 目录；同名技能不会覆盖。",
        }),
        be.jsxs("fieldset", {
          className: "skills-copy-targets",
          disabled: copying,
          children: [
            be.jsx("legend", { children: "目标 CLI（可多选）" }),
            ...targets.map((target) => {
              const copied = copiedTargets.includes(target.id);
              return be.jsxs("label", {
                className: "skills-copy-target",
                children: [
                  be.jsx("input", {
                    type: "checkbox",
                    checked: selectedTargets.includes(target.id),
                    disabled: copying || copied,
                    onChange: (event) => {
                      const checked = event.target.checked;
                      setSelectedTargets((previous) => checked
                        ? [...previous, target.id]
                        : previous.filter((id) => id !== target.id));
                    },
                  }),
                  be.jsx("span", { children: target.label }),
                  copied ? be.jsx("span", { className: "skills-manager-muted", children: "已复制" }) : null,
                ],
              }, target.id);
            }),
          ],
        }),
        copyErrors.length > 0 ? be.jsx("div", {
          className: "skills-copy-errors",
          role: "alert",
          children: copyErrors.join("\n"),
        }) : null,
      ],
    }),
  });
};


const SkillsMarketModal = ({ onClose }) => {
  const [query, setQuery] = c.useState("");
  const [submittedQuery, setSubmittedQuery] = c.useState("");
  const [page, setPage] = c.useState(1);
  const [pageInfo, setPageInfo] = c.useState(null);
  const [loading, setLoading] = c.useState(!0);
  const [errorText, setErrorText] = c.useState("");
  const [selectedId, setSelectedId] = c.useState("");
  const [selectedTargets, setSelectedTargets] = c.useState([]);
  const [installing, setInstalling] = c.useState(!1);
  const [installErrors, setInstallErrors] = c.useState([]);
  const requestRef = c.useRef(0);
  const installingRef = c.useRef(!1);
  const loadPage = async (nextQuery, nextPage) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(!0);
    setErrorText("");
    try {
      const result = await searchLobehubSkills({ query: nextQuery, page: nextPage });
      if (requestRef.current !== requestId) return;
      setPageInfo(result);
      setSubmittedQuery(nextQuery);
      setPage(result?.currentPage || nextPage);
    } catch (error) {
      if (requestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      setPageInfo(null);
      setErrorText(message || "搜索 Skills 失败");
    } finally {
      if (requestRef.current === requestId) setLoading(!1);
    }
  };
  c.useEffect(() => {
    void loadPage("", 1);
  }, []);
  const items = Array.isArray(pageInfo?.items) ? pageInfo.items : [];
  const selected = items.find((item) => item.identifier === selectedId) || null;
  const totalPages = pageInfo?.totalPages || 0;
  const closeModal = () => {
    if (!installingRef.current) onClose();
  };
  const confirmInstall = async () => {
    if (installingRef.current || !selected || selectedTargets.length === 0) return;
    installingRef.current = !0;
    setInstalling(!0);
    setInstallErrors([]);
    try {
      const result = await installLobehubSkill({
        identifier: selected.identifier,
        platforms: selectedTargets,
      });
      const targets = Array.isArray(result?.targets) ? result.targets : [];
      const installed = targets.filter((item) => item.status === "installed");
      const problems = targets.filter((item) => item.status !== "installed");
      if (installed.length > 0) {
        const names = [...new Set(installed.map((item) => item.name))];
        Kt.success(`已安装 ${names.join("、")}`);
        window.dispatchEvent(new CustomEvent("sinitek-cli-skills-installed", {
          detail: { platforms: [...new Set(installed.map((item) => item.platform))] },
        }));
      }
      if (problems.length === 0) {
        setSelectedId("");
        setSelectedTargets([]);
        setInstallErrors([]);
        return;
      }
      if (installed.length === 0) Kt.warning("没有安装新技能");
      setInstallErrors(problems.map((item) => {
        const label = CLI_GLOBAL_SKILL_TARGETS.find((target) => target.id === item.platform)?.label || item.platform;
        return `${label} / ${item.name}：${item.message || "安装失败"}`;
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInstallErrors([message || "安装失败"]);
    } finally {
      installingRef.current = !1;
      setInstalling(!1);
    }
  };
  return be.jsx(xr, {
    title: "Skills 市场",
    open: !0,
    width: 760,
    rootClassName: "skills-market-modal",
    onCancel: closeModal,
    footer: null,
    closable: !installing,
    maskClosable: !installing,
    keyboard: !installing,
    children: be.jsxs("div", {
      className: "skills-market-content",
      children: [
        be.jsx("div", {
          className: "skills-manager-muted",
          children: "来自 LobeHub Skills 市场。下载后自动解压，安装到所选 CLI 的全局 Skills 目录；同名技能会先删除已有目录再安装。",
        }),
        be.jsxs("div", {
          className: "skills-market-search",
          children: [
            be.jsx("input", {
              className: "skills-market-search-input",
              value: query,
              placeholder: "搜索技能名称或描述",
              disabled: installing,
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== "Enter" || loading || installing) return;
                event.preventDefault();
                setSelectedId("");
                setSelectedTargets([]);
                setInstallErrors([]);
                void loadPage(query.trim(), 1);
              },
            }),
            be.jsx(xn, {
              size: "small",
              disabled: loading || installing,
              onClick: () => {
                setSelectedId("");
                setSelectedTargets([]);
                setInstallErrors([]);
                void loadPage(query.trim(), 1);
              },
              children: "搜索",
            }),
          ],
        }),
        be.jsxs("div", {
          className: "skills-market-toolbar",
          children: [
            be.jsx("div", {
              className: "skills-manager-muted",
              children: loading ? "正在搜索..." : `共 ${pageInfo?.totalCount || items.length} 个`,
            }),
            be.jsxs("div", {
              className: "skills-market-search",
              children: [
                be.jsx(xn, {
                  size: "small",
                  disabled: loading || installing || page <= 1,
                  onClick: () => void loadPage(submittedQuery, page - 1),
                  children: "上一页",
                }),
                be.jsx("span", {
                  className: "skills-manager-muted",
                  children: totalPages > 0 ? `${page} / ${totalPages}` : "",
                }),
                be.jsx(xn, {
                  size: "small",
                  disabled: loading || installing || totalPages === 0 || page >= totalPages,
                  onClick: () => void loadPage(submittedQuery, page + 1),
                  children: "下一页",
                }),
              ],
            }),
          ],
        }),
        errorText ? be.jsx("div", {
          className: "skills-copy-errors",
          role: "alert",
          children: errorText,
        }) : null,
        be.jsx("div", {
          className: "skills-market-list",
          children: items.length === 0 && !loading
            ? be.jsx("div", { className: "skills-manager-muted", children: "没有匹配的 Skills" })
            : items.map((item) => be.jsxs("div", {
                className: "skills-market-item",
                children: [
                  be.jsxs("div", {
                    className: "skills-market-item-main",
                    children: [
                      be.jsxs("div", {
                        className: "skills-market-item-title",
                        children: [
                          be.jsx("span", { children: item.name }),
                          item.version ? be.jsx("span", { className: "skills-manager-muted", children: item.version }) : null,
                        ],
                      }),
                      be.jsx("div", {
                        className: "skills-market-item-description",
                        children: item.description || "无描述",
                      }),
                      be.jsx("div", {
                        className: "skills-manager-muted",
                        children: `${item.author || "未知作者"}${typeof item.installCount === "number" ? ` · 安装 ${item.installCount}` : ""}`,
                      }),
                    ],
                  }),
                  be.jsx(xn, {
                    size: "small",
                    disabled: installing,
                    onClick: () => {
                      setSelectedId(item.identifier);
                      setSelectedTargets([]);
                      setInstallErrors([]);
                    },
                    children: selectedId === item.identifier ? "已选择" : "下载",
                  }),
                ],
              }, item.identifier)),
        }),
        selected ? be.jsxs("div", {
          className: "skills-copy-content",
          children: [
            be.jsx("div", { className: "skills-copy-name", children: selected.name }),
            be.jsxs("fieldset", {
              className: "skills-copy-targets",
              disabled: installing,
              children: [
                be.jsx("legend", { children: "安装到 CLI（可多选）" }),
                ...CLI_GLOBAL_SKILL_TARGETS.map((target) => be.jsxs("label", {
                  className: "skills-copy-target",
                  children: [
                    be.jsx("input", {
                      type: "checkbox",
                      checked: selectedTargets.includes(target.id),
                      disabled: installing,
                      onChange: (event) => {
                        const checked = event.target.checked;
                        setSelectedTargets((previous) => checked
                          ? [...previous, target.id]
                          : previous.filter((id) => id !== target.id));
                      },
                    }),
                    be.jsx("span", { children: target.label }),
                  ],
                }, target.id)),
              ],
            }),
            installErrors.length > 0 ? be.jsx("div", {
              className: "skills-copy-errors",
              role: "alert",
              children: installErrors.join("\n"),
            }) : null,
            be.jsx(xn, {
              type: "primary",
              disabled: installing || selectedTargets.length === 0,
              onClick: () => void confirmInstall(),
              children: installing ? "安装中..." : "安装",
            }),
          ],
        }) : null,
      ],
    }),
  });
};

const renderSkillRows = (skills, pendingName, onCopy, onDelete) =>
  be.jsxs("table", {
    className: "skills-manager-table",
    children: [
      be.jsx("thead", {
        children: be.jsxs("tr", {
          className: "skills-manager-table-header",
          children: [
            be.jsx("th", { className: "skills-manager-table-skill", scope: "col", children: "技能" }),
            be.jsx("th", { className: "skills-manager-table-path", scope: "col", children: "路径" }),
            be.jsx("th", { className: "skills-manager-table-actions", scope: "col", children: "操作" }),
          ],
        }),
      }),
      be.jsx("tbody", {
        children: skills.map((skill) => {
          const busy = pendingName === skill.name;
          return be.jsxs(
            "tr",
            {
              className: "skills-manager-table-row",
              children: [
                be.jsx("td", {
                  className: "skills-manager-table-skill",
                  children: be.jsxs("div", {
                    className: "skills-manager-skill-line",
                    children: [
                      be.jsx("span", {
                        className: "skills-manager-skill-title",
                        title: skill.name,
                        children: skill.name,
                      }),
                      skill.description
                        ? be.jsx("span", {
                            className: "skills-manager-skill-description",
                            title: skill.description,
                            children: skill.description,
                          })
                        : null,
                    ],
                  }),
                }),
                be.jsx("td", {
                  className: "skills-manager-table-path skills-manager-muted",
                  title: skill.path,
                  children: skill.path,
                }),
                be.jsx("td", {
                  className: "skills-manager-table-actions",
                  children: be.jsxs("div", {
                    className: "skills-manager-row-actions",
                    children: [
                      be.jsx(xn, {
                        size: "small",
                        "aria-label": `复制 ${skill.name} 到`,
                        disabled: busy,
                        onClick: () => onCopy(skill),
                        children: "复制到",
                      }),
                      be.jsx(xn, {
                        size: "small",
                        disabled: busy,
                        onClick: () => onDelete(skill),
                        children: "删除",
                      }),
                    ],
                  }),
                }),
              ],
            },
            skill.name,
          );
        }),
      }),
    ],
  });

const SkillsManagerModal = ({
  open: e,
  onClose: t,
  platform: n,
  skills: r,
  directory: o,
  displayDirectory: l,
  loading: s,
  errorText: u,
  pendingName: f,
  onOpenDirectory: m,
  onCopy: v,
  onDelete: p,
}) => {
  const [copySkill, setCopySkill] = c.useState(null);
  c.useEffect(() => setCopySkill(null), [e, n]);
  const countText = s ? "Skills 加载中..." : `共 ${r.length} 个`;
  const body =
    s && r.length === 0
      ? be.jsx("div", {
          className: "skills-manager-empty",
          style: { fontSize: "12px", borderRadius: "6px", padding: "12px" },
          children: "Skills 加载中...",
        })
      : !s && r.length === 0 && !u
        ? be.jsxs("div", {
            className: "skills-manager-empty",
            style: { fontSize: "12px", borderRadius: "6px", padding: "12px" },
            children: [
              be.jsx("div", { children: "该目录还没有 Skills" }),
              be.jsx("div", {
                style: { marginTop: "4px", wordBreak: "break-all" },
                children: o || l || "",
              }),
            ],
          })
        : r.length > 0
          ? renderSkillRows(r, f, setCopySkill, p)
          : null;
  const managerModal = be.jsx(xr, {
    title: skillsTitleByPlatform(n),
    open: e,
    onCancel: t,
    width: 760,
    footer: null,
    destroyOnClose: !0,
    rootClassName: "skills-manager-modal",
    children: be.jsxs("div", {
      className: "skills-manager-content",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxHeight: "70vh",
      },
      children: [
        be.jsx("div", {
          className: "skills-manager-muted",
          style: { fontSize: "12px", wordBreak: "break-all" },
          children: l || o || "",
        }),
        be.jsxs("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          },
          children: [
            be.jsx("div", {
              className: "skills-manager-muted",
              style: { fontSize: "12px" },
              children: countText,
            }),
            be.jsx(xn, {
              size: "small",
              onClick: m,
              children: "打开目录",
            }),
          ],
        }),
        u
          ? be.jsx("div", {
              className: "skills-manager-empty",
              style: {
                fontSize: "12px",
                borderRadius: "6px",
                padding: "12px",
                color: "var(--error-color)",
                border: "1px solid var(--error-color)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              },
              children: u,
            })
          : null,
        be.jsx("div", {
          style: {
            overflow: "auto",
            maxHeight: "calc(70vh - 108px)",
            paddingRight: "4px",
          },
          children: body,
        }),
      ],
    }),
  });
  return be.jsxs(be.Fragment, {
    children: [
      managerModal,
      e && copySkill ? be.jsx(SkillsCopyModal, {
        skill: copySkill,
        platform: n,
        onClose: () => setCopySkill(null),
        onCopy: v,
      }, `${n}:${copySkill.name}`) : null,
    ],
  });
};

// OPENCODE_VISUAL_EDITOR_UTILS_START
const openCodeVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const openCodeVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const OPEN_CODE_PROVIDER_NPM_OPTIONS = Object.freeze([
  { value: "@ai-sdk/amazon-bedrock", label: "Amazon Bedrock (@ai-sdk/amazon-bedrock)" },
  { value: "@ai-sdk/amazon-bedrock/mantle", label: "Amazon Bedrock Mantle (@ai-sdk/amazon-bedrock/mantle)" },
  { value: "@ai-sdk/anthropic", label: "Anthropic (@ai-sdk/anthropic)" },
  { value: "@ai-sdk/azure", label: "Azure (@ai-sdk/azure)" },
  { value: "@ai-sdk/google", label: "Google (@ai-sdk/google)" },
  { value: "@ai-sdk/google-vertex", label: "Google Vertex (@ai-sdk/google-vertex)" },
  { value: "@ai-sdk/google-vertex/anthropic", label: "Google Vertex Anthropic (@ai-sdk/google-vertex/anthropic)" },
  { value: "@ai-sdk/openai", label: "OpenAI (@ai-sdk/openai)" },
  { value: "@ai-sdk/openai-compatible", label: "OpenAI Compatible (@ai-sdk/openai-compatible)" },
  { value: "@openrouter/ai-sdk-provider", label: "OpenRouter (@openrouter/ai-sdk-provider)" },
  { value: "@ai-sdk/xai", label: "xAI (@ai-sdk/xai)" },
  { value: "@ai-sdk/mistral", label: "Mistral (@ai-sdk/mistral)" },
  { value: "@ai-sdk/groq", label: "Groq (@ai-sdk/groq)" },
  { value: "@ai-sdk/deepinfra", label: "DeepInfra (@ai-sdk/deepinfra)" },
  { value: "@ai-sdk/cerebras", label: "Cerebras (@ai-sdk/cerebras)" },
  { value: "@ai-sdk/cohere", label: "Cohere (@ai-sdk/cohere)" },
  { value: "@ai-sdk/gateway", label: "Vercel AI Gateway (@ai-sdk/gateway)" },
  { value: "@ai-sdk/togetherai", label: "Together AI (@ai-sdk/togetherai)" },
  { value: "@ai-sdk/perplexity", label: "Perplexity (@ai-sdk/perplexity)" },
  { value: "@ai-sdk/vercel", label: "Vercel (@ai-sdk/vercel)" },
  { value: "@ai-sdk/alibaba", label: "Alibaba (@ai-sdk/alibaba)" },
  { value: "gitlab-ai-provider", label: "GitLab (gitlab-ai-provider)" },
  { value: "@ai-sdk/github-copilot", label: "GitHub Copilot (@ai-sdk/github-copilot)" },
  { value: "venice-ai-sdk-provider", label: "Venice (venice-ai-sdk-provider)" },
]);

const OPEN_CODE_VISUAL_COMPATIBILITY_PREFIX = "__sinitek_opencode_compatibility__:";

const openCodeVisualCompatibilityValue = (value) =>
  `${OPEN_CODE_VISUAL_COMPATIBILITY_PREFIX}${Array.isArray(value) ? "array" : typeof value}`;

const openCodeVisualIsCompatibilityValue = (value) =>
  typeof value === "string" && value.startsWith(OPEN_CODE_VISUAL_COMPATIBILITY_PREFIX);

const openCodeVisualReadString = (value) =>
  typeof value === "string"
    ? value
    : value === void 0
      ? ""
      : openCodeVisualCompatibilityValue(value);

const openCodeVisualReadOptionalBoolean = (value) =>
  value === !0
    ? "true"
    : value === !1
      ? "false"
      : value === void 0
        ? ""
        : openCodeVisualCompatibilityValue(value);

const openCodeVisualReadAutoUpdate = (value) =>
  value === !0
    ? "true"
    : value === !1
      ? "false"
      : typeof value === "string"
        ? value
        : value === void 0
          ? ""
          : openCodeVisualCompatibilityValue(value);

const openCodeVisualSetString = (target, key, value) => {
  if (openCodeVisualIsCompatibilityValue(value)) return;
  const normalized = typeof value === "string" ? value.trim() : "";
  normalized ? (target[key] = normalized) : delete target[key];
};

const openCodeVisualSetOptionalBoolean = (target, key, value) => {
  if (openCodeVisualIsCompatibilityValue(value)) return;
  value === "true" ? (target[key] = !0) : value === "false" ? (target[key] = !1) : delete target[key];
};

const openCodeVisualSetAutoUpdate = (target, value) => {
  if (openCodeVisualIsCompatibilityValue(value)) return;
  value === "true"
    ? (target.autoupdate = !0)
    : value === "notify"
      ? (target.autoupdate = "notify")
      : value === "false"
        ? (target.autoupdate = !1)
        : typeof value === "string" && value
          ? (target.autoupdate = value)
          : delete target.autoupdate;
};

const openCodeVisualValidateEnum = (value, allowedValues, sourceValue, label) => {
  if (
    !value ||
    openCodeVisualIsCompatibilityValue(value) ||
    allowedValues.includes(value) ||
    value === sourceValue
  )
    return "";
  return `${label} 必须是 ${allowedValues.join("、")} 之一`;
};

const openCodeVisualCreateState = (config) => {
  const source = openCodeVisualIsRecord(config) ? openCodeVisualClone(config) : {},
    providerSource = openCodeVisualIsRecord(source.provider) ? source.provider : {},
    providers = Object.entries(providerSource).map(([providerId, providerValue]) => {
      const provider = openCodeVisualIsRecord(providerValue) ? providerValue : {},
        options = openCodeVisualIsRecord(provider.options) ? provider.options : {},
        modelSource = openCodeVisualIsRecord(provider.models) ? provider.models : {},
        models = Object.entries(modelSource).map(([modelId, modelValue]) => {
          const model = openCodeVisualIsRecord(modelValue) ? modelValue : {};
          const limit = openCodeVisualIsRecord(model.limit) ? model.limit : {};
          return {
            id: modelId,
            name: typeof model.name === "string" ? model.name : "",
            reasoning: model.reasoning === !0,
            context: openCodeVisualReadOptionalNumber(limit.context),
            source: openCodeVisualClone(model),
          };
        });
      return {
        id: providerId,
        name: typeof provider.name === "string" ? provider.name : "",
        npm: typeof provider.npm === "string" ? provider.npm : "",
        baseURL: typeof options.baseURL === "string" ? options.baseURL : "",
        apiKey: typeof options.apiKey === "string" ? options.apiKey : "",
        models,
        source: openCodeVisualClone(provider),
      };
    });
  return {
    source,
    providers,
    primaryModel: typeof source.model === "string" ? source.model : "",
    smallModel: typeof source.small_model === "string" ? source.small_model : "",
    share: openCodeVisualReadString(source.share),
    autoupdate: openCodeVisualReadAutoUpdate(source.autoupdate),
    logLevel: openCodeVisualReadString(source.logLevel),
    snapshot: openCodeVisualReadOptionalBoolean(source.snapshot),
    selectedProviderId: providers[0]?.id || "",
    selectedModelId: providers[0]?.models[0]?.id || "",
  };
};

const openCodeVisualReadOptionalNumber = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value === void 0
      ? ""
      : openCodeVisualCompatibilityValue(value);

const openCodeVisualSetOptionalNumber = (target, key, value) => {
  if (openCodeVisualIsCompatibilityValue(value)) return;
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) target[key] = value;
    return;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    delete target[key];
    return;
  }
  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && parsed >= 0) target[key] = parsed;
};

const openCodeVisualParseContent = (content) => {
  try {
    const config = JSON.parse(content || "{}");
    if (!openCodeVisualIsRecord(config)) throw new Error("顶层配置必须是 JSON 对象");
    if (config.provider !== void 0 && !openCodeVisualIsRecord(config.provider))
      throw new Error("provider 必须是 JSON 对象");
    return { ok: !0, state: openCodeVisualCreateState(config), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `JSON 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}`,
    };
  }
};

const openCodeVisualModelRef = (providerId, modelId) => `${providerId}/${modelId}`;

const openCodeVisualUniqueStrings = (values) => {
  const seen = new Set();
  return (values || []).filter((value) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) return !1;
    seen.add(normalized);
    return !0;
  });
};

const openCodeVisualModelSuggestions = (state) =>
  openCodeVisualUniqueStrings([
    ...(state?.providers || []).flatMap((provider) =>
      (provider?.models || []).map((model) => openCodeVisualModelRef(provider.id, model.id)),
    ),
    state?.primaryModel,
    state?.smallModel,
  ]);

const openCodeVisualNpmSuggestions = (state) =>
  openCodeVisualUniqueStrings([
    ...OPEN_CODE_PROVIDER_NPM_OPTIONS.map((option) => option.value),
    ...(state?.providers || []).map((provider) => provider?.npm),
  ]);

const openCodeVisualValidateState = (state) => {
  const errors = [],
    providerIds = new Set(),
    modelRefs = new Set();
  (state?.providers || []).forEach((provider, providerIndex) => {
    const providerId = String(provider?.id || "").trim();
    if (!providerId) errors.push(`第 ${providerIndex + 1} 个 Provider 的 id 不能为空`);
    else if (providerId.includes("/")) errors.push(`Provider id “${providerId}” 不能包含 /`);
    else if (providerIds.has(providerId)) errors.push(`Provider id “${providerId}” 重复`);
    else providerIds.add(providerId);
    const modelIds = new Set();
    (provider?.models || []).forEach((model, modelIndex) => {
      const modelId = String(model?.id || "").trim();
      if (!modelId)
        errors.push(`Provider “${providerId || providerIndex + 1}” 的第 ${modelIndex + 1} 个模型 id 不能为空`);
      else if (modelId.includes("/")) errors.push(`模型 id “${modelId}” 不能包含 /`);
      else if (modelIds.has(modelId))
        errors.push(`Provider “${providerId}” 中的模型 id “${modelId}” 重复`);
      else {
        modelIds.add(modelId), providerId && modelRefs.add(openCodeVisualModelRef(providerId, modelId));
      }
      const rawContext = model?.context;
      const context = typeof rawContext === "string" ? rawContext.trim() : rawContext;
      if (
        context !== "" &&
        context !== void 0 &&
        context !== null &&
        !openCodeVisualIsCompatibilityValue(context)
      ) {
        const parsedContext = typeof context === "number" ? context : Number(context);
        if (!Number.isFinite(parsedContext) || parsedContext < 0) {
          errors.push(`模型 “${providerId || providerIndex + 1}/${modelId || modelIndex + 1}” 的上下文大小必须是非负有限数值`);
        }
      }
    });
  });
  [
    [state?.share, ["manual", "auto", "disabled"], state?.source?.share, "share"],
    [state?.autoupdate, ["true", "notify", "false"], state?.source?.autoupdate, "autoupdate"],
    [state?.logLevel, ["DEBUG", "INFO", "WARN", "ERROR"], state?.source?.logLevel, "logLevel"],
    [state?.snapshot, ["true", "false"], state?.source?.snapshot, "snapshot"],
  ].forEach(([value, allowedValues, sourceValue, label]) => {
    const error = openCodeVisualValidateEnum(value, allowedValues, sourceValue, label);
    error && errors.push(error);
  });
  return { valid: errors.length === 0, errors, modelRefs: Array.from(modelRefs) };
};

const openCodeVisualSerializeState = (state) => {
  if (!state || !Array.isArray(state.providers))
    return {
      ok: !1,
      config: null,
      error: "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复",
      errors: ["当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复"],
    };
  const validation = openCodeVisualValidateState(state);
  if (!validation.valid) return { ok: !1, config: null, error: validation.errors[0], errors: validation.errors };
  const config = openCodeVisualClone(state?.source) || {},
    providerConfig = {};
  openCodeVisualSetString(config, "share", state.share);
  openCodeVisualSetAutoUpdate(config, state.autoupdate);
  openCodeVisualSetString(config, "logLevel", state.logLevel);
  openCodeVisualSetOptionalBoolean(config, "snapshot", state.snapshot);
  (state?.providers || []).forEach((provider) => {
    const providerId = provider.id.trim(),
      providerValue = openCodeVisualClone(provider.source) || {},
      providerOptions = openCodeVisualIsRecord(providerValue.options)
        ? { ...providerValue.options }
        : {},
      models = {};
    provider.name.trim() ? (providerValue.name = provider.name.trim()) : delete providerValue.name;
    provider.npm.trim() ? (providerValue.npm = provider.npm.trim()) : delete providerValue.npm;
    provider.baseURL.trim()
      ? (providerOptions.baseURL = provider.baseURL.trim())
      : delete providerOptions.baseURL;
    provider.apiKey.trim()
      ? (providerOptions.apiKey = provider.apiKey.trim())
      : delete providerOptions.apiKey;
    Object.keys(providerOptions).length > 0
      ? (providerValue.options = providerOptions)
      : delete providerValue.options;
    (provider.models || []).forEach((model) => {
      const modelValue = openCodeVisualClone(model.source) || {};
      model.name.trim() ? (modelValue.name = model.name.trim()) : delete modelValue.name;
      modelValue.reasoning = model.reasoning === !0;
      if (openCodeVisualIsRecord(modelValue.limit)) {
        const modelLimit = { ...modelValue.limit };
        openCodeVisualSetOptionalNumber(modelLimit, "context", model.context);
        Object.keys(modelLimit).length > 0 ? (modelValue.limit = modelLimit) : delete modelValue.limit;
      } else if (
        model.context !== "" &&
        model.context !== void 0 &&
        !openCodeVisualIsCompatibilityValue(model.context)
      ) {
        const modelLimit = {};
        openCodeVisualSetOptionalNumber(modelLimit, "context", model.context);
        Object.keys(modelLimit).length > 0 && (modelValue.limit = modelLimit);
      }
      models[model.id.trim()] = modelValue;
    });
    providerValue.models = models;
    providerConfig[providerId] = providerValue;
  });
  config.provider = providerConfig;
  state.primaryModel ? (config.model = state.primaryModel) : delete config.model;
  state.smallModel ? (config.small_model = state.smallModel) : delete config.small_model;
  return { ok: !0, config, content: JSON.stringify(config, null, 2), error: "", errors: [] };
};

const openCodeVisualUniqueId = (items, prefix) => {
  const ids = new Set((items || []).map((item) => item.id));
  if (!ids.has(prefix)) return prefix;
  let index = 2;
  for (; ids.has(`${prefix}${index}`); index += 1);
  return `${prefix}${index}`;
};

const openCodeVisualAddProvider = (state) => {
  const id = openCodeVisualUniqueId(state.providers, "provider"),
    provider = {
      id,
      name: "新 Provider",
      npm: "@ai-sdk/openai-compatible",
      baseURL: "",
      apiKey: "",
      models: [],
      source: {},
    };
  return { ...state, providers: [...state.providers, provider], selectedProviderId: id, selectedModelId: "" };
};

const openCodeVisualUpdateProvider = (state, providerId, patch) => {
  const nextId = patch.id === void 0 ? providerId : String(patch.id),
    providers = state.providers.map((provider) =>
      provider.id === providerId ? { ...provider, ...patch, id: nextId } : provider,
    ),
    updateRef = (ref) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) return ref;
      const model = provider.models.find((item) => ref === openCodeVisualModelRef(providerId, item.id));
      return model ? openCodeVisualModelRef(nextId, model.id) : ref;
    };
  return {
    ...state,
    providers,
    primaryModel: updateRef(state.primaryModel),
    smallModel: updateRef(state.smallModel),
    selectedProviderId: state.selectedProviderId === providerId ? nextId : state.selectedProviderId,
  };
};

const openCodeVisualDeleteProvider = (state, providerId) => {
  const providers = state.providers.filter((provider) => provider.id !== providerId),
    selectedProvider = providers[0] || null;
  return {
    ...state,
    providers,
    selectedProviderId:
      state.selectedProviderId === providerId ? selectedProvider?.id || "" : state.selectedProviderId,
    selectedModelId:
      state.selectedProviderId === providerId ? selectedProvider?.models[0]?.id || "" : state.selectedModelId,
  };
};

const openCodeVisualAddModel = (state, providerId) => {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return state;
  const id = openCodeVisualUniqueId(provider.models, "model"),
    model = { id, name: "新模型", reasoning: !1, context: "", source: {} };
  return {
    ...state,
    providers: state.providers.map((item) =>
      item.id === providerId ? { ...item, models: [...item.models, model] } : item,
    ),
    selectedProviderId: providerId,
    selectedModelId: id,
  };
};

const openCodeVisualUpdateModel = (state, providerId, modelId, patch) => {
  const nextId = patch.id === void 0 ? modelId : String(patch.id),
    oldRef = openCodeVisualModelRef(providerId, modelId),
    nextRef = openCodeVisualModelRef(providerId, nextId);
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, ...patch, id: nextId } : model,
            ),
          }
        : provider,
    ),
    primaryModel: state.primaryModel === oldRef ? nextRef : state.primaryModel,
    smallModel: state.smallModel === oldRef ? nextRef : state.smallModel,
    selectedModelId: state.selectedModelId === modelId ? nextId : state.selectedModelId,
  };
};

const openCodeVisualDeleteModel = (state, providerId, modelId) => {
  let nextSelectedModelId = state.selectedModelId;
  const providers = state.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    const models = provider.models.filter((model) => model.id !== modelId);
    state.selectedModelId === modelId && (nextSelectedModelId = models[0]?.id || "");
    return { ...provider, models };
  });
  return { ...state, providers, selectedModelId: nextSelectedModelId };
};

const openCodeVisualSetRole = (state, providerId, modelId, role, enabled) => {
  const ref = openCodeVisualModelRef(providerId, modelId),
    key = role === "small" ? "smallModel" : "primaryModel";
  return { ...state, [key]: enabled ? ref : state[key] === ref ? "" : state[key] };
};

const openCodeVisualRunSaveFlow = async ({ content, saveConfig, applyActiveConfig }) => {
  await saveConfig(content);
  await applyActiveConfig(content);
  return content;
};

const OpenCodeConfigVisualEditorUtils = Object.freeze({
  providerNpmOptions: OPEN_CODE_PROVIDER_NPM_OPTIONS,
  readContext: (model) => {
    const limit = openCodeVisualIsRecord(model?.limit) ? model.limit : {};
    return openCodeVisualReadOptionalNumber(limit.context);
  },
  modelSuggestions: openCodeVisualModelSuggestions,
  npmSuggestions: openCodeVisualNpmSuggestions,
  createState: openCodeVisualCreateState,
  parseContent: openCodeVisualParseContent,
  validateState: openCodeVisualValidateState,
  serializeState: openCodeVisualSerializeState,
  addProvider: openCodeVisualAddProvider,
  updateProvider: openCodeVisualUpdateProvider,
  deleteProvider: openCodeVisualDeleteProvider,
  addModel: openCodeVisualAddModel,
  updateModel: openCodeVisualUpdateModel,
  deleteModel: openCodeVisualDeleteModel,
  setRole: openCodeVisualSetRole,
  runSaveFlow: openCodeVisualRunSaveFlow,
});
// OPENCODE_VISUAL_EDITOR_UTILS_END

// CLAUDE_VISUAL_EDITOR_UTILS_START
const claudeVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const claudeVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const claudeVisualManagedEnvKeys = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
]);

const CLAUDE_VISUAL_COMPATIBILITY_PREFIX = "__sinitek_claude_compatibility__:";

const claudeVisualCompatibilityValue = (value) =>
  `${CLAUDE_VISUAL_COMPATIBILITY_PREFIX}${Array.isArray(value) ? "array" : typeof value}`;

const claudeVisualIsCompatibilityValue = (value) =>
  typeof value === "string" && value.startsWith(CLAUDE_VISUAL_COMPATIBILITY_PREFIX);

const claudeVisualReadEnum = (value) =>
  typeof value === "string"
    ? value
    : value === void 0
      ? ""
      : claudeVisualCompatibilityValue(value);

const claudeVisualNormalizeList = (value) => {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]/),
    seen = new Set(),
    normalized = [];
  values.forEach((item) => {
    const entry = typeof item === "string" ? item.trim() : "";
    if (entry && !seen.has(entry)) {
      seen.add(entry), normalized.push(entry);
    }
  });
  return normalized;
};

const claudeVisualReadList = (value) =>
  claudeVisualNormalizeList(value).join("\n");

const claudeVisualReadOptionalBoolean = (value) =>
  value === !0
    ? "true"
    : value === !1
      ? "false"
      : value === void 0
        ? ""
        : claudeVisualCompatibilityValue(value);

const claudeVisualCreateState = (config) => {
  const source = claudeVisualIsRecord(config) ? claudeVisualClone(config) : {},
    env = claudeVisualIsRecord(source.env) ? source.env : {},
    permissions = claudeVisualIsRecord(source.permissions) ? source.permissions : {},
    managedEnv = {};
  claudeVisualManagedEnvKeys.forEach((key) => {
    managedEnv[key] = typeof env[key] === "string" ? env[key] : "";
  });
  return {
    source,
    model: typeof source.model === "string" ? source.model : "",
    fallbackModels: claudeVisualReadList(source.fallbackModel),
    availableModels: claudeVisualReadList(source.availableModels),
    effortLevel: claudeVisualReadEnum(source.effortLevel),
    language: typeof source.language === "string" ? source.language : "",
    outputStyle: typeof source.outputStyle === "string" ? source.outputStyle : "",
    autoUpdatesChannel: claudeVisualReadEnum(source.autoUpdatesChannel),
    cleanupPeriodDays:
      typeof source.cleanupPeriodDays === "number" ? String(source.cleanupPeriodDays) : "",
    alwaysThinkingEnabled: claudeVisualReadOptionalBoolean(source.alwaysThinkingEnabled),
    autoCompactEnabled: claudeVisualReadOptionalBoolean(source.autoCompactEnabled),
    autoMemoryEnabled: claudeVisualReadOptionalBoolean(source.autoMemoryEnabled),
    fileCheckpointingEnabled: claudeVisualReadOptionalBoolean(source.fileCheckpointingEnabled),
    editorMode: claudeVisualReadEnum(source.editorMode),
    viewMode: claudeVisualReadEnum(source.viewMode),
    tui: claudeVisualReadEnum(source.tui),
    verbose: claudeVisualReadOptionalBoolean(source.verbose),
    env: managedEnv,
    permissions: {
      defaultMode: claudeVisualReadEnum(permissions.defaultMode),
      allow: claudeVisualReadList(permissions.allow),
      ask: claudeVisualReadList(permissions.ask),
      deny: claudeVisualReadList(permissions.deny),
    },
  };
};

const claudeVisualParseContent = (content) => {
  try {
    const config = JSON.parse(content || "{}");
    if (!claudeVisualIsRecord(config)) throw new Error("顶层配置必须是 JSON 对象");
    if (config.env !== void 0 && !claudeVisualIsRecord(config.env))
      throw new Error("env 必须是 JSON 对象");
    if (config.permissions !== void 0 && !claudeVisualIsRecord(config.permissions))
      throw new Error("permissions 必须是 JSON 对象");
    return { ok: !0, state: claudeVisualCreateState(config), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `JSON 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}`,
    };
  }
};

const claudeVisualValidateState = (state) => {
  if (!state || !claudeVisualIsRecord(state)) return "Claude 可视化配置不可用";
  const fallbackModels = claudeVisualNormalizeList(state.fallbackModels);
  if (fallbackModels.length > 3) return "回退模型最多支持 3 个";
  const source = claudeVisualIsRecord(state.source) ? state.source : {},
    sourcePermissions = claudeVisualIsRecord(source.permissions) ? source.permissions : {},
    enumValidation = [
      [state.effortLevel, ["low", "medium", "high", "xhigh", "ultra"], source.effortLevel, "推理强度"],
      [state.autoUpdatesChannel, ["stable", "latest"], source.autoUpdatesChannel, "自动更新通道"],
      [state.editorMode, ["normal", "vim"], source.editorMode, "编辑模式"],
      [state.viewMode, ["default", "verbose", "focus"], source.viewMode, "视图模式"],
      [state.tui, ["default", "fullscreen"], source.tui, "终端界面模式"],
      [
        state.permissions?.defaultMode,
        ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"],
        sourcePermissions.defaultMode,
        "默认权限模式",
      ],
    ];
  for (const [value, allowedValues, sourceValue, label] of enumValidation) {
    if (
      value &&
      !claudeVisualIsCompatibilityValue(value) &&
      !allowedValues.includes(value) &&
      value !== sourceValue
    )
      return `${label}必须是 ${allowedValues.join("、")} 之一`;
  }
  for (const [key, label] of [
    ["alwaysThinkingEnabled", "默认扩展思考"],
    ["autoCompactEnabled", "自动压缩"],
    ["autoMemoryEnabled", "自动记忆"],
    ["fileCheckpointingEnabled", "文件检查点"],
    ["verbose", "详细输出"],
  ]) {
    const value = state[key];
    if (value && value !== "true" && value !== "false" && !claudeVisualIsCompatibilityValue(value))
      return `${label}只能设为 true 或 false`;
  }
  if (state.cleanupPeriodDays) {
    const cleanupPeriodDays = Number(state.cleanupPeriodDays);
    if (!Number.isInteger(cleanupPeriodDays) || cleanupPeriodDays < 1)
      return "会话保留天数必须是大于等于 1 的整数";
  }
  return "";
};

const claudeVisualSetString = (target, key, value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  normalized ? (target[key] = normalized) : delete target[key];
};

const claudeVisualSetEnum = (target, key, value) => {
  if (claudeVisualIsCompatibilityValue(value)) return;
  claudeVisualSetString(target, key, value);
};

const claudeVisualSetOptionalBoolean = (target, key, value) => {
  if (claudeVisualIsCompatibilityValue(value)) return;
  value === "true" ? (target[key] = !0) : value === "false" ? (target[key] = !1) : delete target[key];
};

const claudeVisualSerializeState = (state) => {
  const validation = claudeVisualValidateState(state);
  if (validation) return { ok: !1, content: "", error: validation };
  const config = claudeVisualClone(state.source) || {},
    fallbackModels = claudeVisualNormalizeList(state.fallbackModels),
    availableModels = claudeVisualNormalizeList(state.availableModels),
    env = claudeVisualIsRecord(config.env) ? { ...config.env } : {},
    permissions = claudeVisualIsRecord(config.permissions) ? { ...config.permissions } : {};

  ["model", "language", "outputStyle"].forEach(
    (key) => claudeVisualSetString(config, key, state[key]),
  );
  claudeVisualSetEnum(config, "effortLevel", state.effortLevel);
  claudeVisualSetEnum(config, "autoUpdatesChannel", state.autoUpdatesChannel);
  claudeVisualSetEnum(config, "editorMode", state.editorMode);
  claudeVisualSetEnum(config, "viewMode", state.viewMode);
  claudeVisualSetEnum(config, "tui", state.tui);
  fallbackModels.length === 0
    ? delete config.fallbackModel
    : (config.fallbackModel = fallbackModels.length === 1 ? fallbackModels[0] : fallbackModels);
  availableModels.length === 0
    ? delete config.availableModels
    : (config.availableModels = availableModels);
  state.cleanupPeriodDays
    ? (config.cleanupPeriodDays = Number(state.cleanupPeriodDays))
    : delete config.cleanupPeriodDays;
  claudeVisualSetOptionalBoolean(
    config,
    "alwaysThinkingEnabled",
    state.alwaysThinkingEnabled,
  );
  ["autoCompactEnabled", "autoMemoryEnabled", "fileCheckpointingEnabled", "verbose"].forEach(
    (key) => claudeVisualSetOptionalBoolean(config, key, state[key]),
  );

  claudeVisualManagedEnvKeys.forEach((key) =>
    claudeVisualSetString(env, key, state.env?.[key]),
  );
  Object.keys(env).length > 0 ? (config.env = env) : delete config.env;

  claudeVisualSetEnum(permissions, "defaultMode", state.permissions?.defaultMode);
  ["allow", "ask", "deny"].forEach((key) => {
    const values = claudeVisualNormalizeList(state.permissions?.[key]);
    values.length > 0 ? (permissions[key] = values) : delete permissions[key];
  });
  Object.keys(permissions).length > 0
    ? (config.permissions = permissions)
    : delete config.permissions;

  return { ok: !0, content: JSON.stringify(config, null, 2), error: "" };
};

const claudeVisualUpdateState = (state, patch) => ({ ...state, ...patch });

const claudeVisualUpdateEnv = (state, key, value) => ({
  ...state,
  env: { ...state.env, [key]: value },
});

const claudeVisualUpdatePermissions = (state, patch) => ({
  ...state,
  permissions: { ...state.permissions, ...patch },
});

const ClaudeConfigVisualEditorUtils = Object.freeze({
  managedEnvKeys: claudeVisualManagedEnvKeys,
  normalizeList: claudeVisualNormalizeList,
  createState: claudeVisualCreateState,
  parseContent: claudeVisualParseContent,
  validateState: claudeVisualValidateState,
  serializeState: claudeVisualSerializeState,
  updateState: claudeVisualUpdateState,
  updateEnv: claudeVisualUpdateEnv,
  updatePermissions: claudeVisualUpdatePermissions,
});
// CLAUDE_VISUAL_EDITOR_UTILS_END

// CODEX_VISUAL_EDITOR_UTILS_START
const codexVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const codexVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const codexVisualManagedRootKeys = Object.freeze([
  "model",
  "model_provider",
  "approval_policy",
  "sandbox_mode",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "model_verbosity",
  "developer_instructions",
  "web_search",
  "disable_response_storage",
  "hide_agent_reasoning",
  "model_supports_reasoning_summaries",
]);

const CODEX_VISUAL_REASONING_EFFORT_OPTIONS = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const codexVisualManagedProviderKeys = Object.freeze([
  "name",
  "base_url",
  "wire_api",
  "requires_openai_auth",
]);

const codexVisualTomlBareKeyPattern = /^[A-Za-z0-9_-]+$/;

const codexVisualUnquoteTomlString = (value) => {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote)
    throw new Error("字符串没有正确闭合");
  const body = value.slice(1, -1);
  return quote === "'" ? body : body.replace(/\\(["\\nrt])/g, (_match, escaped) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
};

const codexVisualSplitTomlPath = (value) =>
  String(value || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part[0] === '"' || part[0] === "'"
        ? codexVisualUnquoteTomlString(part)
        : part,
    );

const codexVisualStripTomlComment = (value) => {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && quote === '"') {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
};

const codexVisualSplitTomlArray = (value) => {
  const parts = [];
  let quote = "",
    start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && quote === '"') {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      parts.push(value.slice(start, index).trim()), (start = index + 1);
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const codexVisualParseTomlValue = (value) => {
  const normalized = codexVisualStripTomlComment(value);
  if (!normalized) throw new Error("缺少 TOML 值");
  if (normalized[0] === '"' || normalized[0] === "'")
    return codexVisualUnquoteTomlString(normalized);
  if (normalized === "true") return !0;
  if (normalized === "false") return !1;
  if (/^[+-]?\d+$/.test(normalized)) return Number(normalized);
  if (/^[+-]?\d+\.\d+$/.test(normalized)) return Number(normalized);
  if (normalized[0] === "[" && normalized[normalized.length - 1] === "]") {
    const body = normalized.slice(1, -1).trim();
    return body ? codexVisualSplitTomlArray(body).map(codexVisualParseTomlValue) : [];
  }
  if (normalized[0] === "{" || normalized.includes("\n"))
    throw new Error("复杂 TOML 请保留在源码模式编辑");
  return normalized;
};

const codexVisualSetDeepValue = (target, path, value) => {
  let cursor = target;
  path.slice(0, -1).forEach((part) => {
    if (!codexVisualIsRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[path[path.length - 1]] = value;
};

const codexVisualParseToml = (content) => {
  const root = {};
  let tablePath = [];
  String(content || "")
    .split(/\r?\n/)
    .forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;
      const tableMatch = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
      if (tableMatch) {
        tablePath = codexVisualSplitTomlPath(tableMatch[1]);
        if (tablePath.length === 0) throw new Error(`第 ${lineIndex + 1} 行表名为空`);
        codexVisualSetDeepValue(root, tablePath, codexVisualClone(codexVisualGetDeepValue(root, tablePath)) || {});
        return;
      }
      const eqIndex = line.indexOf("=");
      if (eqIndex <= 0) throw new Error(`第 ${lineIndex + 1} 行不是有效的 key = value`);
      const keyPath = codexVisualSplitTomlPath(line.slice(0, eqIndex));
      if (keyPath.length === 0) throw new Error(`第 ${lineIndex + 1} 行 key 为空`);
      codexVisualSetDeepValue(root, [...tablePath, ...keyPath], codexVisualParseTomlValue(line.slice(eqIndex + 1)));
    });
  return root;
};

function codexVisualGetDeepValue(target, path) {
  let cursor = target;
  for (const part of path) {
    if (!codexVisualIsRecord(cursor) || !(part in cursor)) return void 0;
    cursor = cursor[part];
  }
  return cursor;
}

const codexVisualTomlKey = (key) =>
  codexVisualTomlBareKeyPattern.test(String(key))
    ? String(key)
    : JSON.stringify(String(key));

const codexVisualTomlValue = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((item) => !codexVisualIsRecord(item)))
    return `[${value.map(codexVisualTomlValue).join(", ")}]`;
  return JSON.stringify(value);
};

const codexVisualStringifyTomlBlock = (record, path = []) => {
  const lines = [],
    nested = [];
  Object.entries(record || {}).forEach(([key, value]) => {
    if (codexVisualIsRecord(value) || (Array.isArray(value) && value.some(codexVisualIsRecord))) {
      nested.push([key, value]);
    } else if (value !== void 0) {
      lines.push(`${codexVisualTomlKey(key)} = ${codexVisualTomlValue(value)}`);
    }
  });
  nested.forEach(([key, value]) => {
    const nextPath = [...path, key].map(codexVisualTomlKey).join(".");
    if (Array.isArray(value)) {
      value.forEach((item) => {
        lines.push("", `[[${nextPath}]]`, ...codexVisualStringifyTomlBlock(item, [...path, key]));
      });
    } else {
      lines.push("", `[${nextPath}]`, ...codexVisualStringifyTomlBlock(value, [...path, key]));
    }
  });
  return lines;
};

const codexVisualStringifyToml = (record) =>
  `${codexVisualStringifyTomlBlock(record).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;

const codexVisualReadString = (value) => (typeof value === "string" ? value : "");

const CODEX_VISUAL_COMPATIBILITY_PREFIX = "__sinitek_codex_compatibility__:";

const codexVisualCompatibilityValue = (value) =>
  `${CODEX_VISUAL_COMPATIBILITY_PREFIX}${Array.isArray(value) ? "array" : typeof value}`;

const codexVisualIsCompatibilityValue = (value) =>
  typeof value === "string" && value.startsWith(CODEX_VISUAL_COMPATIBILITY_PREFIX);

const codexVisualReadEnum = (value) =>
  typeof value === "string"
    ? value
    : value === void 0
      ? ""
      : codexVisualCompatibilityValue(value);

const codexVisualReadText = (value) =>
  typeof value === "string"
    ? value
    : value === void 0
      ? ""
      : codexVisualCompatibilityValue(value);

const codexVisualReadOptionalBoolean = (value) =>
  value === !0
    ? "true"
    : value === !1
      ? "false"
      : value === void 0
        ? ""
        : codexVisualCompatibilityValue(value);

const codexVisualSetString = (target, key, value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  normalized ? (target[key] = normalized) : delete target[key];
};

const codexVisualSetEnum = (target, key, value) => {
  if (codexVisualIsCompatibilityValue(value)) return;
  codexVisualSetString(target, key, value);
};

const codexVisualSetText = (target, key, value) => {
  if (codexVisualIsCompatibilityValue(value)) return;
  typeof value === "string" && value.length > 0 ? (target[key] = value) : delete target[key];
};

const codexVisualSetOptionalBoolean = (target, key, value) => {
  if (codexVisualIsCompatibilityValue(value)) return;
  value === "true" ? (target[key] = !0) : value === "false" ? (target[key] = !1) : delete target[key];
};

const codexVisualValidateEnum = (value, allowedValues, sourceValue, label) => {
  if (
    !value ||
    codexVisualIsCompatibilityValue(value) ||
    allowedValues.includes(value) ||
    value === sourceValue
  )
    return "";
  return `${label}必须是 ${allowedValues.join("、")} 之一`;
};

const codexVisualCreateProvider = (id, value = {}) => ({
  id,
  name: codexVisualReadString(value.name),
  baseUrl: codexVisualReadString(value.base_url),
  wireApi: codexVisualReadEnum(value.wire_api),
  requiresOpenaiAuth: codexVisualReadOptionalBoolean(value.requires_openai_auth),
  source: codexVisualClone(value) || {},
});

const codexVisualCreateState = (configContent) => {
  const source = codexVisualParseToml(configContent || ""),
    providersSource = codexVisualIsRecord(source.model_providers) ? source.model_providers : {},
    providers = Object.entries(providersSource)
      .filter(([, value]) => codexVisualIsRecord(value))
      .map(([id, value]) => codexVisualCreateProvider(id, value));
  return {
    source,
    model: codexVisualReadString(source.model),
    modelProvider: codexVisualReadString(source.model_provider),
    approvalPolicy: codexVisualReadEnum(source.approval_policy),
    sandboxMode: codexVisualReadString(source.sandbox_mode),
    reasoningEffort: codexVisualReadEnum(source.model_reasoning_effort),
    reasoningSummary: codexVisualReadEnum(source.model_reasoning_summary),
    verbosity: codexVisualReadEnum(source.model_verbosity),
    developerInstructions: codexVisualReadText(source.developer_instructions),
    webSearch: codexVisualReadEnum(source.web_search),
    disableResponseStorage: codexVisualReadOptionalBoolean(source.disable_response_storage),
    hideAgentReasoning: codexVisualReadOptionalBoolean(source.hide_agent_reasoning),
    supportsReasoningSummaries: codexVisualReadOptionalBoolean(source.model_supports_reasoning_summaries),
    providers,
    selectedProviderId: codexVisualReadString(source.model_provider) || providers[0]?.id || "",
  };
};

const codexVisualParseContent = (configContent) => {
  try {
    return { ok: !0, state: codexVisualCreateState(configContent), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `TOML 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}。请切换到 TOML 源码修复。`,
    };
  }
};

const codexVisualValidateState = (state) => {
  if (!state || !codexVisualIsRecord(state)) return "Codex 可视化配置不可用，请切换到 TOML 源码修复";
  const source = codexVisualIsRecord(state.source) ? state.source : {};
  for (const [value, allowedValues, sourceValue, label] of [
    [state.approvalPolicy, ["untrusted", "on-request", "never"], source.approval_policy, "approval_policy"],
    [state.reasoningEffort, CODEX_VISUAL_REASONING_EFFORT_OPTIONS, source.model_reasoning_effort, "model_reasoning_effort"],
    [state.verbosity, ["low", "medium", "high"], source.model_verbosity, "model_verbosity"],
    [state.webSearch, ["disabled", "cached", "indexed", "live"], source.web_search, "web_search"],
  ]) {
    const error = codexVisualValidateEnum(value, allowedValues, sourceValue, label);
    if (error) return error;
  }
  const providerIds = new Set();
  for (const [index, provider] of (state.providers || []).entries()) {
    const id = codexVisualReadString(provider.id).trim();
    if (!id) return `第 ${index + 1} 个 Provider 的 id 不能为空`;
    if (providerIds.has(id)) return `Provider id “${id}” 重复`;
    providerIds.add(id);
    const wireApiError = codexVisualValidateEnum(
      provider.wireApi,
      ["responses"],
      provider.source?.wire_api,
      `Provider “${id}” 的 wire_api`,
    );
    if (wireApiError) return wireApiError;
  }
  if (state.modelProvider && !providerIds.has(state.modelProvider))
    return `model_provider “${state.modelProvider}” 未在 model_providers 中定义`;
  return "";
};

const codexVisualSerializeState = (state) => {
  const validation = codexVisualValidateState(state);
  if (validation) return { ok: !1, content: "", error: validation };
  const config = codexVisualClone(state.source) || {};
  [
    ["model", state.model],
    ["model_provider", state.modelProvider],
    ["sandbox_mode", state.sandboxMode],
  ].forEach(([key, value]) => codexVisualSetString(config, key, value));
  codexVisualSetEnum(config, "approval_policy", state.approvalPolicy);
  codexVisualSetEnum(config, "model_reasoning_effort", state.reasoningEffort);
  codexVisualSetEnum(config, "model_reasoning_summary", state.reasoningSummary);
  codexVisualSetEnum(config, "model_verbosity", state.verbosity);
  codexVisualSetText(config, "developer_instructions", state.developerInstructions);
  codexVisualSetEnum(config, "web_search", state.webSearch);
  codexVisualSetOptionalBoolean(config, "disable_response_storage", state.disableResponseStorage);
  codexVisualSetOptionalBoolean(config, "hide_agent_reasoning", state.hideAgentReasoning);
  codexVisualSetOptionalBoolean(config, "model_supports_reasoning_summaries", state.supportsReasoningSummaries);

  const providers = {};
  (state.providers || []).forEach((provider) => {
    const value = codexVisualClone(provider.source) || {};
    codexVisualManagedProviderKeys
      .filter((key) => key !== "wire_api" || !codexVisualIsCompatibilityValue(provider.wireApi))
      .forEach((key) => delete value[key]);
    codexVisualSetString(value, "name", provider.name);
    codexVisualSetString(value, "base_url", provider.baseUrl);
    codexVisualSetEnum(value, "wire_api", provider.wireApi);
    codexVisualSetOptionalBoolean(value, "requires_openai_auth", provider.requiresOpenaiAuth);
    providers[provider.id.trim()] = value;
  });
  Object.keys(providers).length > 0
    ? (config.model_providers = providers)
    : delete config.model_providers;
  return {
    ok: !0,
    content: codexVisualStringifyToml(config),
    error: "",
  };
};

const codexVisualUpdateState = (state, patch) => ({ ...state, ...patch });

const codexVisualUniqueId = (items, prefix) => {
  const ids = new Set((items || []).map((item) => item.id));
  if (!ids.has(prefix)) return prefix;
  let index = 2;
  for (; ids.has(`${prefix}${index}`); index += 1);
  return `${prefix}${index}`;
};

const codexVisualAddProvider = (state) => {
  const id = codexVisualUniqueId(state.providers, "openai"),
    provider = codexVisualCreateProvider(id, {
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      wire_api: "responses",
      requires_openai_auth: !0,
    });
  return {
    ...state,
    providers: [...state.providers, provider],
    selectedProviderId: id,
    modelProvider: state.modelProvider || id,
  };
};

const codexVisualUpdateProvider = (state, providerId, patch) => {
  const nextId = patch.id === void 0 ? providerId : String(patch.id);
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId ? { ...provider, ...patch, id: nextId } : provider,
    ),
    modelProvider: state.modelProvider === providerId ? nextId : state.modelProvider,
    selectedProviderId: state.selectedProviderId === providerId ? nextId : state.selectedProviderId,
  };
};

const codexVisualDeleteProvider = (state, providerId) => {
  const providers = state.providers.filter((provider) => provider.id !== providerId),
    selected = providers[0]?.id || "";
  return {
    ...state,
    providers,
    selectedProviderId: state.selectedProviderId === providerId ? selected : state.selectedProviderId,
    modelProvider: state.modelProvider === providerId ? selected : state.modelProvider,
  };
};

const CodexConfigVisualEditorUtils = Object.freeze({
  managedRootKeys: codexVisualManagedRootKeys,
  managedProviderKeys: codexVisualManagedProviderKeys,
  reasoningEffortOptions: CODEX_VISUAL_REASONING_EFFORT_OPTIONS,
  parseToml: codexVisualParseToml,
  stringifyToml: codexVisualStringifyToml,
  createState: codexVisualCreateState,
  parseContent: codexVisualParseContent,
  validateState: codexVisualValidateState,
  serializeState: codexVisualSerializeState,
  updateState: codexVisualUpdateState,
  addProvider: codexVisualAddProvider,
  updateProvider: codexVisualUpdateProvider,
  deleteProvider: codexVisualDeleteProvider,
});
// CODEX_VISUAL_EDITOR_UTILS_END

const { TextArea: Qa } = zi;
const GROK_VISUAL_FIELD_IDS = Object.freeze([
  "models.default",
  "models.default_reasoning_effort",
  "model.model",
  "model.base_url",
  "model.api_key",
  "model.api_backend",
  "model.env_key",
  "model.context_window",
  "model.reasoning_summary",
  "model.compaction_at_tokens",
]);
const GROK_VISUAL_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const GROK_VISUAL_API_BACKENDS = Object.freeze([
  "chat_completions",
  "responses",
  "messages",
]);
const GROK_VISUAL_REASONING_SUMMARIES = Object.freeze([
  "none",
  "auto",
  "concise",
  "detailed",
]);
const GROK_VISUAL_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GROK_EMPTY_TEXT_ERROR = "空文本不会覆盖上一份有效内容。";

const grokVisualIsTable = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

const grokVisualClone = (value) => {
  if (Array.isArray(value)) return value.map(grokVisualClone);
  if (!grokVisualIsTable(value)) return value;
  const next = {};
  Object.keys(value).forEach((key) => {
    next[key] = grokVisualClone(value[key]);
  });
  return next;
};

const grokVisualModelIds = (source) => {
  const table = grokVisualIsTable(source?.model) ? source.model : {};
  return Object.keys(table).filter((id) => grokVisualIsTable(table[id]));
};

const grokVisualPickModelId = (source) => {
  const ids = grokVisualModelIds(source);
  const preferred =
    grokVisualIsTable(source?.models) && typeof source.models.default === "string"
      ? source.models.default
      : "";
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0] || preferred || "";
};

const grokVisualReadString = (value) => (typeof value === "string" ? value : "");

const grokVisualReadInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(value) : "";

const grokVisualReadModelFields = (source, modelId) => {
  const table = grokVisualIsTable(source?.model) ? source.model : {};
  const model = grokVisualIsTable(table[modelId]) ? table[modelId] : {};
  return {
    model: grokVisualReadString(model.model),
    baseUrl: grokVisualReadString(model.base_url),
    apiKey: grokVisualReadString(model.api_key),
    apiBackend: grokVisualReadString(model.api_backend),
    envKey: grokVisualReadString(model.env_key),
    contextWindow: grokVisualReadInteger(model.context_window),
    reasoningSummary: grokVisualReadString(model.reasoning_summary),
    compactionAtTokens: grokVisualReadInteger(model.compaction_at_tokens),
  };
};

const grokVisualValidateSource = (source) => {
  if (!grokVisualIsTable(source)) return "Grok 配置不可用。";
  const models = source.models;
  if (models !== void 0 && !grokVisualIsTable(models)) return "models 必须是表。";
  if (grokVisualIsTable(models)) {
    const effort = models.default_reasoning_effort;
    if (
      effort !== void 0 &&
      (typeof effort !== "string" || !GROK_VISUAL_REASONING_EFFORTS.includes(effort))
    ) {
      return "default_reasoning_effort 无效。";
    }
  }
  const modelTable = source.model;
  if (modelTable !== void 0 && !grokVisualIsTable(modelTable)) return "model 必须是表。";
  if (!grokVisualIsTable(modelTable)) return "";
  for (const value of Object.values(modelTable)) {
    if (!grokVisualIsTable(value)) continue;
    if (
      value.api_backend !== void 0 &&
      (typeof value.api_backend !== "string" || !GROK_VISUAL_API_BACKENDS.includes(value.api_backend))
    ) {
      return "api_backend 无效。";
    }
    if (
      value.reasoning_summary !== void 0 &&
      (typeof value.reasoning_summary !== "string" ||
        !GROK_VISUAL_REASONING_SUMMARIES.includes(value.reasoning_summary))
    ) {
      return "reasoning_summary 无效。";
    }
    if (value.api_key !== void 0 && typeof value.api_key !== "string") {
      return "api_key 必须是字符串。";
    }
    if (
      value.env_key !== void 0 &&
      (typeof value.env_key !== "string" || !GROK_VISUAL_ENV_KEY_PATTERN.test(value.env_key))
    ) {
      return "env_key 只能是环境变量名。";
    }
    if (
      value.context_window !== void 0 &&
      !(typeof value.context_window === "number" && Number.isInteger(value.context_window) && value.context_window >= 0)
    ) {
      return "context_window 必须是非负整数。";
    }
    if (
      value.compaction_at_tokens !== void 0 &&
      !(
        typeof value.compaction_at_tokens === "number" &&
        Number.isInteger(value.compaction_at_tokens) &&
        value.compaction_at_tokens >= 0
      )
    ) {
      return "compaction_at_tokens 必须是非负整数。";
    }
  }
  return "";
};

const grokVisualCreateState = (content) => {
  const parsed = grokVisualParseContent(content);
  return parsed.ok ? parsed.state : null;
};

const grokVisualParseContent = (content) => {
  if (!String(content || "").trim()) {
    return { ok: false, empty: true, error: GROK_EMPTY_TEXT_ERROR, state: null };
  }
  try {
    const source = g1(String(content));
    const selectedModelId = grokVisualPickModelId(source);
    const models = grokVisualIsTable(source.models) ? source.models : {};
    return {
      ok: true,
      state: {
        source,
        selectedModelId,
        defaultModel: grokVisualReadString(models.default),
        defaultReasoningEffort: grokVisualReadString(models.default_reasoning_effort),
        ...grokVisualReadModelFields(source, selectedModelId),
        fieldError: grokVisualValidateSource(source),
      },
    };
  } catch (error) {
    return {
      ok: false,
      empty: false,
      error: error instanceof Error ? error.message : "非法 TOML。",
      state: null,
    };
  }
};

const grokVisualWriteOptionalString = (target, key, value) => {
  if (!String(value || "").trim()) {
    delete target[key];
    return;
  }
  target[key] = String(value).trim();
};

const grokVisualWriteOptionalInteger = (target, key, value) => {
  if (!String(value || "").trim()) {
    delete target[key];
    return "";
  }
  if (!/^\d+$/.test(String(value).trim())) return `${key} 必须是非负整数。`;
  target[key] = Number(String(value).trim());
  return "";
};

const grokVisualUpdateState = (state, patch) => {
  if (!state || !grokVisualIsTable(state.source)) return state;
  const source = grokVisualClone(state.source);
  const models = grokVisualIsTable(source.models) ? { ...source.models } : {};
  if (Object.prototype.hasOwnProperty.call(patch, "defaultModel")) {
    grokVisualWriteOptionalString(models, "default", patch.defaultModel);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultReasoningEffort")) {
    grokVisualWriteOptionalString(models, "default_reasoning_effort", patch.defaultReasoningEffort);
  }
  if (Object.keys(models).length) source.models = models;
  else delete source.models;
  let selectedModelId = Object.prototype.hasOwnProperty.call(patch, "selectedModelId")
    ? String(patch.selectedModelId || "")
    : state.selectedModelId || "";
  const modelPatchKeys = [
    "model",
    "baseUrl",
    "apiKey",
    "apiBackend",
    "envKey",
    "contextWindow",
    "reasoningSummary",
    "compactionAtTokens",
  ];
  const editsModel = modelPatchKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (!selectedModelId && editsModel) {
    selectedModelId = grokVisualReadString(models.default) || grokVisualReadString(patch.model);
  }
  if (editsModel) {
    const modelTable = grokVisualIsTable(source.model) ? { ...source.model } : {};
    if (selectedModelId) {
      const current = grokVisualIsTable(modelTable[selectedModelId])
        ? { ...modelTable[selectedModelId] }
        : {};
      const hadApiKey = Object.prototype.hasOwnProperty.call(current, "api_key");
      const nextFields = {
        ...grokVisualReadModelFields(source, selectedModelId),
        ...patch,
      };
      grokVisualWriteOptionalString(current, "model", nextFields.model);
      grokVisualWriteOptionalString(current, "base_url", nextFields.baseUrl);
      if (hadApiKey || Object.prototype.hasOwnProperty.call(patch, "apiKey")) {
        current.api_key = String(nextFields.apiKey ?? "").trim();
      }
      grokVisualWriteOptionalString(current, "api_backend", nextFields.apiBackend);
      grokVisualWriteOptionalString(current, "env_key", nextFields.envKey);
      grokVisualWriteOptionalString(current, "reasoning_summary", nextFields.reasoningSummary);
      const contextError = grokVisualWriteOptionalInteger(current, "context_window", nextFields.contextWindow);
      const compactionError = grokVisualWriteOptionalInteger(
        current,
        "compaction_at_tokens",
        nextFields.compactionAtTokens,
      );
      if (Object.keys(current).length) modelTable[selectedModelId] = current;
      else delete modelTable[selectedModelId];
      if (Object.keys(modelTable).length) source.model = modelTable;
      else delete source.model;
      const fieldError = contextError || compactionError || grokVisualValidateSource(source);
      const readback = grokVisualReadModelFields(source, selectedModelId);
      return {
        source,
        selectedModelId,
        defaultModel: grokVisualReadString(grokVisualIsTable(source.models) ? source.models.default : ""),
        defaultReasoningEffort: grokVisualReadString(
          grokVisualIsTable(source.models) ? source.models.default_reasoning_effort : "",
        ),
        ...readback,
        contextWindow: contextError ? String(nextFields.contextWindow || "") : readback.contextWindow,
        compactionAtTokens: compactionError
          ? String(nextFields.compactionAtTokens || "")
          : readback.compactionAtTokens,
        fieldError,
      };
    }
  }
  const readback = grokVisualReadModelFields(source, selectedModelId);
  return {
    source,
    selectedModelId,
    defaultModel: grokVisualReadString(grokVisualIsTable(source.models) ? source.models.default : ""),
    defaultReasoningEffort: grokVisualReadString(
      grokVisualIsTable(source.models) ? source.models.default_reasoning_effort : "",
    ),
    ...readback,
    fieldError: grokVisualValidateSource(source),
  };
};

const grokVisualSerializeState = (state) => {
  if (!state || !grokVisualIsTable(state.source)) {
    return { ok: false, error: "当前 TOML 无法加载到可视化编辑器，请切换到 TOML 源码修复。" };
  }
  if (state.fieldError) return { ok: false, error: state.fieldError };
  const fieldError = grokVisualValidateSource(state.source);
  if (fieldError) return { ok: false, error: fieldError };
  try {
    const content = Ik(state.source);
    if (!String(content || "").trim()) return { ok: false, error: GROK_EMPTY_TEXT_ERROR };
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "无法序列化 TOML。" };
  }
};

const grokVisualAddModel = (state, rawId) => {
  const modelId = String(rawId || "").trim();
  if (!modelId || ["__proto__", "constructor", "prototype"].includes(modelId)) {
    return { ok: false, error: "invalid-id", state };
  }
  if (!state || state.fieldError) return { ok: false, error: "invalid-config", state };
  const source = grokVisualClone(state.source);
  const modelTable = grokVisualIsTable(source.model) ? source.model : {};
  if (Object.prototype.hasOwnProperty.call(modelTable, modelId)) {
    return { ok: false, error: "duplicate-id", state };
  }
  const templateId = grokVisualModelIds(source).includes(state.selectedModelId)
    ? state.selectedModelId
    : grokVisualPickModelId(source);
  const template = grokVisualIsTable(modelTable[templateId]) ? grokVisualClone(modelTable[templateId]) : {};
  delete template.name;
  source.model = { ...modelTable, [modelId]: { ...template, model: modelId } };
  const models = grokVisualIsTable(source.models) ? { ...source.models } : {};
  if (!grokVisualModelIds(source).includes(models.default)) models.default = modelId;
  source.models = models;
  return {
    ok: true,
    state: grokVisualUpdateState({ ...state, source }, { selectedModelId: modelId }),
  };
};

const grokVisualDeleteModel = (state, modelId) => {
  if (!state || state.fieldError || !grokVisualModelIds(state.source).includes(modelId)) return state;
  const source = grokVisualClone(state.source);
  delete source.model[modelId];
  const remainingIds = grokVisualModelIds(source);
  if (grokVisualIsTable(source.models) && source.models.default === modelId) {
    if (remainingIds.length) source.models.default = remainingIds[0];
    else delete source.models.default;
  }
  const selectedModelId = state.selectedModelId === modelId ? remainingIds[0] || "" : state.selectedModelId;
  return grokVisualUpdateState({ ...state, source }, { selectedModelId });
};

const GrokConfigVisualEditorUtils = Object.freeze({
  fieldIds: GROK_VISUAL_FIELD_IDS,
  parseContent: grokVisualParseContent,
  createState: grokVisualCreateState,
  updateState: grokVisualUpdateState,
  serializeState: grokVisualSerializeState,
  validateSource: grokVisualValidateSource,
  addModel: grokVisualAddModel,
  deleteModel: grokVisualDeleteModel,
});

const ps = {
    claude: {
      settings: `{
  "model": "claude-sonnet-5",
  "effortLevel": "high",
  "language": "zh-CN",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<请填写你的 auth token>",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:33391",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-sonnet-5",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-5"
  }
}`,
    },
    codex: {
      config: `model_provider = "codex"
model = "gpt-5.1-codex"
model_reasoning_effort = "medium"
model_reasoning_summary = "detailed"
model_verbosity = "high"
model_supports_reasoning_summaries = true
disable_response_storage = true
hide_agent_reasoning = false
web_search = "cached"

[model_providers.codex]
name = "codex"
base_url = "<供应商 url>"
wire_api = "responses"
requires_openai_auth = true`,
      auth: `{
  "OPENAI_API_KEY": "<你的 api key>"
}`,
    },
    opencode: {
      settings: `{
  "$schema": "https://opencode.ai/config.json",
  "model": "myAPI/main-chat-model",
  "small_model": "myAPI/small-task-model",
  "provider": {
    "myAPI": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "myAPI",
      "options": {
        "baseURL": "{env:MY_API_BASE_URL}",
        "apiKey": "{env:MY_API_KEY}"
      },
      "models": {
        "main-chat-model": {
          "name": "Main Chat Model",
          "reasoning": true,
          "limit": {
            "context": 128000
          }
        },
        "small-task-model": {
          "name": "Small Task Model",
          "reasoning": true,
          "limit": {
            "context": 32768
          }
        }
      }
    }
  }
}`,
	    },
    grok: {
      config: `[models]
default = "grok-4.7"
default_reasoning_effort = "xhigh"

[model."grok-4.7"]
model = "grok-4.7"
base_url = "http://127.0.0.1:33391/v1"
api_key = ""
api_backend = "responses"
env_key = "XAI_API_KEY"
context_window = 500000
reasoning_summary = "auto"
compaction_at_tokens = 450000
`,
    },
	    dsh: {
	      config: createDshUiProfileText(),
	    },
	  };

const Nk = {
    "claude-settings": {
      title: "Claude settings.json",
      content: ps.claude.settings,
    },
	    "opencode-settings": {
	      title: "OpenCode 模型配置 config.json（myAPI 双模型范例）",
	      content: ps.opencode.settings,
	    },
    "codex-config": { title: "Codex config.toml", content: ps.codex.config },
    "codex-auth": { title: "Codex auth.json", content: ps.codex.auth },
    "grok-config": { title: "Grok config.toml", content: ps.grok.config },
	    "dsh-config": { title: "DSH profile JSON", content: ps.dsh.config },
  };

// Config editor panel
const ConfigEditorPanel = () => {
    const {
        selectedConfigId: e,
        selectedConfigPlatform: t,
        getConfigById: n,
        updateConfig: r,
        getActiveConfigId: o,
        isLoading: configListLoading,
      } = useConfigStore(),
      [l, s] = c.useState(""),
      [m, v] = c.useState(""),
      [p, h] = c.useState(""),
      [S, y] = c.useState(null),
      [skillsModalOpen, setSkillsModalOpen] = c.useState(!1),
      [cliSkills, setCliSkills] = c.useState([]),
      [skillsDirectory, setSkillsDirectory] = c.useState(""),
      [skillsDisplayDirectory, setSkillsDisplayDirectory] = c.useState(""),
      [skillsLoading, setSkillsLoading] = c.useState(!1),
      [skillsError, setSkillsError] = c.useState(""),
      [pendingSkillName, setPendingSkillName] = c.useState(""),
      skillsLoadGenerationRef = c.useRef(0),
      skillsLoadTargetRef = c.useRef(""),
      [claudeEditorMode, setClaudeEditorMode] = c.useState("json"),
      [claudeVisualState, setClaudeVisualState] = c.useState(() =>
        claudeVisualCreateState({}),
      ),
      [claudeVisualError, setClaudeVisualError] = c.useState(""),
      [openCodeEditorMode, setOpenCodeEditorMode] = c.useState("json"),
      [openCodeVisualState, setOpenCodeVisualState] = c.useState(() =>
        openCodeVisualCreateState({}),
      ),
      [openCodeVisualError, setOpenCodeVisualError] = c.useState(""),
      [codexEditorMode, setCodexEditorMode] = c.useState("toml"),
      [codexVisualState, setCodexVisualState] = c.useState(() =>
        codexVisualCreateState(""),
      ),
      [codexVisualError, setCodexVisualError] = c.useState(""),
      [grokEditorMode, setGrokEditorMode] = c.useState("toml"),
      [grokTextDraft, setGrokTextDraft] = c.useState(""),
      [grokValidContent, setGrokValidContent] = c.useState(""),
      [grokVisualState, setGrokVisualState] = c.useState(null),
      [grokVisualError, setGrokVisualError] = c.useState(""),
      [grokAddModelOpen, setGrokAddModelOpen] = c.useState(!1),
      [grokNewModelId, setGrokNewModelId] = c.useState(""),
      [grokModelActionError, setGrokModelActionError] = c.useState(""),
      grokNewModelInputRef = c.useRef(null),
      [dshEditorMode, setDshEditorMode] = c.useState("json"),
      [dshText, setDshText] = c.useState(""),
      [dshVisual, setDshVisual] = c.useState(null),
      [dshFieldError, setDshFieldError] = c.useState(""),
      [dshSelectedModelId, setDshSelectedModelId] = c.useState(""),
      [dshBusy, setDshBusy] = c.useState(!1),
      [configFieldHelpTooltipKey, setConfigFieldHelpTooltipKey] = c.useState(""),
      configFieldHelpTooltipTimerRef = c.useRef(null),
      O = e ? n(e, t || void 0) : null,
      I = S ? Nk[S] : null;
    c.useEffect(() => {
      return () => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
      };
    }, []);
    c.useEffect(() => {
      setGrokAddModelOpen(!1);
      setGrokNewModelId("");
      setGrokModelActionError("");
      if (!O) {
          (s(""),
          v(""),
          h(""),
          setCliSkills([]),
          setSkillsDirectory(""),
          setSkillsDisplayDirectory(""),
          setSkillsLoading(!1),
          setSkillsError(""),
          setPendingSkillName(""),
          setSkillsModalOpen(!1),
          setClaudeEditorMode("json"),
          setClaudeVisualState(claudeVisualCreateState({})),
          setClaudeVisualError(""),
          setOpenCodeEditorMode("json"),
          setOpenCodeVisualState(openCodeVisualCreateState({})),
          setOpenCodeVisualError(""),
          setCodexEditorMode("toml"),
          setCodexVisualState(codexVisualCreateState("")),
          setCodexVisualError(""),
          setGrokEditorMode("toml"),
          setGrokTextDraft(""),
          setGrokValidContent(""),
          setGrokVisualState(null),
          setGrokVisualError(""),
          setDshEditorMode("json"),
          setDshText(""),
          setDshVisual(null),
          setDshFieldError(""),
          setDshSelectedModelId(""),
          setDshBusy(!1));
        return;
      }
      if (O.platform === "claude") {
        const W = O.content || "{}",
          H = claudeVisualParseContent(W);
        s(W), v(""), h(""), setClaudeEditorMode("json");
        H.ok
          ? (setClaudeVisualState(H.state), setClaudeVisualError(""))
          : (setClaudeVisualState(null), setClaudeVisualError(H.error));
      } else if (O.platform === "opencode") {
        const W = O.content || "{}",
          H = openCodeVisualParseContent(W);
        s(W), v(""), h(""), setOpenCodeEditorMode("json");
        H.ok
          ? (setOpenCodeVisualState(H.state), setOpenCodeVisualError(""))
          : (setOpenCodeVisualState(null), setOpenCodeVisualError(H.error));
      } else if (O.platform === "grok") {
        const W = O.configContent || O.content || "";
        const H = grokVisualParseContent(W);
        setGrokTextDraft(W), setGrokEditorMode("toml"), s(""), v(""), h("");
        H.ok && !H.state.fieldError
          ? (setGrokVisualState(H.state), setGrokValidContent(W), setGrokVisualError(""))
          : (setGrokVisualState(H.state), setGrokValidContent(""), setGrokVisualError(H.ok ? H.state.fieldError : H.error));
      } else if (O.platform === "dsh") {
        const W = O.configContent || O.content || "";
        setDshSelectedModelId("");
        setDshBusy(!1);
        s(""), v(""), h("");
        if (dshUiContainsProfileSecret(W)) {
          setDshText("");
          setDshVisual(null);
          setDshFieldError(DSH_UI_SECRET_ERROR);
          setDshEditorMode("json");
        } else {
          const H = readDshUiDocument(W);
          setDshText(W);
          if (H.ok) {
            setDshVisual(H.document);
            setDshText(H.content);
            setDshFieldError("");
            setDshSelectedModelId(H.document.acpModel || H.document.models[0]?.id || "");
            setDshEditorMode("json");
          } else {
            setDshVisual(null);
            setDshFieldError(H.error);
            setDshEditorMode("json");
          }
        }
      } else {
        const W = O.configContent || "",
          H = codexVisualParseContent(W);
        v(W), h(O.authContent || "{}"), s(""), setCodexEditorMode("toml");
        H.ok
          ? (setCodexVisualState(H.state), setCodexVisualError(""))
          : (setCodexVisualState(null), setCodexVisualError(H.error));
      }
    }, [O]);
    c.useEffect(() => {
      if (claudeEditorMode !== "visual" || !claudeVisualState) return;
      const W = claudeVisualSerializeState(claudeVisualState);
      W.ok ? (s(W.content), setClaudeVisualError("")) : setClaudeVisualError(W.error);
    }, [claudeEditorMode, claudeVisualState]);
    c.useEffect(() => {
      if (openCodeEditorMode !== "visual" || !openCodeVisualState) return;
      const W = openCodeVisualSerializeState(openCodeVisualState);
      W.ok ? (s(W.content), setOpenCodeVisualError("")) : setOpenCodeVisualError(W.error);
    }, [openCodeEditorMode, openCodeVisualState]);
    c.useEffect(() => {
      if (codexEditorMode !== "visual" || !codexVisualState) return;
      const W = codexVisualSerializeState(codexVisualState);
      W.ok
        ? (v(W.content), setCodexVisualError(""))
        : setCodexVisualError(W.error);
    }, [codexEditorMode, codexVisualState]);
    c.useEffect(() => {
      if (grokEditorMode !== "visual" || !grokVisualState) return;
      if (grokVisualState.fieldError) {
        setGrokVisualError(grokVisualState.fieldError);
        return;
      }
      const W = grokVisualSerializeState(grokVisualState);
      if (!W.ok || !String(W.content || "").trim()) {
        setGrokVisualError(W.ok ? GROK_EMPTY_TEXT_ERROR : W.error);
        return;
      }
      setGrokTextDraft(W.content), setGrokValidContent(W.content), setGrokVisualError("");
    }, [grokEditorMode, grokVisualState]);
    const applyCliSkillsResult = (result) => {
      if (!result || typeof result !== "object") return;
      if (typeof result.directory === "string") setSkillsDirectory(result.directory);
      if (typeof result.displayDirectory === "string") setSkillsDisplayDirectory(result.displayDirectory);
      if (Array.isArray(result.skills)) setCliSkills(result.skills);
      setSkillsError("");
    };
    const loadCliSkills = c.useCallback(async (platform, generation) => {
      setSkillsLoading(!0);
      try {
        const result = await fetchCliSkillsList(platform);
        if (skillsLoadGenerationRef.current !== generation) return;
        applyCliSkillsResult(result);
      } catch (error) {
        if (skillsLoadGenerationRef.current !== generation) return;
        const message = error instanceof Error ? error.message : String(error);
        setSkillsError(message || "获取 Skills 失败");
      } finally {
        if (skillsLoadGenerationRef.current === generation) setSkillsLoading(!1);
      }
    }, []);
    c.useEffect(() => {
      const generation = skillsLoadGenerationRef.current + 1;
      skillsLoadGenerationRef.current = generation;
      if (!O || (O.platform !== "claude" && O.platform !== "codex" && O.platform !== "opencode" && O.platform !== "grok")) {
        skillsLoadTargetRef.current = "";
        setCliSkills([]), setSkillsDirectory(""), setSkillsDisplayDirectory(""), setSkillsError(""), setSkillsLoading(!1);
        return;
      }
      const targetKey = `${O.platform}:${O.id}`;
      if (skillsLoadTargetRef.current !== targetKey) {
        skillsLoadTargetRef.current = targetKey;
        setCliSkills([]), setSkillsDirectory(""), setSkillsDisplayDirectory(""), setSkillsError("");
      }
      void loadCliSkills(O.platform, generation);
    }, [O, loadCliSkills]);
    c.useEffect(() => {
      const onInstalled = (event) => {
        const platforms = event?.detail?.platforms;
        if (!O || !Array.isArray(platforms) || !platforms.includes(O.platform)) return;
        const generation = skillsLoadGenerationRef.current + 1;
        skillsLoadGenerationRef.current = generation;
        void loadCliSkills(O.platform, generation);
      };
      window.addEventListener("sinitek-cli-skills-installed", onInstalled);
      return () => window.removeEventListener("sinitek-cli-skills-installed", onInstalled);
    }, [O, loadCliSkills]);
    const openSkillsDirectory = async () => {
      if (!O) return;
      try {
        const directory = await openCliSkillsDirectory(O.platform);
        if (typeof directory === "string" && directory) {
          window.sinitekConfigBridge?.openPath?.(directory);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSkillsError(message || "打开 Skills 目录失败");
      }
    };
    const copyCliSkillTo = async (skill, targetPlatform) => {
      if (!O || !skill) return;
      const sourceKey = `${O.platform}:${O.id}`;
      setPendingSkillName(skill.name);
      try {
        const result = await copyCliSkill(O.platform, skill.name, targetPlatform);
        if (skillsLoadTargetRef.current === sourceKey) applyCliSkillsResult(result);
      } finally {
        setPendingSkillName("");
      }
    };
    const confirmDeleteCliSkill = (skill) => {
      if (!O || !skill) return;
      uk({
        title: `删除 ${skill.name}`,
        content: `只删除该 CLI 全局目录中的这个技能文件夹：${skill.name}`,
        okText: "删除",
        cancelText: "取消",
        onOk: async () => {
          setPendingSkillName(skill.name);
          try {
            const result = await deleteCliSkill(O.platform, skill.name);
            applyCliSkillsResult(result);
            Kt.success(`已删除 ${skill.name}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSkillsError(message || "删除 Skill 失败");
          } finally {
            setPendingSkillName("");
          }
        },
      });
    };
    const _ = (W) => {
        try {
          return (JSON.parse(W), !0);
        } catch {
          return !1;
        }
      },
      M = (W) => {
        try {
          const H = JSON.parse(W);
          return JSON.stringify(H, null, 2);
        } catch {
          throw new Error("JSON格式不正确");
        }
      },
      syncClaudeVisualContent = (W, H = "visual", k = !1) => {
        const L = claudeVisualParseContent(W);
        if (!L.ok) {
          setClaudeVisualError(L.error), k && Kt.error(L.error);
          return !1;
        }
        return (
          s(W),
          setClaudeVisualState(L.state),
          setClaudeVisualError(""),
          setClaudeEditorMode(H),
          !0
        );
      },
      switchClaudeEditorMode = (W) => {
        if (W === claudeEditorMode) return;
        if (W === "visual") {
          syncClaudeVisualContent(l, "visual", !0);
          return;
        }
        if (!claudeVisualState) {
          setClaudeEditorMode("json");
          return;
        }
        const H = claudeVisualSerializeState(claudeVisualState);
        if (!H.ok) {
          setClaudeVisualError(H.error), Kt.error(H.error);
          return;
        }
        s(H.content), setClaudeVisualError(""), setClaudeEditorMode("json");
      },
      syncOpenCodeVisualContent = (W, H = "visual", k = !1) => {
        const L = openCodeVisualParseContent(W);
        if (!L.ok) {
          setOpenCodeVisualError(L.error), k && Kt.error(L.error);
          return !1;
        }
        return (
          s(W),
          setOpenCodeVisualState(L.state),
          setOpenCodeVisualError(""),
          setOpenCodeEditorMode(H),
          !0
        );
      },
      switchOpenCodeEditorMode = (W) => {
        if (W === openCodeEditorMode) return;
        if (W === "visual") {
          syncOpenCodeVisualContent(l, "visual", !0);
          return;
        }
        if (!openCodeVisualState) {
          setOpenCodeEditorMode("json");
          return;
        }
        const H = openCodeVisualSerializeState(openCodeVisualState);
        if (!H.ok) {
          setOpenCodeVisualError(H.error), Kt.error(H.error);
          return;
        }
        s(H.content), setOpenCodeVisualError(""), setOpenCodeEditorMode("json");
      },
      syncCodexVisualContent = (W, H = "visual", k = !1) => {
        const L = codexVisualParseContent(W);
        if (!L.ok) {
          setCodexVisualError(L.error), k && Kt.error(L.error);
          return !1;
        }
        return (
          v(W),
          setCodexVisualState(L.state),
          setCodexVisualError(""),
          setCodexEditorMode(H),
          !0
        );
      },
      switchCodexEditorMode = (W) => {
        if (W === codexEditorMode) return;
        if (W === "visual") {
          syncCodexVisualContent(m, "visual", !0);
          return;
        }
        if (!codexVisualState) {
          setCodexEditorMode("toml");
          return;
        }
        const H = codexVisualSerializeState(codexVisualState);
        if (!H.ok) {
          setCodexVisualError(H.error), Kt.error(H.error);
          return;
        }
        v(H.content), setCodexVisualError(""), setCodexEditorMode("toml");
      },
      syncGrokVisualContent = (W, H = "visual", k = !1) => {
        if (!String(W || "").trim()) {
          setGrokVisualError(GROK_EMPTY_TEXT_ERROR), k && Kt.error(GROK_EMPTY_TEXT_ERROR);
          return !1;
        }
        const L = grokVisualParseContent(W);
        if (!L.ok || L.state.fieldError) {
          const U = L.ok ? L.state.fieldError : L.error;
          setGrokVisualError(U), k && Kt.error(U);
          return !1;
        }
        return (
          setGrokTextDraft(W),
          setGrokValidContent(W),
          setGrokVisualState(L.state),
          setGrokVisualError(""),
          setGrokEditorMode(H),
          !0
        );
      },
      onGrokTextChange = (W) => {
        setGrokTextDraft(W);
        if (!String(W || "").trim()) {
          setGrokVisualError(GROK_EMPTY_TEXT_ERROR);
          return;
        }
        const H = grokVisualParseContent(W);
        if (!H.ok) {
          setGrokVisualError(H.error);
          return;
        }
        setGrokVisualState(H.state);
        if (H.state.fieldError) {
          setGrokVisualError(H.state.fieldError);
          return;
        }
        setGrokValidContent(W), setGrokVisualError("");
      },
      switchGrokEditorMode = (W) => {
        if (W === grokEditorMode) return;
        if (W === "visual") {
          syncGrokVisualContent(grokTextDraft, "visual", !0);
          return;
        }
        if (!grokVisualState || grokVisualState.fieldError) {
          const H = grokVisualState?.fieldError || grokVisualError || "当前 TOML 无法加载到可视化编辑器，请切换到 TOML 源码修复。";
          setGrokVisualError(H), Kt.error(H);
          return;
        }
        const H = grokVisualSerializeState(grokVisualState);
        if (!H.ok || !String(H.content || "").trim()) {
          const k = H.ok ? GROK_EMPTY_TEXT_ERROR : H.error;
          setGrokVisualError(k), Kt.error(k);
          return;
        }
        setGrokTextDraft(H.content), setGrokValidContent(H.content), setGrokVisualError(""), setGrokEditorMode("toml");
      },
      N = (W) => y(W),
      z = () => y(null),
      D = () => {
        if (!(!I || !S)) {
          switch (S) {
            case "claude-settings":
              syncClaudeVisualContent(I.content, "visual", !0);
              break;
		            case "opencode-settings":
			              syncOpenCodeVisualContent(I.content, "visual", !0);
			              break;
            case "codex-config":
              syncCodexVisualContent(ps.codex.config, "visual", !0);
              break;
            case "codex-auth":
              h(I.content);
              break;
            case "grok-config":
              syncGrokVisualContent(I.content, "visual", !0);
              break;
	          case "dsh-config": {
	            const H = readDshUiDocument(I.content);
	            if (!H.ok) {
	              setDshFieldError(H.error);
	              Kt.error("范例导入失败: " + H.error);
	              return;
	            }
	            setDshText(H.content);
	            setDshVisual(H.document);
	            setDshFieldError("");
	            setDshSelectedModelId(H.document.acpModel || H.document.models[0]?.id || "");
	            setDshEditorMode("json");
	            break;
	          }
          }
          (Kt.success("已导入范例内容，请确认后保存"), z());
        }
      },
      B = () =>
        be.jsx(RE, {
          rootClassName: "config-example-drawer",
          title: I?.title || "配置范例",
          width: 560,
          open: !!I,
          onClose: z,
          destroyOnClose: !0,
          children: I
            ? be.jsxs(be.Fragment, {
                children: [
                  be.jsx("div", {
                    style: { marginBottom: 12, textAlign: "right" },
                    children: be.jsx(xn, {
                      type: "primary",
                      onClick: D,
                      children: "一键导入",
                    }),
                  }),
                  be.jsx("pre", {
                    style: {
                      margin: 0,
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background-color-secondary)",
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      lineHeight: 1.6,
                    },
                    children: I.content,
                  }),
                ],
              })
            : null,
        }),
      A = async (W) => {
        if (!O || o(O.platform) !== O.id) return;
        const payload = O.platform === "dsh" ? { ...W, profileId: O.id } : W;
        try {
          await applyConfigItem(O.platform, payload);
          Kt.success("已更新当前激活的配置");
        } catch (k) {
          Kt.error("已保存，但更新激活配置失败: " + k);
        }
      },
      saveClaudeSettingsCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        let W;
        if (claudeEditorMode === "visual") {
          if (!claudeVisualState) {
            const H =
              claudeVisualError || "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复";
            setClaudeVisualError(H), Kt.error(H);
            return;
          }
          const H = claudeVisualSerializeState(claudeVisualState);
          if (!H.ok) {
            setClaudeVisualError(H.error), Kt.error(H.error);
            return;
          }
          W = H.content;
        } else {
          if (!_(l)) {
            Kt.error("JSON格式不正确");
            return;
          }
          W = M(l);
        }
        try {
          await r(O.id, { content: W });
          s(W);
          if (claudeEditorMode === "visual") {
            const H = claudeVisualParseContent(W);
            H.ok && setClaudeVisualState(H.state);
          }
          Kt.success("保存成功");
          await A({ content: W });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      saveOpenCodeSettingsCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        let W;
        if (openCodeEditorMode === "visual") {
          if (!openCodeVisualState) {
            const H =
              openCodeVisualError || "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复";
            setOpenCodeVisualError(H), Kt.error(H);
            return;
          }
          const H = openCodeVisualSerializeState(openCodeVisualState);
          if (!H.ok) {
            setOpenCodeVisualError(H.error), Kt.error(H.error);
            return;
          }
          W = H.content;
        } else {
          if (!_(l)) {
            Kt.error("JSON格式不正确");
            return;
          }
          W = M(l);
        }
        try {
          await openCodeVisualRunSaveFlow({
            content: W,
            saveConfig: async (H) => {
              await r(O.id, { content: H });
              s(H), Kt.success("保存成功");
              if (openCodeEditorMode === "visual") {
                const k = openCodeVisualParseContent(H);
                k.ok && setOpenCodeVisualState(k.state);
              }
            },
            applyActiveConfig: (H) => A({ content: H }),
          });
        } catch (H) {
          Kt.error("保存失败: " + H);
        }
      },
      saveCodexConfigCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        try {
          let W = m;
          if (codexEditorMode === "visual") {
            if (!codexVisualState) {
              const k =
                codexVisualError || "当前 TOML 尚未成功加载到可视化编辑器，请切换到 TOML 源码修复";
              setCodexVisualError(k), Kt.error(k);
              return;
            }
            const k = codexVisualSerializeState(codexVisualState);
            if (!k.ok) {
              setCodexVisualError(k.error), Kt.error(k.error);
              return;
            }
            W = k.content;
          } else {
            const k = codexVisualParseContent(m);
            if (!k.ok) {
              setCodexVisualError(k.error), Kt.error(k.error);
              return;
            }
          }
          if (!_(p)) {
            Kt.error("auth.json格式不正确");
            return;
          }
          const k = M(p);
          await r(O.id, { content: W, configContent: W, authContent: k });
          v(W), h(k);
          const L = codexVisualParseContent(W);
          L.ok && setCodexVisualState(L.state);
          Kt.success("保存成功");
          await A({ configContent: W, authContent: k });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      saveCodexAuthCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        if (!_(p)) {
          Kt.error("auth.json格式不正确");
          return;
        }
        try {
          const W = M(p);
          await r(O.id, { content: m, configContent: m, authContent: W });
          h(W);
          Kt.success("保存成功");
          await A({ configContent: m, authContent: W });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      grokSaveDisabled =
        configListLoading ||
        !String(grokTextDraft || "").trim() ||
        Boolean(grokVisualError) ||
        (grokEditorMode === "visual" && (!grokVisualState || Boolean(grokVisualState.fieldError))),
      saveGrokConfigCard = async () => {
        if (!O || O.platform !== "grok") {
          Kt.warning("请先选择一个配置");
          return;
        }
        if (grokSaveDisabled) return;
        try {
          let W = grokValidContent;
          if (grokEditorMode === "visual") {
            const H = grokVisualSerializeState(grokVisualState);
            if (!H.ok || !String(H.content || "").trim()) {
              const k = H.ok ? GROK_EMPTY_TEXT_ERROR : H.error;
              setGrokVisualError(k), Kt.error(k);
              return;
            }
            W = H.content;
          } else if (!String(grokTextDraft || "").trim() || grokTextDraft !== grokValidContent) {
            setGrokVisualError(grokVisualError || GROK_EMPTY_TEXT_ERROR);
            return;
          }
          await r(O.id, { content: W, configContent: W });
          setGrokTextDraft(W), setGrokValidContent(W);
          const H = grokVisualParseContent(W);
          H.ok && !H.state.fieldError && setGrokVisualState(H.state);
          Kt.success("保存成功");
          await A({ content: W, configContent: W });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      switchDshEditorMode = (nextMode) => {
        if (dshBusy || configListLoading || nextMode === dshEditorMode) return;
        const switched = dshUiSwitchMode({
          mode: dshEditorMode,
          nextMode,
          text: dshText,
          document: dshVisual,
        });
        if (!switched.ok) {
          setDshFieldError(switched.error);
          Kt.error(switched.error);
          return;
        }
        setDshEditorMode(switched.mode);
        setDshText(switched.text);
        setDshVisual(switched.document);
        setDshFieldError("");
      },
      saveDshConfigCard = async () => {
        if (!O || O.platform !== "dsh") {
          Kt.warning("请先选择一个配置");
          return;
        }
        if (dshBusy || configListLoading) return;
        const source = dshEditorMode === "json" ? dshText : dshUiSerializeRaw(dshVisual || {});
        if (dshUiContainsProfileSecret(source)) {
          setDshFieldError(DSH_UI_SECRET_ERROR);
          Kt.error(DSH_UI_SECRET_ERROR);
          return;
        }
        const parsed = readDshUiDocument(dshEditorMode === "json" ? dshText : dshUiSerializeRaw(dshVisual || {}));
        if (!parsed.ok) {
          setDshFieldError(parsed.error);
          Kt.error(parsed.error);
          return;
        }
        const content = parsed.content;
        setDshBusy(!0);
        try {
          await r(O.id, { content, configContent: content });
          setDshVisual(parsed.document);
          setDshText(content);
          setDshFieldError("");
          Kt.success("保存成功");
          await A({ content, configContent: content });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const safeMessage = dshUiContainsSecret(message) ? DSH_UI_SECRET_ERROR : message;
          setDshFieldError(safeMessage);
          Kt.error("保存失败: " + safeMessage);
        } finally {
          setDshBusy(!1);
        }
      };
    const configAppUsesChinese =
        typeof navigator === "undefined" ||
        !navigator.language ||
        navigator.language.toLowerCase().startsWith("zh"),
      claudeText = (W, H) => (configAppUsesChinese ? W : H),
      configFieldHelpMap = Object.freeze({
        "默认模型 model": "会话默认模型，可填写 sonnet、opus、haiku 或供应商模型 ID。",
        "Default model": "Default session model; use sonnet, opus, haiku, or a provider model ID.",
        "推理强度 effortLevel": "控制 Claude Code 的推理预算。",
        "Effort level": "Controls the Claude Code reasoning budget.",
        "回退模型 fallbackModel": "主模型不可用时按顺序尝试的回退模型，每行一个，最多 3 个。",
        "Fallback models": "Fallback models tried in order when the primary model is unavailable; one per line, up to 3.",
        "可选模型 availableModels": "限制 UI 或命令中可选择的模型范围，每行一个别名或完整模型名。",
        "Available models": "Restricts selectable models in UI or commands; one alias or full model name per line.",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "将 Claude Haiku 档映射到第三方供应商的实际模型名。",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "将 Claude Sonnet 档映射到第三方供应商的实际模型名。",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "将 Claude Opus 档映射到第三方供应商的实际模型名。",
        CLAUDE_CODE_SUBAGENT_MODEL: "设置 Claude Code 子代理使用的模型名称。",
        ANTHROPIC_BASE_URL: "Anthropic 或兼容网关的 API Base URL。",
        ANTHROPIC_API_KEY: "Anthropic 官方 API Key，敏感值仅保存在本机配置。",
        ANTHROPIC_AUTH_TOKEN: "第三方网关 Bearer Token，敏感值仅保存在本机配置。",
        "界面语言 language": "设置 Claude Code 界面或输出偏好的语言。",
        Language: "Sets the preferred language for Claude Code UI or output.",
        "输出风格 outputStyle": "设置 Claude Code 默认输出风格名称。",
        "Output style": "Sets the default Claude Code output style name.",
        自动更新通道: "选择 Claude Code 自动更新通道。",
        "Auto-update channel": "Selects the Claude Code auto-update channel.",
        会话保留天数: "会话清理保留天数，需为大于等于 1 的整数。",
        "Session retention days": "Session cleanup retention in days; must be an integer of at least 1.",
        默认启用扩展思考: "是否默认启用扩展思考。",
        "Extended thinking by default": "Whether extended thinking is enabled by default.",
        "自动压缩 autoCompactEnabled": "是否自动压缩上下文。",
        "Automatic compaction": "Whether to compact context automatically.",
        "自动记忆 autoMemoryEnabled": "是否自动保存和使用 Claude Code 记忆。",
        "Automatic memory": "Whether Claude Code memory is saved and used automatically.",
        "文件检查点 fileCheckpointingEnabled": "是否启用文件检查点与回滚工作流。",
        "File checkpointing": "Whether file checkpoints and rollback workflows are enabled.",
        "编辑模式 editorMode": "选择 normal 或 vim 编辑模式。",
        "Editor mode": "Selects normal or vim editing behavior.",
        "视图模式 viewMode": "选择 default、verbose 或 focus 视图模式。",
        "View mode": "Selects the default, verbose, or focus view mode.",
        "终端界面 tui": "选择 default 或 fullscreen 终端界面模式。",
        "Terminal UI mode": "Selects the default or fullscreen terminal UI mode.",
        "详细输出 verbose": "是否启用详细 CLI 输出。",
        "Verbose output": "Whether verbose CLI output is enabled.",
        默认权限模式: "Claude Code 默认权限模式。bypassPermissions 会跳过权限确认，仅应在受控可信环境中使用。",
        "Default permission mode": "Default Claude Code permission mode. bypassPermissions skips permission prompts and should only be used in controlled, trusted environments.",
        allow: "始终允许的工具规则，每行一个 Tool 或 Tool(specifier)。",
        ask: "需要确认的工具规则，每行一个 Tool 或 Tool(specifier)。",
        deny: "始终拒绝的工具规则，每行一个 Tool 或 Tool(specifier)。",
        "Provider id": "Provider 唯一标识，会被模型引用使用。",
        名称: "Provider 展示名称，用于配置页列表识别。",
        npm: "OpenCode 加载的 provider npm 包名；可从建议中选择或输入任意包名。",
        "Base URL": "兼容 OpenAI 协议的网关地址，可使用 {env:VAR} 引用环境变量。",
        "API Key": "Provider API Key，可使用 {env:VAR} 引用环境变量。",
        "模型 id": "Provider 下的模型唯一标识，会拼成 provider/model 引用。",
        模型名称: "模型在配置页中显示的人类可读名称。",
        "上下文大小 limit.context": "OpenCode 模型最大上下文 token 数，写入 provider.models.<id>.limit.context；留空表示保留官方默认值。",
        "Context size limit.context": "Maximum OpenCode model context tokens, saved to provider.models.<id>.limit.context; leave blank to keep the provider default.",
        "主模型 model": "OpenCode 主模型引用；写入官方 model 字段，作为底层 CLI 兼容字段保存。",
        "Main model": "OpenCode main model reference; saved to the official model field as a lower-level CLI compatibility field.",
        "子模型 small_model": "OpenCode 子模型引用；写入官方 small_model 字段，作为底层 CLI 兼容字段保存。",
        "Subtask model": "OpenCode subtask model reference; saved to the official small_model field as a lower-level CLI compatibility field.",
        "共享设置 share": "控制会话分享模式。",
        "Sharing mode": "Controls the session sharing mode.",
        "自动更新 autoupdate": "控制自动更新：开启、通知或关闭。",
        "Auto-update": "Controls auto-updates: enabled, notify, or disabled.",
        "日志级别 logLevel": "OpenCode CLI 日志级别。",
        "Log level": "OpenCode CLI logging level.",
        "快照 snapshot": "是否启用快照。未设置时继承 CLI 默认值。",
        "Snapshot": "Whether snapshots are enabled. When unset, the CLI default applies.",
        model: "Codex CLI 默认模型名称。",
        model_provider: "Codex 使用的默认模型供应商。",
        approval_policy: "控制命令执行前的审批策略。复杂 granular table 仅在 TOML 源码中保留。",
        sandbox_mode: "控制 Codex CLI 文件系统沙箱范围。",
        model_reasoning_effort: "控制模型推理强度。",
        model_reasoning_summary: "控制推理摘要展示方式。",
        model_verbosity: "控制模型输出详略程度；仅适用于支持该能力的模型与 Responses 模式。",
        developer_instructions: "为 Codex 追加 developer instructions；多行内容会按 TOML 字符串往返保存。",
        web_search: "选择 web_search mode。旧 boolean 或复杂值会保留在 TOML，直到明确迁移。",
        disable_response_storage: "是否禁用响应存储。",
        hide_agent_reasoning: "是否隐藏 agent reasoning。",
        model_supports_reasoning_summaries: "声明当前模型是否支持 reasoning summaries。",
        name: "Provider 展示名称。",
        base_url: "Provider API Base URL。",
        wire_api: "Provider 使用的 wire API。新配置仅提供 responses；旧值会保留直到明确迁移。",
        requires_openai_auth: "Provider 是否需要 OpenAI auth。",
        OPENAI_API_KEY: "OpenAI 或兼容服务 API Key。",
        OPENAI_BASE_URL: "通过环境变量覆盖 OpenAI Base URL。",
        OPENAI_ORG_ID: "OpenAI organization id。",
        OPENAI_ORGANIZATION: "OpenAI organization 名称或兼容变量。",
      }),
      getConfigLabelText = (W) => (typeof W === "string" ? W : String(W || "")),
      getConfigFieldHelp = (W, H) =>
        H || configFieldHelpMap[getConfigLabelText(W)] || `${getConfigLabelText(W)} 配置项。`,
      stripConfigHelpOption = (W = {}) => {
        const { help: H, ...k } = W;
        return k;
      },
      showConfigFieldHelpTooltip = (W) => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
        configFieldHelpTooltipTimerRef.current = setTimeout(() => {
          setConfigFieldHelpTooltipKey(W);
        }, CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS);
      },
      hideConfigFieldHelpTooltip = () => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
        configFieldHelpTooltipTimerRef.current = null;
        setConfigFieldHelpTooltipKey("");
      },
      renderConfigFieldLabel = (W, H) =>
        be.jsxs("span", {
          style: {
            color: "var(--text-color-secondary)",
            fontSize: "12px",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            minWidth: 0,
          },
          children: [
            be.jsx("span", { children: W }),
            getConfigFieldHelp(W, H)
              ? be.jsxs("span", {
                  style: { position: "relative", display: "inline-flex", flex: "0 0 auto" },
                  children: [
                    be.jsx("span", {
                      title: getConfigFieldHelp(W, H),
                      "aria-label": getConfigFieldHelp(W, H),
                      role: "img",
                      onMouseEnter: () => showConfigFieldHelpTooltip(getConfigLabelText(W)),
                      onMouseLeave: hideConfigFieldHelpTooltip,
                      onFocus: () => showConfigFieldHelpTooltip(getConfigLabelText(W)),
                      onBlur: hideConfigFieldHelpTooltip,
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "14px",
                        height: "14px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "50%",
                        color: "var(--text-color-secondary)",
                        background: "var(--background-color)",
                        fontSize: "10px",
                        lineHeight: 1,
                        cursor: "help",
                        flex: "0 0 auto",
                      },
                      children: "?",
                    }),
                    configFieldHelpTooltipKey === getConfigLabelText(W)
                      ? be.jsx("span", {
                          role: "tooltip",
                          style: {
                            position: "absolute",
                            left: "50%",
                            bottom: "calc(100% + 6px)",
                            transform: "translateX(-50%)",
                            zIndex: 20,
                            width: "max-content",
                            maxWidth: "260px",
                            padding: "5px 7px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            background: "var(--background-color)",
                            color: "var(--text-color)",
                            boxShadow: "0 4px 14px var(--shadow-color)",
                            fontSize: "12px",
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                            pointerEvents: "none",
                          },
                          children: getConfigFieldHelp(W, H),
                        })
                      : null,
                  ],
                })
              : null,
          ],
        }),
      formatConfigEnumHelp = (W, H) => `${W}${W ? " " : ""}可选值：${H.join(" / ")}`,
      insertLegacyMaxCompatibilityOption = (options, selectedValue, compatibilityOption) => {
        if (selectedValue !== "max") return [...options, compatibilityOption];
        const ultraIndex = options.findIndex((option) => option.value === "ultra");
        return ultraIndex === -1
          ? [...options, compatibilityOption]
          : [
              ...options.slice(0, ultraIndex),
              compatibilityOption,
              ...options.slice(ultraIndex),
            ];
      },
      renderConfigSelect = (W, H, k, L, U = {}) => {
        const T = Array.isArray(L) ? L : [],
          value = H || "";
        return be.jsxs("label", {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 3,
            minWidth: 0,
            ...(U.fullWidth ? { width: "100%", gridColumn: "1 / -1" } : {}),
          },
          children: [
            renderConfigFieldLabel(
              W,
              formatConfigEnumHelp(getConfigFieldHelp(W, U.help), T.map((Z) => Z.value || Z.label)),
            ),
            be.jsx($l, {
              value: value || void 0,
              disabled: U.disabled === true,
              onChange: (Z) => k(Z || ""),
              onSearch: U.allowCustomValue ? (Z) => k(Z || "") : void 0,
              mode: U.allowCustomValue ? $l.SECRET_COMBOBOX_MODE_DO_NOT_USE : void 0,
              options: T,
              allowClear: !0,
              showSearch: !0,
              optionFilterProp: "label",
              placeholder: U.placeholder,
              className: U.className,
              getPopupContainer: (Z) => Z.parentElement || document.body,
              style: { width: "100%" },
              "aria-label": getConfigLabelText(W),
            }),
          ],
        });
      },
      updateClaudeVisualState = (W) =>
        setClaudeVisualState((H) => (H ? claudeVisualUpdateState(H, W) : H)),
      updateClaudeVisualEnv = (W, H) =>
        setClaudeVisualState((k) => (k ? claudeVisualUpdateEnv(k, W, H) : k)),
      updateClaudeVisualPermissions = (W) =>
        setClaudeVisualState((H) => (H ? claudeVisualUpdatePermissions(H, W) : H)),
      renderClaudeField = (W, H, k, L = "", U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(zi, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              type: U.type || "text",
              min: U.min,
              step: U.step,
            }),
          ],
        }),
      renderClaudeSelect = (W, H, k, L, U = {}) => {
        const T = L.some((Z) => Z.value === H)
          ? L
          : H
            ? insertLegacyMaxCompatibilityOption(L, H, {
                value: H,
                label: claudeVisualIsCompatibilityValue(H)
                  ? claudeText("当前旧值（仅保留 JSON 源码）", "Legacy value (preserved in JSON)")
                  : H,
              })
            : L;
        return renderConfigSelect(W, H, k, T, U);
      },
      renderClaudeListField = (W, H, k, L, U = 3, T = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, T.help),
            be.jsx(Qa, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              rows: U,
              style: { fontFamily: "monospace", fontSize: "12px", resize: "vertical" },
            }),
          ],
        }),
      renderClaudeSection = (W, H, k) =>
        be.jsxs("section", {
          style: {
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "6px",
          },
          children: [
            be.jsx("div", { style: { fontWeight: 600, marginBottom: "2px" }, children: W }),
            H
              ? be.jsx("div", {
                  style: {
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                  },
                  children: H,
                })
              : null,
            k,
          ],
        }),
      renderClaudeVisualEditor = () => {
        if (!claudeVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children:
              claudeVisualError ||
              claudeText(
                "当前 JSON 无法加载到可视化编辑器，请切换到 JSON 模式修复。",
                "The current JSON cannot be loaded visually. Switch to JSON mode to fix it.",
              ),
          });
        const booleanOptions = [
            { value: "", label: claudeText("跟随默认", "Use default") },
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ],
          gridStyle = {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            gap: "5px",
          };
        return be.jsxs("div", {
          style: { display: "flex", flexDirection: "column", gap: "6px" },
          children: [
            be.jsx("div", {
              style: {
                padding: "7px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-color-secondary)",
                fontSize: "12px",
                lineHeight: 1.5,
              },
              children: claudeText(
                "依据 Claude Code 官方 settings.json 格式编辑常用核心字段；未展示字段、额外 env、hooks 与企业策略会原样保留。",
                "Edit common fields from the official Claude Code settings.json format. Hidden fields, extra env entries, hooks, and enterprise policies are preserved.",
              ),
            }),
            renderClaudeSection(
              claudeText("模型与推理", "Models and reasoning"),
              claudeText(
                "model 是会话默认模型；fallbackModel 最多三个；availableModels 限制可选择模型。",
                "model sets the session default; fallbackModel supports up to three entries; availableModels restricts selection.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    claudeText("默认模型 model", "Default model"),
                    claudeVisualState.model,
                    (W) => updateClaudeVisualState({ model: W }),
                    "sonnet / opus / haiku / vendor-model-id",
                  ),
                  renderClaudeSelect(
                    claudeText("推理强度 effortLevel", "Effort level"),
                    claudeVisualState.effortLevel,
                    (W) => updateClaudeVisualState({ effortLevel: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      ...["low", "medium", "high", "xhigh", "ultra"].map((W) => ({ value: W, label: W })),
                    ],
                  ),
                  renderClaudeListField(
                    claudeText("回退模型 fallbackModel", "Fallback models"),
                    claudeVisualState.fallbackModels,
                    (W) => updateClaudeVisualState({ fallbackModels: W }),
                    claudeText("每行一个，最多 3 个", "One per line, up to 3"),
                  ),
                  renderClaudeListField(
                    claudeText("可选模型 availableModels", "Available models"),
                    claudeVisualState.availableModels,
                    (W) => updateClaudeVisualState({ availableModels: W }),
                    claudeText("每行一个模型别名或完整名称", "One alias or full model name per line"),
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("模型映射", "Model mapping"),
              claudeText(
                "为 Haiku、Sonnet、Opus 档及 Claude Code 子代理分别指定模型名称。",
                "Set model names for Haiku, Sonnet, and Opus tiers, and Claude Code subagents.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_HAIKU_MODEL", W),
                    "provider-haiku-model",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_SONNET_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_SONNET_MODEL", W),
                    "provider-sonnet-model",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_OPUS_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_OPUS_MODEL", W),
                    "provider-opus-model",
                  ),
                  renderClaudeField(
                    "CLAUDE_CODE_SUBAGENT_MODEL",
                    claudeVisualState.env.CLAUDE_CODE_SUBAGENT_MODEL,
                    (W) => updateClaudeVisualEnv("CLAUDE_CODE_SUBAGENT_MODEL", W),
                    "provider-subagent-model",
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("API 与网关", "API and gateway"),
              claudeText(
                "按供应商要求选择 API Key 或 Auth Token；敏感值仍保存在本机配置文件。",
                "Use API Key or Auth Token as required by your provider. Secrets remain in the local settings file.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    "ANTHROPIC_BASE_URL",
                    claudeVisualState.env.ANTHROPIC_BASE_URL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_BASE_URL", W),
                    "https://api.example.com",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_API_KEY",
                    claudeVisualState.env.ANTHROPIC_API_KEY,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_API_KEY", W),
                    claudeText("官方 API Key", "Anthropic API key"),
                    { type: "password" },
                  ),
                  renderClaudeField(
                    "ANTHROPIC_AUTH_TOKEN",
                    claudeVisualState.env.ANTHROPIC_AUTH_TOKEN,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_AUTH_TOKEN", W),
                    claudeText("网关 Bearer Token", "Gateway bearer token"),
                    { type: "password" },
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("常用行为", "Common behavior"),
              "",
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    claudeText("界面语言 language", "Language"),
                    claudeVisualState.language,
                    (W) => updateClaudeVisualState({ language: W }),
                    "zh-CN / English",
                  ),
                  renderClaudeField(
                    claudeText("输出风格 outputStyle", "Output style"),
                    claudeVisualState.outputStyle,
                    (W) => updateClaudeVisualState({ outputStyle: W }),
                    "Explanatory",
                  ),
                  renderClaudeSelect(
                    claudeText("自动更新通道", "Auto-update channel"),
                    claudeVisualState.autoUpdatesChannel,
                    (W) => updateClaudeVisualState({ autoUpdatesChannel: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      { value: "stable", label: "stable" },
                      { value: "latest", label: "latest" },
                    ],
                  ),
                  renderClaudeField(
                    claudeText("会话保留天数", "Session retention days"),
                    claudeVisualState.cleanupPeriodDays,
                    (W) => updateClaudeVisualState({ cleanupPeriodDays: W }),
                    "30",
                    { type: "number", min: 1, step: 1 },
                  ),
                  renderClaudeSelect(
                    claudeText("默认启用扩展思考", "Extended thinking by default"),
                    claudeVisualState.alwaysThinkingEnabled,
                    (W) => updateClaudeVisualState({ alwaysThinkingEnabled: W }),
                    booleanOptions,
                  ),
                  renderClaudeSelect(
                    claudeText("自动压缩 autoCompactEnabled", "Automatic compaction"),
                    claudeVisualState.autoCompactEnabled,
                    (W) => updateClaudeVisualState({ autoCompactEnabled: W }),
                    booleanOptions,
                  ),
                  renderClaudeSelect(
                    claudeText("自动记忆 autoMemoryEnabled", "Automatic memory"),
                    claudeVisualState.autoMemoryEnabled,
                    (W) => updateClaudeVisualState({ autoMemoryEnabled: W }),
                    booleanOptions,
                  ),
                  renderClaudeSelect(
                    claudeText("文件检查点 fileCheckpointingEnabled", "File checkpointing"),
                    claudeVisualState.fileCheckpointingEnabled,
                    (W) => updateClaudeVisualState({ fileCheckpointingEnabled: W }),
                    booleanOptions,
                  ),
                  renderClaudeSelect(
                    claudeText("编辑模式 editorMode", "Editor mode"),
                    claudeVisualState.editorMode,
                    (W) => updateClaudeVisualState({ editorMode: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      { value: "normal", label: "normal" },
                      { value: "vim", label: "vim" },
                    ],
                  ),
                  renderClaudeSelect(
                    claudeText("视图模式 viewMode", "View mode"),
                    claudeVisualState.viewMode,
                    (W) => updateClaudeVisualState({ viewMode: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      ...["default", "verbose", "focus"].map((W) => ({ value: W, label: W })),
                    ],
                  ),
                  renderClaudeSelect(
                    claudeText("终端界面 tui", "Terminal UI mode"),
                    claudeVisualState.tui,
                    (W) => updateClaudeVisualState({ tui: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      { value: "default", label: "default" },
                      { value: "fullscreen", label: "fullscreen" },
                    ],
                  ),
                  renderClaudeSelect(
                    claudeText("详细输出 verbose", "Verbose output"),
                    claudeVisualState.verbose,
                    (W) => updateClaudeVisualState({ verbose: W }),
                    booleanOptions,
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("权限规则", "Permission rules"),
              claudeText(
                "规则每行一个；支持 Claude Code 的 Tool 或 Tool(specifier) 语法。",
                "Enter one rule per line using Claude Code Tool or Tool(specifier) syntax.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeSelect(
                    claudeText("默认权限模式", "Default permission mode"),
                    claudeVisualState.permissions.defaultMode,
                    (W) => updateClaudeVisualPermissions({ defaultMode: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      ...["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"].map((W) => ({
                        value: W,
                        label: W,
                      })),
                    ],
                    {
                      help: claudeText(
                        "bypassPermissions 会跳过权限确认，仅应在受控且可信的环境中使用。",
                        "bypassPermissions skips permission prompts; use it only in controlled, trusted environments.",
                      ),
                    },
                  ),
                  renderClaudeListField(
                    "allow",
                    claudeVisualState.permissions.allow,
                    (W) => updateClaudeVisualPermissions({ allow: W }),
                    "Read\nEdit",
                  ),
                  renderClaudeListField(
                    "ask",
                    claudeVisualState.permissions.ask,
                    (W) => updateClaudeVisualPermissions({ ask: W }),
                    "Bash(git push:*)",
                  ),
                  renderClaudeListField(
                    "deny",
                    claudeVisualState.permissions.deny,
                    (W) => updateClaudeVisualPermissions({ deny: W }),
                    "Read(./.env)\nBash(rm:*)",
                  ),
                ],
              }),
            ),
          ],
        });
      },
      selectedOpenCodeProvider = openCodeVisualState?.providers.find(
        (W) => W.id === openCodeVisualState.selectedProviderId,
      ),
      selectedOpenCodeModel = selectedOpenCodeProvider?.models.find(
        (W) => W.id === openCodeVisualState.selectedModelId,
      ),
      selectOpenCodeProvider = (W) => {
        setOpenCodeVisualState((H) => {
          if (!H) return H;
          const k = H.providers.find((L) => L.id === W);
          return { ...H, selectedProviderId: W, selectedModelId: k?.models[0]?.id || "" };
        });
      },
      updateSelectedOpenCodeProvider = (W) => {
        selectedOpenCodeProvider &&
          setOpenCodeVisualState((H) =>
            H ? openCodeVisualUpdateProvider(H, selectedOpenCodeProvider.id, W) : H,
          );
      },
      updateSelectedOpenCodeModel = (W) => {
        selectedOpenCodeProvider &&
          selectedOpenCodeModel &&
          setOpenCodeVisualState((H) =>
            H
              ? openCodeVisualUpdateModel(
                  H,
                  selectedOpenCodeProvider.id,
                  selectedOpenCodeModel.id,
                  W,
                )
              : H,
          );
      },
      confirmDeleteOpenCodeProvider = (provider = selectedOpenCodeProvider) => {
        if (!provider) return;
        xr.confirm({
          title: "删除 Provider",
          content: `确定删除 ${provider.name || provider.id} 及其全部模型吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setOpenCodeVisualState((W) =>
              W ? openCodeVisualDeleteProvider(W, provider.id) : W,
            ),
        });
      },
      confirmDeleteOpenCodeModel = (provider = selectedOpenCodeProvider, model = selectedOpenCodeModel) => {
        if (!provider || !model) return;
        xr.confirm({
          title: "删除模型",
          content: `确定删除 ${model.name || model.id} 吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setOpenCodeVisualState((W) =>
              W ? openCodeVisualDeleteModel(W, provider.id, model.id) : W,
            ),
        });
      },
      renderOpenCodeField = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(zi, {
              value: H,
              onChange: (T) => k(T.target.value),
              placeholder: L,
              ...stripConfigHelpOption(U),
            }),
          ],
        }),
      renderOpenCodeSelect = (W, H, k, L, U = {}) => {
        const T = L.some((Z) => Z.value === H)
          ? L
          : H
            ? [
                ...L,
                {
                  value: H,
                  label: openCodeVisualIsCompatibilityValue(H)
                    ? claudeText("当前旧值（仅保留 JSON 源码）", "Legacy value (preserved in JSON)")
                    : H,
                },
              ]
            : L;
        return renderConfigSelect(W, H, k, T, U);
      },
      renderOpenCodeVisualEditor = () => {
        if (!openCodeVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children: openCodeVisualError || "当前 JSON 无法加载到可视化编辑器",
          });
        const W = selectedOpenCodeProvider,
          H = selectedOpenCodeModel,
          k = openCodeVisualModelSuggestions(openCodeVisualState);
        return be.jsxs("div", {
          style: {
            display: "flex",
            gap: "6px",
            alignItems: "stretch",
            flexWrap: "wrap",
            minHeight: 420,
          },
          children: [
            be.jsxs("section", {
              style: {
                flex: "1 1 100%",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "6px",
              },
              children: [
                be.jsx("div", {
                  style: { fontWeight: 600, marginBottom: "2px" },
                  children: claudeText("运行与模型", "Runtime and models"),
                }),
                be.jsx("div", {
                  style: {
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                  },
                  children: claudeText(
                    "主模型候选仅来自当前配置；OpenCode 的 small_model 仅作为运行时兼容字段保留。",
                    "Main model suggestions come only from this config. OpenCode small_model is retained only for runtime compatibility.",
                  ),
                }),
                be.jsxs("div", {
                  style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
                    gap: "5px",
                  },
                  children: [
                    renderOpenCodeSelect(
                      claudeText("主模型 model", "Main model"),
                      openCodeVisualState.primaryModel,
                      (L) => setOpenCodeVisualState((U) => (U ? { ...U, primaryModel: L } : U)),
                      k.map((L) => ({ value: L, label: L })),
                      { placeholder: "provider/model", fullWidth: !0 },
                    ),
                    renderOpenCodeSelect(
                      claudeText("共享设置 share", "Sharing mode"),
                      openCodeVisualState.share,
                      (L) => setOpenCodeVisualState((U) => (U ? { ...U, share: L } : U)),
                      [
                        { value: "", label: claudeText("跟随默认", "Use default") },
                        ...["manual", "auto", "disabled"].map((L) => ({ value: L, label: L })),
                      ],
                    ),
                    renderOpenCodeSelect(
                      claudeText("自动更新 autoupdate", "Auto-update"),
                      openCodeVisualState.autoupdate,
                      (L) => setOpenCodeVisualState((U) => (U ? { ...U, autoupdate: L } : U)),
                      [
                        { value: "", label: claudeText("跟随默认", "Use default") },
                        { value: "true", label: claudeText("开启", "Enabled") },
                        { value: "notify", label: "notify" },
                        { value: "false", label: claudeText("禁用", "Disabled") },
                      ],
                    ),
                    renderOpenCodeSelect(
                      claudeText("日志级别 logLevel", "Log level"),
                      openCodeVisualState.logLevel,
                      (L) => setOpenCodeVisualState((U) => (U ? { ...U, logLevel: L } : U)),
                      [
                        { value: "", label: claudeText("跟随默认", "Use default") },
                        ...["DEBUG", "INFO", "WARN", "ERROR"].map((L) => ({ value: L, label: L })),
                      ],
                    ),
                    renderOpenCodeSelect(
                      claudeText("快照 snapshot", "Snapshot"),
                      openCodeVisualState.snapshot,
                      (L) => setOpenCodeVisualState((U) => (U ? { ...U, snapshot: L } : U)),
                      [
                        { value: "", label: claudeText("跟随默认", "Use default") },
                        { value: "true", label: "true" },
                        { value: "false", label: "false" },
                      ],
                    ),
                  ],
                }),
              ],
            }),
            be.jsxs("div", {
              style: {
                width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "5px",
              },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    be.jsx("strong", { children: "Provider" }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () =>
                        setOpenCodeVisualState((L) =>
                          L ? openCodeVisualAddProvider(L) : openCodeVisualCreateState({}),
                        ),
                      children: "新增",
                    }),
                  ],
                }),
                openCodeVisualState.providers.length > 0
                  ? openCodeVisualState.providers.map((L) =>
                      be.jsxs("div", {
                        style: { display: "flex", alignItems: "center", gap: "2px", minWidth: 0 },
                        children: [
                          be.jsx(xn, {
                            type: L.id === openCodeVisualState.selectedProviderId ? "primary" : "default",
                            onClick: () => selectOpenCodeProvider(L.id),
                            title: L.name || L.id,
                            style: { flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden" },
                            children: L.name || L.id,
                          }),
                          be.jsx(xn, {
                            type: "text",
                            size: "small",
                            danger: !0,
                            icon: be.jsx(AH, {}),
                            style: { flex: "0 0 24px", width: 24, padding: 0 },
                            "data-opencode-delete-provider-id": L.id,
                            "aria-label": `删除 Provider ${L.name || L.id}`,
                            title: `删除 Provider ${L.name || L.id}`,
                            onClick: (event) => {
                              event.stopPropagation();
                              confirmDeleteOpenCodeProvider(L);
                            },
                          }),
                        ],
                      }, L.id),
                    )
                  : be.jsx("div", {
                      style: {
                        padding: "10px 2px",
                        textAlign: "center",
                        color: "var(--text-color-secondary)",
                      },
                      children: "暂无 Provider，请新增",
                    }),
              ],
            }),
            be.jsxs("div", {
              style: {
                flex: "1 1 420px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              },
              children: W
                ? [
                    be.jsxs("div", {
                      style: {
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "6px",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "4px",
                            marginBottom: "5px",
                          },
                          children: [
                            be.jsx("strong", { children: "Provider 配置" }),
                            be.jsx(xn, {
                              size: "small",
                              danger: !0,
                              onClick: () => confirmDeleteOpenCodeProvider(),
                              children: "删除 Provider",
                            }),
                          ],
                        }),
                        be.jsxs("div", {
                          style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
                            gap: "5px",
                          },
                          children: [
                            renderOpenCodeField("Provider id", W.id, (L) => updateSelectedOpenCodeProvider({ id: L }), "例如 myAPI"),
                            renderOpenCodeField("名称", W.name, (L) => updateSelectedOpenCodeProvider({ name: L }), "Provider 名称"),
                            renderOpenCodeSelect(
                              "npm",
                              W.npm,
                              (L) => updateSelectedOpenCodeProvider({ npm: L }),
                              openCodeVisualNpmSuggestions(openCodeVisualState).map((L) => ({ value: L, label: L })),
                              {
                                allowCustomValue: !0,
                                placeholder: claudeText("选择 Provider npm 包", "Select a provider npm package"),
                              },
                            ),
                            renderOpenCodeField("Base URL", W.baseURL, (L) => updateSelectedOpenCodeProvider({ baseURL: L }), "例如 {env:MY_API_BASE_URL}"),
                            renderOpenCodeField("API Key", W.apiKey, (L) => updateSelectedOpenCodeProvider({ apiKey: L }), "例如 {env:MY_API_KEY}", { type: "password" }),
                          ],
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      style: {
                        display: "flex",
                        gap: "6px",
                        flexWrap: "wrap",
                        flex: 1,
                        minHeight: 260,
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                            minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                            maxWidth: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "5px",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                              children: [
                                be.jsx("strong", { children: "模型" }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () =>
                                    setOpenCodeVisualState((L) =>
                                      L ? openCodeVisualAddModel(L, W.id) : L,
                                    ),
                                  children: "新增",
                                }),
                              ],
                            }),
                            W.models.length > 0
                              ? W.models.map((L) =>
                                  be.jsxs("div", {
                                    style: { display: "flex", alignItems: "center", gap: "2px", minWidth: 0 },
                                    children: [
                                      be.jsx(xn, {
                                        type: L.id === openCodeVisualState.selectedModelId ? "primary" : "default",
                                        onClick: () =>
                                          setOpenCodeVisualState((U) =>
                                            U ? { ...U, selectedModelId: L.id } : U,
                                          ),
                                        title: L.id,
                                        style: { flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden" },
                                        children: L.name || L.id,
                                      }),
                                      be.jsx(xn, {
                                        type: "text",
                                        size: "small",
                                        danger: !0,
                                        icon: be.jsx(AH, {}),
                                        style: { flex: "0 0 24px", width: 24, padding: 0 },
                                        "data-opencode-delete-model-id": L.id,
                                        "aria-label": `删除模型 ${L.name || L.id}`,
                                        title: `删除模型 ${L.name || L.id}`,
                                        onClick: (event) => {
                                          event.stopPropagation();
                                          confirmDeleteOpenCodeModel(W, L);
                                        },
                                      }),
                                    ],
                                  }, L.id),
                                )
                              : be.jsx("div", {
                                  style: {
                                    padding: "10px 2px",
                                    textAlign: "center",
                                    color: "var(--text-color-secondary)",
                                  },
                                  children: "暂无模型，请新增",
                                }),
                          ],
                        }),
                        be.jsxs("div", {
                          style: {
                            flex: "1 1 360px",
                            minWidth: 0,
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "6px",
                          },
                          children: H
                            ? [
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    gap: "4px",
                                    marginBottom: "5px",
                                  },
                                  children: [
                                    be.jsx("strong", { children: H.name || H.id }),
                                    be.jsx(xn, {
                                      size: "small",
                                      danger: !0,
                                      onClick: () => confirmDeleteOpenCodeModel(),
                                      children: "删除模型",
                                    }),
                                  ],
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
                                    gap: "5px",
                                  },
                                  children: [
                                    renderOpenCodeField("模型 id", H.id, (L) => updateSelectedOpenCodeModel({ id: L }), "模型标识"),
                                    renderOpenCodeField("模型名称", H.name, (L) => updateSelectedOpenCodeModel({ name: L }), "列表中显示的名称"),
                                    renderOpenCodeField(
                                      claudeText("上下文大小 limit.context", "Context size limit.context"),
                                      H.context,
                                      (L) => updateSelectedOpenCodeModel({ context: L }),
                                      "例如 128000",
                                      {
                                        type: "number",
                                        min: 0,
                                        step: 1,
                                        help: claudeText(
                                          "OpenCode 模型可接受的最大上下文 token 数；写入 provider.models.<id>.limit.context。留空表示不覆盖官方默认值。",
                                          "Maximum context tokens accepted by the OpenCode model; saved to provider.models.<id>.limit.context. Leave blank to keep the provider default.",
                                        ),
                                      },
                                    ),
                                  ],
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "8px",
                                    marginTop: "14px",
                                  },
                                  children: [
                                    be.jsxs("label", {
                                      style: { display: "inline-flex", alignItems: "center", gap: 3 },
                                      children: [
                                        be.jsx("input", {
                                          type: "checkbox",
                                          checked: H.reasoning,
                                          onChange: (L) => updateSelectedOpenCodeModel({ reasoning: L.target.checked }),
                                        }),
                                        "启用 reasoning",
                                      ],
                                    }),
                                  ],
                                }),
                              ]
                            : [
                                be.jsx("div", {
                                  style: {
                                    padding: "20px 4px",
                                    textAlign: "center",
                                    color: "var(--text-color-secondary)",
                                  },
                                  children: "请选择或新增模型",
                                }),
                              ],
                        }),
                      ],
                    }),
                  ]
                : [
                    be.jsx("div", {
                      style: {
                        padding: "24px 8px",
                        textAlign: "center",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-color-secondary)",
                      },
                      children: "请从左侧新增 Provider",
                    }),
              ],
            }),
          ],
        });
      },
      selectedCodexProvider = codexVisualState?.providers.find(
        (W) => W.id === codexVisualState.selectedProviderId,
      ),
      updateCodexVisualState = (W) =>
        setCodexVisualState((H) => (H ? codexVisualUpdateState(H, W) : H)),
      selectCodexProvider = (W) =>
        setCodexVisualState((H) => (H ? { ...H, selectedProviderId: W } : H)),
      updateSelectedCodexProvider = (W) => {
        selectedCodexProvider &&
          setCodexVisualState((H) =>
            H ? codexVisualUpdateProvider(H, selectedCodexProvider.id, W) : H,
          );
      },
      confirmDeleteCodexProvider = () => {
        if (!selectedCodexProvider) return;
        xr.confirm({
          title: "删除 Provider",
          content: `确定删除 ${selectedCodexProvider.name || selectedCodexProvider.id} 吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setCodexVisualState((W) =>
              W ? codexVisualDeleteProvider(W, selectedCodexProvider.id) : W,
            ),
        });
      },
      renderCodexField = (W, H, k, L, U = {}) =>
        (() => {
          const { suffix: T, ...Y } = U;
          return be.jsxs("label", {
            style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
            children: [
              renderConfigFieldLabel(W, U.help),
              T
                ? be.jsxs("span", {
                    className: "config-field-input-with-suffix",
                    children: [
                      be.jsx(zi, {
                        value: H || "",
                        onChange: (Z) => k(Z.target.value),
                        placeholder: L,
                        ...stripConfigHelpOption(Y),
                      }),
                      be.jsx("span", {
                        className: "config-field-input-suffix",
                        "aria-hidden": true,
                        children: T,
                      }),
                    ],
                  })
                : be.jsx(zi, {
                    value: H || "",
                    onChange: (Z) => k(Z.target.value),
                    placeholder: L,
                    ...stripConfigHelpOption(Y),
                  }),
            ],
          });
        })(),
      renderCodexSelect = (W, H, k, L, U = {}) => {
        const T = L.some((Z) => Z.value === H)
          ? L
          : H
            ? insertLegacyMaxCompatibilityOption(L, H, {
                value: H,
                label: codexVisualIsCompatibilityValue(H)
                  ? claudeText("复杂旧值（仅保留 TOML 源码）", "Complex legacy value (preserved in TOML)")
                  : H,
              })
            : L;
        return renderConfigSelect(W, H, k, T, U);
      },
      renderCodexTextArea = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(Qa, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              rows: U.rows || 4,
              style: { fontFamily: "monospace", fontSize: "12px", resize: "vertical" },
            }),
          ],
        }),
      renderCodexSection = (W, H, k) =>
        be.jsxs("section", {
          style: {
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "6px",
          },
          children: [
            be.jsx("div", { style: { fontWeight: 600, marginBottom: "2px" }, children: W }),
            H
              ? be.jsx("div", {
                  style: {
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                  },
                  children: H,
                })
              : null,
            k,
          ],
        }),
      renderGrokVisualEditor = () => {
        const grokVisualFieldIds = GROK_VISUAL_FIELD_IDS;
        if (!grokVisualState)
          return be.jsx("div", {
            "data-grok-fields": grokVisualFieldIds.join(" "),
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children: be.jsxs("div", {
              children: [
                grokVisualError || claudeText("当前 TOML 无法加载到可视化编辑器，请切换到 TOML 源码修复。", "Fix the TOML source before editing models."),
                !grokTextDraft.trim() ? be.jsx(xn, {
                  onClick: () => setGrokVisualState(grokVisualUpdateState({ source: {} }, {})),
                  children: claudeText("创建模型配置", "Create model configuration"),
                }) : null,
              ],
            }),
          });
        const modelIds = grokVisualModelIds(grokVisualState.source),
          selectedId = grokVisualState.selectedModelId || "",
          gridStyle = {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
            gap: "5px",
          },
          blankOption = { value: "", label: claudeText("跟随默认", "Use default") },
          addGrokModel = () => {
            const result = grokVisualAddModel(grokVisualState, grokNewModelId);
            if (!result.ok) {
              setGrokModelActionError(result.error === "duplicate-id"
                ? claudeText("配置名称已存在，请使用其他名称。", "This configuration name already exists.")
                : claudeText("请输入有效且唯一的模型配置名称。", "Enter a valid, unique model configuration name."));
              return;
            }
            setGrokVisualState(result.state);
            setGrokAddModelOpen(!1);
            setGrokNewModelId("");
            setGrokModelActionError("");
          };
        return be.jsxs("div", {
          "data-grok-fields": grokVisualFieldIds.join(" "),
          className: "grok-model-workspace",
          children: [
            be.jsxs("aside", {
              className: "grok-model-sidebar",
              "aria-label": claudeText("模型管理", "Model management"),
              children: [
                be.jsxs("div", {
                  className: "grok-model-list-header",
                  children: [
                    be.jsx("strong", { children: claudeText("模型列表", "Models") }),
                    be.jsx(xn, {
                      size: "small",
                      "data-testid": "grok-add-model",
                      disabled: Boolean(grokVisualState.fieldError),
                      onClick: () => {
                        setGrokNewModelId("");
                        setGrokModelActionError("");
                        setGrokAddModelOpen(!0);
                      },
                      children: claudeText("新增", "Add"),
                    }),
                  ],
                }),
                be.jsx("div", {
                  className: "grok-model-list",
                  role: "group",
                  "aria-label": claudeText("模型列表", "Models"),
                  children: modelIds.map((modelId) => be.jsxs("div", {
                    className: "grok-model-row",
                    children: [
                      be.jsx(xn, {
                        className: "grok-model-select",
                        type: modelId === selectedId ? "primary" : "default",
                        "aria-pressed": modelId === selectedId,
                        "data-grok-model-id": modelId,
                        title: modelId,
                        disabled: Boolean(grokVisualState.fieldError),
                        onClick: () => setGrokVisualState((current) => grokVisualUpdateState(current, { selectedModelId: modelId })),
                        children: modelId,
                      }),
                      be.jsx(xn, {
                        className: "grok-model-delete",
                        type: "text",
                        size: "small",
                        danger: true,
                        icon: be.jsx(AH, {}),
                        "data-grok-delete-model-id": modelId,
                        "aria-label": claudeText(`删除模型 ${modelId}`, `Delete model ${modelId}`),
                        title: claudeText(`删除模型 ${modelId}`, `Delete model ${modelId}`),
                        disabled: Boolean(grokVisualState.fieldError),
                        onClick: (event) => {
                          event.stopPropagation();
                          xr.confirm({
                            title: claudeText("删除模型配置", "Delete model configuration"),
                            content: claudeText(`确定删除 ${modelId}？其他模型和未展示字段会保留。`, `Delete ${modelId}? Other models and hidden fields are preserved.`),
                            okText: claudeText("删除", "Delete"),
                            cancelText: claudeText("取消", "Cancel"),
                            onOk: () => setGrokVisualState((previous) => grokVisualDeleteModel(previous, modelId)),
                          });
                        },
                      }),
                    ],
                  }, modelId)),
                }),
                modelIds.length === 0 ? be.jsx("div", {
                  role: "status",
                  children: claudeText("尚无模型，请先添加。", "No models yet. Add a model to get started."),
                }) : null,
              ],
            }),
            be.jsx(xr, {
              title: claudeText("添加模型", "Add model"),
              open: grokAddModelOpen,
              width: 400,
              rootClassName: "grok-add-model-modal",
              destroyOnClose: true,
              afterOpenChange: (open) => { if (open) grokNewModelInputRef.current?.focus(); },
              onCancel: () => {
                setGrokAddModelOpen(!1);
                setGrokNewModelId("");
                setGrokModelActionError("");
              },
              onOk: addGrokModel,
              okText: claudeText("添加", "Add"),
              cancelText: claudeText("取消", "Cancel"),
              okButtonProps: { disabled: !grokNewModelId.trim() || Boolean(grokVisualState.fieldError) },
              children: be.jsxs("div", {
                className: "grok-model-dialog-content",
                children: [
                  renderCodexField(
                    claudeText("模型名称", "Model name"),
                    grokNewModelId,
                    (value) => { setGrokNewModelId(value); setGrokModelActionError(""); },
                    "gpt-6.1-sol",
                    {
                      ref: grokNewModelInputRef,
                      "data-testid": "grok-new-model-id",
                      "aria-invalid": Boolean(grokModelActionError),
                      "aria-describedby": grokModelActionError ? "grok-model-name-error" : undefined,
                      status: grokModelActionError ? "error" : undefined,
                      onPressEnter: (event) => { if (!event.nativeEvent?.isComposing) addGrokModel(); },
                    },
                  ),
                  grokModelActionError ? be.jsx("div", {
                    id: "grok-model-name-error",
                    role: "alert",
                    className: "grok-model-action-error",
                    children: grokModelActionError,
                  }) : null,
                  be.jsx("div", {
                    className: "grok-model-copy-hint",
                    children: selectedId
                      ? claudeText(`复制“${selectedId}”的其他参数，model 使用输入的名称，不生成可选的 name。`, `Copies the other settings from “${selectedId}”, using the entered name for model and omitting the optional name field.`)
                      : claudeText("首个模型添加后，请填写接口与凭据。", "Configure the endpoint and credentials after adding the first model."),
                  }),
                ],
              }),
            }),
            be.jsxs("div", {
              className: "grok-model-detail",
              children: [
                renderCodexSection(
                  claudeText("全局默认", "Global defaults"),
                  "",
                  be.jsxs("div", {
                    style: gridStyle,
                    children: [
                      renderCodexSelect(
                        claudeText("默认模型", "Default model"),
                        grokVisualState.defaultModel,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { defaultModel: W }) : H)),
                        [blankOption, ...Array.from(new Set([...modelIds, grokVisualState.defaultModel].filter(Boolean))).map((value) => ({ value, label: value }))],
                        { help: claudeText("写入 [models].default。", "Writes [models].default.") },
                      ),
                      renderCodexSelect(
                        claudeText("默认思考档", "Default reasoning effort"),
                        grokVisualState.defaultReasoningEffort,
                        (W) =>
                          setGrokVisualState((H) =>
                            H ? grokVisualUpdateState(H, { defaultReasoningEffort: W }) : H,
                          ),
                        [blankOption, ...GROK_VISUAL_REASONING_EFFORTS.map((W) => ({ value: W, label: W }))],
                        { help: claudeText("只允许 none、minimal、low、medium、high、xhigh、max。", "Only none, minimal, low, medium, high, xhigh, or max.") },
                      ),
                    ],
                  }),
                ),
                selectedId ? renderCodexSection(
                  selectedId,
                  claudeText("编辑此模型的参数；未展示的 TOML 字段会保留。", "Edit this model's settings; hidden TOML fields are preserved."),
                  be.jsxs("div", {
                    style: gridStyle,
                    children: [
                      renderCodexField(
                        claudeText("模型 ID", "API model ID"),
                        grokVisualState.model,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { model: W }) : H)),
                        "model",
                        { help: claudeText("写入 [model.<id>].model。", "Writes [model.<id>].model.") },
                      ),
                      renderCodexField(
                        claudeText("接口地址", "Base URL"),
                        grokVisualState.baseUrl,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { baseUrl: W }) : H)),
                        "https://api.example.com/v1",
                        { help: claudeText("写入 [model.<id>].base_url。", "Writes [model.<id>].base_url.") },
                      ),
                      renderCodexField(
                        "API Key",
                        grokVisualState.apiKey,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { apiKey: W }) : H)),
                        claudeText("留空", "Leave empty"),
                        { help: claudeText("写入 [model.<id>].api_key。这是密钥本身；不知道时留空，不从 Codex auth.json 复制。", "Writes [model.<id>].api_key. Leave empty if unknown; never copy Codex auth.json.") },
                      ),
                      renderCodexSelect(
                        claudeText("接口协议", "API backend"),
                        grokVisualState.apiBackend,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { apiBackend: W }) : H)),
                        [blankOption, ...GROK_VISUAL_API_BACKENDS.map((W) => ({ value: W, label: W }))],
                        { help: claudeText("只允许 chat_completions、responses、messages。若 Grok 报 response.metadata 解析错误，请选服务支持的 chat_completions。", "Only chat_completions, responses, or messages. If Grok cannot parse response.metadata, use chat_completions when supported by your service.") },
                      ),
                      renderCodexField(
                        claudeText("环境变量名", "Environment variable"),
                        grokVisualState.envKey,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { envKey: W }) : H)),
                        "XAI_API_KEY",
                        { help: claudeText("只写环境变量名，不写密钥值。", "Environment variable name only, never the secret value.") },
                      ),
                      renderCodexField(
                        claudeText("上下文窗口", "Context window"),
                        grokVisualState.contextWindow,
                        (W) => setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { contextWindow: W }) : H)),
                        "500000",
                        { help: claudeText("非负整数 token 上限。", "Non-negative integer token limit.") },
                      ),
                      renderCodexSelect(
                        claudeText("思考摘要", "Reasoning summary"),
                        grokVisualState.reasoningSummary,
                        (W) =>
                          setGrokVisualState((H) => (H ? grokVisualUpdateState(H, { reasoningSummary: W }) : H)),
                        [blankOption, ...GROK_VISUAL_REASONING_SUMMARIES.map((W) => ({ value: W, label: W }))],
                        { help: claudeText("只允许 none、auto、concise、detailed。", "Only none, auto, concise, or detailed.") },
                      ),
                      renderCodexField(
                        claudeText("压缩阈值", "Compaction threshold"),
                        grokVisualState.compactionAtTokens,
                        (W) =>
                          setGrokVisualState((H) =>
                            H ? grokVisualUpdateState(H, { compactionAtTokens: W }) : H,
                          ),
                        "450000",
                        { help: claudeText("非负整数 token 阈值。", "Non-negative integer token threshold.") },
                      ),
                    ],
                  }),
                ) : be.jsx("div", {
                  role: "status",
                  children: claudeText("从左侧添加模型，开始配置。", "Add a model on the left to get started."),
                }),
              ],
            }),
          ],
        });
      },
      renderCodexVisualEditor = () => {
        if (!codexVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children: codexVisualError || "当前 TOML 无法加载到可视化编辑器，请切换到 TOML 源码修复。",
          });
        const W = selectedCodexProvider,
          H = [
            { value: "", label: "跟随默认" },
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ],
          k = {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
            gap: "5px",
          };
        return be.jsxs("div", {
          style: {
            display: "flex",
            gap: "6px",
            alignItems: "stretch",
            flexWrap: "wrap",
            minHeight: 420,
          },
          children: [
            be.jsxs("div", {
              style: {
                width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "5px",
              },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    be.jsx("strong", { children: "Provider" }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () =>
                        setCodexVisualState((L) =>
                          L ? codexVisualAddProvider(L) : codexVisualCreateState("", ""),
                        ),
                      children: "新增",
                    }),
                  ],
                }),
                codexVisualState.providers.length > 0
                  ? codexVisualState.providers.map((L) =>
                      be.jsx(
                        xn,
                        {
                          type: L.id === codexVisualState.selectedProviderId ? "primary" : "default",
                          onClick: () => selectCodexProvider(L.id),
                          style: { width: "100%", textAlign: "left", overflow: "hidden" },
                          children: L.name || L.id,
                        },
                        L.id,
                      ),
                    )
                  : be.jsx("div", {
                      style: {
                        padding: "10px 2px",
                        textAlign: "center",
                        color: "var(--text-color-secondary)",
                      },
                      children: "暂无 Provider，请新增",
                    }),
              ],
            }),
            be.jsxs("div", {
              style: {
                flex: "1 1 420px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              },
              children: [
                renderCodexSection(
                  "核心配置",
                  "编辑 ~/.codex/config.toml 中稳定常用字段；未展示的 TOML 字段会保留。",
                  be.jsxs("div", {
                    style: k,
                    children: [
                      renderCodexField("model", codexVisualState.model, (L) => updateCodexVisualState({ model: L }), "gpt-5.1-codex"),
                      renderCodexSelect(
                        "model_provider",
                        codexVisualState.modelProvider,
                        (L) => updateCodexVisualState({ modelProvider: L }),
                        [
                          { value: "", label: "未设置" },
                          ...codexVisualState.providers.map((L) => ({ value: L.id, label: L.id })),
                        ],
                      ),
                      renderCodexSelect(
                        "approval_policy",
                        codexVisualState.approvalPolicy,
                        (L) => updateCodexVisualState({ approvalPolicy: L }),
                        ["", "untrusted", "on-request", "never"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "sandbox_mode",
                        codexVisualState.sandboxMode,
                        (L) => updateCodexVisualState({ sandboxMode: L }),
                        ["", "read-only", "workspace-write", "danger-full-access"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "model_reasoning_effort",
                        codexVisualState.reasoningEffort,
                        (L) => updateCodexVisualState({ reasoningEffort: L }),
                        ["", ...CODEX_VISUAL_REASONING_EFFORT_OPTIONS].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "model_reasoning_summary",
                        codexVisualState.reasoningSummary,
                        (L) => updateCodexVisualState({ reasoningSummary: L }),
                        ["", "auto", "concise", "detailed", "none"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "model_verbosity",
                        codexVisualState.verbosity,
                        (L) => updateCodexVisualState({ verbosity: L }),
                        ["", "low", "medium", "high"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexTextArea(
                        "developer_instructions",
                        codexVisualState.developerInstructions,
                        (L) => updateCodexVisualState({ developerInstructions: L }),
                        "为 Codex 追加 developer instructions",
                        { rows: 4 },
                      ),
                    ],
                  }),
                ),
                renderCodexSection(
                  "开关与工具",
                  "",
                  be.jsxs("div", {
                    style: k,
                    children: [
                      renderCodexSelect(
                        "web_search",
                        codexVisualState.webSearch,
                        (L) => updateCodexVisualState({ webSearch: L }),
                        ["", "disabled", "cached", "indexed", "live"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect("disable_response_storage", codexVisualState.disableResponseStorage, (L) => updateCodexVisualState({ disableResponseStorage: L }), H),
                      renderCodexSelect("hide_agent_reasoning", codexVisualState.hideAgentReasoning, (L) => updateCodexVisualState({ hideAgentReasoning: L }), H),
                      renderCodexSelect("model_supports_reasoning_summaries", codexVisualState.supportsReasoningSummaries, (L) => updateCodexVisualState({ supportsReasoningSummaries: L }), H),
                    ],
                  }),
                ),
                W
                  ? renderCodexSection(
                      "Provider 配置",
                      "Provider 写入 [model_providers.<id>]；未展示的字段会保留在 TOML 源码中。",
                      be.jsxs(be.Fragment, {
                        children: [
                          be.jsxs("div", {
                            style: {
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "4px",
                              marginBottom: "5px",
                            },
                            children: [
                              be.jsx("strong", { children: W.name || W.id }),
                              be.jsx(xn, {
                                size: "small",
                                danger: !0,
                                onClick: confirmDeleteCodexProvider,
                                children: "删除 Provider",
                              }),
                            ],
                          }),
                          be.jsxs("div", {
                            style: k,
                            children: [
                              renderCodexField("Provider id", W.id, (L) => updateSelectedCodexProvider({ id: L }), "openai"),
                              renderCodexField("name", W.name, (L) => updateSelectedCodexProvider({ name: L }), "OpenAI"),
                              renderCodexField("base_url", W.baseUrl, (L) => updateSelectedCodexProvider({ baseUrl: L }), "https://api.openai.com/v1"),
                              renderCodexSelect(
                                "wire_api",
                                W.wireApi,
                                (L) => updateSelectedCodexProvider({ wireApi: L }),
                                [
                                  { value: "", label: "跟随默认" },
                                  { value: "responses", label: "responses" },
                                ],
                              ),
                              renderCodexSelect("requires_openai_auth", W.requiresOpenaiAuth, (L) => updateSelectedCodexProvider({ requiresOpenaiAuth: L }), H),
                            ],
                          }),
                        ],
                      }),
                    )
                  : null,
              ],
            }),
          ],
        });
      };
    const renderFixedEditorModeTabs = (W) =>
      be.jsx(nh, {
        className: "config-editor-fixed-mode-switch",
        size: "small",
        activeKey: W.find((H) => H.active)?.value || W[0]?.value,
        items: W.map((H) => ({ key: H.value, label: H.label })),
        onChange: (H) => {
          const k = W.find((L) => L.value === H);
          k?.onClick?.();
        },
        tabBarStyle: { margin: 0 },
        style: {
          alignSelf: "flex-start",
          minWidth: "150px",
        },
      });
    const renderConfigEditorCardTitle = (W, H) =>
      be.jsxs("div", {
        className: "config-editor-fixed-title",
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "4px",
        },
        children: [
          be.jsx("div", { children: W }),
          renderFixedEditorModeTabs(H),
        ],
      });
    const renderDshProfileEditor = () => {
      const controlsDisabled = Boolean(dshBusy || configListLoading);
      const document = dshVisual && typeof dshVisual === "object" ? dshVisual : null;
      const models = document && Array.isArray(document.models) ? document.models : [];
      const selectedModelId = models.some((model) => model.id === dshSelectedModelId)
        ? dshSelectedModelId
        : (document && (document.acpModel || models[0]?.id)) || "";
      const selectedModel = models.find((model) => model.id === selectedModelId) || null;
      const applyDshResult = (result) => {
        if (!result || !result.ok) {
          setDshFieldError(result && result.error ? result.error : "DSH profile is empty.");
          return;
        }
        setDshVisual(result.document);
        setDshText(result.content);
        setDshFieldError("");
      };
      const modeTabs = [
        {
          value: "visual",
          label: "可视化",
          active: dshEditorMode === "visual",
          onClick: controlsDisabled ? undefined : () => switchDshEditorMode("visual"),
        },
        {
          value: "json",
          label: "JSON",
          active: dshEditorMode === "json",
          onClick: controlsDisabled ? undefined : () => switchDshEditorMode("json"),
        },
      ];
      return be.jsxs("div", {
        className: "config-editor-shell config-editor-dsh",
        "data-testid": "dsh-profile-editor",
        style: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "8px",
          minHeight: 0,
        },
        children: [
          be.jsx(aa, {
            title: be.jsxs("div", {
              className: "config-editor-fixed-title",
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "4px",
              },
              children: [
                be.jsx("div", { "data-testid": "dsh-profile-name", children: O.name }),
                be.jsx("div", {
                  "data-testid": "dsh-editor-mode",
                  "data-mode": dshEditorMode,
                  children: renderFixedEditorModeTabs(modeTabs),
                }),
              ],
            }),
            extra: be.jsx("div", {
              className: "config-editor-fixed-actions",
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "4px",
              },
              children: be.jsx("div", {
                className: "config-editor-fixed-action-row",
                style: {
                  display: "flex",
                  gap: "4px",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                },
                children: be.jsx(xn, {
                  className: "config-standard-action-button",
                  type: "primary",
                  size: "small",
                  icon: be.jsx(Pv, {}),
                  disabled: controlsDisabled,
                  onClick: saveDshConfigCard,
                  children: "保存",
                }),
              }),
            }),
            style: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            },
            bodyStyle: {
              flex: 1,
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              gap: "8px",
              overflow: "auto",
              minHeight: 0,
            },
            children: be.jsxs("div", {
              className: "dsh-profile-fields",
              style: { display: "flex", flexDirection: "column", gap: "8px", flex: 1 },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
                  children: [
                    be.jsxs("strong", { children: [be.jsx(Ya, {}), " profile.json"] }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => N("dsh-config"),
                      children: "查看范例",
                    }),
                  ],
                }),
                be.jsx("div", {
                  style: {
                    marginBottom: "4px",
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                  },
                  children: "配置文件路径: ~/.dsh/__config/active-profile.json",
                }),
                dshEditorMode === "json"
                  ? [
                    dshFieldError
                      ? be.jsx("div", {
                          "data-testid": "dsh-field-error",
                          style: {
                            padding: "8px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--error-color)",
                          },
                          children: dshFieldError,
                        })
                      : null,
                    be.jsx("div", {
                      style: {
                        color: "var(--text-color-secondary)",
                        fontSize: "12px",
                        lineHeight: 1.5,
                      },
                      children: "JSON 模式编辑同一份完整配置。JSON 无效时不会覆盖最后一次有效的可视化状态。",
                    }),
                    be.jsx(Qa, {
                      "data-testid": "dsh-json-editor",
                      value: dshText,
                      disabled: controlsDisabled,
                      placeholder: "请输入 JSON 配置",
                      rows: 18,
                      onChange: (event) => {
                        const value = event && event.target ? event.target.value : "";
                        setDshText(value);
                        const parsed = readDshUiDocument(value);
                        if (!parsed.ok) {
                          setDshFieldError(parsed.error);
                          return;
                        }
                        setDshVisual(parsed.document);
                        setDshFieldError("");
                      },
                      style: {
                        flex: 1,
                        minHeight: 420,
                        fontFamily: "monospace",
                        fontSize: "13px",
                      },
                    }),
                  ]
                : [
                    dshFieldError
                      ? be.jsx("div", {
                          "data-testid": "dsh-field-error",
                          style: {
                            padding: "8px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--error-color)",
                          },
                          children: dshFieldError,
                        })
                      : null,
                    be.jsxs("section", {
                      className: "dsh-common-parameters",
                      "data-testid": "dsh-common-parameters",
                      children: [
                        be.jsx("strong", { children: "Provider 公共参数" }),
                        renderCodexField("provider", document ? document.provider : "", () => {}, DSH_UI_PROVIDER, {
                          readOnly: true,
                          disabled: controlsDisabled,
                          "data-testid": "dsh-provider",
                        }),
                        renderCodexField("baseURL", document ? document.baseURL : "", (value) => {
                          if (controlsDisabled || !document) return;
                          if (dshUiContainsSecret(value)) {
                            setDshFieldError(DSH_UI_SECRET_ERROR);
                            return;
                          }
                          const committed = dshUiUpdateBaseUrl(document, value);
                          if (!committed.ok) {
                            setDshFieldError(committed.error);
                            return;
                          }
                          applyDshResult(committed);
                        }, DSH_UI_EXAMPLE_BASE_URL, {
                          disabled: controlsDisabled,
                          "data-testid": "dsh-base-url",
                        }),
                        renderCodexField("apiKey", document ? document.apiKey || "" : "", (value) => {
                          if (controlsDisabled) return;
                          applyDshResult(dshUiUpdateApiKey(document, value));
                        }, "直接填写 API Key（可选）", {
                          type: "password",
                          help: [
                            "非空时优先使用此密钥；留空时使用 SINITEK_DSH_API_KEY。配置档案、激活副本和备份都会以明文保存。",
                            "apiKeyEnv 是固定的环境变量名，保存时会自动补为 SINITEK_DSH_API_KEY，不需要在可视化模式填写。",
                            "macOS/Linux（Bash）：",
                            "read -rsp 'DSH API Key: ' SINITEK_DSH_API_KEY && export SINITEK_DSH_API_KEY && code .",
                            "Windows（PowerShell）：",
                            "$secure = Read-Host 'DSH API Key' -AsSecureString; $env:SINITEK_DSH_API_KEY = [System.Net.NetworkCredential]::new('', $secure).Password; code .",
                          ].join("\n"),
                          disabled: controlsDisabled,
                          "data-testid": "dsh-api-key",
                        }),
                        be.jsx("div", {
                          className: "dsh-common-parameter-note",
                          "data-testid": "dsh-api-key-env-note",
                          children: "apiKeyEnv 固定为 SINITEK_DSH_API_KEY，保存时自动补齐；未填写 apiKey 时从该环境变量读取密钥。",
                        }),
                        be.jsx("div", {
                          className: "dsh-common-parameter-note",
                          "data-testid": "dsh-api-key-warning",
                          children: "安全提示：apiKey 会以明文保存在本机配置档案、激活副本和备份中；JSON 模式可见密钥，请勿分享含密钥的配置。",
                        }),
                        be.jsx("div", {
                          "data-testid": "dsh-acp-model",
                          children: renderCodexSelect(
                            "默认模型 acpModel",
                            document ? document.acpModel : "",
                            (value) => {
                              if (controlsDisabled) return;
                              const updated = dshUiSetAcpModel(document, value);
                              if (updated.ok) setDshSelectedModelId(value);
                              applyDshResult(updated);
                            },
                            models.filter((model) => model.id).map((model) => ({ value: model.id, label: model.name || model.id })),
                            { disabled: controlsDisabled },
                          ),
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      className: "grok-model-workspace",
                      "data-testid": "dsh-model-workspace",
                      children: [
                        be.jsxs("aside", {
                          className: "grok-model-sidebar",
                          "data-testid": "dsh-model-list",
                          "aria-label": "模型管理",
                          children: [
                            be.jsxs("div", {
                              className: "grok-model-list-header",
                              children: [
                                be.jsx("strong", { children: "模型列表" }),
                                be.jsx(xn, {
                                  size: "small",
                                  "data-testid": "dsh-add-model",
                                  disabled: controlsDisabled || dshUiHasDraftModel(document),
                                  onClick: () => {
                                    if (controlsDisabled) return;
                                    const added = dshUiAddModel(document);
                                    if (!added.ok) {
                                      setDshFieldError(added.error);
                                      return;
                                    }
                                    setDshSelectedModelId("");
                                    applyDshResult(added);
                                  },
                                  children: "新增",
                                }),
                              ],
                            }),
                            be.jsx("div", {
                              className: "grok-model-list",
                              role: "group",
                              "aria-label": "模型列表",
                                  children: models.map((model) => be.jsxs("div", {
                                className: "grok-model-row",
                                "data-testid": "dsh-model-row",
                                "data-dsh-model-id": model.id,
                                children: [
                                  be.jsx(xn, {
                                    className: "grok-model-select",
                                    type: model.id === selectedModelId ? "primary" : "default",
                                    "aria-pressed": model.id === selectedModelId,
                                    "data-testid": "dsh-model-select",
                                    "data-dsh-model-id": model.id,
                                    title: model.id || "新模型",
                                    disabled: controlsDisabled,
                                    onClick: () => setDshSelectedModelId(model.id),
                                    children: model.name || model.id || "新模型",
                                  }),
                                  be.jsx(xn, {
                                    type: "text",
                                    size: "small",
                                    danger: true,
                                    className: "grok-model-delete",
                                    icon: be.jsx(AH, {}),
                                    "data-testid": "dsh-delete-model",
                                    "data-dsh-model-id": model.id,
                                    "aria-label": model.id ? `删除模型 ${model.id}` : "取消新增模型",
                                    title: model.id ? `删除模型 ${model.id}` : "取消新增模型",
                                    disabled: controlsDisabled || models.length <= 1,
                                    onClick: (event) => {
                                      event.stopPropagation();
                                      if (controlsDisabled) return;
                                      const cancelDraft = model.id === "";
                                      xr.confirm({
                                        title: cancelDraft ? "取消新增模型" : "删除模型",
                                        content: cancelDraft ? "确定放弃尚未填写的模型 id？" : `确定删除模型 ${model.id}？`,
                                        okText: cancelDraft ? "放弃" : "删除",
                                        cancelText: "取消",
                                        onOk: () => {
                                          const deleted = dshUiDeleteModel(document, model.id);
                                          if (!deleted.ok) {
                                            setDshFieldError(deleted.error);
                                            return;
                                          }
                                          setDshSelectedModelId(deleted.document.models.some((item) => item.id === dshSelectedModelId)
                                            ? dshSelectedModelId
                                            : deleted.document.acpModel || deleted.document.models[0]?.id || "");
                                          applyDshResult(deleted);
                                        },
                                      });
                                    },
                                  }),
                                ],
                              }, model.id)),
                            }),
                            models.length === 0
                              ? be.jsx("div", {
                                  "data-testid": "dsh-model-empty",
                                  role: "status",
                                  style: { color: "var(--text-color-secondary)" },
                                  children: "尚无模型，请先添加。",
                                })
                              : null,
                          ],
                        }),
                        be.jsxs("div", {
                          className: "grok-model-detail",
                          children: [
                            selectedModel
                              ? be.jsxs("div", {
                                  "data-testid": "dsh-selected-model-detail",
                                  style: { display: "flex", flexDirection: "column", gap: "8px" },
                                  children: [
                                    be.jsx("strong", { children: selectedModel.id ? `模型详情：${selectedModel.name || selectedModel.id}` : "新增模型" }),
                                    renderCodexField("模型 id", selectedModel.id, (value) => {
                                      if (controlsDisabled) return;
                                      const renamed = dshUiUpdateModelId(document, selectedModel.id, value);
                                      if (renamed.ok && dshSelectedModelId === selectedModel.id) {
                                        setDshSelectedModelId(value.trim());
                                      }
                                      applyDshResult(renamed);
                                    }, DSH_UI_MODEL_ID, {
                                      disabled: controlsDisabled,
                                      placeholder: "输入完整模型 id",
                                      "data-testid": "dsh-model-id",
                                    }),
                                    renderCodexField("模型名称 name", selectedModel.name || selectedModel.id, (value) => {
                                      if (controlsDisabled) return;
                                      applyDshResult(dshUiUpdateModelName(document, selectedModel.id, value));
                                    }, selectedModel.id || "例如：DeepSeek V4.1 Flash", {
                                      disabled: controlsDisabled,
                                      "data-testid": "dsh-model-name",
                                    }),
                                    renderCodexField("上下文窗口 contextWindow（tokens）", selectedModel.contextWindow || "", (value) => {
                                      if (controlsDisabled) return;
                                      applyDshResult(dshUiUpdateModelContextWindow(document, selectedModel.id, value));
                                    }, "留空使用 DSH 默认值 262144", {
                                      type: "number",
                                      min: 1,
                                      step: 1,
                                      disabled: controlsDisabled,
                                      help: "这是 models[] 中该模型的上下文容量声明；留空时采用 DSH 适配器默认值，不代表服务端实测容量。",
                                      "data-testid": "dsh-model-context-window",
                                    }),
                                    be.jsx("div", {
                                      className: "dsh-common-parameter-note",
                                      "data-testid": "dsh-model-input-type",
                                      children: "输入类型 input 当前固定为 text；图片能力尚未在 DSH 执行链路中验证。",
                                    }),
                                  ],
                                })
                              : be.jsx("div", {
                                  "data-testid": "dsh-selected-model-empty",
                                  style: { color: "var(--text-color-secondary)" },
                                children: "请从左侧选择模型，或点击新增。",
                                }),
                          ],
                        }),
                      ],
                    }),
                  ],
              ],
            }),
          }),
        ],
      });
    };
    // dsh profile editor
    return O
      ? O.platform === "claude"
        ? be.jsxs("div", {
            className: "config-editor-shell config-editor-claude",
            style: {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              minHeight: 0,
            },
            children: [
              be.jsx(aa, {
                title: renderConfigEditorCardTitle(`编辑配置: ${O.name}`, [
                  {
                    value: "visual",
                    label: claudeText("可视化", "Visual"),
                    active: claudeEditorMode === "visual",
                    onClick: () => switchClaudeEditorMode("visual"),
                  },
                  {
                    value: "json",
                    label: "JSON",
                    active: claudeEditorMode === "json",
                    onClick: () => switchClaudeEditorMode("json"),
                  },
                ]),
                extra: be.jsxs("div", {
                  className: "config-editor-fixed-actions",
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "4px",
                  },
                  children: [
                    be.jsxs("div", {
                      className: "config-editor-fixed-action-row",
                      style: {
                        display: "flex",
                        gap: "4px",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      },
                      children: [
                                                be.jsx(xn, {
                          className: "config-standard-action-button",
                          size: "small",
                          onClick: () => setSkillsModalOpen(!0),
                          children: "Skills",
                        }),
                        be.jsx(xn, {
                          className: "config-standard-action-button",
                          type: "primary",
                          size: "small",
                          icon: be.jsx(Pv, {}),
                          onClick: saveClaudeSettingsCard,
                          children: "保存",
                        }),
                      ],
                    }),
                  ],
                }),
                style: {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                },
                bodyStyle: {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "auto",
                  minHeight: 0,
                },
                children: be.jsxs("div", {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    flex: 1,
                  },
                  children: [
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "6px",
                            color: "var(--text-color-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 6 },
                              children: [
                                be.jsxs("span", {
                                  children: [
                                    be.jsx(Ya, {}),
                                    " 配置文件路径: ",
                                    "~/.claude/settings.json",
                                  ],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("claude-settings"),
                                  children: "查看范例",
                                }),
                              ],
	                            }),
	                          ],
	                        }),
                        claudeVisualError
                          ? be.jsx("div", {
                              style: {
                                marginBottom: "5px",
                                padding: "4px 5px",
                                border: "1px solid var(--error-color)",
                                borderRadius: "6px",
                                color: "var(--error-color)",
                              },
                              children: claudeVisualError,
                            })
                          : null,
                        claudeEditorMode === "visual"
                          ? renderClaudeVisualEditor()
                          : be.jsxs(be.Fragment, {
                              children: [
                                be.jsx("div", {
                                  style: {
                                    marginBottom: "4px",
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                    lineHeight: 1.5,
                                  },
                                  children: claudeText(
                                    "高级 JSON 模式会保留所有 Claude Code 字段；JSON 无效时不会覆盖最后一次有效的可视化状态。",
                                    "Advanced JSON mode preserves every Claude Code field. Invalid JSON does not overwrite the last valid visual state.",
                                  ),
                                }),
                                be.jsx(Qa, {
                                  value: l,
                                  onChange: (H) => (s(H.target.value), setClaudeVisualError("")),
                                  placeholder: claudeText("请输入 JSON 配置", "Enter JSON configuration"),
                                  rows: 18,
                                  style: {
                                    flex: 1,
                                    minHeight: 420,
                                    fontFamily: "monospace",
                                    fontSize: "13px",
                                  },
                                }),
                              ],
                            }),
                      ],
                    }),
                                      ],
                }),
              }),
                                                        be.jsx(SkillsManagerModal, {
                                                          open: skillsModalOpen,
                                                          onClose: () => setSkillsModalOpen(!1),
                                                          platform: O.platform,
                                                          skills: cliSkills,
                                                          directory: skillsDirectory,
                                                          displayDirectory: skillsDisplayDirectory,
                                                          loading: skillsLoading,
                                                          errorText: skillsError,
                                                          pendingName: pendingSkillName,
                                                          onOpenDirectory: openSkillsDirectory,
                                                          onCopy: copyCliSkillTo,
                                                          onDelete: confirmDeleteCliSkill,
                                                        }),
              B(),
            ],
          })
        : O.platform === "opencode"
          ? be.jsxs("div", {
              className: "config-editor-shell config-editor-opencode",
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "8px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: renderConfigEditorCardTitle(`编辑配置: ${O.name}`, [
                    {
                      value: "visual",
                      label: "可视化",
                      active: openCodeEditorMode === "visual",
                      onClick: () => switchOpenCodeEditorMode("visual"),
                    },
                    {
                      value: "json",
                      label: "JSON",
                      active: openCodeEditorMode === "json",
                      onClick: () => switchOpenCodeEditorMode("json"),
                    },
                  ]),
                  extra: be.jsxs("div", {
                    className: "config-editor-fixed-actions",
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: "4px",
                    },
                    children: [
                      be.jsxs("div", {
                        className: "config-editor-fixed-action-row",
                        style: {
                          display: "flex",
                          gap: "4px",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        },
                        children: [
                                                    be.jsx(xn, {
                            className: "config-standard-action-button",
                            size: "small",
                            onClick: () => setSkillsModalOpen(!0),
                            children: "Skills",
                          }),
                          be.jsx(xn, {
                            className: "config-standard-action-button",
                            type: "primary",
                            size: "small",
                            icon: be.jsx(Pv, {}),
                            onClick: saveOpenCodeSettingsCard,
                            children: "保存",
                          }),
                        ],
                      }),
                    ],
                  }),
                  style: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  },
                  bodyStyle: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px",
                    gap: "8px",
                    overflow: "auto",
                    minHeight: 0,
                  },
                  children: [
                    be.jsxs("div", {
                      style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "5px",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", { children: [be.jsx(Ya, {}), " config.json"] }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("opencode-settings"),
                                  children: "查看范例",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children:
                            "模型/Provider 配置: ~/.opencode/config.json；全局 MCP 配置: ${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json；不使用 ~/.opencode/.env",
                        }),
                        openCodeVisualError
                          ? be.jsx("div", {
                              style: {
                                marginBottom: "5px",
                                padding: "4px 5px",
                                border: "1px solid var(--error-color)",
                                borderRadius: "6px",
                                color: "var(--error-color)",
                              },
                              children: openCodeVisualError,
                            })
                          : null,
                        openCodeEditorMode === "visual"
                          ? renderOpenCodeVisualEditor()
                          : be.jsxs(be.Fragment, {
                              children: [
                                be.jsx("div", {
                                  style: {
                                    marginBottom: "4px",
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                    lineHeight: 1.5,
                                  },
                                  children:
                                    "高级 JSON 模式会保留所有 OpenCode 字段；修改完成后可切回可视化，JSON 无效时不会覆盖当前可视化状态。",
                                }),
                                be.jsx(Qa, {
                                  value: l,
                                  onChange: (W) => (s(W.target.value), setOpenCodeVisualError("")),
                                  placeholder: "请输入 JSON 配置",
                                  rows: 18,
                                  style: {
                                    flex: 1,
                                    minHeight: 420,
                                    fontFamily: "monospace",
                                    fontSize: "13px",
                                  },
                                }),
                              ],
                            }),
                      ],
                    }),
                                      ],
                }),
                                                              be.jsx(SkillsManagerModal, {
                                                                open: skillsModalOpen,
                                                                onClose: () => setSkillsModalOpen(!1),
                                                                platform: O.platform,
                                                                skills: cliSkills,
                                                                directory: skillsDirectory,
                                                                displayDirectory: skillsDisplayDirectory,
                                                                loading: skillsLoading,
                                                                errorText: skillsError,
                                                                pendingName: pendingSkillName,
                                                                onOpenDirectory: openSkillsDirectory,
                                                                onCopy: copyCliSkillTo,
                                                                onDelete: confirmDeleteCliSkill,
                                                              }),
                B(),
              ],
            })
          : O.platform === "grok"
            ? be.jsxs("div", {
                className: "config-editor-shell config-editor-grok",
                style: {
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  padding: "8px",
                  minHeight: 0,
                },
                children: [
                  be.jsx(aa, {
                    title: renderConfigEditorCardTitle(`编辑配置: ${O.name}`, [
                      {
                        value: "visual",
                        label: "可视化",
                        active: grokEditorMode === "visual",
                        onClick: () => switchGrokEditorMode("visual"),
                      },
                      {
                        value: "toml",
                        label: "TOML 源码",
                        active: grokEditorMode === "toml",
                        onClick: () => switchGrokEditorMode("toml"),
                      },
                    ]),
                    extra: be.jsx("div", {
                      className: "config-editor-fixed-actions",
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "4px",
                      },
                      children: be.jsxs("div", {
                        className: "config-editor-fixed-action-row",
                        style: {
                          display: "flex",
                          gap: "4px",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        },
                        children: [
                          be.jsx(xn, {
                            className: "config-standard-action-button",
                            size: "small",
                            onClick: () => setSkillsModalOpen(!0),
                            children: "Skills",
                          }),
                          be.jsx(xn, {
                            className: "config-standard-action-button",
                            type: "primary",
                            size: "small",
                            icon: be.jsx(Pv, {}),
                            disabled: grokSaveDisabled,
                            onClick: saveGrokConfigCard,
                            children: "保存",
                          }),
                        ],
                      }),
                    }),
                    style: {
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                    },
                    bodyStyle: {
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      padding: "8px",
                      gap: "8px",
                      overflow: "auto",
                      minHeight: 0,
                    },
                    children: be.jsxs("div", {
                      style: { display: "flex", flexDirection: "column", gap: "8px", flex: 1 },
                      children: [
                        be.jsxs("div", {
                          style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
                          children: [
                            be.jsxs("strong", { children: [be.jsx(Ya, {}), " config.toml"] }),
                            be.jsx(xn, {
                              size: "small",
                              onClick: () => N("grok-config"),
                              children: "查看范例",
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.grok/config.toml",
                        }),
                        grokVisualError
                          ? be.jsx("div", {
                              style: {
                                padding: "8px",
                                border: "1px solid var(--border-color)",
                                borderRadius: "6px",
                                color: "var(--error-color)",
                              },
                              children: grokVisualError,
                            })
                          : null,
                        grokEditorMode === "visual"
                          ? renderGrokVisualEditor()
                          : be.jsx(Qa, {
                              value: grokTextDraft,
                              onChange: (W) => onGrokTextChange(W.target.value),
                              placeholder: "请输入TOML配置",
                              rows: 18,
                              style: {
                                flex: 1,
                                minHeight: 420,
                                fontFamily: "monospace",
                                fontSize: "13px",
                              },
                            }),
                      ],
                    }),
                  }),
                  be.jsx(SkillsManagerModal, {
                    open: skillsModalOpen,
                    onClose: () => setSkillsModalOpen(!1),
                    platform: O.platform,
                    skills: cliSkills,
                    directory: skillsDirectory,
                    displayDirectory: skillsDisplayDirectory,
                    loading: skillsLoading,
                    errorText: skillsError,
                    pendingName: pendingSkillName,
                    onOpenDirectory: openSkillsDirectory,
                    onCopy: copyCliSkillTo,
                    onDelete: confirmDeleteCliSkill,
                  }),
                  B(),
                ],
              })
          : O.platform === "dsh"
            ? be.jsxs(be.Fragment, {
                children: [renderDshProfileEditor(), B()],
              })
          : be.jsxs("div", {
              className: "config-editor-shell config-editor-codex",
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "8px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: renderConfigEditorCardTitle(`编辑配置: ${O.name}`, [
                    {
                      value: "visual",
                      label: "可视化",
                      active: codexEditorMode === "visual",
                      onClick: () => switchCodexEditorMode("visual"),
                    },
                    {
                      value: "toml",
                      label: "TOML 源码",
                      active: codexEditorMode === "toml",
                      onClick: () => switchCodexEditorMode("toml"),
                    },
                  ]),
                  extra: be.jsxs("div", {
                    className: "config-editor-fixed-actions",
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: "4px",
                    },
                    children: [
                      be.jsxs("div", {
                        className: "config-editor-fixed-action-row",
                        style: {
                          display: "flex",
                          gap: "4px",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        },
                        children: [
                                                    be.jsx(xn, {
                            className: "config-standard-action-button",
                            size: "small",
                            onClick: () => setSkillsModalOpen(!0),
                            children: "Skills",
                          }),
                          be.jsx(xn, {
                            className: "config-standard-action-button",
                            type: "primary",
                            size: "small",
                            icon: be.jsx(Pv, {}),
                            onClick: saveCodexConfigCard,
                            children: "保存",
                          }),
                        ],
                      }),
                    ],
                  }),
                  style: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  },
                  bodyStyle: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px",
                    gap: "8px",
                    overflow: "auto",
                    minHeight: 0,
                  },
                  children: [
                    be.jsxs("div", {
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "6px",
                      },
                      children: [
                        be.jsxs("div", {
                          style: { display: "flex", flexDirection: "column", gap: "2px" },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
                              children: [
                                be.jsxs("strong", { children: [be.jsx(Ya, {}), " config.toml"] }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-config"),
                                  children: "查看范例",
                                }),
                              ],
                            }),
                            be.jsx("span", {
                              style: {
                                color: "var(--text-color-secondary)",
                                fontSize: "12px",
                                lineHeight: 1.5,
                              },
                              children:
                                "主配置: ~/.codex/config.toml；auth.json 保持兼容显示，不是主配置。",
                            }),
                          ],
                        }),
                      ],
                    }),
                    codexVisualError
                      ? be.jsx("div", {
                          style: {
                            padding: "8px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--error-color)",
                          },
                          children: codexVisualError,
                        })
                      : null,
                    codexEditorMode === "visual" ? renderCodexVisualEditor() : null,
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: codexEditorMode === "toml" ? "flex" : "none",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.codex/config.toml",
                        }),
                        be.jsx(Qa, {
                          value: m,
                          onChange: (W) => v(W.target.value),
                          placeholder: "请输入TOML配置",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: codexEditorMode === "toml" ? "flex" : "none",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", {
                                  children: [be.jsx(Ya, {}), " auth.json"],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-auth"),
                                  children: "查看范例",
                                }),
                              ],
	                            }),
	                          ],
	                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.codex/auth.json",
                        }),
                        be.jsx(Qa, {
                          value: p,
                          onChange: (W) => h(W.target.value),
                          placeholder: "请输入JSON配置",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
                        }),
                      ],
                    }),
                                      ],
                }),
                                                              be.jsx(SkillsManagerModal, {
                                                                open: skillsModalOpen,
                                                                onClose: () => setSkillsModalOpen(!1),
                                                                platform: O.platform,
                                                                skills: cliSkills,
                                                                directory: skillsDirectory,
                                                                displayDirectory: skillsDisplayDirectory,
                                                                loading: skillsLoading,
                                                                errorText: skillsError,
                                                                pendingName: pendingSkillName,
                                                                onOpenDirectory: openSkillsDirectory,
                                                                onCopy: copyCliSkillTo,
                                                                onDelete: confirmDeleteCliSkill,
                                                              }),
                B(),
              ],
            })
      : be.jsx("div", {
          className: "config-empty-state",
          style: {
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-color-secondary)",
          },
          children: "请从左侧选择一个配置",
        });
  };

const { Header: jk, Sider: zk, Content: Lk } = Li;

const CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY = "(max-width: 920px)";

const shouldOpenConfigMobileNavigationInitially = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia(CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY).matches;

// Config manager layout
const ConfigManagerLayout = () => {
    const { loadConfigs: e, initDefaultConfigs: t } = useConfigStore(),
      [mobileNavigationOpen, setMobileNavigationOpen] = c.useState(
        shouldOpenConfigMobileNavigationInitially,
      ),
      closeMobileNavigation = () => setMobileNavigationOpen(!1),
      closeConfigPanel = () => window.sinitekConfigBridge?.close?.();

    c.useEffect(() => {
      (async () => {
        (await e(), await t(), await e());
      })();
    }, [e, t]);

    c.useEffect(() => {
      if (!mobileNavigationOpen) return;
      const handleKeyDown = (event) => {
        event.key === "Escape" && closeMobileNavigation();
      };
      return (
        window.addEventListener("keydown", handleKeyDown),
        () => window.removeEventListener("keydown", handleKeyDown)
      );
    }, [mobileNavigationOpen]);

    return be.jsxs(Li, {
      className: "config-app-theme",
      style: { height: "100vh" },
      children: [
        be.jsxs(jk, {
          className: "config-app-header",
          style: {
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
          },
          children: [
            be.jsx("button", {
              type: "button",
              className: "config-mobile-directory-button",
              "aria-label": "打开配置目录",
              "aria-controls": "config-directory-panel",
              "aria-expanded": mobileNavigationOpen,
              onClick: () => setMobileNavigationOpen(!0),
              children: be.jsxs("span", {
                className: "config-mobile-directory-icon",
                "aria-hidden": "true",
                children: [be.jsx("span", {}), be.jsx("span", {}), be.jsx("span", {})],
              }),
            }),
            be.jsx("h2", {
              className: "config-app-title",
              style: {
                margin: 0,
              },
              children: "携宁 CLI 配置",
            }),
            be.jsx("button", {
              type: "button",
              className: "config-app-close-button",
              "aria-label": "关闭配置弹窗",
              title: "关闭配置弹窗",
              onClick: closeConfigPanel,
              children: "×",
            }),
          ],
        }),
        be.jsxs(Li, {
          className: "config-app-workspace",
          children: [
            mobileNavigationOpen &&
              be.jsx("button", {
                type: "button",
                className: "config-mobile-sidebar-backdrop",
                "aria-label": "关闭配置目录",
                onClick: closeMobileNavigation,
              }),
            be.jsx(zk, {
              id: "config-directory-panel",
              className: mobileNavigationOpen
                ? "config-app-sidebar config-app-sidebar-open"
                : "config-app-sidebar",
              width: 306,
              style: {
                background: "var(--bg-color-container)",
                borderRight: "1px solid var(--border-color)",
              },
              children: be.jsx(ConfigListPanel, {
                onMobileClose: closeMobileNavigation,
              }),
            }),
            be.jsx(Lk, {
              className: "config-app-content",
              style: { background: "var(--bg-color)" },
              children: be.jsx(ConfigEditorPanel, {}),
            }),
          ],
        }),
      ],
    });
  };

const readConfigVscodeColor = (...variableNames) => {
  const styles = window.getComputedStyle(document.documentElement);
  for (const variableName of variableNames) {
    const value = styles.getPropertyValue(variableName).trim();
    if (value) return value;
  }
  return "transparent";
};

const createConfigVscodeTheme = () => {
  const editorBackground = readConfigVscodeColor("--vscode-editor-background");
  const foreground = readConfigVscodeColor("--vscode-foreground");
  const secondaryForeground = readConfigVscodeColor(
    "--vscode-descriptionForeground",
    "--vscode-foreground",
  );
  const disabledForeground = readConfigVscodeColor(
    "--vscode-disabledForeground",
    "--vscode-descriptionForeground",
    "--vscode-foreground",
  );
  const surface = readConfigVscodeColor(
    "--vscode-editorWidget-background",
    "--vscode-editor-background",
  );
  const surfaceMuted = readConfigVscodeColor(
    "--vscode-input-background",
    "--vscode-editorWidget-background",
    "--vscode-editor-background",
  );
  const border = readConfigVscodeColor(
    "--vscode-widget-border",
    "--vscode-panel-border",
    "--vscode-foreground",
  );
  const focus = readConfigVscodeColor(
    "--vscode-focusBorder",
    "--vscode-textLink-foreground",
    "--vscode-foreground",
  );
  const primary = readConfigVscodeColor(
    "--vscode-button-background",
    "--vscode-textLink-foreground",
    "--vscode-foreground",
  );
  const primaryHover = readConfigVscodeColor(
    "--vscode-button-hoverBackground",
    "--vscode-button-background",
    "--vscode-textLink-activeForeground",
    "--vscode-foreground",
  );
  const primaryForeground = readConfigVscodeColor(
    "--vscode-button-foreground",
    "--vscode-editor-background",
  );
  const link = readConfigVscodeColor(
    "--vscode-textLink-foreground",
    "--vscode-foreground",
  );
  const linkHover = readConfigVscodeColor(
    "--vscode-textLink-activeForeground",
    "--vscode-textLink-foreground",
    "--vscode-foreground",
  );
  const success = readConfigVscodeColor(
    "--vscode-testing-iconPassed",
    "--vscode-charts-green",
    "--vscode-foreground",
  );
  const warning = readConfigVscodeColor(
    "--vscode-editorWarning-foreground",
    "--vscode-charts-yellow",
    "--vscode-foreground",
  );
  const error = readConfigVscodeColor(
    "--vscode-editorError-foreground",
    "--vscode-testing-iconFailed",
    "--vscode-foreground",
  );
  const rowHover = readConfigVscodeColor(
    "--vscode-list-hoverBackground",
    "--vscode-editorWidget-background",
    "--vscode-editor-background",
  );
  const selectedBackground = readConfigVscodeColor(
    "--vscode-list-activeSelectionBackground",
    "--vscode-button-background",
    "--vscode-editorWidget-background",
  );
  const selectedForeground = readConfigVscodeColor(
    "--vscode-list-activeSelectionForeground",
    "--vscode-button-foreground",
    "--vscode-foreground",
  );

  return {
    ...ZB,
    token: {
      ...(ZB.token || {}),
      colorPrimary: primary,
      colorPrimaryHover: primaryHover,
      colorPrimaryActive: primary,
      colorInfo: link,
      colorSuccess: success,
      colorWarning: warning,
      colorError: error,
      colorText: foreground,
      colorTextSecondary: secondaryForeground,
      colorTextTertiary: secondaryForeground,
      colorTextQuaternary: disabledForeground,
      colorTextDisabled: disabledForeground,
      colorTextLightSolid: primaryForeground,
      colorBgBase: editorBackground,
      colorBgContainer: surface,
      colorBgElevated: surface,
      colorBgLayout: editorBackground,
      colorFill: surfaceMuted,
      colorFillSecondary: surfaceMuted,
      colorFillTertiary: surfaceMuted,
      colorFillQuaternary: editorBackground,
      colorBorder: border,
      colorBorderSecondary: border,
      colorLink: link,
      colorLinkHover: linkHover,
      colorLinkActive: linkHover,
      controlOutline: focus,
      borderRadius: 2,
      borderRadiusLG: 2,
      borderRadiusSM: 2,
      boxShadow: "none",
      boxShadowSecondary: "none",
      fontFamily: "var(--vscode-font-family)",
    },
    components: {
      ...(ZB.components || {}),
      Button: {
        ...(ZB.components?.Button || {}),
        defaultBg: surfaceMuted,
        defaultColor: foreground,
        defaultBorderColor: border,
        defaultHoverBg: rowHover,
        defaultHoverColor: foreground,
        defaultHoverBorderColor: focus,
        primaryColor: primaryForeground,
        dangerColor: error,
        dangerBorderColor: error,
        dangerBg: surface,
        primaryShadow: "none",
        dangerShadow: "none",
        borderRadius: 2,
        controlHeight: 36,
      },
      Card: {
        ...(ZB.components?.Card || {}),
        headerBg: surface,
        colorBorderSecondary: border,
      },
      Form: {
        ...(ZB.components?.Form || {}),
        labelColor: foreground,
      },
      Input: {
        ...(ZB.components?.Input || {}),
        activeBorderColor: focus,
        hoverBorderColor: focus,
        activeShadow: "none",
      },
      Layout: {
        ...(ZB.components?.Layout || {}),
        headerBg: editorBackground,
        siderBg: surface,
        bodyBg: editorBackground,
        triggerBg: primary,
        triggerColor: primaryForeground,
      },
      Modal: {
        ...(ZB.components?.Modal || {}),
        headerBg: surface,
        contentBg: surface,
        titleColor: foreground,
        borderRadiusLG: 2,
      },
      Drawer: {
        ...(ZB.components?.Drawer || {}),
        colorBgElevated: surface,
      },
      Table: {
        ...(ZB.components?.Table || {}),
        headerBg: surfaceMuted,
        headerColor: foreground,
        rowHoverBg: rowHover,
      },
      Tree: {
        ...(ZB.components?.Tree || {}),
        nodeHoverBg: rowHover,
        nodeSelectedBg: selectedBackground,
        nodeSelectedColor: selectedForeground,
      },
      Tabs: {
        ...(ZB.components?.Tabs || {}),
        inkBarColor: focus,
        itemActiveColor: foreground,
        itemHoverColor: linkHover,
        itemSelectedColor: foreground,
      },
    },
  };
};

// App root
const ConfigAppRoot = () => {
  const [configVscodeTheme, setConfigVscodeTheme] = c.useState(createConfigVscodeTheme);

  c.useEffect(() => {
    const observer = new MutationObserver(() => {
      setConfigVscodeTheme(createConfigVscodeTheme());
    });
    const themeAttributeOptions = {
      attributes: true,
      attributeFilter: ["class", "style", "data-vscode-theme-id", "data-vscode-theme-kind"],
    };
    observer.observe(document.documentElement, themeAttributeOptions);
    observer.observe(document.body, themeAttributeOptions);
    return () => observer.disconnect();
  }, []);

  return be.jsx(Do, {
    locale: BB,
    theme: configVscodeTheme,
    children: be.jsx(l$, {
      children: be.jsx(iP, {
        children: be.jsxs(LR, {
          children: [
            be.jsx(wu, {
              path: "/",
              element: be.jsx(Wy, { to: "/config", replace: !0 }),
            }),
            be.jsx(wu, { path: "/config", element: be.jsx(ConfigManagerLayout, {}) }),
            be.jsx(wu, {
              path: "*",
              element: be.jsx(Wy, { to: "/config", replace: !0 }),
            }),
          ],
        }),
      }),
    }),
  });
};
G2.createRoot(document.getElementById("root")).render(
  be.jsx(ee.StrictMode, { children: be.jsx(ConfigAppRoot, {}) }),
);
