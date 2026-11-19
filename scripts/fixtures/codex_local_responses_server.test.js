"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocalResponsesServer } = require("./codex_local_responses_server");

async function request(server, body) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

test("local Responses fixture streams a native function call and keeps ordinary text behavior", async (t) => {
  const fixture = createLocalResponsesServer({ respond: (_body, context) => context.index === 1
    ? { type: "function_call", call_id: "call-safe", name: "shell", arguments: { command: "printf fixed" } }
    : "ordinary completion" });
  await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => fixture.server.close(resolve)));

  const tool = await request(fixture.server, { input: [] });
  assert.equal(tool.status, 200);
  assert.match(tool.text, /event: response\.output_item\.added/);
  assert.match(tool.text, /"type":"function_call"/);
  assert.match(tool.text, /event: response\.function_call_arguments\.delta/);
  assert.match(tool.text, /event: response\.function_call_arguments\.done/);
  assert.match(tool.text, /"call_id":"call-safe"/);
  assert.match(tool.text, /event: response\.completed/);

  const ordinary = await request(fixture.server, { input: [] });
  assert.equal(ordinary.status, 200);
  assert.match(ordinary.text, /event: response\.output_text\.delta/);
  assert.match(ordinary.text, /ordinary completion/);
  fixture.assertHealthy();
  assert.equal(fixture.requests.length, 2);
});
