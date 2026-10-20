import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "node:child_process";
import { buildClaudePrompt, buildClaudePromptContent } from "../../cli/claudeToolPolicy";

test("keeps the original Claude prompt and adds executable network instructions", () => {
  const prompt = "今天上海天气\n保留原始需求";
  const content = buildClaudePromptContent(prompt);
  assert.deepEqual(content[0], { type: "text", text: prompt });
  assert.equal(content.length, 2);
  const policy = content[1].text;
  assert.match(policy, /不要使用 WebSearch/);
  assert.match(policy, /curl -fSL --connect-timeout 10 --max-time 30 "https:\/\/wttr\.in\/Shanghai\?format=j1"/);
  assert.match(policy, /weather\[\]\.date/);
  assert.match(policy, /curl\.exe/);
  assert.match(policy, /不发送凭据/);
  assert.match(policy, /不要使用 WebSearch 或 WebFetch/);
  assert.match(policy, /不得绕过权限拒绝、用户限制或 plan 模式/);
  assert.match(policy, /Glob\/Grep 在当前接入中未暴露/);
  assert.match(policy, /rg --files/);
  assert.match(policy, /Get-ChildItem\/Select-String/);
  assert.match(policy, /正常时优先使用原生工具/);
  assert.match(policy, /不得伪造/);
  assert.match(policy, /JSON\.parse\(fs\.readFileSync\(0, "utf8"\)\)/);
  assert.match(policy, /mintempC: day\.mintempC, maxtempC: day\.maxtempC/);
  assert.match(policy, /不要省略解析/);
  assert.match(policy, /禁止猜测/);
  assert.match(policy, /NotebookEdit/);
  assert.match(policy, /TaskStop/);
});

test("shares the fallback policy with one-shot Claude prompts without changing native compact", () => {
  const prompt = "今天上海天气\n保留原始需求";
  assert.equal(buildClaudePrompt(prompt), buildClaudePromptContent(prompt).map((block) => block.text).join("\n\n"));
  assert.ok(buildClaudePrompt(prompt).startsWith(`${prompt}\n\n`));
  assert.equal(buildClaudePrompt("/compact 保留结果"), "/compact 保留结果");
});

test("keeps native Claude compact commands unchanged", () => {
  for (const prompt of ["/compact", "/compact 保留天气结果", "  /compact\n保留结果"]) {
    assert.deepEqual(buildClaudePromptContent(prompt), [{ type: "text", text: prompt }]);
  }
});

test("adds network instructions to repeated turns without sharing mutable content", () => {
  const first = buildClaudePromptContent("继续查询");
  first[1].text = "changed";
  const second = buildClaudePromptContent("继续查询");
  assert.match(second[1].text, /不要使用 WebSearch/);
  assert.equal(second.filter((block) => block.text.includes("<claude_network_policy>")).length, 1);
  assert.equal(buildClaudePromptContent("/compact-weather").length, 2);
});

test("the suggested parser retains actual forecast temperatures without oversized payloads", () => {
  const parser = buildClaudePrompt("今天上海天气").match(/\| node -e '([^']+)'/);
  assert.ok(parser);
  const forecast = {
    current_condition: [{ temp_C: "26", observation_time: "03:15 AM" }],
    weather: [{
      date: "2026-10-20",
      mintempC: "21",
      maxtempC: "27",
      oversized: "payload".repeat(10000),
      hourly: [{ time: "1800", tempC: "23", weatherDesc: [{ value: "Drizzle" }], chanceofrain: "80" }],
    }],
  };
  const result = spawnSync(process.execPath, ["-e", parser[1]], { input: JSON.stringify(forecast), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.weather[0].date, "2026-10-20");
  assert.equal(parsed.weather[0].mintempC, "21");
  assert.equal(parsed.weather[0].maxtempC, "27");
  assert.equal(parsed.weather[0].hourly[0].weatherDesc[0].value, "Drizzle");
  assert.equal(parsed.weather[0].oversized, undefined);
  assert.equal(parsed.current_condition[0].temp_C, "26");
  assert.equal(parsed.current_condition[0].observation_time, undefined);
  assert.ok(result.stdout.length < 1000);
});

test("the suggested parser fails instead of fabricating weather on an invalid response", () => {
  const parser = buildClaudePrompt("今天上海天气").match(/\| node -e '([^']+)'/);
  assert.ok(parser);
  const result = spawnSync(process.execPath, ["-e", parser[1]], { input: "<html>network error</html>", encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.trim(), "");
  assert.match(result.stderr, /SyntaxError/);
});
