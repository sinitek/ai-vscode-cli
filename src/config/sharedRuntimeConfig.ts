import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { writeFileAtomically } from "../shared/atomicWrite";

export type SharedConfigSelection = { configId: string | null; revision: string; profileDigest: string | null; ready: boolean };
type SharedState = SharedConfigSelection & { version: 1 };

export function runtimeCoordinationDirectory(targetFile: string): string {
  return path.join(path.dirname(targetFile), ".sinitek-runtime-coordination", path.basename(targetFile));
}

export class SharedRuntimeConfig {
  private readonly statePath: string;

  constructor(private readonly directory: string) {
    this.statePath = path.join(directory, "selection.json");
  }

  private async readState(): Promise<SharedState | null> {
    try {
      const state = JSON.parse(await fs.readFile(this.statePath, "utf8")) as SharedState;
      if (state.version !== 1 || typeof state.revision !== "string" || !state.revision
        || (state.configId !== null && typeof state.configId !== "string")
        || (state.profileDigest !== null && typeof state.profileDigest !== "string")
        || typeof state.ready !== "boolean") {
        throw new Error("共享配置状态已损坏，请刷新配置面板后重试。");
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writeState(state: SharedState): Promise<void> {
    await writeFileAtomically(this.statePath, JSON.stringify(state), { mode: 0o600 });
  }

  async read(initialize?: () => Promise<{ configId: string | null; profileDigest: string | null }>): Promise<SharedConfigSelection | null> {
    let state = await this.readState();
    if (!state && initialize) {
      state = { version: 1, ...await initialize(), revision: randomUUID(), ready: true };
      await this.writeState(state);
    }
    if (!state) return null;
    const { configId, revision, profileDigest, ready } = state;
    return { configId, revision, profileDigest, ready };
  }

  async change(
    operation: () => Promise<{ configId: string | null; profileDigest: string | null }>,
    options: { reuseConfigId?: string } = {},
  ): Promise<SharedConfigSelection> {
    const previous = await this.readState();
    if (options.reuseConfigId && previous?.ready && previous.configId === options.reuseConfigId) {
      return this.selection(previous);
    }
    const next = await operation();
    const state: SharedState = { version: 1, ...next, revision: randomUUID(), ready: true };
    await this.writeState(state);
    return this.selection(state);
  }

  async edit(configId: string, operation: () => Promise<void>, describe: () => Promise<string | null>): Promise<void> {
    await operation();
    const state = await this.readState();
    if (state?.configId !== configId) return;
    const profileDigest = await describe();
    await this.writeState({
      ...state,
      configId: profileDigest === null ? null : configId,
      profileDigest,
      revision: randomUUID(),
      ready: true,
    });
  }

  private selection(state: SharedState): SharedConfigSelection {
    const { configId, revision, profileDigest, ready } = state;
    return { configId, revision, profileDigest, ready };
  }
}
