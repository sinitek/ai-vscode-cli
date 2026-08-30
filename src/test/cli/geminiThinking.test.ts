import test = require("node:test");
import assert = require("node:assert/strict");

import { buildGeminiThinkingRuntimeProfile } from "../../cli/geminiThinking";

test("keeps legacy Gemini 2.5 thinking helper behavior with thinkingBudget 0", () => {
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

test("keeps legacy Gemini 3 Pro thinking helper behavior when thinking cannot be disabled", () => {
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

test("keeps legacy Gemini 3 Flash thinking helper behavior with MINIMAL level", () => {
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

test("keeps legacy Gemini helper passthrough for unsupported Flash Lite models", () => {
  const profile = buildGeminiThinkingRuntimeProfile("gemini-3.1-flash-lite-preview", "high");

  assert.equal(profile.strategy, "passthrough");
  assert.equal(profile.runtimeModel, "gemini-3.1-flash-lite-preview");
  assert.equal(profile.systemSettings, null);
});
