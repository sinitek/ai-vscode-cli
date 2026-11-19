"use strict";
const http = require("node:http");

/** OpenAI-compatible chat protocol, NOT the Codex Responses protocol. This
 * provider offers text only; it never issues tools or contacts another host. */
function createOpenCodeLocalProvider(options = {}) {
  const requests = [], failures = [];
  if (options.respond !== undefined && typeof options.respond !== "function") throw new Error("invalid-provider-respond");
  const maxRequests = options.maxRequests ?? 8;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 32) throw new Error("invalid-provider-budget");
  const server = http.createServer((req, res) => {
    const reject = (status, reason) => {
      failures.push(reason); req.resume();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: reason, type: "invalid_request_error" } }));
    };
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") return reject(404, "unexpected-provider-endpoint");
    if (req.headers.authorization !== "Bearer isolated-free-provider") return reject(401, "unexpected-provider-auth");
    let body = "", size = 0, over = false;
    req.setEncoding("utf8");
    req.on("data", chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 1024 * 1024) over = true;
      else body += chunk;
    });
    req.on("error", () => failures.push("provider-request-interrupted"));
    req.on("end", async () => {
      if (over) return reject(413, "provider-body-limit");
      let input;
      try { input = JSON.parse(body); } catch { return reject(400, "provider-invalid-json"); }
      if (!input || input.model !== "native-drain" || !Array.isArray(input.messages) || !input.messages.length
        || !input.messages.every(m => m && ["system", "developer", "user", "assistant", "tool"].includes(m.role))
        || typeof input.stream !== "boolean") return reject(422, "provider-invalid-chat-request");
      if (requests.length >= maxRequests) return reject(429, "provider-request-budget-exceeded");
      const users = input.messages.filter(m => m.role === "user");
      const last = JSON.stringify(users.at(-1)?.content ?? "");
      const title = input.messages.some(m => ["system", "user"].includes(m.role)
        && /You are a title generator|Generate a title for this conversation:/.test(JSON.stringify(m.content)));
      const turn = title ? null : /NATIVE_DRAIN_ROUND_2/.test(last) ? 2 : /NATIVE_DRAIN_ROUND_1/.test(last) ? 1 : null;
      // Title/summarization may use a non-streaming call. It is recorded, bounded
      // and answered by this same free provider, never by a remote small model.
      let text = input.stream && turn ? `NATIVE_DRAIN_TURN_${turn}_OK` : "Isolated native drain verification";
      const id = `chatcmpl-isolated-${requests.length + 1}`;
      const record = { index: requests.length + 1, model: input.model, stream: input.stream, purpose: title ? "title" : "task", turn,
        roles: input.messages.map(m => m.role), userMessages: users.length, responseText: text, at: Date.now() };
      requests.push(record);
      if (options.respond) {
        record.body = input;
        try {
          text = await options.respond(input, { index: record.index, request: record, purpose: record.purpose });
          if (typeof text !== "string" || !text.trim()) throw new Error("provider-empty-scripted-response");
          record.responseText = text;
        } catch (error) { return reject(422, `provider-scripted-protocol:${error instanceof Error ? error.message : String(error)}`); }
      }
      const base = { id, object: "chat.completion.chunk", created: 1, model: "native-drain" };
      if (!input.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0,
          message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base,
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      emit({ role: "assistant", content: "" });
      emit({ content: text.slice(0, 10) }); emit({ content: text.slice(10) }); emit({}, "stop");
      res.end("data: [DONE]\n\n");
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, requests, failures, maxRequests,
    async listen() {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      return `http://127.0.0.1:${server.address().port}/v1`;
    },
    async close() {
      if (!server.listening) return;
      const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
      server.closeAllConnections(); await closed;
    },
    assertHealthy() { if (failures.length) throw new Error(`local-provider-failed:${failures.join(",")}`); },
  };
}
module.exports = { createOpenCodeLocalProvider };
