import * as path from "path";
import * as os from "os";
import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

const promptRuntime = require("../promptRuntime") as typeof import("../promptRuntime");

type StatSync = typeof import("fs").statSync;
type RuntimeGateModule = {
  isMemoryRuntimeOperationAllowed: (...args: unknown[]) => boolean;
};
type MemoryRecallModule = {
  buildWorkspaceMemoryRecallPack: (...args: unknown[]) => unknown;
};
type MemoryPromptModule = {
  buildLongTermMemoryPromptBlock: (...args: unknown[]) => string;
  injectLongTermMemoryPrompt: (...args: unknown[]) => string;
};

const nodeFs = require("fs") as { statSync: StatSync };
const runtimeGate = require("../memory/runtimeGate") as RuntimeGateModule;
const memoryRecall = require("../memory/memoryRecall") as MemoryRecallModule;
const memoryPrompt = require("../memory/memoryPrompt") as MemoryPromptModule;

function collectWithMockedStats(
  prompt: string,
  cwd: string,
  statSync: (filePath: string) => { isFile: () => boolean }
): string[] {
  const originalStatSync = nodeFs.statSync;
  try {
    nodeFs.statSync = ((filePath: string) => statSync(filePath)) as StatSync;
    return promptRuntime.collectCodexImagePathsFromPrompt(prompt, cwd);
  } finally {
    nodeFs.statSync = originalStatSync;
  }
}

function withLongTermMemoryMocks(
  run: () => void
): void {
  const originalIsAllowed = runtimeGate.isMemoryRuntimeOperationAllowed;
  const originalRecall = memoryRecall.buildWorkspaceMemoryRecallPack;
  const originalBuildBlock = memoryPrompt.buildLongTermMemoryPromptBlock;
  const originalInject = memoryPrompt.injectLongTermMemoryPrompt;
  try {
    run();
  } finally {
    runtimeGate.isMemoryRuntimeOperationAllowed = originalIsAllowed;
    memoryRecall.buildWorkspaceMemoryRecallPack = originalRecall;
    memoryPrompt.buildLongTermMemoryPromptBlock = originalBuildBlock;
    memoryPrompt.injectLongTermMemoryPrompt = originalInject;
  }
}

test("normalizes prompt tags and core prompt text helpers without preserving invalid values", () => {
  assert.deepEqual(
    promptRuntime.normalizePromptContextTags({ contextTags: [" source.ts ", "", "  ", 4, null, "range"] }),
    [" source.ts ", "range"]
  );
  assert.deepEqual(promptRuntime.normalizePromptContextTags({ contextTags: "source.ts" }), []);
  assert.deepEqual(promptRuntime.normalizePromptContextTags({}), []);

  assert.equal(promptRuntime.buildRuntimeModelPrompt({ displayPrompt: "visible", modelPrompt: "model" }), "model");
  assert.equal(promptRuntime.buildRuntimeModelPrompt({ displayPrompt: "visible", modelPrompt: "" }), "visible");
  assert.equal(promptRuntime.buildRuntimeModelPrompt({ displayPrompt: "visible", modelPrompt: null }), "visible");

  assert.equal(promptRuntime.hasNonEmptyAssistantText({ role: "assistant", content: " answer " } as never), true);
  assert.equal(promptRuntime.hasNonEmptyAssistantText({ role: "assistant", content: "  " } as never), false);
  assert.equal(promptRuntime.hasNonEmptyAssistantText({ role: "assistant" } as never), false);
  assert.equal(promptRuntime.hasNonEmptyAssistantText({ role: "user", content: "answer" } as never), false);
  assert.equal(promptRuntime.hasNonEmptyAssistantText(undefined), false);

  assert.equal(promptRuntime.mergePromptSections("intro  \n", "body", "\n  trailer"), "intro\nbody\ntrailer");
  assert.equal(promptRuntime.mergePromptSections(" \t", "body", "\n"), "body");

  assert.equal(
    promptRuntime.buildThinkingPrompt("codex", "medium", "raw prompt", {
      includePrefix: false,
      includeSuffix: false,
      includeFinalAnswerInstruction: false,
    }),
    "raw prompt"
  );
  assert.match(
    promptRuntime.buildThinkingPrompt("codex", "high", "raw prompt"),
    /raw prompt/,
  );
});

test("uses configured thinking instructions and tolerates a malformed attachment matcher", () => {
  const vscode = require("vscode") as {
    workspace: { getConfiguration: () => { get: <T>(key: string, fallback?: T) => T | undefined } };
  };
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalMatchAll = String.prototype.matchAll;
  try {
    vscode.workspace.getConfiguration = () => ({
      get: <T>(key: string, fallback?: T): T | undefined => (
        key.includes("Prefix") ? "prefix" as T : key.includes("Suffix") ? "suffix" as T : fallback
      ),
    });
    assert.equal(
      promptRuntime.buildThinkingPrompt("codex", "high", "body", { includeFinalAnswerInstruction: false }),
      "prefix\nbody\nsuffix",
    );
    String.prototype.matchAll = (() => [[undefined, undefined, undefined, undefined]][Symbol.iterator]()) as typeof String.prototype.matchAll;
    assert.deepEqual(promptRuntime.collectCodexImagePathsFromPrompt("@malformed", "/tmp"), []);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    String.prototype.matchAll = originalMatchAll;
  }
});

test("redacts only the last matching prompt argument and leaves empty prompts unchanged", () => {
  const args = ["exec", "repeat", "--note", "repeat"];

  assert.deepEqual(promptRuntime.redactPromptArg(args, "repeat"), ["exec", "repeat", "--note", "<prompt:6>"]);
  assert.deepEqual(args, ["exec", "repeat", "--note", "repeat"]);
  assert.equal(promptRuntime.redactPromptArg(args), args);
  assert.equal(promptRuntime.redactPromptArg(args, ""), args);
  assert.deepEqual(promptRuntime.redactPromptArg(args, "absent"), args);
});

test("resolves blank, absolute, and cwd-relative prompt references", () => {
  const cwd = path.join(path.sep, "isolated", "project");

  assert.equal(promptRuntime.resolvePromptReferencedPath("   ", cwd), null);
  assert.equal(promptRuntime.resolvePromptReferencedPath(" /attachments/image.png ", cwd), "/attachments/image.png");
  assert.equal(
    promptRuntime.resolvePromptReferencedPath(" screenshots/image.png ", cwd),
    path.resolve(cwd, "screenshots/image.png")
  );
  assert.equal(
    promptRuntime.resolvePromptReferencedPath("screenshots/image.png"),
    path.resolve("screenshots/image.png")
  );
  assert.equal(promptRuntime.resolvePromptReferencedPath("~", cwd), os.homedir());
  assert.equal(
    promptRuntime.resolvePromptReferencedPath("~/screenshots/image.png", cwd),
    path.join(os.homedir(), "screenshots/image.png")
  );
});

test("collects only existing supported image references and de-duplicates resolved paths", () => {
  const cwd = path.join(path.sep, "isolated", "project");
  const pngPath = path.resolve(cwd, "diagram.PNG");
  const webpPath = path.resolve(cwd, "with space.webp");
  const svgPath = path.resolve(cwd, "vector.svg");
  const prompt = [
    "inspect @diagram.PNG",
    "@\"with space.webp\"",
    "@'vector.svg'",
    "@diagram.PNG",
    "@notes.txt @missing.gif @folder.heic",
  ].join(" ");

  const imagePaths = collectWithMockedStats(prompt, cwd, (filePath) => {
    if (filePath.endsWith("missing.gif")) {
      throw new Error("not found");
    }
    return { isFile: () => !filePath.endsWith("folder.heic") };
  });

  assert.deepEqual(imagePaths, [pngPath, webpPath, svgPath]);
  assert.deepEqual(
    collectWithMockedStats("   ", cwd, () => {
      throw new Error("blank prompts must not stat files");
    }),
    []
  );
});

test("normalizes context settings and formats current-file labels with range fallback", () => {
  assert.deepEqual(promptRuntime.normalizePromptContextOptions(), {
    includeCurrentFile: true,
    includeSelection: true,
  });
  assert.deepEqual(promptRuntime.normalizePromptContextOptions({ includeCurrentFile: false }), {
    includeCurrentFile: false,
    includeSelection: true,
  });
  assert.deepEqual(promptRuntime.normalizePromptContextOptions({ includeSelection: false }), {
    includeCurrentFile: true,
    includeSelection: false,
  });

  const rangeLabel = promptRuntime.formatPromptContextTagLabel({
    fileLabel: "src/widget.ts",
    hasSelection: true,
    selectionLabel: "5:1-7:2",
  });
  assert.match(rangeLabel, /src\/widget\.ts/);
  assert.match(rangeLabel, /5:1-7:2/);

  const fallbackLabel = promptRuntime.formatPromptContextTagLabel({
    fileLabel: "src/widget.ts",
    hasSelection: true,
    selectionLabel: null,
  });
  assert.match(fallbackLabel, /src\/widget\.ts/);
  assert.doesNotMatch(fallbackLabel, /5:1-7:2/);
});

test("builds editor context only when enabled, including selection and current-file fallback", () => {
  let activeEditorCalls = 0;
  const getActiveEditorPromptContext = (): null => {
    activeEditorCalls += 1;
    return null;
  };

  assert.deepEqual(
    promptRuntime.buildPromptWithAutoContextFromEditor("", undefined, {
      autoAddEditorContextTags: true,
      getActiveEditorPromptContext,
    }),
    { modelPrompt: "", contextTags: [] }
  );
  assert.deepEqual(
    promptRuntime.buildPromptWithAutoContextFromEditor("inspect", undefined, {
      autoAddEditorContextTags: false,
      getActiveEditorPromptContext,
    }),
    { modelPrompt: "inspect", contextTags: [] }
  );
  assert.deepEqual(
    promptRuntime.buildPromptWithAutoContextFromEditor("inspect", {
      includeCurrentFile: false,
      includeSelection: false,
    }, {
      autoAddEditorContextTags: true,
      getActiveEditorPromptContext,
    }),
    { modelPrompt: "inspect", contextTags: [] }
  );
  assert.equal(activeEditorCalls, 0);

  assert.deepEqual(
    promptRuntime.buildPromptWithAutoContextFromEditor("inspect", undefined, {
      autoAddEditorContextTags: true,
      getActiveEditorPromptContext,
    }),
    { modelPrompt: "inspect", contextTags: [] }
  );
  assert.equal(activeEditorCalls, 1);

  const fallback = promptRuntime.buildPromptWithAutoContextFromEditor("inspect", {
    includeSelection: true,
  }, {
    autoAddEditorContextTags: true,
    getActiveEditorPromptContext: () => ({
      fileLabel: "src/fallback.ts",
      hasSelection: false,
      selectionLabel: null,
    }),
  });
  assert.equal(fallback.modelPrompt, "inspect\n\n----\nAuto Context References:\n@src/fallback.ts");
  assert.equal(fallback.contextTags.length, 1);
  assert.match(fallback.contextTags[0], /src\/fallback\.ts/);

  const selected = promptRuntime.buildPromptWithAutoContextFromEditor("inspect", {
    includeCurrentFile: false,
    includeSelection: true,
  }, {
    autoAddEditorContextTags: true,
    getActiveEditorPromptContext: () => ({
      fileLabel: "src/selected.ts",
      hasSelection: true,
      selectionLabel: "10-12",
    }),
  });
  assert.equal(selected.modelPrompt, "inspect\n\n----\nAuto Context References:\nSelected range in @src/selected.ts: 10-12");
  assert.equal(selected.contextTags.length, 1);

  const selectedWithoutLabel = promptRuntime.buildPromptWithAutoContextFromEditor("inspect", {
    includeCurrentFile: false,
    includeSelection: true,
  }, {
    autoAddEditorContextTags: true,
    getActiveEditorPromptContext: () => ({
      fileLabel: "src/selected.ts",
      hasSelection: true,
      selectionLabel: null,
    }),
  });
  assert.equal(selectedWithoutLabel.modelPrompt, "inspect\n\n----\nAuto Context References:\nSelected range in @src/selected.ts");

  assert.deepEqual(
    promptRuntime.buildPromptWithAutoContextFromEditor("inspect", {
      includeCurrentFile: false,
      includeSelection: true,
    }, {
      autoAddEditorContextTags: true,
      getActiveEditorPromptContext: () => ({
        fileLabel: "src/no-selection.ts",
        hasSelection: false,
        selectionLabel: null,
      }),
    }),
    { modelPrompt: "inspect", contextTags: [] }
  );
});

test("deduplicates normalized long-term-memory focus hints", () => {
  assert.deepEqual(
    promptRuntime.buildLongTermMemoryFocusHints(
      ["  feature  ", "feature", "", "  range "],
      { fileLabel: "src/feature.ts", hasSelection: true, selectionLabel: "4-9" }
    ),
    ["feature", "range", "src/feature.ts", "4-9"]
  );
  assert.deepEqual(
    promptRuntime.buildLongTermMemoryFocusHints([null, "  useful  "] as unknown as string[], null),
    ["useful"],
  );
  assert.deepEqual(promptRuntime.buildLongTermMemoryFocusHints([], null), []);
});

test("skips long-term-memory injection when the runtime gate is closed or paths are unavailable", () => {
  withLongTermMemoryMocks(() => {
    let recallCalls = 0;
    memoryRecall.buildWorkspaceMemoryRecallPack = () => {
      recallCalls += 1;
      return {};
    };

    runtimeGate.isMemoryRuntimeOperationAllowed = () => false;
    const baseDeps = {
      runtimeSettings: {} as never,
      memoryPaths: {} as never,
      locale: "en" as never,
      getActiveEditorPromptContext: () => null,
      onError: () => undefined,
    };
    assert.equal(
      promptRuntime.maybeInjectLongTermMemoryForPromptWithDeps("user prompt", "model prompt", [], baseDeps),
      "model prompt"
    );

    runtimeGate.isMemoryRuntimeOperationAllowed = () => true;
    assert.equal(
      promptRuntime.maybeInjectLongTermMemoryForPromptWithDeps("user prompt", "model prompt", [], {
        ...baseDeps,
        memoryPaths: null,
      }),
      "model prompt"
    );
    assert.equal(recallCalls, 0);
  });
});

test("injects mocked long-term memory and reports recall errors without changing the model prompt", () => {
  withLongTermMemoryMocks(() => {
    const memoryPaths = { root: "in-memory" } as never;
    let recallArgs: unknown[] = [];
    runtimeGate.isMemoryRuntimeOperationAllowed = () => true;
    memoryRecall.buildWorkspaceMemoryRecallPack = (...args: unknown[]) => {
      recallArgs = args;
      return { entries: ["memory"] };
    };
    memoryPrompt.buildLongTermMemoryPromptBlock = (recallPack, locale) => {
      assert.deepEqual(recallPack, { entries: ["memory"] });
      assert.equal(locale, "en");
      return "[memory block]";
    };
    memoryPrompt.injectLongTermMemoryPrompt = (modelPrompt, memoryBlock) => {
      assert.equal(modelPrompt, "model prompt");
      assert.equal(memoryBlock, "[memory block]");
      return `${modelPrompt}\n${memoryBlock}`;
    };

    const injected = promptRuntime.maybeInjectLongTermMemoryForPromptWithDeps(
      "user prompt",
      "model prompt",
      ["  selected symbol ", "selected symbol"],
      {
        runtimeSettings: {} as never,
        memoryPaths,
        locale: "en" as never,
        getActiveEditorPromptContext: () => ({
          fileLabel: "src/feature.ts",
          hasSelection: true,
          selectionLabel: "4-9",
        }),
        onError: () => undefined,
      }
    );
    assert.equal(injected, "model prompt\n[memory block]");
    assert.deepEqual(recallArgs, [memoryPaths, {
      prompt: "user prompt",
      focusHints: ["selected symbol", "src/feature.ts", "4-9"],
    }]);

    const expectedError = new Error("recall failed");
    const reportedErrors: unknown[][] = [];
    memoryRecall.buildWorkspaceMemoryRecallPack = () => {
      throw expectedError;
    };
    assert.equal(
      promptRuntime.maybeInjectLongTermMemoryForPromptWithDeps("user", "unchanged", [], {
        runtimeSettings: {} as never,
        memoryPaths,
        locale: "en" as never,
        getActiveEditorPromptContext: () => null,
        onError: (...args: unknown[]) => reportedErrors.push(args),
      }),
      "unchanged"
    );
    assert.deepEqual(reportedErrors, [[expectedError, memoryPaths]]);
  });
});
