import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  const bodyStart = source.indexOf("{", start + signature.length);
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unclosed ${functionName} body`);
}

type ModelInputEvent = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
};

type ShouldSubmitModelInputOnEnter = (
  event: ModelInputEvent,
  isComposing: boolean,
  lastCompositionEndAt: number,
  now: number,
) => boolean;

function loadShouldSubmitModelInputOnEnter(): ShouldSubmitModelInputOnEnter {
  const source = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_MODEL_MANAGER,
    "shouldSubmitModelInputOnEnter",
  );
  return new Function(`return ${source}`)() as ShouldSubmitModelInputOnEnter;
}

function createModelInputHarness() {
  let now = 1000;
  let submissions = 0;
  const emitters = new Map<string, EventEmitter>();
  const elements = Object.fromEntries([
    "addModelOverlay",
    "closeAddModel",
    "cancelAddModel",
    "clearModelEdit",
    "confirmAddModel",
    "modelInput",
  ].map((name) => {
    const emitter = new EventEmitter();
    emitters.set(name, emitter);
    return [name, { addEventListener: emitter.on.bind(emitter) }];
  }));
  const bindingStart = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("if (elements.addModelOverlay) {");
  const bindingEnd = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("function normalizeSubtaskThinkingValue", bindingStart);
  assert.notEqual(bindingStart, -1);
  assert.ok(bindingEnd > bindingStart);
  const source = [
    extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "shouldSubmitModelInputOnEnter"),
    VIEW_CONTENT_SCRIPT_MODEL_MANAGER.slice(bindingStart, bindingEnd),
  ].join("\n");
  new Function("elements", "Date", "confirmAddModel", "hideAddModelDialog", "resetModelManageForm", source)(
    elements,
    { now: () => now },
    () => { submissions += 1; },
    () => undefined,
    () => undefined,
  );
  return {
    dispatch(type: string, event: Partial<ModelInputEvent> = {}) {
      let prevented = false;
      emitters.get("modelInput")?.emit(type, {
        ...event,
        preventDefault: () => { prevented = true; },
      });
      return prevented;
    },
    clickSubmit: () => emitters.get("confirmAddModel")?.emit("click"),
    advanceTime: (elapsed: number) => { now += elapsed; },
    submissions: () => submissions,
  };
}

test("does not submit the model name while an IME composition is active", () => {
  const shouldSubmit = loadShouldSubmitModelInputOnEnter();
  assert.equal(shouldSubmit({ key: "Enter", isComposing: true }, false, 0, 1000), false);
  assert.equal(shouldSubmit({ key: "Enter" }, true, 0, 1000), false);
});

test("does not submit IME candidate selection enter events", () => {
  const shouldSubmit = loadShouldSubmitModelInputOnEnter();
  assert.equal(shouldSubmit({ key: "Enter", keyCode: 229 }, false, 0, 1000), false);
  assert.equal(shouldSubmit({ key: "Enter", which: 229 }, false, 0, 1000), false);
  assert.equal(shouldSubmit({ key: "Enter" }, false, 900, 1000), false);
});

test("submits on a regular enter after IME composition settles", () => {
  const shouldSubmit = loadShouldSubmitModelInputOnEnter();
  assert.equal(shouldSubmit({ key: "Enter" }, false, 0, 1000), true);
  assert.equal(shouldSubmit({ key: "Tab" }, false, 0, 1000), false);
  assert.equal(shouldSubmit({ key: "Enter" }, false, 800, 1000), true);
});

test("model input listeners preserve candidate selection and only submit a later intentional enter", () => {
  const harness = createModelInputHarness();
  harness.dispatch("compositionstart");
  assert.equal(harness.dispatch("keydown", { key: "Enter", isComposing: false }), false);
  harness.dispatch("compositionend");
  assert.equal(harness.dispatch("keydown", { key: "Enter", isComposing: false }), false);
  harness.advanceTime(150);
  assert.equal(harness.dispatch("keydown", { key: "Enter" }), false);
  assert.equal(harness.submissions(), 0);
  harness.advanceTime(1);
  assert.equal(harness.dispatch("keydown", { key: "Enter" }), true);
  assert.equal(harness.submissions(), 1);
});

test("model input listeners keep normal enter and explicit button submission working", () => {
  const harness = createModelInputHarness();
  assert.equal(harness.dispatch("keydown", { key: "Enter", keyCode: 229 }), false);
  assert.equal(harness.dispatch("keydown", { key: "Enter", which: 229 }), false);
  assert.equal(harness.dispatch("keydown", { key: "Enter", isComposing: true }), false);
  assert.equal(harness.submissions(), 0);
  assert.equal(harness.dispatch("keydown", { key: "Enter", keyCode: 13 }), true);
  harness.dispatch("compositionstart");
  harness.dispatch("compositionend");
  harness.clickSubmit();
  assert.equal(harness.submissions(), 2);
});
