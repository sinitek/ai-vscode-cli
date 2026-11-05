import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";
import {
  discoverImportModels,
  getModelImportProviders,
  type DiscoverImportModelsPayload,
  type ModelImportModel,
  type ModelImportOptions,
  type ModelImportPayload,
} from "../../config/modelimport";
import type { ModelImportDraft, ModelImportPlatform } from "../../config/modelimporttypes";

type AnyRecord = Record<string, any>;
type EditorNode = { type: unknown; props: AnyRecord };

const source = fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-ui.js"), "utf8");
const values = { base_url: "https://api.example.com/v1", api_key: "example-import-key", model: "got-6.1-sol" };
const seed = "sinitek-discovery-probe";
const exampleKeys = ["claude-settings", "codex-config", "codex-auth", "opencode-settings", "grok-config", "dsh-config", "kimi-code-config", "zcode-config"];
const expectedPlatforms: Record<string, string> = {
  "claude-settings": "claude",
  "codex-config": "codex",
  "codex-auth": "codex",
  "opencode-settings": "opencode",
  "grok-config": "grok",
  "dsh-config": "dsh",
  "kimi-code-config": "kimi-code",
  "zcode-config": "zcode",
};

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `找不到 ${startMarker}`);
  return source.slice(start, end);
}

function nodes(value: unknown): EditorNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as EditorNode;
  return [node, ...nodes(node.props.children)];
}

function loadUtilities(overrides: AnyRecord = {}) {
  const element = (type: unknown, props: AnyRecord) => ({ type, props });
  const sandbox: AnyRecord = {
    URL, Error,
    be: { jsx: element, jsxs: element, Fragment: "fragment" },
    zi: "input", xr: "modal", xn: "button", RE: "drawer",
    $l: { SECRET_COMBOBOX_MODE_DO_NOT_USE: "combobox" },
    KH: "import-icon",
    configPlatformLabel: (platform: string) => platform,
    ...overrides,
  };
  vm.runInNewContext([
    section("function fk(", "const CLI_GLOBAL_SKILL_TARGETS ="),
    section("const DSH_UI_PROVIDER", "const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS"),
    section("// OPENCODE_VISUAL_EDITOR_UTILS_START", "// CODEX_VISUAL_EDITOR_UTILS_END"),
    section("function parseConfigJsonText(", "const GROK_VISUAL_FIELD_IDS"),
    section("const GROK_VISUAL_FIELD_IDS", "// Config editor panel"),
    "globalThis.utils = { build: buildCliExampleImport, validate: validateCliExampleImport, protocol: getCliExampleImportProtocol, platform: cliExampleImportPlatformFor, connectErrors: validateCliExampleImportConnection, discoveryDraft: buildCliExampleImportDiscovery, options: cliExampleImportModelOptions, text: cliExampleImportModelText, modal: CliExampleImportModal };",
  ].join("\n"), sandbox);
  return { sandbox, utils: sandbox.utils as AnyRecord };
}

function connectionValues(utils: AnyRecord, exampleKey: string, extra: AnyRecord = {}) {
  const protocol = utils.protocol(exampleKey);
  return { ...values, ...(protocol ? { protocol: protocol.defaultValue } : {}), ...extra };
}

const tick = () => new Promise<void>((resolve) => { setImmediate(resolve); });

function jsonResponse(body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response;
}

function offlineFetch(payload: { data?: unknown[]; status?: number; fail?: boolean }) {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    if (payload.fail) throw new Error(`不允许的错误细节 ${values.api_key}`);
    if (payload.status) {
      return { ok: false, status: payload.status, headers: { get: () => null }, text: async () => "" } as unknown as Response;
    }
    return jsonResponse({ data: payload.data ?? [] });
  };
  return { fetch: fetch as unknown as ModelImportOptions["fetch"], calls };
}

type HarnessOptions = {
  props?: AnyRecord;
  host?: { providers?: (payload: ModelImportPayload) => unknown; discover?: (payload: DiscoverImportModelsPayload) => unknown };
};

function loadHarness(options: HarnessOptions = {}) {
  let state: unknown[] = [];
  let refs: AnyRecord[] = [];
  let effectSlots: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
  const pendingEffects: Array<{ index: number; deps?: unknown[]; effect: () => void | (() => void) }> = [];
  const imported: AnyRecord[] = [];
  const skipped: AnyRecord[] = [];
  let cursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let closed = 0;
  const calls = { providers: 0, discover: 0 };
  const { utils, sandbox } = loadUtilities({
    getModelImportProviders: (payload: ModelImportPayload) => {
      calls.providers += 1;
      return options.host?.providers ? options.host.providers(payload) : { providers: [{ id: "gateway", baseUrl: values.base_url }] };
    },
    discoverImportModels: (payload: DiscoverImportModelsPayload) => {
      calls.discover += 1;
      return options.host?.discover ? options.host.discover(payload) : { models: [{ id: values.model, label: values.model }], existingModelIds: [seed] };
    },
    c: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => {
          const resolved = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
          if (!Object.is(resolved, state[index])) stateDirty = true;
          state[index] = resolved;
        }];
      },
      useRef: (initial: unknown) => {
        const index = refCursor++;
        return refs[index] ||= { current: initial };
      },
      useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
        const index = effectCursor++;
        const previous = effectSlots[index];
        const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
          || deps.some((dep, position) => !Object.is(dep, previous.deps![position]));
        if (!changed) return;
        pendingEffects.push({ index, deps, effect });
      },
    },
  });
  let stateDirty = false;
  const flushEffects = () => {
    for (const { index, deps, effect } of pendingEffects.splice(0)) {
      effectSlots[index]?.cleanup?.();
      const cleanup = effect();
      effectSlots[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    }
  };
  const render = (onImport: (next: AnyRecord) => unknown = (next) => { imported.push(next); }) => {
    let tree: AnyRecord = {};
    for (let pass = 0; pass < 4; pass += 1) {
      cursor = 0;
      refCursor = 0;
      effectCursor = 0;
      tree = utils.modal({
        onClose: () => { closed += 1; },
        onImport,
        onSkip: (next: AnyRecord) => { skipped.push(next); },
        ...(options.props ?? { exampleKey: "claude-settings" }),
      });
      if (!pendingEffects.length) break;
      flushEffects();
      if (!stateDirty) break;
      stateDirty = false;
    }
    return tree;
  };
  const field = (label: string) => nodes(render()).find((node) => node.props["aria-label"] === label);
  const status = () => nodes(render()).find((node) => node.props.role === "status")!;
  const resolveButton = () => nodes(render()).find((node) => node.props.className === "cli-example-import-resolve")!;
  const connect = (base = values.base_url, key = values.api_key) => {
    field("base_url")!.props.onChange({ target: { value: base } });
    field("api_key")!.props.onChange({ target: { value: key } });
  };
  return {
    utils, sandbox, render, field, status, resolveButton, connect,
    imported, skipped, calls,
    closed: () => closed,
    setProps: (next: AnyRecord) => { options.props = next; },
    remount: (next: AnyRecord) => {
      for (const slot of effectSlots) slot.cleanup?.();
      options.props = next;
      state = [];
      refs = [];
      effectSlots = [];
      return render();
    },
    unmount: () => {
      for (const slot of effectSlots.splice(0)) slot.cleanup?.();
    },
  };
}

test("解析草稿复用范例生成器，七平台八入口与真实宿主 API 兼容且只含临时种子", async () => {
  const { utils } = loadUtilities();
  const fetchFixture = offlineFetch({ data: [{ id: "existing-one", display_name: "现有模型" }, { id: "brand-new" }] });
  for (const exampleKey of exampleKeys) {
    const input = connectionValues(utils, exampleKey);
    assert.equal(utils.platform(exampleKey), expectedPlatforms[exampleKey]);
    const started = utils.discoveryDraft(exampleKey, input);
    assert.equal(started.platform, expectedPlatforms[exampleKey]);
    const draft = started.draft as ModelImportDraft;
    assert.ok(draft.content || draft.configContent, exampleKey);
    if (exampleKey === "codex-auth" || exampleKey === "codex-config") {
      assert.ok(draft.configContent, "codex 配置");
      assert.ok(draft.authContent, "codex 鉴权");
    } else {
      assert.equal(draft.authContent, undefined, exampleKey);
    }
    assert.ok(JSON.stringify([draft.content, draft.configContent, draft.authContent]).includes(seed), `${exampleKey} 临时草稿仅用于解析`);
    const providers = getModelImportProviders({ platform: started.platform as ModelImportPlatform, draft });
    assert.equal(providers.providers.length, 1, exampleKey);
    const provider = providers.providers[0];
    assert.equal(provider.baseUrl, values.base_url, exampleKey);
    assert.equal(provider.disabledReason, undefined, exampleKey);
    const discovered = await discoverImportModels(
      { platform: started.platform as ModelImportPlatform, draft, providerId: provider.id },
      { fetch: fetchFixture.fetch },
    );
    assert.deepEqual(discovered.models.map((model) => model.id), ["existing-one", "brand-new"], exampleKey);
    assert.deepEqual(discovered.existingModelIds, [seed], exampleKey);
    assert.ok(discovered.models.every((model) => model.id !== seed), exampleKey);
    const userDraft = utils.build(exampleKey, input) as ModelImportDraft;
    assert.ok(!Object.values(userDraft).some((part) => String(part ?? "").includes(seed)), `${exampleKey} 临时种子不得进入用户草稿`);
    assert.ok(!JSON.stringify(Object.values(userDraft)).includes(seed), exampleKey);
  }
  assert.ok(!/split\("-"\)\[0\]/.test(source.slice(source.indexOf("CLI_EXAMPLE_IMPORT_PLATFORMS"), source.indexOf("const CLI_EXAMPLE_IMPORT_Z_INDEX"))));
  assert.equal(fetchFixture.calls[0], "https://api.example.com/v1/models");
});

test("同名真实模型不被临时草稿排除，模型列表复用宿主去重与清洗", async () => {
  const { utils } = loadUtilities();
  const fixture = offlineFetch({
    data: [
      { id: values.model, display_name: "同名真实模型" },
      { id: values.model, display_name: "重复项" },
      { id: seed },
      { id: "another-model" },
    ],
  });
  const input = connectionValues(utils, "claude-settings");
  const started = utils.discoveryDraft("claude-settings", input);
  const providers = getModelImportProviders({ platform: "claude", draft: started.draft as ModelImportDraft });
  const result = await discoverImportModels(
    { platform: "claude", draft: started.draft as ModelImportDraft, providerId: providers.providers[0].id },
    { fetch: fixture.fetch },
  );
  assert.deepEqual(result.models.map((model) => model.id), [values.model, seed, "another-model"]);
  assert.deepEqual(result.existingModelIds, [seed]);
  const options = utils.options(result.models) as Array<{ value: string; label: string }>;
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { value: values.model, label: "同名真实模型" },
    { value: seed, label: seed },
    { value: "another-model", label: "another-model" },
  ]);
});

test("初始态不发请求、不可提交，模型控件为禁用的下拉占位", async () => {
  let submitted = 0;
  const harness = loadHarness();
  assert.equal(harness.resolveButton().props.disabled, true);
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  assert.equal(harness.field("模型名称")!.props.placeholder, "填写地址和密钥后解析模型");
  assert.equal(harness.status().props["aria-live"], "polite");
  assert.equal(harness.status().props["data-state"], "idle");
  harness.render(() => { submitted += 1; }).props.onOk();
  assert.equal(harness.calls.providers, 0);
  assert.equal(harness.calls.discover, 0);
  assert.equal(submitted, 0);
  harness.connect();
  assert.equal(harness.resolveButton().props.disabled, false);
  assert.equal(harness.calls.providers, 0);
  harness.field("base_url")!.props.onChange({ target: { value: "ftp://example.com" } });
  assert.equal(harness.resolveButton().props.disabled, true);
  assert.equal(harness.calls.providers, 0);
});

test("解析成功切换为可搜索下拉，允许改选后提交且密钥不外泄", async () => {
  const harness = loadHarness({
    host: {
      discover: async () => ({
        models: [{ id: "got-6.1-sol", label: "GOT 6.1" }, { id: "got-6.1-pro", label: `GOT ${values.api_key}` }],
        existingModelIds: [seed],
      }),
    },
  });
  harness.connect();
  await harness.resolveButton().props.onClick();
  const select = harness.field("模型名称")!;
  assert.equal(select.props.type, undefined);
  assert.ok(Array.isArray(select.props.options));
  assert.equal(select.props.showSearch, true);
  assert.deepEqual(JSON.parse(JSON.stringify(select.props.options)), [{ value: "got-6.1-sol", label: "GOT 6.1" }, { value: "got-6.1-pro", label: `GOT ${values.api_key}` }]);
  assert.equal(select.props.value, "got-6.1-sol");
  assert.equal(harness.status().props["data-state"], "success");
  assert.ok(!String(harness.status().props.children).includes(values.api_key));
  assert.equal(harness.field("api_key")!.props.type, "password");
  select.props.onChange("got-6.1-pro");
  assert.equal(harness.field("模型名称")!.props.value, "got-6.1-pro");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 1);
  assert.equal(harness.imported[0].model, "got-6.1-pro");
  assert.equal(harness.imported[0].api_key, values.api_key);
  assert.ok(!JSON.stringify(harness.imported[0]).includes(seed));
  assert.equal(harness.calls.providers, 1);
  assert.equal(harness.calls.discover, 1);
});

test("网络失败、空结果、协议不支持与禁用 Provider 均回退手动输入，重试成功后恢复下拉", async () => {
  const failures: Array<() => HarnessOptions["host"]> = [
    () => ({ discover: async () => { throw new Error(`请求失败 ${values.api_key}`); } }),
    () => ({ discover: async () => ({ models: [], existingModelIds: [seed] }) }),
    () => ({ providers: async () => ({ providers: [{ id: "gateway", baseUrl: values.base_url, protocol: "unsupported", mode: "multi", label: "gateway", disabledReason: "该 OpenCode provider 的 npm 协议未知，未套用 OpenAI 兼容接口。" }] }) }),
    () => ({ providers: async () => ({ providers: [{ id: "gateway", baseUrl: values.base_url, protocol: "unsupported", mode: "multi", label: "gateway", disabledReason: "未知类型" }] }) }),
  ];
  for (const host of failures) {
    const harness = loadHarness({ host: host() });
    harness.connect();
    await harness.resolveButton().props.onClick();
    const manual = harness.field("模型名称")!;
    assert.equal(manual.props.type, "text", "回退为文本输入");
    assert.equal(harness.status().props["data-state"], "failure");
    assert.ok(!String(harness.status().props.children).includes(values.api_key));
    assert.ok(!JSON.stringify(nodes(harness.render()).filter((node) => node.props.role === "alert" || node.props.role === "status")).includes(values.api_key));
    assert.equal(manual.props.value, "");
    manual.props.onChange({ target: { value: "manual-model" } });
    assert.equal(harness.field("模型名称")!.props.value, "manual-model");
    assert.equal(harness.resolveButton().props.children, "重新解析");
  }
  let succeed = false;
  const harness = loadHarness({
    host: {
      discover: async () => {
        if (!succeed) throw new Error("请求失败");
        return { models: [{ id: "got-6.1-sol", label: "got-6.1-sol" }], existingModelIds: [seed] };
      },
    },
  });
  harness.connect();
  await harness.resolveButton().props.onClick();
  assert.equal(harness.field("模型名称")!.props.type, "text");
  succeed = true;
  await harness.resolveButton().props.onClick();
  assert.ok(Array.isArray(harness.field("模型名称")!.props.options));
  assert.equal(harness.field("模型名称")!.props.value, "got-6.1-sol");
  assert.equal(harness.status().props["data-state"], "success");
});

test("手动回退仍走最终校验，空模型与非法地址不会提交", async () => {
  const harness = loadHarness({ host: { discover: async () => { throw new Error("失败"); } } });
  harness.connect();
  await harness.resolveButton().props.onClick();
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 0);
  assert.ok(nodes(harness.render()).some((node) => node.props.role === "alert" && String(node.props.children).includes("模型名称")));
  harness.field("模型名称")!.props.onChange({ target: { value: "a\nb" } });
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 0);
  harness.field("模型名称")!.props.onChange({ target: { value: "manual-model" } });
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 1);
  assert.equal(harness.imported[0].model, "manual-model");
});

test("地址、密钥与协议变更清空旧结果并作废在途请求", async () => {
  const harness = loadHarness();
  harness.connect();
  await harness.resolveButton().props.onClick();
  assert.ok(Array.isArray(harness.field("模型名称")!.props.options));
  harness.field("base_url")!.props.onChange({ target: { value: "https://api.other.example.com/v1" } });
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  assert.equal(harness.field("模型名称")!.props.value, undefined);
  assert.equal(harness.status().props["data-state"], "idle");

  const releases: Array<(value: unknown) => void> = [];
  const harness2 = loadHarness({ host: { discover: () => new Promise((resolve) => { releases.push(resolve); }) } });
  harness2.connect();
  const pending = harness2.resolveButton().props.onClick();
  await tick();
  harness2.field("api_key")!.props.onChange({ target: { value: "rotated-key" } });
  assert.equal(harness2.status().props["data-state"], "idle");
  releases[0]({ models: [{ id: "stale-model", label: "stale-model" }], existingModelIds: [] });
  await pending;
  assert.equal(harness2.status().props["data-state"], "idle");
  assert.equal(harness2.field("模型名称")!.props.value, undefined);

  harness2.field("base_url")!.props.onChange({ target: { value: values.base_url } });
  harness2.field("api_key")!.props.onChange({ target: { value: values.api_key } });
  const retried = harness2.resolveButton().props.onClick();
  await tick();
  releases[1]({ models: [{ id: "fresh-model", label: "fresh-model" }], existingModelIds: [] });
  await retried;
  assert.equal(harness2.status().props["data-state"], "success");
  assert.equal(harness2.field("模型名称")!.props.value, "fresh-model");
});

test("乱序响应、关闭与卸载后到达的结果不覆盖新状态", async () => {
  const releases: Array<(value: unknown) => void> = [];
  const host = { discover: () => new Promise((resolve) => { releases.push(resolve); }) };
  const harness = loadHarness({ host });
  harness.connect();
  const first = harness.resolveButton().props.onClick();
  await tick();
  harness.field("base_url")!.props.onChange({ target: { value: "https://api.second.example.com/v1" } });
  harness.field("api_key")!.props.onChange({ target: { value: "second-key" } });
  const second = harness.resolveButton().props.onClick();
  await tick();
  releases[1]({ models: [{ id: "second-model", label: "second-model" }], existingModelIds: [] });
  await second;
  assert.equal(harness.field("模型名称")!.props.value, "second-model");
  releases[0]({ models: [{ id: "first-model", label: "first-model" }], existingModelIds: [] });
  await first;
  assert.equal(harness.field("模型名称")!.props.value, "second-model");

  const closingReleases: Array<(value: unknown) => void> = [];
  const closing = loadHarness({ host: { discover: () => new Promise((resolve) => { closingReleases.push(resolve); }) } });
  closing.connect();
  const pending = closing.resolveButton().props.onClick();
  await tick();
  closing.render().props.onCancel();
  assert.equal(closing.closed(), 1);
  closingReleases[0]({ models: [{ id: "closed-model", label: "closed-model" }], existingModelIds: [] });
  await pending;
  assert.equal(closing.field("模型名称")!.props.value, undefined);
  assert.equal(closing.imported.length, 0);

  const unmountReleases: Array<(value: unknown) => void> = [];
  const unmounted = loadHarness({ host: { discover: () => new Promise((resolve) => { unmountReleases.push(resolve); }) } });
  unmounted.connect();
  const inflight = unmounted.resolveButton().props.onClick();
  await tick();
  unmounted.unmount();
  unmountReleases[0]({ models: [{ id: "unmounted-model", label: "unmounted-model" }], existingModelIds: [] });
  await inflight;
  assert.equal(unmounted.field("模型名称")!.props.value, undefined);
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("解析期间修改配置名称，成功与失败响应都保留最新名称且提交使用最新值", async () => {
  const pending = deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>();
  const harness = loadHarness({ props: { platform: "codex" }, host: { discover: () => pending.promise } });
  harness.connect();
  const nameField = () => harness.field("配置名称")!;
  assert.equal(nameField().props.disabled, false);
  nameField().props.onChange({ target: { value: "A" } });
  const request = harness.resolveButton().props.onClick();
  await tick();
  assert.equal(harness.status().props["data-state"], "loading");
  assert.equal(nameField().props.disabled, false, "解析中名称仍可编辑");
  nameField().props.onChange({ target: { value: "B" } });
  pending.resolve({ models: [{ id: "offline-model", label: "offline-model" }], existingModelIds: [] });
  await request;
  assert.equal(nameField().props.value, "B");
  assert.equal(harness.status().props["data-state"], "success");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 1);
  assert.equal(harness.imported[0].name, "B");
  assert.equal(harness.imported[0].model, "offline-model");
});

test("失败与重试同样保留解析期间输入的最新配置名称与其他字段", async () => {
  let attempt = 0;
  const attempts: Array<Deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>> = [];
  const harness = loadHarness({
    props: { platform: "codex" },
    host: {
      discover: () => {
        attempt += 1;
        const pending = deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>();
        attempts.push(pending);
        return pending.promise;
      },
    },
  });
  harness.connect();
  harness.field("配置名称")!.props.onChange({ target: { value: "A" } });
  const first = harness.resolveButton().props.onClick();
  await tick();
  harness.field("配置名称")!.props.onChange({ target: { value: "B" } });
  attempts[0].reject(new Error("解析失败"));
  await first;
  assert.equal(harness.status().props["data-state"], "failure");
  assert.equal(harness.field("配置名称")!.props.value, "B");
  assert.equal(harness.field("base_url")!.props.value, values.base_url);
  const retry = harness.resolveButton().props.onClick();
  await tick();
  harness.field("配置名称")!.props.onChange({ target: { value: "C" } });
  attempts[1].resolve({ models: [{ id: "retry-model", label: "retry-model" }], existingModelIds: [] });
  await retry;
  assert.equal(attempt, 2);
  assert.equal(harness.status().props["data-state"], "success");
  assert.equal(harness.field("配置名称")!.props.value, "C");
  assert.equal(harness.field("模型名称")!.props.value, "retry-model");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 1);
  assert.equal(harness.imported[0].name, "C");
  assert.equal(harness.imported[0].model, "retry-model");
});

test("目标平台切换后旧成功响应不能建立成功态，也不能提交旧模型", async () => {
  const pending = deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>();
  const harness = loadHarness({ props: { platform: "codex" }, host: { discover: () => pending.promise } });
  harness.connect();
  const request = harness.resolveButton().props.onClick();
  await tick();
  harness.setProps({ platform: "claude" });
  pending.resolve({ models: [{ id: "offline-model", label: "offline-model" }], existingModelIds: [] });
  await request;
  assert.equal(harness.status().props["data-state"], "idle");
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  assert.equal(harness.field("模型名称")!.props.value, undefined);
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 0, "未解析的新目标不可提交");
  assert.equal(harness.calls.providers, 1);
});

test("目标切换后旧失败不能放开手填授权，已有成功与手填态都回到未解析", async () => {
  const failures: Array<Deferred<never>> = [];
  const harness = loadHarness({
    props: { platform: "codex" },
    host: {
      discover: () => {
        const pending = deferred<never>();
        failures.push(pending);
        return pending.promise;
      },
    },
  });
  harness.connect();
  const request = harness.resolveButton().props.onClick();
  await tick();
  harness.setProps({ platform: "claude" });
  failures[0].reject(new Error("旧目标失败"));
  await request;
  assert.equal(harness.status().props["data-state"], "idle");
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  assert.deepEqual(Array.from(harness.field("模型名称")!.props.options as unknown[]), []);

  const host: HarnessOptions["host"] = {
    discover: async () => ({ models: [{ id: "offline-model", label: "offline-model" }], existingModelIds: [] }),
  };
  const success = loadHarness({ props: { platform: "codex" }, host });
  success.connect();
  await success.resolveButton().props.onClick();
  assert.equal(success.status().props["data-state"], "success");
  success.setProps({ platform: "claude" });
  assert.equal(success.status().props["data-state"], "idle");
  assert.equal(success.field("模型名称")!.props.disabled, true);
  assert.equal(success.field("模型名称")!.props.value, undefined);

  const manual = loadHarness({ props: { platform: "codex" }, host: { discover: async () => { throw new Error("失败"); } } });
  manual.connect();
  await manual.resolveButton().props.onClick();
  assert.equal(manual.field("模型名称")!.props.type, "text");
  manual.setProps({ platform: "claude" });
  assert.equal(manual.status().props["data-state"], "idle");
  assert.equal(manual.field("模型名称")!.props.disabled, true);
  assert.equal(manual.field("模型名称")!.props.value, undefined);
});

test("目标切换后按新目标初始化协议默认值，新发现可提交到新平台", async () => {
  const harness = loadHarness({ props: { platform: "codex" } });
  assert.equal(harness.field("API 协议类型")!.props.value, "responses");
  harness.connect();
  await harness.resolveButton().props.onClick();
  assert.ok(Array.isArray(harness.field("模型名称")!.props.options));
  harness.setProps({ platform: "grok" });
  const protocolField = harness.field("API 协议类型")!;
  assert.equal(protocolField.props.value, "responses");
  assert.equal(harness.status().props["data-state"], "idle");
  assert.equal(harness.field("模型名称")!.props.value, undefined);
  await harness.resolveButton().props.onClick();
  assert.equal(harness.status().props["data-state"], "success");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 1);
  assert.equal(harness.imported[0].model, values.model);
  assert.equal(harness.imported[0].protocol, "responses");
  assert.equal(harness.calls.discover, 2);

  const drawer = loadHarness({ props: { exampleKey: "codex-config" } });
  drawer.connect();
  drawer.setProps({ exampleKey: "claude-settings" });
  assert.equal(drawer.status().props["data-state"], "idle");
  assert.equal(nodes(drawer.render()).some((node) => node.props["aria-label"] === "API 协议类型"), false, "Claude 不展示协议");
  await drawer.resolveButton().props.onClick();
  assert.equal(drawer.status().props["data-state"], "success");
});

test("目标切换按新平台重建默认配置名称，用户自定义名称保留", async () => {
  const harness = loadHarness({ props: { platform: "codex" } });
  const original = harness.field("配置名称")!.props.value as string;
  assert.match(original, /^Codex 配置 \d+$/);
  harness.setProps({ platform: "grok" });
  const renamed = harness.field("配置名称")!.props.value as string;
  assert.match(renamed, /^Grok 配置 \d+$/);
  assert.notEqual(renamed, original);
  harness.field("配置名称")!.props.onChange({ target: { value: "自定义名称" } });
  harness.setProps({ platform: "claude" });
  assert.equal(harness.field("配置名称")!.props.value, "自定义名称");
});

test("按身份 key 真实重挂载后新实例从空白未解析态开始，旧实例迟到响应无副作用", async () => {
  const pending = deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>();
  const harness = loadHarness({ props: { platform: "codex" }, host: { discover: () => pending.promise } });
  harness.connect();
  harness.field("配置名称")!.props.onChange({ target: { value: "旧实例名称" } });
  const request = harness.resolveButton().props.onClick();
  await tick();
  assert.equal(harness.status().props["data-state"], "loading");
  const tree = harness.remount({ platform: "claude" });
  assert.equal(nodes(tree).find((node) => node.props.role === "status")!.props["data-state"], "idle");
  assert.equal(harness.field("base_url")!.props.value, "");
  assert.equal(harness.field("api_key")!.props.value, "");
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  assert.equal(nodes(tree).some((node) => node.props["aria-label"] === "API 协议类型"), false, "Claude 无协议字段");
  pending.resolve({ models: [{ id: "stale-codex-model", label: "stale-codex-model" }], existingModelIds: [] });
  await request;
  assert.equal(harness.status().props["data-state"], "idle");
  assert.equal(harness.field("模型名称")!.props.value, undefined);
  assert.equal(harness.field("base_url")!.props.value, "");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 0, "新实例未解析不可提交");
});

test("目标切换后旧请求结束不清除新请求的 loading 与结果", async () => {
  const requests: Array<Deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>> = [];
  const harness = loadHarness({
    props: { platform: "codex" },
    host: {
      discover: () => {
        const pending = deferred<{ models: Array<{ id: string; label: string }>; existingModelIds: string[] }>();
        requests.push(pending);
        return pending.promise;
      },
    },
  });
  harness.connect();
  const first = harness.resolveButton().props.onClick();
  await tick();
  assert.equal(requests.length, 1);
  harness.setProps({ platform: "claude" });
  const second = harness.resolveButton().props.onClick();
  await tick();
  assert.equal(requests.length, 2);
  assert.equal(harness.status().props["data-state"], "loading");
  requests[0].resolve({ models: [{ id: "stale-codex-model", label: "stale-codex-model" }], existingModelIds: [] });
  await first;
  assert.equal(harness.status().props["data-state"], "loading", "旧请求结束不得清除新请求 loading");
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  requests[1].resolve({ models: [{ id: "fresh-claude-model", label: "fresh-claude-model" }], existingModelIds: [] });
  await second;
  assert.equal(harness.status().props["data-state"], "success");
  assert.equal(harness.field("模型名称")!.props.value, "fresh-claude-model");
});

test("保存失败保留模型选择，保存中禁用重复提交与解析", async () => {
  let submissions = 0;
  let rejectSave: (error: Error) => void = () => undefined;
  const harness = loadHarness();
  harness.connect();
  await harness.resolveButton().props.onClick();
  const pending = harness.render(() => {
    submissions += 1;
    return new Promise((_resolve, reject) => { rejectSave = reject; });
  }).props.onOk();
  assert.equal(submissions, 1);
  assert.equal(harness.resolveButton().props.disabled, true);
  assert.equal(harness.field("base_url")!.props.disabled, true);
  assert.equal(harness.field("模型名称")!.props.disabled, true);
  await harness.render().props.onOk();
  assert.equal(submissions, 1);
  rejectSave(new Error("保存失败"));
  await pending;
  assert.equal(harness.field("模型名称")!.props.value, values.model);
  assert.equal(harness.render().props.open, true);
  await harness.render(() => { submissions += 1; }).props.onOk();
  assert.equal(submissions, 2);
});

test("跳过不写入草稿、不触发解析请求，取消关闭不导入", async () => {
  const harness = loadHarness({ props: { platform: "codex" } });
  const footer = harness.render().props.footer as EditorNode[];
  assert.deepEqual(Array.from(footer, (button) => String(button.props.children)), ["取消", "创建配置", "跳过"]);
  await footer[2].props.onClick();
  assert.equal(harness.skipped.length, 1);
  assert.equal(harness.imported.length, 0);
  assert.equal(harness.calls.providers, 0);
  assert.equal(harness.calls.discover, 0);
  footer[0].props.onClick();
  assert.equal(harness.closed(), 1);
  assert.equal(harness.imported.length, 0);
  assert.equal(harness.skipped.length, 1);
});

test("拒绝展示宿主原始错误文本，仅使用固定中文提示", async () => {
  const harness = loadHarness({
    host: { providers: async () => { throw new Error(`Provider returned HTTP 401 for ${values.api_key}`); } },
  });
  harness.connect();
  await harness.resolveButton().props.onClick();
  const visible = nodes(harness.render()).filter((node) => node.props.role === "alert" || node.props.role === "status"
    || String(node.props.className || "").includes("grok-model-copy-hint"));
  const text = JSON.stringify(visible);
  assert.ok(!text.includes("HTTP 401"));
  assert.ok(!text.includes(values.api_key));
  assert.equal(harness.status().props["data-state"], "failure");
  assert.ok(text.includes("未能解析模型，可手动填写模型名称"));
});

test("七类范例的协议候选与临时种子不进入候选或提交负载", async () => {
  const { utils } = loadUtilities();
  const models: ModelImportModel[] = [{ id: values.model, label: values.model }];
  for (const exampleKey of exampleKeys) {
    const input = connectionValues(utils, exampleKey);
    const draft = utils.build(exampleKey, input) as ModelImportDraft;
    assert.ok(!JSON.stringify([draft.content, draft.configContent, draft.authContent]).includes(seed), exampleKey);
    assert.ok(JSON.stringify([draft.content, draft.configContent, draft.authContent]).includes(values.model), exampleKey);
    assert.ok(models.every((model) => model.id !== seed));
  }
});
