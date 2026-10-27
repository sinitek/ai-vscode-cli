import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanupHumanInteractionHistory,
  readHumanInteractionHistory,
  recordHumanInteractionHistory,
} from "../../humanInteractionHistory";
import type { HumanInteractionRequest } from "../../humanInteraction";

function createRequest(): HumanInteractionRequest {
  return {
    interactionId: "question-1",
    tabId: "tab-1",
    title: "选择实现方案",
    instruction: "请选择继续方式。",
    formFields: [
      { id: "mode", label: "模式", type: "radio", options: [{ label: "兼容方案", value: "safe" }] },
      { id: "token", label: "令牌", type: "password", defaultValue: "do-not-persist-default" },
    ],
    submitLabel: "提交",
    cancelLabel: "拒绝",
  };
}

test("persists question answers and automatic-selection status while hiding passwords", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const options = { filePath: path.join(root, "history.json") };
  try {
    recordHumanInteractionHistory(createRequest(), {
      interactionId: "question-1",
      status: "completed",
      values: { mode: "safe", token: "do-not-persist" },
    }, options);
    recordHumanInteractionHistory(createRequest(), {
      interactionId: "question-1",
      status: "completed",
      timedOut: true,
      values: { mode: "safe" },
    }, options, "orchestrator");

    const records = readHumanInteractionHistory(options);
    assert.equal(records.length, 2);
    assert.equal(records[0].timedOut, true);
    assert.equal(records[0].source, "orchestrator");
    assert.equal(records[0].values.mode, "safe");
    assert.equal(records[0].values.token, "已隐藏");
    assert.equal(records[1].values.mode, "safe");
    assert.equal(records[1].values.token, "已隐藏");
    assert.equal(fs.readFileSync(options.filePath, "utf8").includes("do-not-persist"), false);
    assert.equal(fs.readFileSync(options.filePath, "utf8").includes("do-not-persist-default"), false);
    assert.equal(records[1].formFields[0].options?.[0].label, "兼容方案");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention cleanup removes expired history and ignores corrupt files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const filePath = path.join(root, "history.json");
  const options = {
    filePath,
    isTimestampWithinRetention: (timestamp: number) => timestamp >= 100,
  };
  try {
    recordHumanInteractionHistory(createRequest(), {
      interactionId: "question-1",
      status: "aborted",
      values: {},
    }, options);
    const records = readHumanInteractionHistory(options);
    records[0].createdAt = 1;
    fs.writeFileSync(filePath, JSON.stringify({ items: records }), "utf8");
    cleanupHumanInteractionHistory(options);
    assert.equal(fs.existsSync(filePath), false);
    fs.writeFileSync(filePath, "not-json", "utf8");
    assert.deepEqual(readHumanInteractionHistory(options), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
