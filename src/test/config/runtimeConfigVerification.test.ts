import test = require("node:test");
import assert = require("node:assert/strict");
import {
  assertRuntimeConfigApplied,
  applyRuntimeConfigIfNeeded,
  retryRuntimeConfigApply,
  RuntimeConfigVerificationError,
} from "../../config/runtimeConfigVerification";

test("conditional application skips semantically equal files and verifies changed files", async () => {
  let content = '{ "enabled": true }';
  let writes = 0;
  const read = async () => content;
  const write = async (next: string) => { writes += 1; content = next; };
  const options = { cli: "测试 CLI", file: "settings.json", format: "JSON" as const };
  await applyRuntimeConfigIfNeeded('{"enabled":true}', read, write, options);
  assert.equal(writes, 0);
  await applyRuntimeConfigIfNeeded('{"enabled":false}', read, write, options);
  assert.equal(writes, 1);
  await assert.rejects(applyRuntimeConfigIfNeeded("{}", read, async () => undefined, options), RuntimeConfigVerificationError);
  await assert.rejects(applyRuntimeConfigIfNeeded("{}", async () => { throw new Error("读取失败"); }, write, options), /读取失败/);
  await assert.rejects(applyRuntimeConfigIfNeeded("{}", read, async () => { throw new Error("写入失败"); }, options), /写入失败/);
  assert.equal(writes, 1);
});

test("runtime verification compares structured values without weakening field checks", async (context) => {
  const scenarios: {
    name: string;
    format: "JSON" | "JSONC" | "TOML";
    expected: string;
    actual: string;
    patch?: boolean;
    matches: boolean;
  }[] = [
    { name: "identical text keeps the existing fast path", format: "JSON", expected: "draft", actual: "draft", matches: true },
    { name: "JSON whitespace and BOM", format: "JSON", expected: '{"enabled":true}', actual: '\uFEFF{\n "enabled": true\n}\n', matches: true },
    { name: "nested JSON key order", format: "JSON", expected: '{"nested":{"first":1,"second":2}}', actual: '{"nested":{"second":2,"first":1}}', matches: true },
    { name: "JSONC comments and trailing commas", format: "JSONC", expected: '{"model":"test/model"}', actual: '{/* comment */"model":"test/model",}', matches: true },
    { name: "TOML comments, quoting and CRLF", format: "TOML", expected: 'model = "test"\n', actual: "# comment\r\nmodel='test'\r\n", matches: true },
    { name: "array order remains meaningful", format: "JSON", expected: '{"args":[1,2]}', actual: '{"args":[2,1]}', matches: false },
    { name: "value type remains meaningful", format: "JSON", expected: '{"enabled":true}', actual: '{"enabled":"true"}', matches: false },
    { name: "missing value fails", format: "JSON", expected: '{"enabled":true}', actual: "{}", matches: false },
    { name: "extra value fails a full replacement", format: "JSON", expected: "{}", actual: '{"extra":true}', matches: false },
    { name: "blank JSON is not an applied empty object", format: "JSON", expected: "{}", actual: "", matches: false },
    { name: "invalid JSON is not normalized into success", format: "JSON", expected: "{}", actual: "{", matches: false },
    { name: "invalid expected text keeps strict comparison", format: "JSON", expected: "draft", actual: "{}", matches: false },
    { name: "invalid TOML fails", format: "TOML", expected: 'model="test"', actual: "model=", matches: false },
    { name: "unrelated MCP root keys are retained", format: "JSON", expected: '{"nested":{"first":1,"second":2}}', actual: '{"extra":true,"nested":{"second":2,"first":1}}', patch: true, matches: true },
    { name: "MCP merge is shallow rather than recursive", format: "JSON", expected: '{"nested":{"first":1}}', actual: '{"nested":{"first":1,"second":2}}', patch: true, matches: false },
    { name: "MCP patch cannot omit a key", format: "JSON", expected: '{"nested":{}}', actual: "{}", patch: true, matches: false },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, () => {
      const verify = () => assertRuntimeConfigApplied(scenario.expected, scenario.actual, {
        cli: "测试 CLI", file: "测试配置", format: scenario.format, patch: scenario.patch,
      });
      if (scenario.matches) {
        assert.doesNotThrow(verify);
      } else {
        assert.throws(verify, (error: Error) => {
          assert.ok(error instanceof RuntimeConfigVerificationError);
          assert.match(error.message, /未成功更新配置.*测试 CLI.*测试配置/);
          return true;
        });
      }
    });
  }
});

test("runtime apply returns its first successful result without extra attempts", async () => {
  let attempts = 0;
  const result = await retryRuntimeConfigApply(async () => {
    attempts += 1;
    return "applied";
  });
  assert.equal(result, "applied");
  assert.equal(attempts, 1);
});

test("runtime apply retries verification conflicts and returns the recovered result", async () => {
  let attempts = 0;
  const result = await retryRuntimeConfigApply(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new RuntimeConfigVerificationError("Codex", "auth.json");
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 3);
});

test("persistent verification conflicts stop after three attempts and retain the diagnostic", async () => {
  let attempts = 0;
  const failure = new RuntimeConfigVerificationError("Codex", "auth.json");
  await assert.rejects(() => retryRuntimeConfigApply(async () => {
    attempts += 1;
    throw failure;
  }), (error: Error) => error === failure);
  assert.equal(attempts, 3);
});

test("runtime apply does not retry write, permission, syntax or untyped errors", async (context) => {
  const failures = [
    Object.assign(new Error("write failed"), { code: "EIO" }),
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
    new SyntaxError("invalid configuration"),
    new Error("未成功更新配置"),
  ];
  for (const failure of failures) {
    await context.test(failure.message, async () => {
      let attempts = 0;
      await assert.rejects(() => retryRuntimeConfigApply(async () => {
        attempts += 1;
        throw failure;
      }), (error: Error) => error === failure);
      assert.equal(attempts, 1);
    });
  }
});
