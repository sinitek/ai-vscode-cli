import test = require("node:test");
import assert = require("node:assert/strict");

import {
  applyOpenCodeRuntimeModelOverlay,
  parseOpenCodeConfigModels,
  validateOpenCodeModelOverride,
} from "../cli/opencodeconfigmodels";

test("parses primary and small models while keeping display labels separate from exact refs", () => {
  const parsed = parseOpenCodeConfigModels(JSON.stringify({
    model: "main/chat",
    small_model: "utility/title",
    provider: {
      main: {
        name: "Main Provider",
        models: {
          chat: { name: "Shared Name" },
          backup: { name: "Shared Name" },
        },
      },
      utility: {
        models: {
          title: { name: "Small Tasks" },
        },
      },
    },
  }));

  assert.equal(parsed.primaryModel?.ref, "main/chat");
  assert.equal(parsed.smallModel?.ref, "utility/title");
  assert.deepEqual(parsed.candidates.map((candidate) => candidate.value), [
    "main/chat",
    "main/backup",
    "utility/title",
  ]);
  assert.deepEqual(parsed.candidates.map((candidate) => candidate.label), [
    "Shared Name",
    "Shared Name",
    "Small Tasks",
  ]);
  assert.notEqual(parsed.candidates[0].ref, parsed.candidates[1].ref);
  assert.equal(parsed.candidates[0].label, parsed.candidates[1].label);
  parsed.candidates.forEach((candidate) => {
    assert.equal(candidate.label.includes(`(${candidate.ref})`), false);
  });
  assert.equal(parsed.candidates[0].providerLabel, "Main Provider");
  assert.equal(parsed.candidates[0].resolution, "unverified");
  assert.deepEqual(parsed.issues, []);
});

test("uses the model id when the configured model name is missing or blank", () => {
  const parsed = parseOpenCodeConfigModels(JSON.stringify({
    provider: {
      gateway: {
        models: {
          named: { name: "  Display Name  " },
          missing: {},
          blank: { name: "   " },
        },
      },
    },
  }));

  assert.deepEqual(parsed.candidates.map(({ ref, label }) => ({ ref, label })), [
    { ref: "gateway/named", label: "Display Name" },
    { ref: "gateway/missing", label: "missing" },
    { ref: "gateway/blank", label: "blank" },
  ]);
  parsed.candidates.forEach((candidate) => {
    assert.equal(candidate.label.includes(`(${candidate.ref})`), false);
  });
});

test("allows an empty small model to follow OpenCode automatic behavior", () => {
  const parsed = parseOpenCodeConfigModels(JSON.stringify({
    model: "gateway/main",
    small_model: "",
    provider: { gateway: { models: { main: {} } } },
  }));

  assert.equal(parsed.primaryModelRef, "gateway/main");
  assert.equal(parsed.smallModelRef, null);
  assert.equal(parsed.smallModel, null);
  assert.equal(parsed.issues.some((issue) => issue.role === "small"), false);
});

test("reports invalid JSON, exact refs, missing providers, and missing models", () => {
  assert.deepEqual(
    parseOpenCodeConfigModels("not-json").issues.map((issue) => issue.code),
    ["invalid-json"]
  );

  const invalidRef = parseOpenCodeConfigModels(JSON.stringify({
    model: "bare-model",
    provider: { gateway: { models: { "bare-model": {} } } },
  }));
  assert.deepEqual(invalidRef.issues.map((issue) => issue.code), ["role-model-invalid-ref"]);

  const missingProvider = parseOpenCodeConfigModels(JSON.stringify({
    model: "missing/model",
    provider: {},
  }));
  assert.equal(missingProvider.issues[0].code, "role-provider-not-found");
  assert.equal(missingProvider.issues[0].ref, "missing/model");

  const missingModel = parseOpenCodeConfigModels(JSON.stringify({
    model: "gateway/missing",
    provider: { gateway: { models: { present: {} } } },
  }));
  assert.equal(missingModel.issues[0].code, "role-model-not-found");
  assert.equal(missingModel.issues[0].role, "primary");
});

test("applies provider and model filters without inferring adapter capabilities", () => {
  const parsed = parseOpenCodeConfigModels(JSON.stringify({
    model: "active/main",
    small_model: "active/alpha",
    enabled_providers: ["active", "disabled"],
    disabled_providers: ["disabled"],
    provider: {
      active: {
        npm: "@ai-sdk/openai-compatible",
        whitelist: ["main", "alpha", "deprecated", "disabled-model"],
        blacklist: ["blocked"],
        models: {
          main: {},
          alpha: { status: "alpha" },
          blocked: {},
          hidden: {},
          deprecated: { status: "deprecated" },
          "disabled-model": { disabled: true },
        },
      },
      disabled: { models: { model: {} } },
      omitted: { models: { model: {} } },
    },
  }));

  assert.deepEqual(parsed.candidates.map((candidate) => candidate.ref), [
    "active/main",
    "active/alpha",
  ]);
  assert.equal(parsed.smallModel?.resolution, "conditional");
  assert.deepEqual(new Set(parsed.issues.map((issue) => issue.code)), new Set([
    "model-resolution-conditional",
    "model-blacklisted",
    "model-not-whitelisted",
    "model-deprecated",
    "model-disabled",
    "provider-disabled",
    "provider-not-enabled",
  ]));
});

test("validates temporary role overrides only against current exact candidates", () => {
  const parsed = parseOpenCodeConfigModels(JSON.stringify({
    model: "one/main",
    provider: {
      one: { models: { main: {} } },
      two: { models: { small: {} } },
    },
  }));

  assert.deepEqual(validateOpenCodeModelOverride(parsed, "primary", null), {
    ok: true,
    role: "primary",
    modelRef: null,
    issue: null,
  });
  assert.equal(validateOpenCodeModelOverride(parsed, "small", "two/small").ok, true);
  assert.equal(
    validateOpenCodeModelOverride(parsed, "primary", "main").issue?.code,
    "override-model-invalid-ref"
  );
  assert.equal(
    validateOpenCodeModelOverride(parsed, "primary", "one/missing").issue?.code,
    "override-model-unavailable"
  );
});

test("creates a runtime overlay without mutating the source config", () => {
  const source = {
    model: "one/main",
    small_model: "one/small",
    theme: "system",
    provider: {
      one: { models: { main: {}, small: {} } },
      two: { models: { main: {}, small: {} } },
    },
  };
  const snapshot = JSON.parse(JSON.stringify(source));
  const result = applyOpenCodeRuntimeModelOverlay(source, {
    primary: "two/main",
    small: "two/small",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.config, {
    ...source,
    model: "two/main",
    small_model: "two/small",
  });
  assert.deepEqual(source, snapshot);

  const followingConfig = applyOpenCodeRuntimeModelOverlay(source, {
    primary: null,
    small: null,
  });
  assert.deepEqual(followingConfig.config, source);
  assert.notEqual(followingConfig.config, source);
});
