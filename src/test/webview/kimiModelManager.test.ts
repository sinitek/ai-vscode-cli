import test = require("node:test");
import assert = require("node:assert/strict");
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";

function extract(name: string): string {
  const source = VIEW_CONTENT_SCRIPT_MODEL_MANAGER;
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  let depth = 0;
  let bodyStart = -1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      if (depth === 0) bodyStart = index;
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test("kimi opens the existing model manager and reads managed config models", () => {
  const state = {
    currentCli: "kimi-code",
    managedModelsByCli: { "kimi-code": ["kimi-one", "kimi-two"] },
  };
  const source = [
    extract("canOpenModelManagerDialog"),
    extract("getManagedModelsForCurrentCli"),
    "return { canOpenModelManagerDialog, getManagedModelsForCurrentCli };",
  ].join("\n");
  const manager = new Function("state", source)(state) as {
    canOpenModelManagerDialog: () => boolean;
    getManagedModelsForCurrentCli: () => string[];
  };
  assert.equal(manager.canOpenModelManagerDialog(), true);
  assert.deepEqual(manager.getManagedModelsForCurrentCli(), ["kimi-one", "kimi-two"]);
  state.currentCli = "grok";
  assert.equal(manager.canOpenModelManagerDialog(), false);
});
