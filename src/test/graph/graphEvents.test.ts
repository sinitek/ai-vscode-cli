import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  appendGraphEvent,
  appendGraphEventForRun,
  buildGraphEventsFile,
  readGraphEvents,
  readGraphEventsForRun,
} from "../../graph/graphEvents";

function createTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-events-"));
}

test("appends and reads Graph JSONL events in order", () => {
  const baseDir = createTempBaseDir();
  try {
    const eventsFile = buildGraphEventsFile("run-1", { baseDir });
    appendGraphEvent(eventsFile, {
      eventId: "event-1",
      runId: "run-1",
      type: "run.created",
      timestamp: 1,
      summary: "created",
    });
    appendGraphEvent(eventsFile, {
      eventId: "event-2",
      runId: "run-1",
      type: "node.started",
      timestamp: 2,
      nodeId: "node-1",
      attempt: 1,
    });

    const events = readGraphEvents(eventsFile);
    assert.deepEqual(events.map((event) => event.eventId), ["event-1", "event-2"]);
    assert.deepEqual(events.map((event) => event.type), ["run.created", "node.started"]);
    assert.equal(events[1].nodeId, "node-1");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("creates missing event directories when appending for a run", () => {
  const baseDir = createTempBaseDir();
  try {
    const event = appendGraphEventForRun("run-auto-dir", {
      eventId: "event-auto-dir",
      runId: "run-auto-dir",
      type: "run.updated",
      timestamp: 10,
    }, { baseDir });
    const eventsFile = buildGraphEventsFile("run-auto-dir", { baseDir });

    assert.equal(event.eventId, "event-auto-dir");
    assert.equal(fs.existsSync(eventsFile), true);
    assert.equal(readGraphEventsForRun("run-auto-dir", { baseDir }).length, 1);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("redacts obvious secrets in event summary, error, and data fields", () => {
  const baseDir = createTempBaseDir();
  try {
    const eventsFile = buildGraphEventsFile("run-redact", { baseDir });
    appendGraphEvent(eventsFile, {
      eventId: "event-redact",
      runId: "run-redact",
      type: "node.failed",
      timestamp: 20,
      summary: "token=raw-token password: raw-password apiKey=raw-api-key",
      error: "secret=raw-secret",
      data: {
        token: "raw-data-token",
        nested: {
          password: "raw-nested-password",
          normal: "keep-me",
          api_key: "raw-api-key-data",
        },
        items: [{ privateKey: "raw-private-key" }],
      },
    });

    const rawFile = fs.readFileSync(eventsFile, "utf8");
    assert.doesNotMatch(rawFile, /raw-token|raw-password|raw-api-key|raw-secret|raw-data-token|raw-nested-password|raw-api-key-data|raw-private-key/u);
    assert.match(rawFile, /keep-me/u);

    const [event] = readGraphEvents(eventsFile);
    assert.equal(event.summary, "token=[REDACTED] password: [REDACTED] apiKey=[REDACTED]");
    assert.equal(event.error, "secret=[REDACTED]");
    assert.deepEqual(event.data, {
      token: "[REDACTED]",
      nested: {
        password: "[REDACTED]",
        normal: "keep-me",
        api_key: "[REDACTED]",
      },
      items: [{ privateKey: "[REDACTED]" }],
    });
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("rejects unsupported event types and damaged JSONL lines", () => {
  const baseDir = createTempBaseDir();
  try {
    const eventsFile = buildGraphEventsFile("run-invalid", { baseDir });
    assert.throws(
      () => appendGraphEvent(eventsFile, {
        eventId: "event-invalid",
        runId: "run-invalid",
        type: "scheduler.ready" as never,
        timestamp: 30,
      }),
      /Unsupported Graph event type/u,
    );

    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    fs.writeFileSync(eventsFile, "{\"eventId\":\"event-1\"\n", "utf8");
    assert.throws(
      () => readGraphEvents(eventsFile),
      /Invalid Graph event JSON/u,
    );
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
