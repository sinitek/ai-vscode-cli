import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import {
  isCliEnabled,
  listEnabledClis,
  normalizeCliEnabledByName,
  normalizeToolSettings,
  readHumanInteractionTimeoutMs,
  resolveGlobalAutoCompactContextAfterRun,
  resolveGlobalHumanInteractionEnabled,
  resolveHumanInteractionTimeoutMinutes,
  resolveLongTermMemoryEnabled,
  resolveNewTaskInteractiveMode,
  resolveNextEnabledCli,
  resolveNotificationSettings,
  normalizeHistoryRetentionDays,
  updateToolSettings,
  type ToolSettingsState,
} from "../../toolSettings";
import { getLegacyLoopPropertyKey } from "../../loopLegacyMigration";
import { PROMPT_INPUT_MIN_HEIGHT } from "../../promptInputHeight";

test("chat message limit keeps old settings compatible and preserves neighboring values", () => {
  assert.deepEqual(normalizeToolSettings(undefined), {});
  assert.deepEqual(normalizeToolSettings({ debug: true, historyRetentionDays: 45 }), {
    debug: true, historyRetentionDays: 45,
  });
  for (const [value, expected] of [["734.9", 734], ["", 500], [null, 500], [true, 500], [Infinity, 500], [0, 1], [20000, 10000]] as const) {
    assert.deepEqual(normalizeToolSettings({ debug: true, chatMessageLimit: value, historyRetentionDays: 45 }), {
      debug: true, chatMessageLimit: expected, historyRetentionDays: 45,
    });
  }
});

test("group chat message limit is independent and safely normalizes global settings", () => {
  for (const [value, expected] of [[200, 200], ["734.9", 734], ["", 500], [null, 500], [true, 500], [Infinity, 500], [0, 1], [20000, 10000]] as const) {
    assert.deepEqual(normalizeToolSettings({ chatMessageLimit: 500, loopGroupChatMessageLimit: value, debug: true }), {
      chatMessageLimit: 500, loopGroupChatMessageLimit: expected, debug: true,
    });
  }
});

test("department capacity settings normalize old, malformed, and valid persisted values", () => {
  assert.deepEqual(normalizeToolSettings({ debug: true }), { debug: true });
  assert.deepEqual(normalizeToolSettings({ departmentMaxLeaders: "5.9", departmentMaxEmployees: 18.7 }), {
    departmentMaxLeaders: 5,
    departmentMaxEmployees: 18,
  });
  assert.deepEqual(normalizeToolSettings({ departmentMaxLeaders: "", departmentMaxEmployees: Infinity }), {
    departmentMaxLeaders: 4,
    departmentMaxEmployees: 16,
  });
  assert.deepEqual(normalizeToolSettings({ departmentMaxEmployees: 20 }), { departmentMaxEmployees: 20 });
});

test("instruction bubble visibility accepts only booleans and keeps old settings compatible", () => {
  for (const enabled of [true, false]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, hideInstructionBubbles: enabled }), {
      debug: true, hideInstructionBubbles: enabled,
    });
  }
  for (const value of [undefined, null, "true", "false", 1, 0, {}, []]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, hideInstructionBubbles: value }), { debug: true });
  }
});

test("chat input height accepts finite pixel heights at or above the three-row minimum", () => {
  for (const height of [PROMPT_INPUT_MIN_HEIGHT, 190.5]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, promptInputHeight: height }), { debug: true, promptInputHeight: height });
  }
  for (const height of [undefined, null, 0, PROMPT_INPUT_MIN_HEIGHT - 0.5, "190.5", NaN, Infinity]) {
    assert.deepEqual(normalizeToolSettings({ debug: true, promptInputHeight: height }), { debug: true });
  }
});

test("new task mode defaults to Vibe and accepts only the three visible modes", () => {
  assert.equal(resolveNewTaskInteractiveMode(normalizeToolSettings({}).newTaskInteractiveMode), "coding");
  for (const mode of ["coding", "loop", "loop_plus"]) {
    assert.equal(normalizeToolSettings({ newTaskInteractiveMode: mode }).newTaskInteractiveMode, mode);
  }
  for (const mode of [null, "plan", "lobster", "Loop+", true, {}]) {
    assert.equal(normalizeToolSettings({ newTaskInteractiveMode: mode }).newTaskInteractiveMode, "coding");
  }
});

test("reloading tool settings reads external changes and replaces the cached snapshot", (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-reload-settings-"));
  context.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const script = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    require("node:os").homedir = () => ${JSON.stringify(temporaryHome)};
    const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
    const filePath = settings.getToolSettingsFilePath();
    const initial = { debug: true, historyRetentionDays: 45 };
    settings.writeToolSettings(initial);
    const external = JSON.stringify({ historyRetentionDays: 90, chatMessageLimit: "800.9" });
    fs.writeFileSync(filePath, external);
    assert.deepEqual(settings.readToolSettings(), initial);
    const updated = { historyRetentionDays: 90, chatMessageLimit: 800 };
    assert.deepEqual(settings.reloadToolSettings(), updated);
    assert.deepEqual(settings.readToolSettings(), updated);
    assert.equal(fs.readFileSync(filePath, "utf8"), external);
    fs.writeFileSync(filePath, "invalid JSON");
    assert.deepEqual(settings.reloadToolSettings(), {});
    assert.deepEqual(settings.readToolSettings(), {});
    fs.writeFileSync(filePath, external);
    assert.deepEqual(settings.reloadToolSettings(), updated);
    fs.unlinkSync(filePath);
    assert.deepEqual(settings.reloadToolSettings(), {});
    assert.deepEqual(settings.readToolSettings(), {});
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("tool settings persist globally without losing other settings", () => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-chat-limit-settings-"));
  try {
    const script = `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      require("node:os").homedir = () => ${JSON.stringify(temporaryHome)};
      const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
      const filePath = path.join(${JSON.stringify(temporaryHome)}, ".sinitek_cli", "settings.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12 }));
      assert.deepEqual(settings.readToolSettings(), { debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12 });
      settings.writeToolSettings({ ...settings.readToolSettings(), chatMessageLimit: "879.9" });
      const expected = { debug: true, historyRetentionDays: 45, humanInteractionTimeoutMinutes: 12, chatMessageLimit: 879 };
      assert.equal(settings.getToolSettingsFilePath(), filePath);
      assert.deepEqual(settings.readToolSettings(), expected);
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), expected);
      settings.writeToolSettings({ ...settings.readToolSettings(), loopGroupChatMessageLimit: "200.9" });
      assert.deepEqual(settings.readToolSettings(), { ...expected, loopGroupChatMessageLimit: 200 });
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { ...expected, loopGroupChatMessageLimit: 200 });
      const resized = { ...settings.readToolSettings(), promptInputHeight: 190.5 };
      settings.writeToolSettings(resized);
      assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), resized);
      const settingsPath = ${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))};
      delete require.cache[require.resolve(settingsPath)];
      assert.deepEqual(require(settingsPath).readToolSettings(), resized);
      settings.writeToolSettings({ ...settings.readToolSettings(), promptInputHeight: undefined });
      for (const enabled of [true, false]) {
        settings.writeToolSettings({ ...settings.readToolSettings(), hideInstructionBubbles: enabled });
        const persisted = { ...expected, loopGroupChatMessageLimit: 200, hideInstructionBubbles: enabled };
        assert.deepEqual(settings.readToolSettings(), persisted);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), persisted);
      }
      for (const mode of ["coding", "loop", "loop_plus"]) {
        settings.writeToolSettings({ ...settings.readToolSettings(), newTaskInteractiveMode: mode });
        const persisted = { ...expected, loopGroupChatMessageLimit: 200, hideInstructionBubbles: false, newTaskInteractiveMode: mode };
        assert.deepEqual(settings.readToolSettings(), persisted);
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), persisted);
      }
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test("global setting patches merge disk state across stale window caches", (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-settings-patch-"));
  context.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const script = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    require("node:os").homedir = () => ${JSON.stringify(temporaryHome)};
    const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
    settings.writeToolSettings({ debug: true, historyRetentionDays: 30, cliEnabledByName: { codex: false } });
    settings.readToolSettings();
    settings.updateToolSettings({ historyRetentionDays: 90 });
    settings.updateToolSettings({ debug: false, cliEnabledByName: { claude: false } });
    const expected = { debug: false, historyRetentionDays: 90, cliEnabledByName: { codex: false, claude: false } };
    assert.deepEqual(settings.reloadToolSettings(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings.getToolSettingsFilePath(), "utf8")), expected);
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("global tool settings preserve patches from two processes with stale caches", async (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-settings-cross-process-"));
  const filePath = path.join(temporaryHome, ".sinitek_cli", "settings.json");
  const initial = { debug: true, historyRetentionDays: 30, chatMessageLimit: 650, cliEnabledByName: { codex: false } };
  const writers: ReturnType<typeof startWriter>[] = [];
  context.after(async () => {
    for (const { child } of writers) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await Promise.all(writers.map(({ closed }) => closed));
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(initial));

  function startWriter(name: string, patch: ToolSettingsState) {
    const script = `
      const assert = require("node:assert/strict");
      assert.equal(require("node:os").homedir(), ${JSON.stringify(temporaryHome)});
      const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
      assert.deepEqual(settings.readToolSettings(), ${JSON.stringify(initial)});
      process.once("message", (message) => {
        assert.equal(message, "save");
        settings.updateToolSettings(${JSON.stringify(patch)});
        process.disconnect();
      });
      process.send("ready");
    `;
    const child = spawn(process.execPath, ["-e", script], {
      env: { ...process.env, HOME: temporaryHome, USERPROFILE: temporaryHome, NODE_OPTIONS: "" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: 5000,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { stderr += `${error.message}\n`; });
    const closed = new Promise<{ code: number | null; detail: string }>((resolve) => {
      child.once("close", (code, signal) => resolve({ code, detail: `${name}: exit ${code}, signal ${signal}\n${stderr}` }));
    });
    const ready = Promise.race([
      once(child, "message").then(([message]) => assert.equal(message, "ready", name)),
      closed.then(({ detail }) => { throw new Error(`Writer closed before loading baseline: ${detail}`); }),
    ]);
    async function save() {
      await new Promise<void>((resolve, reject) => {
        child.send("save", (error) => error ? reject(error) : resolve());
      });
      const { code, detail } = await closed;
      assert.equal(code, 0, detail);
    }
    return { child, closed, ready, save };
  }

  function assertPersisted(expected: ToolSettingsState) {
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), expected);
    assert.equal(fs.existsSync(`${filePath}.lock`), false, "settings lock was not released");
  }

  const writerA = startWriter("writer A", { historyRetentionDays: 90, cliEnabledByName: { claude: false } });
  writers.push(writerA);
  const writerB = startWriter("writer B", { debug: false, cliEnabledByName: { opencode: false } });
  writers.push(writerB);
  await Promise.all([writerA.ready, writerB.ready]);
  await writerA.save();
  assertPersisted({ ...initial, historyRetentionDays: 90, cliEnabledByName: { codex: false, claude: false } });
  await writerB.save();
  assertPersisted({
    ...initial, historyRetentionDays: 90, debug: false,
    cliEnabledByName: { codex: false, claude: false, opencode: false },
  });
});

test("tool settings report a replaced lock without removing it or rolling back a completed write", (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-settings-lock-"));
  context.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const script = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    require("node:os").homedir = () => ${JSON.stringify(temporaryHome)};
    const settings = require(${JSON.stringify(path.resolve(__dirname, "../../toolSettings.js"))});
    const filePath = settings.getToolSettingsFilePath();
    const lockPath = filePath + ".lock";
    settings.writeToolSettings({ debug: true });
    assert.equal(fs.existsSync(lockPath), false);

    const renameSync = fs.renameSync;
    fs.renameSync = (source, destination) => {
      renameSync(source, destination);
      if (destination === filePath) {
        renameSync(lockPath, lockPath + ".original");
        fs.writeFileSync(lockPath, "replacement", { flag: "wx" });
      }
    };
    assert.throws(() => settings.updateToolSettings({ historyRetentionDays: 90 }), {
      message: "全局工具设置锁已替换，拒绝释放未知锁。",
    });
    const expected = { debug: true, historyRetentionDays: 90 };
    assert.deepEqual(settings.readToolSettings(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), expected);
    assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement");
  `;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});

test("notification settings share the global tool settings source", () => {
  assert.deepEqual(normalizeToolSettings({ taskCompletionNotifications: false, debug: true }), {
    taskCompletionNotifications: false,
    debug: true,
  });
  assert.deepEqual(resolveNotificationSettings({ humanInteractionNotifications: false }), {
    humanInteractionNotifications: false,
    taskCompletionNotifications: true,
    humanInteractionWindowAttention: true,
    taskCompletionWindowAttention: true,
  });
});

test("ignores retired final-answer policy fields", () => {
  assert.deepEqual(
    normalizeToolSettings({
      debug: true,
      finalAnswerPolicy: "successful_reply_fallback",
      codexFinalAnswerPolicy: "completed_turn_fallback",
    }),
    { debug: true },
  );
});

test("ignores retired implicit-subagents settings without affecting other settings", () => {
  for (const value of [true, false, "true", null]) {
    assert.deepEqual(
      normalizeToolSettings({ multiAgentEnabled: value, codexMultiAgentEnabled: value, debug: true }),
      { debug: true },
    );
  }
  assert.deepEqual(normalizeToolSettings({ multiAgentEnabled: false }), {});
});

test("keeps CLI enable flags default-on and persists only explicit booleans", () => {
  assert.deepEqual(listEnabledClis({}), ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
  assert.deepEqual(listEnabledClis(null), ["codex", "claude", "opencode", "grok", "dsh", "kimi-code", "zcode"]);
  assert.equal(isCliEnabled("codex", {}), true);
  assert.equal(isCliEnabled("zcode", {}), true);
  assert.equal(isCliEnabled("zcode", { cliEnabledByName: { zcode: false } }), false);
  assert.equal(isCliEnabled("not-a-cli", {}), false);
  assert.deepEqual(normalizeToolSettings({
    cliEnabledByName: { codex: false, claude: "no", grok: true, extra: false },
  }), {
    cliEnabledByName: { codex: false, grok: true },
  });
  assert.deepEqual(
    listEnabledClis({ cliEnabledByName: { codex: false } }),
    ["claude", "opencode", "grok", "dsh", "kimi-code", "zcode"],
  );
  assert.equal(resolveNextEnabledCli("codex", { cliEnabledByName: { codex: false } }), "claude");
  assert.equal(resolveNextEnabledCli("grok", { cliEnabledByName: { grok: true } }), "grok");
  assert.equal(resolveNextEnabledCli("codex", {
    cliEnabledByName: { codex: false, claude: false, opencode: false, grok: false, dsh: false, "kimi-code": false, zcode: false },
  }), null);
  assert.equal(normalizeCliEnabledByName(["codex"]), undefined);
  assert.equal(normalizeCliEnabledByName({ codex: 1, claude: null }), undefined);
});

test("normalizes the global human-interaction setting", () => {
  assert.deepEqual(
    normalizeToolSettings({ humanInteractionEnabled: false }),
    { humanInteractionEnabled: false },
  );
  assert.deepEqual(
    normalizeToolSettings({ humanInteractionEnabled: "false" }),
    {},
  );
});

test("resolves global human interaction as default-on", () => {
  assert.equal(resolveGlobalHumanInteractionEnabled({}), true);
  assert.equal(resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled: true }), true);
  assert.equal(resolveGlobalHumanInteractionEnabled({ humanInteractionEnabled: false }), false);
});

test("normalizes the global automatic-compaction setting", () => {
  assert.deepEqual(
    normalizeToolSettings({ autoCompactContextAfterRun: false }),
    { autoCompactContextAfterRun: false },
  );
  assert.deepEqual(
    normalizeToolSettings({ autoCompactContextAfterRun: "false" }),
    {},
  );
});

test("resolves global automatic compaction before legacy workspace values", () => {
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {}), true);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({ autoCompactContextAfterRun: false }, {
    autoCompactContextAfterRun: true,
  }), false);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({ autoCompactContextAfterRun: true }, {
    autoCompactContextAfterRun: false,
  }), true);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {
    autoCompactContextAfterRun: false,
    autoCompactContextBeforeRun: true,
  }), false);
  assert.equal(resolveGlobalAutoCompactContextAfterRun({}, {
    autoCompactContextBeforeRun: false,
  }), false);
});

test("resolves long-term memory disabled by default without requiring persisted settings", () => {
  assert.equal(resolveLongTermMemoryEnabled({}), false);
});

test("keeps any explicit total-switch false as the effective long-term memory state", () => {
  assert.equal(resolveLongTermMemoryEnabled({ memoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ globalMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ longTermMemoryEnabled: false }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceSettings: { longTermMemoryEnabled: false } }), false);
  assert.equal(resolveLongTermMemoryEnabled({ workspaceSettings: { workspaceMemoryEnabled: false } }), false);
});

test("ignores legacy global long-term memory field after memory became workspace scoped", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      longTermMemoryEnabled: false,
      workspaceSettings: { workspaceMemoryEnabled: true },
    }),
    true,
  );
});

test("treats memory auto-extract settings as secondary switches only", () => {
  assert.equal(
    resolveLongTermMemoryEnabled({
      workspaceSettings: { workspaceMemoryEnabled: false },
      memoryAutoExtractAfterCompact: true,
      memoryAutoExtractAfterLoopTask: true,
    }),
    false,
  );
  assert.equal(resolveLongTermMemoryEnabled({ memoryAutoExtractAfterCompact: true }), false);
});

test("preserves long-term memory false when saving unrelated tool settings", () => {
  const stored: ToolSettingsState = normalizeToolSettings({
    longTermMemoryEnabled: false,
    debug: false,
  });
  const saved = normalizeToolSettings({
    ...stored,
  });

  assert.deepEqual(saved, {
    debug: false,
    longTermMemoryEnabled: false,
  });
});

test("normalizes known legacy memory fields without accepting non-boolean values", () => {
  assert.deepEqual(
    normalizeToolSettings({
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterCompact: "true",
      memoryAutoExtractAfterLoopTask: true,
    }),
    {
      memoryEnabled: false,
      globalMemoryEnabled: true,
      memoryAutoExtractAfterLoopTask: true,
    },
  );
});

test("normalizes global Loop tool settings", () => {
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: "42.9",
      loopPlusDecisionSubtaskMax: "8.2",
      loopPlusSubtaskMaxRounds: "100.8",
      humanInteractionTimeoutMinutes: "10.9",
      loopSubtaskMaxThinkingMode: "high",
    }),
    {
      loopPlusDecisionSubtaskMax: 8,
      humanInteractionTimeoutMinutes: 10,
    },
  );
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: "",
      loopPlusDecisionSubtaskMax: "",
      loopPlusSubtaskMaxRounds: "",
      humanInteractionTimeoutMinutes: "",
      loopSubtaskMaxThinkingMode: "invalid",
    }),
    {},
  );
  assert.equal(resolveHumanInteractionTimeoutMinutes(undefined), 15);
  assert.equal(resolveHumanInteractionTimeoutMinutes(0), 1);
  assert.equal(resolveHumanInteractionTimeoutMinutes(9999), 1440);
  assert.equal(readHumanInteractionTimeoutMs({}), 900_000);
  assert.equal(readHumanInteractionTimeoutMs({ humanInteractionTimeoutMinutes: 2 }), 120_000);
  assert.equal(readHumanInteractionTimeoutMs({ humanInteractionTimeoutMinutes: 1440 }), 86_400_000);
  assert.deepEqual(
    normalizeToolSettings({ loopSubtaskMaxThinkingMode: "ultra" }),
    {},
  );
});

test("normalizes global automatic-cleanup retention days", () => {
  assert.deepEqual(normalizeToolSettings({ historyRetentionDays: "45.9" }), {
    historyRetentionDays: 45,
  });
  assert.equal(normalizeHistoryRetentionDays(0), 1);
  assert.equal(normalizeHistoryRetentionDays(99999), 3650);
  assert.equal(normalizeHistoryRetentionDays("invalid"), 30);
  assert.deepEqual(normalizeToolSettings({ historyRetentionDays: "" }), {});
});

test("migrates legacy Loop tool-setting keys and prefers current values", () => {
  assert.deepEqual(
    normalizeToolSettings({
      [getLegacyLoopPropertyKey("loopMaxRounds")]: "31.8",
      [getLegacyLoopPropertyKey("loopSubtaskMaxThinkingMode")]: "max",
      [getLegacyLoopPropertyKey("memoryAutoExtractAfterLoopTask")]: true,
    }),
    {
      memoryAutoExtractAfterLoopTask: true,
    },
  );
  assert.deepEqual(
    normalizeToolSettings({
      loopMaxRounds: 12,
      [getLegacyLoopPropertyKey("loopMaxRounds")]: 99,
    }),
    {},
  );
});


test("ignores retired cumulative Loop subtask settings", () => {
  assert.deepEqual(normalizeToolSettings({ loopPlusSubtaskMaxRounds: 0, loopPlusMaxAcceptances: 1 }), {});
  assert.deepEqual(normalizeToolSettings({ loopPlusSubtaskMaxRounds: 10000 }), {});
  assert.deepEqual(normalizeToolSettings({ loopPlusMaxAcceptances: 1 }), {});
});
