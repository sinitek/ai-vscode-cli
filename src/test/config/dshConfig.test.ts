import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createDshExampleProfileText } from "../../cli/dshConfigModels";
import {
  activateDshProfile,
  readDshActivation,
  readDshActiveProfileText,
  resolveDshConfigPaths,
} from "../../config/dshConfig";
import { resolveDshHomeDir } from "../../shared/userHomePaths";

async function tempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dsh-config-"));
}

test("resolves DSH homes with the same cross-platform rules as Grok", () => {
  const home = path.join(path.sep, "Users", "tester");
  assert.equal(resolveDshHomeDir({}, home, "darwin"), path.join(home, ".dsh"));
  assert.equal(resolveDshHomeDir({}, home, "linux"), path.join(home, ".dsh"));
  assert.equal(
    resolveDshHomeDir({ DSH_HOME: "~/.dsh-custom" }, home, "darwin"),
    path.join(home, ".dsh-custom"),
  );
  const windowsHome = resolveDshHomeDir(
    { DSH_HOME: "%USERPROFILE%\\dsh-home", USERPROFILE: "/Users/tester" },
    home,
    "win32",
  );
  assert.equal(windowsHome.includes("%USERPROFILE%"), false);
  assert.equal(windowsHome.includes("dsh-home"), true);
  const paths = resolveDshConfigPaths({ DSH_HOME: path.join(home, "isolated") }, home, "linux");
  assert.equal(paths.configDir, path.join(home, "isolated", "__config"));
  assert.equal(paths.patchPath, path.join(paths.configDir, "active-patch.yaml"));
});

test("activation records success only after the patch write and leaves failure inactive", async () => {
  const home = await tempHome();
  const paths = resolveDshConfigPaths({ DSH_HOME: home }, home, "linux");
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, "settings.yaml"), "untouched: true\n", "utf8");
  await fs.writeFile(path.join(home, ".credentials.yaml"), "key: redacted\n", "utf8");
  const beforeSettings = await fs.readFile(path.join(home, "settings.yaml"), "utf8");
  const beforeCredentials = await fs.readFile(path.join(home, ".credentials.yaml"), "utf8");

  const failed = await activateDshProfile({
    profileId: "profile-a",
    content: "{\"provider\":\"subcoco\"}",
    paths,
    now: 10,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.activated, false);
  assert.equal((await readDshActivation(paths)).activeProfileId, null);
  assert.equal(await readDshActiveProfileText(paths), "");

  const example = createDshExampleProfileText();
  const activated = await activateDshProfile({
    profileId: "profile-a",
    content: example,
    paths,
    now: 20,
  });
  assert.equal(activated.ok, true);
  if (!activated.ok) {
    return;
  }
  assert.equal(activated.activated, true);
  assert.equal(activated.profileId, "profile-a");
  const status = await readDshActivation(paths);
  assert.equal(status.activeProfileId, "profile-a");
  assert.equal(status.patchPath, paths.patchPath);
  const applied = await readDshActiveProfileText(paths);
  assert.match(applied, /subcoco\/deepseek-v4\.1-flash/);
  assert.equal(applied.includes("sk-"), false);
  const patch = await fs.readFile(paths.patchPath, "utf8");
  assert.match(patch, /api: openai-completions/);
  assert.equal(patch.includes("modelOverrides"), false);
  assert.equal(await fs.readFile(path.join(home, "settings.yaml"), "utf8"), beforeSettings);
  assert.equal(await fs.readFile(path.join(home, ".credentials.yaml"), "utf8"), beforeCredentials);

  const otherHome = await tempHome();
  const otherPaths = resolveDshConfigPaths({ DSH_HOME: otherHome }, otherHome, "linux");
  const other = await activateDshProfile({
    profileId: "profile-b",
    content: example,
    paths: otherPaths,
    now: 30,
  });
  assert.equal(other.ok, true);
  assert.equal((await readDshActivation(paths)).activeProfileId, "profile-a");
  assert.equal((await readDshActivation(otherPaths)).activeProfileId, "profile-b");
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(otherHome, { recursive: true, force: true });
});

test("direct apiKey stays in private profile storage and is omitted from runtime patch", async () => {
  const home = await tempHome();
  const paths = resolveDshConfigPaths({ DSH_HOME: home }, home, "linux");
  const apiKey = "sk-direct-config-key-12345";
  const profile = JSON.parse(createDshExampleProfileText()) as Record<string, unknown>;
  profile.apiKey = apiKey;

  const activated = await activateDshProfile({
    profileId: "direct-key",
    content: JSON.stringify(profile),
    paths,
  });
  assert.equal(activated.ok, true);
  const applied = JSON.parse(await readDshActiveProfileText(paths)) as { apiKey?: string };
  assert.equal(applied.apiKey, apiKey);
  const patch = await fs.readFile(paths.patchPath, "utf8");
  assert.equal(patch.includes(apiKey), false);
  assert.match(patch, /apiKeyEnv: SINITEK_DSH_API_KEY/);

  if (process.platform !== "win32") {
    const directoryMode = (await fs.stat(paths.configDir)).mode & 0o777;
    const profileMode = (await fs.stat(paths.appliedProfilePath)).mode & 0o777;
    const patchMode = (await fs.stat(paths.patchPath)).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    assert.equal(profileMode, 0o600);
    assert.equal(patchMode, 0o600);
  }
  await fs.rm(home, { recursive: true, force: true });
});
