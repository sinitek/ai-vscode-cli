import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as logger from "../../logger";

import {
  createLoopSubtaskExecutionRoot,
  isLoopSubtaskLinkFailedError,
  LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME,
} from "../../loopSubtaskExecutionRoot";

function createFixture(context: test.TestContext) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-safe-source-"));
  const executionRoots: ReturnType<typeof createLoopSubtaskExecutionRoot>[] = [];
  const failures: unknown[] = [];
  context.mock.method(logger, "logError", async (_event: string, data?: unknown) => {
    failures.push(data);
  });
  context.mock.method(logger, "logInfo", async () => undefined);
  fs.mkdirSync(path.join(workspaceRoot, "src"));
  fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "source", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), "original", "utf8");
  context.after(() => {
    context.mock.restoreAll();
    for (const executionRoot of executionRoots) {
      executionRoot.dispose();
      fs.rmSync(executionRoot.cwd, { recursive: true, force: true });
    }
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  return {
    workspaceRoot,
    failures,
    createRoot: () => {
      const executionRoot = createLoopSubtaskExecutionRoot(workspaceRoot);
      executionRoots.push(executionRoot);
      return executionRoot;
    },
  };
}

function removeDirectoryLink(targetPath: string): void {
  if (process.platform === "win32") {
    fs.rmdirSync(targetPath);
  } else {
    fs.unlinkSync(targetPath);
  }
}

function withWindowsLinks(context: test.TestContext, action: (junctionRemovals: string[]) => void): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platformDescriptor);
  const originalPlatform = process.platform;
  const originalSymlink = fs.symlinkSync;
  const originalRmdir = fs.rmdirSync;
  const junctions = new Set<string>();
  const junctionRemovals: string[] = [];
  const symlinkMock = context.mock.method(fs, "symlinkSync", (sourcePath: fs.PathLike, targetPath: fs.PathLike, type?: fs.symlink.Type) => {
    if (type === "junction") {
      junctions.add(String(targetPath));
    }
    originalSymlink(sourcePath, targetPath, originalPlatform !== "win32" && type === "junction" ? "dir" : type);
  });
  const rmdirMock = context.mock.method(fs, "rmdirSync", (targetPath: fs.PathLike, options?: fs.RmDirOptions) => {
    assert.ok(!options?.recursive);
    if (junctions.has(String(targetPath))) {
      junctionRemovals.push(String(targetPath));
      if (originalPlatform !== "win32") {
        fs.unlinkSync(targetPath);
        return;
      }
    }
    originalRmdir(targetPath, options);
  });
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
  try {
    action(junctionRemovals);
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
    symlinkMock.mock.restore();
    rmdirMock.mock.restore();
  }
}

test("creates a writable Loop subtask execution root without repository rules or skills", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-subtask-source-"));
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "project rules", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "CLAUDE.md"), "claude rules", "utf8");
  fs.mkdirSync(path.join(workspaceRoot, ".agents", "skills"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".agents", "skills", "SKILL.md"), "skill", "utf8");
  fs.mkdirSync(path.join(workspaceRoot, "src"));
  fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "before", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), "{\"name\":\"demo\"}", "utf8");
  fs.mkdirSync(path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "secret.txt"),
    "hidden-temp",
    "utf8",
  );

  const executionRoot = createLoopSubtaskExecutionRoot(workspaceRoot);
  try {
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, ".agents")), false);
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME)), false);

    const linkedSource = path.join(executionRoot.cwd, "src", "app.ts");
    assert.equal(fs.readFileSync(linkedSource, "utf8"), "before");
    fs.writeFileSync(linkedSource, "after", "utf8");
    assert.equal(fs.readFileSync(path.join(workspaceRoot, "src", "app.ts"), "utf8"), "after");

    const linkedPackage = path.join(executionRoot.cwd, "package.json");
    assert.equal(fs.readFileSync(linkedPackage, "utf8"), "{\"name\":\"demo\"}");
    fs.writeFileSync(linkedPackage, "{\"name\":\"updated\"}", "utf8");
    assert.equal(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8"), "{\"name\":\"updated\"}");
    if (process.platform === "win32") {
      const stats = fs.lstatSync(linkedPackage);
      if (!stats.isSymbolicLink()) {
        assert.ok(stats.nlink >= 2);
      }
    }
  } finally {
    executionRoot.dispose();
  }

  assert.equal(fs.existsSync(executionRoot.cwd), false);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "src", "app.ts"), "utf8"), "after");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf8"), "{\"name\":\"updated\"}");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8"), "project rules");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, ".agents", "skills", "SKILL.md"), "utf8"), "skill");
  assert.equal(
    fs.readFileSync(path.join(workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "secret.txt"), "utf8"),
    "hidden-temp",
  );
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("dispose preserves entries not created by the execution root", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-subtask-unexpected-"));
  fs.mkdirSync(path.join(workspaceRoot, "src"));
  fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "source", "utf8");
  const executionRoot = createLoopSubtaskExecutionRoot(workspaceRoot);
  const unexpectedPath = path.join(executionRoot.cwd, "unexpected.txt");
  fs.writeFileSync(unexpectedPath, "keep", "utf8");
  const unexpectedDirectory = path.join(executionRoot.cwd, "unexpected-directory");
  fs.mkdirSync(unexpectedDirectory);
  fs.writeFileSync(path.join(unexpectedDirectory, "keep.txt"), "keep directory", "utf8");

  executionRoot.dispose();

  assert.equal(fs.readFileSync(unexpectedPath, "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(unexpectedDirectory, "keep.txt"), "utf8"), "keep directory");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "src", "app.ts"), "utf8"), "source");
  fs.rmSync(unexpectedPath, { force: true });
  fs.unlinkSync(path.join(unexpectedDirectory, "keep.txt"));
  fs.rmdirSync(unexpectedDirectory);
  executionRoot.dispose();
  assert.equal(fs.existsSync(executionRoot.cwd), false);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("dispose never invokes recursive removal", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const removalMock = context.mock.method(fs, "rmSync", () => {
    throw new Error("Recursive cleanup must not be used");
  });

  executionRoot.dispose();

  assert.equal(removalMock.mock.callCount(), 0);
  assert.equal(fs.existsSync(executionRoot.cwd), false);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fixture.failures.length, 0);
});

test("persistent execution roots keep their identity while refreshing workspace links", (context) => {
  const fixture = createFixture(context);
  fs.writeFileSync(path.join(fixture.workspaceRoot, "AGENTS.md"), "hidden");
  const persistentCwd = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "dsh-stable");
  const firstOuter = fixture.createRoot();
  const first = createLoopSubtaskExecutionRoot(firstOuter.cwd, { persistentCwd });
  const identity = fs.lstatSync(first.cwd, { bigint: true });
  assert.equal(fs.existsSync(path.join(first.cwd, "AGENTS.md")), false);
  fs.writeFileSync(path.join(first.cwd, "src", "app.ts"), "draft");
  first.dispose();
  firstOuter.dispose();
  assert.deepEqual(fs.readdirSync(persistentCwd), []);
  assert.equal(fs.existsSync(firstOuter.cwd), false);

  fs.mkdirSync(path.join(fixture.workspaceRoot, "added"));
  const secondOuter = fixture.createRoot();
  const second = createLoopSubtaskExecutionRoot(secondOuter.cwd, { persistentCwd });
  assert.notEqual(firstOuter.cwd, secondOuter.cwd);
  assert.equal(fs.lstatSync(second.cwd, { bigint: true }).ino, identity.ino);
  assert.equal(fs.lstatSync(second.cwd, { bigint: true }).birthtimeNs, identity.birthtimeNs);
  assert.equal(fs.readFileSync(path.join(second.cwd, "src", "app.ts"), "utf8"), "draft");
  assert.equal(fs.statSync(path.join(second.cwd, "added")).isDirectory(), true);
  assert.equal(fs.existsSync(path.join(second.cwd, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME)), false);
  fs.writeFileSync(path.join(second.cwd, "src", "app.ts"), "repaired");
  second.dispose();
  second.dispose();
  secondOuter.dispose();
  assert.deepEqual(fs.readdirSync(persistentCwd), []);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "repaired");
  assert.equal(fixture.failures.length, 0);
});

test("persistent execution roots preserve unknown files and refuse to overwrite them on resume", (context) => {
  const fixture = createFixture(context);
  const persistentCwd = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "dsh-unknown");
  const executionRoot = createLoopSubtaskExecutionRoot(fixture.workspaceRoot, { persistentCwd });
  const unknown = path.join(executionRoot.cwd, "new-file.txt");
  fs.writeFileSync(unknown, "keep");
  executionRoot.dispose();
  assert.deepEqual(fs.readdirSync(persistentCwd), ["new-file.txt"]);
  assert.throws(() => createLoopSubtaskExecutionRoot(fixture.workspaceRoot, { persistentCwd }), /已保留现场/);
  assert.equal(fs.readFileSync(unknown, "utf8"), "keep");
  assert.equal(fixture.failures.length, 1);
});

test("persistent execution roots reject symlink directories without touching their targets", (context) => {
  const fixture = createFixture(context);
  const parent = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME);
  fs.mkdirSync(parent);
  const persistentCwd = path.join(parent, "replaced");
  fs.symlinkSync(fixture.workspaceRoot, persistentCwd, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => createLoopSubtaskExecutionRoot(fixture.workspaceRoot, { persistentCwd }), /真实目录/);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  removeDirectoryLink(persistentCwd);
});

test("failed persistent root setup removes only its own links and keeps an empty cwd", (context) => {
  const fixture = createFixture(context);
  const persistentCwd = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "dsh-failed");
  const originalSymlink = fs.symlinkSync;
  context.mock.method(fs, "symlinkSync", (sourcePath: fs.PathLike, targetPath: fs.PathLike, type?: fs.symlink.Type) => {
    if (path.basename(String(targetPath)) === "src") {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }
    originalSymlink(sourcePath, targetPath, type);
  });
  assert.throws(() => createLoopSubtaskExecutionRoot(fixture.workspaceRoot, { persistentCwd }), /Failed to link/);
  assert.deepEqual(fs.readdirSync(persistentCwd), []);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
});

test("Windows persistent execution roots refresh nested junctions and hardlinks safely", (context) => {
  const fixture = createFixture(context);
  const persistentCwd = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME, "dsh-windows");
  withWindowsLinks(context, (junctionRemovals) => {
    for (const value of ["draft", "repaired"]) {
      const outer = fixture.createRoot();
      const inner = createLoopSubtaskExecutionRoot(outer.cwd, { persistentCwd });
      fs.writeFileSync(path.join(inner.cwd, "src", "app.ts"), value);
      fs.writeFileSync(path.join(inner.cwd, "package.json"), value);
      inner.dispose();
      assert.deepEqual(fs.readdirSync(persistentCwd), []);
      outer.dispose();
      assert.equal(fs.existsSync(outer.cwd), false);
      assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), value);
      assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), value);
    }
    assert.equal(junctionRemovals.filter((target) => target === path.join(persistentCwd, "src")).length, 2);
  });
  assert.equal(fixture.failures.length, 0);
});

test("dispose is repeatable and tolerates an already removed execution root", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  executionRoot.dispose();
  assert.equal(fs.existsSync(executionRoot.cwd), false);
  assert.doesNotThrow(() => executionRoot.dispose());
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
  assert.equal(fixture.failures.length, 0);
});

test("dispose preserves a directory that replaced a registered link", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const linkedSource = path.join(executionRoot.cwd, "src");
  removeDirectoryLink(linkedSource);
  fs.mkdirSync(linkedSource);
  fs.writeFileSync(path.join(linkedSource, "keep.txt"), "keep", "utf8");

  executionRoot.dispose();

  assert.equal(fs.readFileSync(path.join(linkedSource, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fixture.failures.length, 1);
});

test("dispose preserves a file that replaced a registered link", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const linkedFile = path.join(executionRoot.cwd, "package.json");
  fs.unlinkSync(linkedFile);
  fs.writeFileSync(linkedFile, "new content", "utf8");

  executionRoot.dispose();

  assert.equal(fs.readFileSync(linkedFile, "utf8"), "new content");
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
  assert.equal(fixture.failures.length, 1);
});

test("dispose does not traverse a replacement link even when it points to the same source", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const linkedSource = path.join(executionRoot.cwd, "src");
  const savedLink = path.join(executionRoot.cwd, "saved-link");
  fs.renameSync(linkedSource, savedLink);
  fs.symlinkSync(
    path.join(fixture.workspaceRoot, "src"),
    linkedSource,
    process.platform === "win32" ? "junction" : "dir",
  );

  executionRoot.dispose();

  assert.equal(fs.lstatSync(linkedSource).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fixture.failures.length, 1);
});

test("dispose refuses an execution root replaced by a directory link", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const savedRoot = path.join(fixture.workspaceRoot, "saved-execution-root");
  fs.renameSync(executionRoot.cwd, savedRoot);
  fs.symlinkSync(fixture.workspaceRoot, executionRoot.cwd, process.platform === "win32" ? "junction" : "dir");

  executionRoot.dispose();

  assert.equal(fs.lstatSync(executionRoot.cwd).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
  assert.equal(fixture.failures.length, 1);
  removeDirectoryLink(executionRoot.cwd);
  fs.renameSync(savedRoot, executionRoot.cwd);
});

test("dispose refuses an execution root replaced by another real directory", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const savedRoot = path.join(fixture.workspaceRoot, "saved-execution-root");
  fs.renameSync(executionRoot.cwd, savedRoot);
  fs.mkdirSync(executionRoot.cwd);
  fs.writeFileSync(path.join(executionRoot.cwd, "keep.txt"), "keep", "utf8");

  executionRoot.dispose();

  assert.equal(fs.readFileSync(path.join(executionRoot.cwd, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fixture.failures.length, 1);
  fs.unlinkSync(path.join(executionRoot.cwd, "keep.txt"));
  fs.rmdirSync(executionRoot.cwd);
  fs.renameSync(savedRoot, executionRoot.cwd);
});

test("disposing one execution root leaves concurrent roots and the source intact", (context) => {
  const fixture = createFixture(context);
  const firstRoot = fixture.createRoot();
  const secondRoot = fixture.createRoot();
  fs.writeFileSync(path.join(firstRoot.cwd, "src", "app.ts"), "shared change", "utf8");

  firstRoot.dispose();

  assert.equal(fs.readFileSync(path.join(secondRoot.cwd, "src", "app.ts"), "utf8"), "shared change");
  secondRoot.dispose();
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "shared change");
  assert.equal(fs.existsSync(firstRoot.cwd), false);
  assert.equal(fs.existsSync(secondRoot.cwd), false);
});

test("dispose logs an occupied root and can safely retry later", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const originalRmdir = fs.rmdirSync;
  const removalMock = context.mock.method(fs, "rmdirSync", (targetPath: fs.PathLike) => {
    if (String(targetPath) === executionRoot.cwd) {
      throw Object.assign(new Error("occupied"), { code: "EBUSY" });
    }
    originalRmdir(targetPath);
  });

  assert.doesNotThrow(() => executionRoot.dispose());
  assert.equal(fs.existsSync(executionRoot.cwd), true);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fixture.failures.length, 1);
  removalMock.mock.restore();
  executionRoot.dispose();
  assert.equal(fs.existsSync(executionRoot.cwd), false);
});

test("dispose logs unlink failures and retries without losing the source", (context) => {
  const fixture = createFixture(context);
  const executionRoot = fixture.createRoot();
  const linkedFile = path.join(executionRoot.cwd, "package.json");
  const originalUnlink = fs.unlinkSync;
  const removalMock = context.mock.method(fs, "unlinkSync", (targetPath: fs.PathLike) => {
    if (String(targetPath) === linkedFile) {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }
    originalUnlink(targetPath);
  });

  assert.doesNotThrow(() => executionRoot.dispose());
  assert.equal(fs.readFileSync(linkedFile, "utf8"), "original");
  assert.equal(fixture.failures.length, 1);
  removalMock.mock.restore();
  executionRoot.dispose();
  assert.equal(fs.existsSync(executionRoot.cwd), false);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
});

test("partial link creation failure safely releases already created links", (context) => {
  const fixture = createFixture(context);
  fs.mkdirSync(path.join(fixture.workspaceRoot, "z-failure"));
  const originalSymlink = fs.symlinkSync;
  let executionCwd: string | undefined;
  context.mock.method(fs, "symlinkSync", (sourcePath: fs.PathLike, targetPath: fs.PathLike, type?: fs.symlink.Type) => {
    executionCwd = path.dirname(String(targetPath));
    if (path.basename(String(targetPath)) === "z-failure") {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }
    originalSymlink(sourcePath, targetPath, type);
  });

  assert.throws(() => fixture.createRoot(), isLoopSubtaskLinkFailedError);

  assert.ok(executionCwd);
  assert.equal(fs.existsSync(executionCwd), false);
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
});

test("Windows cleanup removes junctions non-recursively and preserves hardlink source contents", (context) => {
  const fixture = createFixture(context);
  withWindowsLinks(context, (junctionRemovals) => {
    const executionRoot = fixture.createRoot();
    const linkedFile = path.join(executionRoot.cwd, "package.json");
    assert.equal(fs.lstatSync(linkedFile).isSymbolicLink(), false);
    assert.ok(fs.lstatSync(linkedFile).nlink >= 2);
    fs.writeFileSync(linkedFile, "updated", "utf8");

    executionRoot.dispose();

    assert.deepEqual(junctionRemovals, [path.join(executionRoot.cwd, "src")]);
    assert.equal(fs.existsSync(executionRoot.cwd), false);
    assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
    assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "updated");
    assert.equal(fixture.failures.length, 0);
  });
});

test("Windows cleanup retains a hardlink when its source was replaced", (context) => {
  const fixture = createFixture(context);
  withWindowsLinks(context, () => {
    const executionRoot = fixture.createRoot();
    const sourceFile = path.join(fixture.workspaceRoot, "package.json");
    const linkedFile = path.join(executionRoot.cwd, "package.json");
    fs.unlinkSync(sourceFile);
    fs.writeFileSync(sourceFile, "new source", "utf8");

    executionRoot.dispose();

    assert.equal(fs.readFileSync(linkedFile, "utf8"), "original");
    assert.equal(fs.readFileSync(sourceFile, "utf8"), "new source");
    assert.equal(fixture.failures.length, 1);
  });
});

test("Windows cleanup retains a replaced hardlink entry", (context) => {
  const fixture = createFixture(context);
  withWindowsLinks(context, () => {
    const executionRoot = fixture.createRoot();
    const linkedFile = path.join(executionRoot.cwd, "package.json");
    fs.unlinkSync(linkedFile);
    fs.writeFileSync(linkedFile, "replacement", "utf8");

    executionRoot.dispose();

    assert.equal(fs.readFileSync(linkedFile, "utf8"), "replacement");
    assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
    assert.equal(fixture.failures.length, 1);
  });
});

test("Windows file-link fallback is removed without touching its target", { skip: process.platform === "win32" }, (context) => {
  const fixture = createFixture(context);
  withWindowsLinks(context, () => {
    const hardlinkMock = context.mock.method(fs, "linkSync", () => {
      throw Object.assign(new Error("cross device"), { code: "EXDEV" });
    });
    try {
      const executionRoot = fixture.createRoot();
      assert.equal(fs.lstatSync(path.join(executionRoot.cwd, "package.json")).isSymbolicLink(), true);

      executionRoot.dispose();

      assert.equal(fs.existsSync(executionRoot.cwd), false);
      assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "package.json"), "utf8"), "original");
    } finally {
      hardlinkMock.mock.restore();
    }
  });
});

test("same-volume fallback keeps the shared temporary parent until all roots finish", (context) => {
  const fixture = createFixture(context);
  const originalParse = path.parse;
  const parseMock = context.mock.method(path, "parse", (targetPath: string) => ({
    ...originalParse(targetPath),
    root: targetPath.startsWith(fixture.workspaceRoot) ? "workspace-volume" : "system-volume",
  }));
  withWindowsLinks(context, () => {
    const firstRoot = fixture.createRoot();
    const secondRoot = fixture.createRoot();
    const localTempRoot = path.join(fixture.workspaceRoot, LOOP_SUBTASK_SAME_VOLUME_TEMP_DIR_NAME);
    assert.equal(path.dirname(firstRoot.cwd), localTempRoot);

    firstRoot.dispose();

    assert.equal(fs.existsSync(localTempRoot), true);
    assert.equal(fs.readFileSync(path.join(secondRoot.cwd, "src", "app.ts"), "utf8"), "source");
    secondRoot.dispose();
    assert.equal(fs.existsSync(localTempRoot), false);
    assert.equal(fs.readFileSync(path.join(fixture.workspaceRoot, "src", "app.ts"), "utf8"), "source");
  });
  parseMock.mock.restore();
});
