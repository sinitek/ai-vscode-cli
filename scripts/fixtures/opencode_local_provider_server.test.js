"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenCodeLocalProvider } = require("./opencode_local_provider_server");
const chat = (stream = true, text = "current runtime prompt") => ({ model: "native-drain", stream, messages: [{ role: "user", content: text }] });
async function post(base, body) {
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { authorization: "Bearer isolated-free-provider", "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, text: await response.text() };
}
test("optional controlled respond receives exact Chat request and handles JSON/SSE without altering native defaults", async () => {
  const seen = [], p = createOpenCodeLocalProvider({ maxRequests: 3, respond: async (body, context) => {
    seen.push({ body, index: context.index, purpose: context.purpose }); context.request.stage = "controlled"; return "exact-stage-response";
  } });
  const base = await p.listen();
  try {
    assert.equal(p.server.address().address, "127.0.0.1");
    const json = await post(base, chat(false)); assert.equal(json.status, 200);
    assert.equal(JSON.parse(json.text).choices[0].message.content, "exact-stage-response");
    const sse = await post(base, chat()); assert.equal(sse.status, 200);
    const chunks = sse.text.split("\n\n").filter(Boolean).map(line => line.slice(6)); assert.equal(chunks.pop(), "[DONE]");
    assert.equal(chunks.map(line => JSON.parse(line).choices[0].delta.content || "").join(""), "exact-stage-response");
    assert.deepEqual(seen.map(x => x.index), [1, 2]); assert.deepEqual(seen[0].body, chat(false));
    assert.ok(p.requests.every(x => x.stage === "controlled")); p.assertHealthy();
  } finally { await p.close(); }
});
test("scripted unknown/empty answers and budget are failures, never generic success", async () => {
  for (const respond of [() => { throw new Error("unknown-runtime-stage"); }, () => ""]) {
    const p = createOpenCodeLocalProvider({ maxRequests: 1, respond }), base = await p.listen();
    try {
      assert.equal((await post(base, chat())).status, 422); assert.throws(() => p.assertHealthy(), /protocol/);
      assert.equal((await post(base, chat())).status, 429); assert.equal(p.requests.length, 1);
    } finally { await p.close(); }
  }
});
test("title request is separately recorded and delegated to the controlled protocol", async () => {
  const p = createOpenCodeLocalProvider({ respond: (_body, context) => { assert.equal(context.purpose, "title"); return "bounded title"; } }), base = await p.listen();
  try {
    const body = chat(false); body.messages.unshift({ role: "system", content: "You are a title generator." });
    assert.equal((await post(base, body)).status, 200); assert.equal(p.requests[0].purpose, "title"); p.assertHealthy();
  } finally { await p.close(); }
});
