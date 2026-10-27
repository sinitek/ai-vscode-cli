import assert = require("node:assert/strict");
import test = require("node:test");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  assertKimiLaunchHasNoCredential,
  prepareKimiInteractiveLaunch,
  resolveKimiAcpMode,
  resolveKimiThinkingValue,
} = require("../../extensionHost/kimiInteractiveLaunch") as typeof import("../../extensionHost/kimiInteractiveLaunch");
const {
  KIMI_CODE_DEFAULT_MODEL,
  createKimiCodeDefaultConfigText,
} = require("../../config/kimiCodeConfig") as typeof import("../../config/kimiCodeConfig");
const {
  KIMI_FOREIGN_CREDENTIAL_ENV_KEYS,
} = require("../../interactive/kimiAppServerProtocol") as typeof import("../../interactive/kimiAppServerProtocol");

test("Kimi plan mode maps to the real ACP plan mode and never bypasses approvals", () => {
  assert.equal(resolveKimiAcpMode("plan", "yolo"), "plan");
  assert.equal(resolveKimiAcpMode("plan", "manual"), "plan");
  assert.equal(resolveKimiAcpMode("coding", "manual"), "yolo");
  assert.equal(resolveKimiAcpMode("coding", "yolo"), "yolo");
  assert.equal(resolveKimiAcpMode("coding", "auto"), "auto");
  assert.equal(resolveKimiAcpMode("loop_plus", null), "yolo");
});

test("Kimi thinking forwards only values the ACP session can advertise", () => {
  assert.equal(resolveKimiThinkingValue("high"), "high");
  assert.equal(resolveKimiThinkingValue("max"), "max");
  assert.equal(resolveKimiThinkingValue("off"), null);
  assert.equal(resolveKimiThinkingValue("on"), null);
  assert.equal(resolveKimiThinkingValue("ultra"), null);
  assert.equal(resolveKimiThinkingValue(""), null);
  assert.equal(resolveKimiThinkingValue("off", "high"), "high");
  assert.equal(resolveKimiThinkingValue("ultra", "medium"), "medium");
  assert.equal(resolveKimiThinkingValue("xhigh", "high"), "xhigh");
});

test("Kimi launch strips other CLIs' credentials and never injects a key", async () => {
  const parentEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    KIMI_CODE_HOME: "/tmp/home/.kimi-code",
    OPENAI_API_KEY: "sk-openai-must-not-leak",
    ANTHROPIC_API_KEY: "sk-anthropic-must-not-leak",
    SINITEK_KIMI_API_KEY: "sk-kimi-provider-key",
  };
  const launch = await prepareKimiInteractiveLaunch({
    parentEnv,
    interactiveMode: "coding",
    selectedModel: KIMI_CODE_DEFAULT_MODEL,
    thinkingMode: "high",
  });
  for (const key of KIMI_FOREIGN_CREDENTIAL_ENV_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(launch.env, key), false, key);
  }
  assert.equal(JSON.stringify(launch.env).includes("must-not-leak"), false);
  assert.equal(launch.agentArgs.includes("sk-kimi-provider-key"), false);
  assert.equal(launch.agentArgs.includes("--api-key"), false);
  assert.deepEqual(launch.agentArgs, []);
  assert.equal(launch.modelAlias, KIMI_CODE_DEFAULT_MODEL);
  assert.equal(launch.modeId, "yolo");
  assert.equal(launch.thinkingValue, "high");
  assert.doesNotThrow(() => assertKimiLaunchHasNoCredential(launch, parentEnv));
});

test("Kimi launch reports a credential leak instead of silently continuing", () => {
  const parentEnv: NodeJS.ProcessEnv = { GEMINI_API_KEY: "sk-gemini-abcdefgh" };
  assert.throws(
    () => assertKimiLaunchHasNoCredential({ agentArgs: [], env: { GEMINI_API_KEY: "x" } }, parentEnv),
    /must not include GEMINI_API_KEY/,
  );
  assert.throws(
    () => assertKimiLaunchHasNoCredential({ agentArgs: ["--api-key", "sk-gemini-abcdefgh"], env: {} }, parentEnv),
    /must not contain the value of GEMINI_API_KEY/,
  );
});

test("Kimi default config text never contains a real-looking secret", () => {
  const text = createKimiCodeDefaultConfigText({
    baseUrl: "http://127.0.0.1:33391/v1",
    model: KIMI_CODE_DEFAULT_MODEL,
  });
  assert.match(text, /default_model = "kimi-k3\.1-pro"/);
  assert.doesNotMatch(text, /subcoco\//);
  assert.match(text, /api_key_env = "KIMI_CODE_API_KEY"/);
  assert.match(text, /type = "openai"/);
  assert.match(text, /base_url = "http:\/\/127\.0\.0\.1:33391\/v1"/);
  assert.equal(/sk-[A-Za-z0-9]{8,}/.test(text), false);
  assert.equal(/api_key\s*=\s*"/.test(text), false);
});
