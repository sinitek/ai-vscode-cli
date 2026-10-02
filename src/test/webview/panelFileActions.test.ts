import * as assert from "node:assert/strict";
import { test } from "node:test";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

import {
  buildRunStreamExportFileName,
  formatRunStreamExportJsonl,
} from "../../webview/panelFileActions";

test("builds a JSONL filename for replay exports", () => {
  assert.equal(
    buildRunStreamExportFileName(Date.parse("2026-10-02T12:34:56.789Z")),
    "sinitek-run-stream-2026-10-02T12-34-56-789Z.jsonl",
  );
});

test("formats replay export metadata and records as JSONL", () => {
  const content = formatRunStreamExportJsonl(
    [
      {
        index: 1,
        content: "first line\nsecond line",
        source: "stdout",
        createdAt: Date.parse("2026-10-02T12:00:00.000Z"),
      },
      {
        index: 2,
        content: "stderr output",
        source: "stderr",
        createdAt: Date.parse("2026-10-02T12:00:01.000Z"),
      },
    ],
    {
      cli: "codex",
      tabId: "tab-1",
      exportedAt: Date.parse("2026-10-02T12:01:00.000Z"),
    },
  );

  const lines = content.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(content.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(lines[0]), {
    type: "metadata",
    format: "sinitek.run-stream",
    version: 1,
    exportedAt: "2026-10-02T12:01:00.000Z",
    cli: "codex",
    tabId: "tab-1",
    recordCount: 2,
  });
  assert.deepEqual(JSON.parse(lines[1]), {
    type: "record",
    index: 1,
    source: "stdout",
    createdAt: Date.parse("2026-10-02T12:00:00.000Z"),
    createdAtIso: "2026-10-02T12:00:00.000Z",
    content: "first line\nsecond line",
  });
  assert.deepEqual(JSON.parse(lines[2]), {
    type: "record",
    index: 2,
    source: "stderr",
    createdAt: Date.parse("2026-10-02T12:00:01.000Z"),
    createdAtIso: "2026-10-02T12:00:01.000Z",
    content: "stderr output",
  });
});
