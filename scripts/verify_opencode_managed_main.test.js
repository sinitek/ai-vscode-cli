"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { parseArgs, classify } = require("./verify_opencode_managed_main");
test("managed main verifier rejects missing, duplicate, relative and unknown parameters", () => {
  assert.deepEqual(parseArgs(["--product", "/tmp/product", "--report", "/tmp/report"]), { product: "/tmp/product", report: "/tmp/report" });
  for (const args of [[], ["--product"], ["--product", "relative"], ["--unknown", "/tmp/x"],
    ["--product", "/tmp/a", "--product", "/tmp/b", "--report", "/tmp/c"]]) assert.throws(() => parseArgs(args));
});
test("tool fixture requires actual read and deny results before exact final answer and rejects replay", () => {
  const state = { stage: 0, titles: 0 }, input = { model: "native-drain", tools: [{ function: { name: "read" } }],
    messages: [{ role: "user", content: "MANAGED_MAIN_TOOL_CONTRACT" }] };
  const tools = classify(input, state, "/isolated/yes", "/isolated/no", "token");
  assert.equal(tools.calls.length, 2); assert.equal(tools.finish, "tool_calls");
  assert.throws(() => classify(input, state, "a", "b", "token"), /duplicate/);
  const follow = { ...input, messages: [...input.messages, { role: "tool", tool_call_id: "call_isolated_0", content: "token" },
    { role: "tool", tool_call_id: "call_isolated_1", content: "Permission denied" }] };
  assert.throws(() => classify({ ...follow, messages: follow.messages.slice(0, 2) }, state, "a", "b", "token"), /both native/);
  assert.equal(classify(follow, state, "a", "b", "token").content, "[final_answer] MANAGED_MAIN_READ_OK token");
  assert.throws(() => classify(follow, state, "a", "b", "token"), /unexpected follow-up/);
});
test("unknown prompts and title overflow fail; title never advances execution", () => {
  const state = { stage: 0, titles: 0 };
  assert.throws(() => classify({ model: "native-drain", messages: [{ role: "user", content: "continue" }] }, state), /unknown/);
  const title = { model: "native-drain", messages: [{ role: "system", content: "You are a title generator" }] };
  classify(title, state); classify(title, state); assert.equal(state.stage, 0); assert.throws(() => classify(title, state), /budget/);
});
