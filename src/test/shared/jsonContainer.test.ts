import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { buildJsonContainerRuntimeSource, parseCompleteJsonContainer } from "../../shared/jsonContainer";

test("complete JSON containers match the browser parser for raw and fenced objects and arrays", () => {
  const runtime = vm.runInNewContext(`${buildJsonContainerRuntimeSource()}; ({ parseCompleteJsonContainer })`);
  for (const content of [
    '{"status":"dispatch","subtasks":[]}',
    "[]",
    "{}",
    '\uFEFF  {"完成":true}  ',
    '```json\r\n{"status":"dispatch"}\r\n```',
    '~~~json\n[{"task":"编码"}]\n~~~',
  ]) {
    assert.notEqual(parseCompleteJsonContainer(content), null, content);
    assert.equal(JSON.stringify(runtime.parseCompleteJsonContainer(content)), JSON.stringify(parseCompleteJsonContainer(content)));
  }
});

test("JSON primitives, invalid JSON and prose containing JSON are not JSON tree bubbles", () => {
  const runtime = vm.runInNewContext(`${buildJsonContainerRuntimeSource()}; ({ parseCompleteJsonContainer })`);
  for (const content of [
    "", " ", "null", "true", "42", '"结果"', '{"status":',
    '已完成\n{"result":true}',
    '```json\n{"result":true}\n```\n说明',
    '```json\n{"result":true}\n```\n```json\n[]\n```',
  ]) {
    assert.equal(parseCompleteJsonContainer(content), null, content);
    assert.equal(runtime.parseCompleteJsonContainer(content), null, content);
  }
});
