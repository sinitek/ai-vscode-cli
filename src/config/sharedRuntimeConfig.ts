import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { writeFileAtomically } from "../shared/atomicWrite";

export type VisibleConfigSelection = { configId: string | null; revision: string };
export type SharedConfigSelection = VisibleConfigSelection & { profileDigest: string | null; ready: boolean };
type ExecutionLease = { id: string; pid: number };
type SharedState = SharedConfigSelection & { version: 1; leases: ExecutionLease[] };
type LockOwner = { pid: number; token: string };

export class ConfigSelectionChangedError extends Error {
  constructor() {
    super("配置档案已在其他窗口切换，本次任务未启动。界面已请求刷新，请确认所选档案后重新发送。");
    this.name = "ConfigSelectionChangedError";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export class SharedRuntimeConfig {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(private readonly directory: string, private readonly timeoutMs = 15000) {
    this.statePath = path.join(directory, "selection.json");
    this.lockPath = path.join(directory, "mutex");
  }

  private async readOwner(): Promise<LockOwner | null> {
    try {
      const owner = JSON.parse(await fs.readFile(this.lockPath, "utf8")) as LockOwner;
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== "string") {
        throw new Error("配置协调锁已损坏，请关闭相关窗口后检查配置协调目录。");
      }
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async recoverLock(owner: LockOwner): Promise<void> {
    const recoveryPath = path.join(this.directory, `recover-${owner.token}`);
    try {
      await fs.mkdir(recoveryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
      throw error;
    }
    try {
      const current = await this.readOwner();
      if (current?.token === owner.token && !isAlive(current.pid)) {
        await fs.unlink(this.lockPath);
      }
    } finally {
      await fs.rmdir(recoveryPath);
    }
  }

  private async locked<Result>(operation: () => Promise<Result>): Promise<Result> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const owner: LockOwner = { pid: process.pid, token: randomUUID() };
    const candidate = path.join(this.directory, `owner-${owner.token}`);
    await fs.writeFile(candidate, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    const deadline = Date.now() + this.timeoutMs;
    let acquired = false;
    try {
      while (!acquired) {
        try {
          await fs.link(candidate, this.lockPath);
          acquired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const current = await this.readOwner();
          if (current && !isAlive(current.pid)) await this.recoverLock(current);
          if (Date.now() >= deadline) throw new Error("等待其他窗口配置操作超时，任务未启动，请稍后重试。");
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
      }
      return await operation();
    } finally {
      if (acquired && (await this.readOwner())?.token === owner.token) await fs.unlink(this.lockPath);
      await fs.rm(candidate, { force: true });
    }
  }

  private async readState(): Promise<SharedState | null> {
    let state: SharedState;
    try {
      state = JSON.parse(await fs.readFile(this.statePath, "utf8")) as SharedState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("共享配置状态无法读取，任务未启动，请检查文件权限或重新应用配置。");
    }
    if (state.version !== 1 || typeof state.revision !== "string" || !state.revision
      || (state.configId !== null && typeof state.configId !== "string")
      || (state.profileDigest !== null && typeof state.profileDigest !== "string")
      || typeof state.ready !== "boolean" || !Array.isArray(state.leases)
      || state.leases.some((lease) => !lease || typeof lease.id !== "string" || !Number.isSafeInteger(lease.pid) || lease.pid <= 0)) {
      throw new Error("共享配置状态已损坏，任务未启动，请检查配置协调目录。");
    }
    const liveLeases = state.leases.filter((lease) => isAlive(lease.pid));
    if (liveLeases.length !== state.leases.length) {
      state.leases = liveLeases;
      await this.writeState(state);
    }
    return state;
  }

  private writeState(state: SharedState): Promise<void> {
    return writeFileAtomically(this.statePath, JSON.stringify(state), { mode: 0o600 });
  }

  private selection(state: SharedState): SharedConfigSelection {
    const { configId, revision, profileDigest, ready } = state;
    return { configId, revision, profileDigest, ready };
  }

  private assertIdle(state: SharedState | null): void {
    if (state?.leases.length) throw new Error("此 CLI 在其他窗口或当前窗口仍有执行中的任务，暂不能切换或修改配置，请任务结束后重试。");
  }

  async read(initialize?: () => Promise<{ configId: string | null; profileDigest: string | null }>): Promise<SharedConfigSelection | null> {
    return this.locked(async () => {
      let state = await this.readState();
      if (!state && initialize) {
        state = { version: 1, ...await initialize(), revision: randomUUID(), ready: true, leases: [] };
        await this.writeState(state);
      }
      return state ? this.selection(state) : null;
    });
  }

  async change(
    operation: () => Promise<{ configId: string | null; profileDigest: string | null }>,
    options: { reuseConfigId?: string } = {},
  ): Promise<SharedConfigSelection> {
    return this.locked(async () => {
      const previous = await this.readState();
      if (options.reuseConfigId && previous?.ready && previous.configId === options.reuseConfigId) {
        return this.selection(previous);
      }
      this.assertIdle(previous);
      const state: SharedState = previous ?? { version: 1, configId: null, profileDigest: null, revision: randomUUID(), ready: false, leases: [] };
      state.ready = false;
      state.revision = randomUUID();
      await this.writeState(state);
      const next = await operation();
      Object.assign(state, next, { ready: true, revision: randomUUID() });
      await this.writeState(state);
      return this.selection(state);
    });
  }

  async edit(configId: string, operation: () => Promise<void>, describe: () => Promise<string | null>): Promise<void> {
    await this.locked(async () => {
      const state = await this.readState();
      const active = state?.configId === configId;
      if (active) {
        this.assertIdle(state);
        state.ready = false;
        state.revision = randomUUID();
        await this.writeState(state);
      }
      await operation();
      if (active) {
        const profileDigest = await describe();
        Object.assign(state, { configId: profileDigest === null ? null : configId, profileDigest, ready: true, revision: randomUUID() });
        await this.writeState(state);
      }
    });
  }

  async acquire(
    expected: VisibleConfigSelection,
  ): Promise<{ selection: SharedConfigSelection; release: () => Promise<void> }> {
    const lease: ExecutionLease = { id: randomUUID(), pid: process.pid };
    const selection = await this.locked(async () => {
      const state = await this.readState();
      if (!state || state.configId !== expected.configId) throw new ConfigSelectionChangedError();
      if (!state.ready) throw new Error("上次配置应用未成功，任务未启动，请重新应用所需档案。");
      state.leases.push(lease);
      await this.writeState(state);
      return this.selection(state);
    });
    let released = false;
    return {
      selection,
      release: async () => {
        if (released) return;
        await this.locked(async () => {
          const state = await this.readState();
          if (state) {
            state.leases = state.leases.filter((entry) => entry.id !== lease.id);
            await this.writeState(state);
          }
        });
        released = true;
      },
    };
  }
}
