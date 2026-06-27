import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

import {
  buildOfficialSkillMetadata,
  buildResolvedOfficialSkillCatalogItem,
  computeOfficialSkillContentHash,
  readOfficialSkillMetadata,
  resolveOfficialSkillInstallState,
  writeOfficialSkillMetadata,
  type OfficialSkillMetadataV1,
} from "../config/officialSkillVersioning";
import { OfficialSkillCatalogItem } from "../config/types";

function createCatalogItem(overrides: Partial<OfficialSkillCatalogItem> = {}): OfficialSkillCatalogItem {
  return {
    id: "codex-openai-docs",
    platform: "codex",
    group: "docs",
    name: "openai-docs",
    description: "Official docs helper",
    archivePath: "official-skills/codex/openai-docs.zip",
    installFolderName: "openai-docs",
    sourceRepo: "openai/codex",
    sourceRef: "commit:repo-ref-1",
    sourcePath: "skills/openai-docs",
    sourceUrl: "https://example.com/openai-docs",
    ...overrides,
  };
}

async function withTempDir(run: (tempRoot: string) => Promise<void>): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-official-skill-versioning-"));
  try {
    await run(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function createInstalledSkillDir(
  tempRoot: string,
  files: Record<string, string>,
): Promise<string> {
  const skillDir = path.join(tempRoot, "installed-skill");
  await fs.mkdir(skillDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(skillDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return skillDir;
}

test("writes schema version 2 metadata with version fields", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
    });
    const item = createCatalogItem({
      version: "a1b2c3d4",
      versionSource: "content-hash-short",
      contentHash: "catalog-hash-1",
      sourceCommit: "abcdef1234567890",
    });

    await writeOfficialSkillMetadata(skillDir, item);
    const metadata = await readOfficialSkillMetadata(skillDir);

    assert.deepEqual(metadata, {
      ...buildOfficialSkillMetadata(item),
      installedAt: metadata?.installedAt,
    });
    assert.equal(metadata?.schemaVersion, 2);
  });
});

test("prefers content hash to determine installed and update available state", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
      "nested/guide.md": "latest docs\n",
    });
    const contentHash = await computeOfficialSkillContentHash(skillDir);
    assert.ok(contentHash);

    const installedItem = createCatalogItem({
      version: "a1b2c3d4",
      versionSource: "content-hash-short",
      contentHash,
      sourceCommit: "abcdef1234567890",
      sourceRef: "commit:repo-ref-new",
    });
    await writeOfficialSkillMetadata(skillDir, installedItem);
    const metadata = await readOfficialSkillMetadata(skillDir);
    const installedState = resolveOfficialSkillInstallState({
      item: createCatalogItem({
        contentHash,
        sourceRef: "commit:repo-ref-old",
      }),
      targetDir: skillDir,
      metadata,
      computedInstalledContentHash: contentHash,
    });

    assert.equal(installedState.installState, "installed");
    assert.equal(installedState.installedContentHash, contentHash);
    assert.equal(installedState.installedVersion, "a1b2c3d4");
    assert.equal(installedState.installedVersionSource, "content-hash-short");
    assert.equal(installedState.installedSourceCommit, "abcdef1234567890");

    const updateState = resolveOfficialSkillInstallState({
      item: createCatalogItem({
        contentHash: "catalog-hash-2",
        sourceRef: "commit:repo-ref-old",
      }),
      targetDir: skillDir,
      metadata,
      computedInstalledContentHash: contentHash,
    });

    assert.equal(updateState.installState, "update_available");
  });
});

test("computes content hash with the catalog contract", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
      "nested/guide.md": "latest docs\n",
    });

    const contentHash = await computeOfficialSkillContentHash(skillDir);
    assert.ok(contentHash);
    assert.match(contentHash, /^sha256:[0-9a-f]{64}$/);

    const expectedHasher = createHash("sha256");
    expectedHasher.update("D\tnested\n");
    expectedHasher.update(`F\tSKILL.md\t${Buffer.byteLength("# openai-docs\n")}\t${createHash("sha256").update("# openai-docs\n").digest("hex")}\n`);
    expectedHasher.update(`F\tnested/guide.md\t${Buffer.byteLength("latest docs\n")}\t${createHash("sha256").update("latest docs\n").digest("hex")}\n`);

    assert.equal(contentHash, `sha256:${expectedHasher.digest("hex")}`);
  });
});

test("keeps metadata file out of the content hash", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
      "nested/guide.md": "latest docs\n",
    });

    const before = await computeOfficialSkillContentHash(skillDir);
    assert.ok(before);

    await fs.writeFile(
      path.join(skillDir, ".sinitek-official-skill.json"),
      JSON.stringify({ schemaVersion: 2, installedAt: "ignored" }, null, 2),
      "utf-8",
    );
    const after = await computeOfficialSkillContentHash(skillDir);

    assert.equal(after, before);
  });
});

test("recognizes schema version 1 metadata via computed content hash", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
      "nested/guide.md": "latest docs\n",
    });
    const contentHash = await computeOfficialSkillContentHash(skillDir);
    assert.ok(contentHash);

    const metadataV1: OfficialSkillMetadataV1 = {
      schemaVersion: 1,
      platform: "codex",
      skillId: "codex-openai-docs",
      name: "openai-docs",
      sourceRepo: "openai/codex",
      sourceRef: "commit:repo-ref-old",
      sourcePath: "skills/openai-docs",
      archivePath: "official-skills/codex/openai-docs.zip",
      installedAt: "2026-06-27T00:00:00.000Z",
    };
    await fs.writeFile(path.join(skillDir, ".sinitek-official-skill.json"), `${JSON.stringify(metadataV1, null, 2)}\n`, "utf-8");

    const metadata = await readOfficialSkillMetadata(skillDir);
    const resolved = resolveOfficialSkillInstallState({
      item: createCatalogItem({
        contentHash,
        sourceRef: "commit:repo-ref-new",
      }),
      targetDir: skillDir,
      metadata,
      computedInstalledContentHash: contentHash,
    });

    assert.equal(resolved.installState, "installed");
    assert.equal(resolved.installedContentHash, contentHash);
    assert.equal(resolved.installedVersion, undefined);
  });
});

test("normalizes legacy metadata content hash before comparing", async () => {
  await withTempDir(async (tempRoot) => {
    const skillDir = await createInstalledSkillDir(tempRoot, {
      "SKILL.md": "# openai-docs\n",
    });
    const computedContentHash = await computeOfficialSkillContentHash(skillDir);
    assert.ok(computedContentHash);

    const metadata = buildOfficialSkillMetadata(createCatalogItem({
      contentHash: computedContentHash.replace(/^sha256:/, ""),
      sourceRef: "commit:repo-ref-old",
    }));

    const resolved = resolveOfficialSkillInstallState({
      item: createCatalogItem({
        contentHash: computedContentHash,
        sourceRef: "commit:repo-ref-new",
      }),
      targetDir: skillDir,
      metadata,
      computedInstalledContentHash: computedContentHash,
    });

    assert.equal(resolved.installState, "installed");
    assert.equal(resolved.installedContentHash, computedContentHash);
  });
});

test("falls back to sourceRef when catalog lacks content hash", async () => {
  const targetDir = "/tmp/official-skill";
  const metadata = buildOfficialSkillMetadata(createCatalogItem({
    version: "a1b2c3d4",
    versionSource: "content-hash-short",
    contentHash: "installed-hash",
    sourceRef: "commit:repo-ref-1",
  }));

  const installed = resolveOfficialSkillInstallState({
    item: createCatalogItem({
      sourceRef: "commit:repo-ref-1",
      contentHash: undefined,
    }),
    targetDir,
    metadata,
  });
  assert.equal(installed.installState, "installed");

  const updateAvailable = resolveOfficialSkillInstallState({
    item: createCatalogItem({
      sourceRef: "commit:repo-ref-2",
      contentHash: undefined,
    }),
    targetDir,
    metadata,
  });
  assert.equal(updateAvailable.installState, "update_available");
});

test("preserves unknown_source for directories without matching official metadata", async () => {
  const targetDir = "/tmp/custom-skill";
  const resolved = resolveOfficialSkillInstallState({
    item: createCatalogItem(),
    targetDir,
    metadata: {
      schemaVersion: 2,
      platform: "codex",
      skillId: "custom-openai-docs",
      name: "custom-openai-docs",
      sourceRepo: "someone-else/custom",
      sourceRef: "commit:custom-ref",
      sourcePath: "skills/custom-openai-docs",
      archivePath: "custom.zip",
      installedAt: "2026-06-27T00:00:00.000Z",
      contentHash: "custom-hash",
    },
    computedInstalledContentHash: "custom-hash",
  });

  assert.equal(resolved.installState, "unknown_source");

  const runtimeItem = buildResolvedOfficialSkillCatalogItem(createCatalogItem(), resolved);
  assert.equal(runtimeItem.installState, "unknown_source");
  assert.equal(runtimeItem.canUpdate, true);
  assert.equal(runtimeItem.canUninstall, true);
});
