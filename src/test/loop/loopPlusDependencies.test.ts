import test = require("node:test");
import assert = require("node:assert/strict");
import { readLoopPlusDependsOn } from "../../loopPlusDependencies";

test("reads missing and empty dependency lists as independent tasks", () => {
  assert.deepEqual(readLoopPlusDependsOn(undefined, "task"), []);
  assert.deepEqual(readLoopPlusDependsOn([], "task"), []);
});

test("trims, preserves order, and copies explicit dependency lists", () => {
  const input = [" first ", "second"];
  const dependencies = readLoopPlusDependsOn(input, "task");
  assert.deepEqual(dependencies, ["first", "second"]);
  assert.notEqual(dependencies, input);
  input[0] = "changed";
  assert.deepEqual(dependencies, ["first", "second"]);
});

test("rejects malformed dependency lists without filtering bad entries", () => {
  for (const value of [null, "first", 1, {}, ["first", 1], ["first", null], ["   "], ["task"], ["first", " first "]]) {
    assert.equal(readLoopPlusDependsOn(value, "task"), null, `invalid value ${JSON.stringify(value)}`);
  }
});
