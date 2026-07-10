import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as path from "path";
import * as vm from "node:vm";

type ExampleModel = {
  name: string;
  reasoning: boolean;
  options: Record<string, unknown>;
  variants: Record<string, Record<string, unknown>>;
};

type OpenCodeExample = {
  $schema: string;
  model: string;
  small_model: string;
  provider: Record<
    string,
    {
      npm: string;
      name: string;
      options: Record<string, unknown>;
      models: Record<string, ExampleModel>;
    }
  >;
  mcp: Record<string, unknown>;
};

function loadVisualParser(source: string): (content: string) => any {
  const start = source.indexOf("// OPENCODE_VISUAL_EDITOR_UTILS_START");
  const end = source.indexOf("// OPENCODE_VISUAL_EDITOR_UTILS_END");
  assert.notEqual(start, -1, "visual utility start marker should exist");
  assert.notEqual(end, -1, "visual utility end marker should exist");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\n;globalThis.__parse = OpenCodeConfigVisualEditorUtils.parseContent;`,
    sandbox,
  );
  return sandbox.__parse as (content: string) => any;
}

test("OpenCode config page exposes a parseable myAPI dual-model example", async () => {
  const uiScript = await fs.readFile(
    path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js"),
    "utf-8",
  );
  const exampleMatch = /opencode:\s*\{\s*settings:\s*`([\s\S]*?)`,\s*\}/.exec(uiScript);

  assert.ok(exampleMatch, "OpenCode config example should remain embedded in the config page");

  const exampleText = exampleMatch[1];
  const example = JSON.parse(exampleText) as OpenCodeExample;
  const provider = example.provider.myAPI;
  const mainModel = provider.models["main-chat-model"];
  const smallModel = provider.models["small-task-model"];

  assert.equal(example.$schema, "https://opencode.ai/config.json");
  assert.equal(example.model, "myAPI/main-chat-model");
  assert.equal(example.small_model, "myAPI/small-task-model");
  assert.deepEqual(Object.keys(example.provider), ["myAPI"]);
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
  assert.equal(provider.options.baseURL, "{env:MY_API_BASE_URL}");
  assert.equal(provider.options.apiKey, "{env:MY_API_KEY}");
  assert.deepEqual(Object.keys(provider.models).sort(), ["main-chat-model", "small-task-model"]);
  assert.equal(mainModel.options.reasoningEffort, "medium");
  assert.equal(mainModel.variants.low.reasoningEffort, "low");
  assert.equal(mainModel.variants.high.reasoningEffort, "high");
  assert.equal(smallModel.options.reasoningEffort, "low");
  assert.equal(smallModel.variants.low.reasoningEffort, "low");
  assert.equal(smallModel.variants.high.reasoningEffort, "high");
  assert.ok(example.mcp.example);
  assert.doesNotMatch(exampleText, /PackyAPI/i);
  assert.doesNotMatch(exampleText, /\.env/i);

  const visual = loadVisualParser(uiScript)(exampleText);
  assert.equal(visual.ok, true);
  assert.equal(visual.state.providers[0].id, "myAPI");
  assert.deepEqual(
    Array.from(visual.state.providers[0].models, (model: any) => model.name),
    ["Main Chat Model", "Small Task Model"],
  );
});
