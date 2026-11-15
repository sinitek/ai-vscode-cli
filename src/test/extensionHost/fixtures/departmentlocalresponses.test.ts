const test = require("node:test") as typeof import("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const http: typeof import("node:http") = require("node:http");
const path = require("node:path") as typeof import("node:path");

const { createLocalResponsesServer } = require(path.resolve(process.cwd(), "scripts/fixtures/codex_local_responses_server.js")) as {
  createLocalResponsesServer(options?: {
    maxRequests?: number;
    respond?: (input: { input?: unknown }, context: { index: number }) => string | Promise<string>;
  }): {
    server: import("node:http").Server;
    requests: Array<{ body: { input?: unknown } }>;
    failures: Array<{ index: number; reason: string }>;
    assertHealthy(): void;
  };
};

async function withServer<T>(fixture: ReturnType<typeof createLocalResponsesServer>, run: (url: string) => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    fixture.server.once("error", reject);
    fixture.server.listen(0, "127.0.0.1", resolve);
  });
  const address = fixture.server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind a TCP port");
  try { return await run(`http://127.0.0.1:${address.port}/v1/responses`); }
  finally { await new Promise<void>((resolve) => fixture.server.close(() => resolve())); }
}

function post(url: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(target, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      let text = "";
      response.setEncoding("utf8"); response.on("data", (part) => { text += part; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
    });
    request.once("error", reject); request.end(JSON.stringify(body));
  });
}

function completedText(sse: string): string | undefined {
  for (const block of sse.split("\n\n")) {
    const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data) as { type?: string; response?: { output?: Array<{ content?: Array<{ text?: string }> }> } };
    if (event.type === "response.completed") return event.response?.output?.[0]?.content?.[0]?.text;
  }
  return undefined;
}

test("department Responses fixture scripts stage-specific decisions and rejects unknown protocol requests", async () => {
  const decisions = [
    { match: "director-root", text: '{"status":"continue","subtasks":[{"title":"module","prompt":"implement module"}]}' },
    { match: "leader-event-batch", text: '{"status":"accept","reviewEventId":"event-1","progressPercent":50}' },
    { match: "employee-attempt", text: "[final_answer] employee complete" },
    { match: "director-report", text: '{"status":"completed","finalSummary":"root complete"}' },
  ];
  const fixture = createLocalResponsesServer({ maxRequests: decisions.length, respond(input, { index }) {
    const prompt = JSON.stringify(input.input);
    const decision = decisions[index - 1];
    assert.ok(decision && prompt.includes(decision.match), `unexpected or out-of-order Responses request ${index}: ${prompt}`);
    return decision.text;
  } });

  await withServer(fixture, async (url) => {
    for (let index = 0; index < decisions.length; index++) {
      const result = await post(url, { model: "local-test", input: decisions[index].match });
      assert.equal(result.status, 200);
      assert.match(result.text, /event: response\.completed/);
      assert.equal(completedText(result.text), decisions[index].text);
    }
    const extra = await post(url, { model: "local-test", input: "unbudgeted request" });
    assert.equal(extra.status, 429);
  });

  assert.equal(fixture.requests.length, decisions.length);
  assert.equal(fixture.failures.length, 1);
  assert.equal(fixture.failures[0].reason, "request-budget-exceeded");
  assert.throws(() => fixture.assertHealthy(), /request-budget-exceeded/);
});

test("department Responses fixture fails closed for an unrecognized request or empty scripted answer", async () => {
  const fixture = createLocalResponsesServer({ maxRequests: 2, respond(input) {
    if (JSON.stringify(input.input).includes("known stage")) return "known";
    throw new Error("unknown-department-prompt");
  } });

  await withServer(fixture, async (url) => {
    assert.equal((await post(url, { input: "known stage" })).status, 200);
    assert.equal((await post(url, { input: "different stage" })).status, 422);
  });
  assert.equal(fixture.failures[0].reason, "unknown-department-prompt");
  assert.throws(() => fixture.assertHealthy(), /unknown-department-prompt/);

  const empty = createLocalResponsesServer({ respond: () => "  " });
  await withServer(empty, async (url) => assert.equal((await post(url, { input: "stage" })).status, 422));
  assert.match(empty.failures[0].reason, /non-empty text/);
});

test("existing Codex drain fixture keeps its static local final-answer behavior by default", async () => {
  const fixture = createLocalResponsesServer();
  await withServer(fixture, async (url) => {
    const first = await post(url, { model: "local-test", input: "first" });
    const second = await post(url, { model: "local-test", input: "second" });
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.match(first.text, /Isolated native drain turn 1/);
    assert.match(second.text, /Isolated native drain turn 2/);
  });
  assert.equal(fixture.failures.length, 0);
  assert.doesNotThrow(() => fixture.assertHealthy());
});
