import test = require("node:test");
import assert = require("node:assert/strict");

import { buildGeminiThinkingRuntimeProfile } from "../cli/geminiThinking";

test("maps Gemini 2.5 thinking off to a runtime alias with thinkingBudget 0", () => {
  const profile = buildGeminiThinkingRuntimeProfile("gemini-2.5-pro", "off");

  assert.equal(profile.strategy, "budget");
  assert.equal(profile.requestedMode, "off");
  assert.equal(profile.effectiveMode, "off");
  assert.ok(profile.runtimeModel);
  assert.deepEqual(profile.systemSettings, {
    modelConfigs: {
      customAliases: {
        [profile.runtimeModel as string]: {
          extends: "gemini-2.5-pro",
          modelConfig: {
            generateContentConfig: {
              thinkingConfig: {
                thinkingBudget: 0,
              },
            },
          },
        },
      },
    },
  });
});

test("maps Gemini 3 Pro thinking off to LOW because the model cannot disable thinking", () => {
  const profile = buildGeminiThinkingRuntimeProfile("gemini-3-pro-preview", "off");

  assert.equal(profile.strategy, "level");
  assert.equal(profile.requestedMode, "off");
  assert.equal(profile.effectiveMode, "low");
  assert.ok(profile.runtimeModel);
  assert.deepEqual(profile.systemSettings, {
    modelConfigs: {
      customAliases: {
        [profile.runtimeModel as string]: {
          extends: "gemini-3-pro-preview",
          modelConfig: {
            generateContentConfig: {
              thinkingConfig: {
                thinkingLevel: "LOW",
              },
            },
          },
        },
      },
    },
  });
});

test("maps Gemini 3 Flash thinking off to MINIMAL", () => {
  const profile = buildGeminiThinkingRuntimeProfile("gemini-3-flash-preview", "off");

  assert.equal(profile.strategy, "level");
  assert.equal(profile.effectiveMode, "off");
  assert.ok(profile.runtimeModel);
  assert.deepEqual(profile.systemSettings, {
    modelConfigs: {
      customAliases: {
        [profile.runtimeModel as string]: {
          extends: "gemini-3-flash-preview",
          modelConfig: {
            generateContentConfig: {
              thinkingConfig: {
                thinkingLevel: "MINIMAL",
              },
            },
          },
        },
      },
    },
  });
});

test("passes through unsupported Gemini Flash Lite models without generating overrides", () => {
  const profile = buildGeminiThinkingRuntimeProfile("gemini-3.1-flash-lite-preview", "high");

  assert.equal(profile.strategy, "passthrough");
  assert.equal(profile.runtimeModel, "gemini-3.1-flash-lite-preview");
  assert.equal(profile.systemSettings, null);
});
