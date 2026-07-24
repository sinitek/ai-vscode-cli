import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { readGraphNodeExecutionResultArtifact } from "../graph/graphNodeArtifact";

test("reads Graph node execution status from the communication JSON block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-artifact-"));
  try {
    const file = path.join(dir, "implement.md");
    fs.writeFileSync(file, [
      "# Graph node",
      "",
      "## JSON",
      "```json",
      JSON.stringify({
        status: "blocked",
        summary: "writeFiles missing",
        artifactRef: "/tmp/implement.md",
        acceptance: [{ name: "Stopped safely", passed: true, required: true }],
      }),
      "```",
      "",
    ].join("\n"), "utf8");

    const result = readGraphNodeExecutionResultArtifact(file);
    assert.equal(result?.status, "blocked");
    assert.equal(result?.summary, "writeFiles missing");
    assert.equal(result?.artifactRef, "/tmp/implement.md");
    assert.equal(result?.acceptance?.[0].name, "Stopped safely");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reads AI planner plannedGraph from the communication JSON block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-artifact-plan-"));
  try {
    const file = path.join(dir, "plan.md");
    fs.writeFileSync(file, [
      "## JSON",
      "```json",
      JSON.stringify({
        status: "passed",
        summary: "planned",
        plannedGraph: {
          maxConcurrent: 3,
          nodes: [{
            id: "implement-api",
            title: "Implement API",
            kind: "implement",
            writeFiles: ["src/api/**"],
          }, {
            id: "test-api",
            title: "Test API",
            kind: "test",
            dependsOn: ["implement-api"],
          }],
          edges: [{
            from: "implement-api",
            to: "test-api",
            kind: "depends_on",
          }],
        },
      }),
      "```",
    ].join("\n"), "utf8");

    const result = readGraphNodeExecutionResultArtifact(file);
    assert.equal(result?.status, "passed");
    assert.equal(result?.plannedGraph?.maxConcurrent, 3);
    assert.equal(result?.plannedGraph?.nodes[0].id, "implement-api");
    assert.equal(result?.plannedGraph?.edges?.[0].to, "test-api");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null when the JSON artifact is missing or invalid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-artifact-invalid-"));
  try {
    const file = path.join(dir, "node.md");
    fs.writeFileSync(file, "## JSON\n```json\n{\"status\":\"unknown\"}\n```\n", "utf8");
    assert.equal(readGraphNodeExecutionResultArtifact(file), null);
    assert.equal(readGraphNodeExecutionResultArtifact(path.join(dir, "missing.md")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
