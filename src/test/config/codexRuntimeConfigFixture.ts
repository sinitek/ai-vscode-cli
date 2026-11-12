import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ensureCodexProjectTrusted } from "../../interactive/codexRuntimeConfig";

export async function withCodexIdentityFixture(run: (fixture: {
  root: string;
  home: string;
  a: string;
  b: string;
  configPath: string;
  authPath: string;
  writeConfig: (content: string) => Promise<void>;
  trust: (projectRoot: string) => ReturnType<typeof ensureCodexProjectTrusted>;
  fingerprint: typeof import("../../config/configService").readRuntimeConfigFingerprint;
}) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-codex-identity-"));
  const home = path.join(root, "home", ".codex");
  const a = path.join(root, "A");
  const b = path.join(root, "A-neighbor");
  const previous = ["HOME", "USERPROFILE", "CODEX_HOME", "CODEX_HOME_DIR"].map((key) => [key, process.env[key]] as const);
  try {
    process.env.HOME = path.dirname(home);
    process.env.USERPROFILE = path.dirname(home);
    process.env.CODEX_HOME = home;
    process.env.CODEX_HOME_DIR = home;
    await Promise.all([home, a, b].map((dir) => fs.mkdir(dir, { recursive: true })));
    const configPath = path.join(home, "config.toml");
    const authPath = path.join(home, "auth.json");
    const { readRuntimeConfigFingerprint } = require("../../config/configService") as typeof import("../../config/configService");
    await run({ root, home, a, b, configPath, authPath,
      writeConfig: (content) => fs.writeFile(configPath, content),
      trust: (projectRoot) => ensureCodexProjectTrusted({ projectRoot, codexHomeDir: home }),
      fingerprint: readRuntimeConfigFingerprint,
    });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
