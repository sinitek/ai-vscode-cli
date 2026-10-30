import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanupHumanInteractionHistory,
  cleanupHumanInteractionHistoryAcrossWorkspaces,
  getHumanInteractionHistoryFilePath,
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

test("workspace history stays independent and does not import unscoped legacy records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const directoryPath = path.join(root, "human-interaction-history");
  const firstOptions = { filePath: getHumanInteractionHistoryFilePath(directoryPath, "project-a_123") };
  const secondOptions = { filePath: getHumanInteractionHistoryFilePath(directoryPath, "project-b_456") };
  const emptyOptions = { filePath: getHumanInteractionHistoryFilePath(directoryPath, "no-workspace") };
  try {
    const legacyOptions = { filePath: path.join(root, "human-interaction-history.json") };
    const submission = { interactionId: "question-1", status: "completed" as const, values: { mode: "safe" } };
    const legacyRecord = recordHumanInteractionHistory(createRequest(), submission, legacyOptions);
    assert.deepEqual(readHumanInteractionHistory(firstOptions), []);
    assert.equal(fs.existsSync(directoryPath), false);

    const firstRecord = recordHumanInteractionHistory(createRequest(), submission, firstOptions);
    const secondRecord = recordHumanInteractionHistory(createRequest(), submission, secondOptions, "orchestrator");

    assert.deepEqual(readHumanInteractionHistory(firstOptions).map((record) => record.id), [firstRecord.id]);
    assert.deepEqual(readHumanInteractionHistory(secondOptions).map((record) => record.id), [secondRecord.id]);
    assert.deepEqual(readHumanInteractionHistory(emptyOptions), []);
    assert.deepEqual(readHumanInteractionHistory(legacyOptions).map((record) => record.id), [legacyRecord.id]);
    assert.equal(path.dirname(firstOptions.filePath), directoryPath);
    assert.equal(path.basename(firstOptions.filePath), "project-a_123.json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace history limits do not evict records from other workspaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const firstOptions = { filePath: getHumanInteractionHistoryFilePath(root, "project-a"), limit: 1 };
  const secondOptions = { filePath: getHumanInteractionHistoryFilePath(root, "project-b"), limit: 1 };
  try {
    const submission = { interactionId: "question-1", status: "completed" as const, values: {} };
    const secondRecord = recordHumanInteractionHistory(createRequest(), submission, secondOptions, "orchestrator");
    recordHumanInteractionHistory(createRequest(), submission, firstOptions);
    const latestRecord = recordHumanInteractionHistory(createRequest(), submission, firstOptions);

    assert.deepEqual(readHumanInteractionHistory(firstOptions).map((record) => record.id), [latestRecord.id]);
    assert.deepEqual(readHumanInteractionHistory(secondOptions).map((record) => record.id), [secondRecord.id]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retention cleanup visits all workspace history files and ignores unrelated entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const directoryPath = path.join(root, "history");
  const firstOptions = { filePath: getHumanInteractionHistoryFilePath(directoryPath, "project-a") };
  const secondOptions = { filePath: getHumanInteractionHistoryFilePath(directoryPath, "project-b") };
  try {
    cleanupHumanInteractionHistoryAcrossWorkspaces(directoryPath);
    assert.equal(fs.existsSync(directoryPath), false);
    const submission = { interactionId: "question-1", status: "completed" as const, values: {} };
    const expiredRecord = recordHumanInteractionHistory(createRequest(), submission, firstOptions);
    const retainedRecord = recordHumanInteractionHistory(createRequest(), submission, secondOptions, "orchestrator");
    expiredRecord.createdAt = 1;
    retainedRecord.createdAt = 100;
    fs.writeFileSync(firstOptions.filePath, JSON.stringify({ items: [expiredRecord] }), "utf8");
    fs.writeFileSync(secondOptions.filePath, JSON.stringify({ items: [retainedRecord, expiredRecord] }), "utf8");
    fs.writeFileSync(path.join(directoryPath, "notes.txt"), "keep", "utf8");
    fs.mkdirSync(path.join(directoryPath, "archive.json"));

    cleanupHumanInteractionHistoryAcrossWorkspaces(directoryPath, {
      isTimestampWithinRetention: (timestamp) => timestamp >= 100,
    });

    assert.equal(fs.existsSync(firstOptions.filePath), false);
    assert.deepEqual(readHumanInteractionHistory({
      ...secondOptions,
      isTimestampWithinRetention: (timestamp) => timestamp >= 100,
    }).map((record) => record.id), [retainedRecord.id]);
    assert.equal(fs.readFileSync(path.join(directoryPath, "notes.txt"), "utf8"), "keep");
    assert.equal(fs.statSync(path.join(directoryPath, "archive.json")).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace retention cleanup reports directory errors without throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-interaction-history-"));
  const directoryPath = path.join(root, "not-a-directory");
  const events: string[] = [];
  try {
    fs.writeFileSync(directoryPath, "keep", "utf8");
    cleanupHumanInteractionHistoryAcrossWorkspaces(directoryPath, {
      logError: (event) => events.push(event),
    });
    assert.deepEqual(events, ["human-interaction-history-cleanup-error"]);
    assert.equal(fs.readFileSync(directoryPath, "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
