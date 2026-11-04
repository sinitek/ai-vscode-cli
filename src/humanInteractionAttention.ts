export type HumanInteractionAttentionSettings = {
  notifications: boolean;
  windowAttention: boolean;
  taskCompletion?: {
    notifications: boolean;
    windowAttention: boolean;
  };
};

export type DesktopAttentionNotificationKind = "human-interaction" | "task-completed";

export type HumanInteractionAttentionTransport = {
  notify: (kind?: DesktopAttentionNotificationKind) => Promise<void>;
  startAttention: () => Promise<void>;
  stopAttention: () => Promise<void>;
};

export function createHumanInteractionAttentionController(deps: {
  isFocused: () => boolean;
  isLocal: () => boolean;
  readSettings: () => HumanInteractionAttentionSettings;
  transport: HumanInteractionAttentionTransport;
  onError: (channel: "notification" | "window", error: unknown) => void;
}) {
  const pending = new Map<string, { kind: DesktopAttentionNotificationKind; notified: boolean }>();
  const seenCompletions = new Set<string>();
  const maxRememberedCompletions = 512;
  let disposed = false;
  let attentionStarted = false;
  let queue = Promise.resolve();

  const shouldRemind = (): boolean => !disposed && deps.isLocal() && !deps.isFocused() && pending.size > 0;

  const attempt = async (channel: "notification" | "window", action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      deps.onError(channel, error);
    }
  };

  const stopAttention = async (): Promise<void> => {
    if (!attentionStarted) {
      return;
    }
    attentionStarted = false;
    await attempt("window", deps.transport.stopAttention);
  };

  const refresh = (): Promise<void> => {
    const notifications: Promise<void>[] = [];
    queue = queue.then(async () => {
      if (deps.isFocused() || !deps.isLocal()) {
        for (const [entryId, entry] of pending) {
          if (entry.kind === "task-completed") {
            pending.delete(entryId);
          }
        }
      }
      if (!shouldRemind()) {
        await stopAttention();
        return;
      }
      const settings = deps.readSettings();
      const completionSettings = settings.taskCompletion ?? { notifications: true, windowAttention: true };
      const settingsFor = (kind: DesktopAttentionNotificationKind) => kind === "task-completed" ? completionSettings : settings;
      const actions: Promise<void>[] = [];
      for (const kind of ["human-interaction", "task-completed"] as const) {
        const entries = Array.from(pending.values()).filter((entry) => entry.kind === kind);
        if (settingsFor(kind).notifications && entries.some((entry) => !entry.notified)) {
          for (const entry of entries) {
            entry.notified = true;
          }
          notifications.push(attempt("notification", () => deps.transport.notify(kind)));
        }
      }
      const wantsWindowAttention = () => {
        const currentSettings = deps.readSettings();
        return Array.from(pending.values()).some((entry) => entry.kind === "task-completed"
          ? (currentSettings.taskCompletion?.windowAttention ?? true) : currentSettings.windowAttention);
      };
      if (wantsWindowAttention() && !attentionStarted) {
        attentionStarted = true;
        actions.push(attempt("window", deps.transport.startAttention));
      } else if (!wantsWindowAttention()) {
        actions.push(stopAttention());
      }
      await Promise.all(actions);
      if (!shouldRemind() || !wantsWindowAttention()) {
        await stopAttention();
      }
    });
    return queue.then(async () => { await Promise.all(notifications); });
  };

  return {
    request(interactionId: string): Promise<void> {
      if (disposed) {
        return queue;
      }
      const entryId = `interaction:${interactionId}`;
      if (!pending.has(entryId)) {
        pending.set(entryId, { kind: "human-interaction", notified: false });
      }
      return refresh();
    },
    complete(interactionId: string): Promise<void> {
      pending.delete(`interaction:${interactionId}`);
      return refresh();
    },
    taskCompleted(completionId: string): Promise<void> {
      if (disposed || seenCompletions.has(completionId)) {
        return queue;
      }
      seenCompletions.add(completionId);
      if (seenCompletions.size > maxRememberedCompletions) {
        seenCompletions.delete(seenCompletions.values().next().value!);
      }
      if (!deps.isLocal() || deps.isFocused()) {
        return refresh();
      }
      pending.set("completion", { kind: "task-completed", notified: false });
      return refresh();
    },
    refresh,
    dispose(): Promise<void> {
      disposed = true;
      pending.clear();
      seenCompletions.clear();
      return refresh();
    },
  };
}

export type HumanInteractionAttentionController = ReturnType<typeof createHumanInteractionAttentionController>;

export async function withHumanInteractionAttention<Result>(
  controller: HumanInteractionAttentionController | undefined,
  interactionId: string,
  action: () => Promise<Result>,
): Promise<Result> {
  void controller?.request(interactionId);
  try {
    return await action();
  } finally {
    void controller?.complete(interactionId);
  }
}
