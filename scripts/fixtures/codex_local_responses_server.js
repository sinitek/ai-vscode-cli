"use strict";

const http = require("node:http");

function response(id, text) {
  const message = { id: `${id}_message`, type: "message", status: "completed", role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }] };
  return { id, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed",
    error: null, incomplete_details: null, model: "local-test", output: [message], parallel_tool_calls: false,
    usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
}

function event(res, type, payload) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function createLocalResponsesServer(options = {}) {
  const requests = [];
  const failures = [];
  const maxRequests = Number.isSafeInteger(options.maxRequests) && options.maxRequests >= 0
    ? options.maxRequests : Number.POSITIVE_INFINITY;
  const respond = typeof options.respond === "function"
    ? options.respond
    : (_request, context) => `[final_answer] Isolated native drain turn ${context.index}.`;
  let sequence = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      req.resume(); res.writeHead(404); res.end("not found"); return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (part) => { body += part; });
    req.on("end", () => {
      let input;
      try { input = JSON.parse(body); } catch { res.writeHead(400); res.end("invalid JSON"); return; }
      const index = requests.length + 1, responseId = `resp_local_${index}`;
      const record = { body: input, responseId, at: Date.now() };
      if (index > maxRequests) {
        failures.push({ index, reason: "request-budget-exceeded", responseId });
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "local Responses fixture request budget exceeded" } }));
        return;
      }
      requests.push(record);
      Promise.resolve().then(() => respond(input, { index, responseId, request: record })).then((text) => {
        if (typeof text !== "string" || !text.trim()) throw new Error("scripted response must be non-empty text");
        const output = response(responseId, text);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.flushHeaders?.();
        event(res, "response.created", { sequence_number: sequence++, response: { ...output, status: "in_progress", output: [] } });
        event(res, "response.in_progress", { sequence_number: sequence++, response: { ...output, status: "in_progress", output: [] } });
        const item = output.output[0], part = item.content[0];
        event(res, "response.output_item.added", { sequence_number: sequence++, output_index: 0,
          item: { ...item, status: "in_progress", content: [] } });
        event(res, "response.content_part.added", { sequence_number: sequence++, item_id: item.id, output_index: 0,
          content_index: 0, part: { ...part, text: "" } });
        event(res, "response.output_text.delta", { sequence_number: sequence++, item_id: item.id,
          output_index: 0, content_index: 0, delta: part.text });
        event(res, "response.output_text.done", { sequence_number: sequence++, item_id: item.id,
          output_index: 0, content_index: 0, text: part.text });
        event(res, "response.content_part.done", { sequence_number: sequence++, item_id: item.id,
          output_index: 0, content_index: 0, part });
        event(res, "response.output_item.done", { sequence_number: sequence++, output_index: 0, item });
        event(res, "response.completed", { sequence_number: sequence++, response: output });
        res.end("data: [DONE]\n\n");
      }).catch((error) => {
        failures.push({ index, reason: error instanceof Error ? error.message : String(error), responseId });
        if (res.headersSent) { res.destroy(error); return; }
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "local Responses fixture rejected request protocol" } }));
      });
    });
  });
  return { server, requests, failures, maxRequests,
    assertHealthy() {
      if (failures.length) throw new Error(`local Responses fixture recorded failures: ${JSON.stringify(failures)}`);
      if (requests.length > maxRequests) throw new Error("local Responses fixture exceeded request budget");
    } };
}

module.exports = { createLocalResponsesServer };
