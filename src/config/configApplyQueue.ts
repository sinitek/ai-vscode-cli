export type ConfigApplyOperation = {
  apply: () => Promise<void>;
  commit: () => void;
};

export type ConfigApplyResult = "applied" | "superseded";

type QueuedConfigApplyOperation = ConfigApplyOperation & {
  resolve: (result: ConfigApplyResult) => void;
  reject: (error: unknown) => void;
};

type QueueState = {
  pending: QueuedConfigApplyOperation | null;
  draining: boolean;
  idlePromise: Promise<boolean>;
  resolveIdle: (success: boolean) => void;
};

export function createConfigApplyQueue<K extends string>() {
  const states = new Map<K, QueueState>();

  const drain = async (key: K, state: QueueState): Promise<void> => {
    state.draining = true;
    try {
      while (state.pending) {
        const operation = state.pending;
        state.pending = null;
        if (!operation) {
          continue;
        }
        try {
          await operation.apply();
        } catch (error) {
          if (state.pending) {
            operation.resolve("superseded");
            continue;
          }
          operation.reject(error);
          state.resolveIdle(false);
          return;
        }

        // A newer selection arrived while this write was in flight. The file
        // write happened, but only the latest selection may update active state.
        if (state.pending) {
          operation.resolve("superseded");
          continue;
        }

        try {
          operation.commit();
          operation.resolve("applied");
          state.resolveIdle(true);
          return;
        } catch (error) {
          operation.reject(error);
          state.resolveIdle(false);
          return;
        }
      }
      state.resolveIdle(true);
    } finally {
      state.draining = false;
      states.delete(key);
    }
  };

  const request = (key: K, operation: ConfigApplyOperation): Promise<ConfigApplyResult> => {
    let state = states.get(key);
    if (!state) {
      let resolveIdle!: (success: boolean) => void;
      const idlePromise = new Promise<boolean>((resolve) => {
        resolveIdle = resolve;
      });
      state = {
        pending: null,
        draining: false,
        idlePromise,
        resolveIdle,
      };
      states.set(key, state);
    }

    return new Promise<ConfigApplyResult>((resolve, reject) => {
      if (state.pending) {
        state.pending.resolve("superseded");
      }
      state.pending = {
        ...operation,
        resolve,
        reject,
      };
      if (!state.draining) {
        void drain(key, state);
      }
    });
  };

  const waitForIdle = async (key: K): Promise<boolean> => states.get(key)?.idlePromise ?? true;

  return { request, waitForIdle };
}
