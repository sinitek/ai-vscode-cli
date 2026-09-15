import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { writeFileAtomically } from "../../shared/atomicWrite";

test("atomically overwrites an existing file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-write-"));
  const targetPath = path.join(tempDir, "config.toml");
  try {
    await writeFileAtomically(targetPath, "first\n");
    await writeFileAtomically(targetPath, "second\n");
    assert.equal(await fs.readFile(targetPath, "utf8"), "second\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
