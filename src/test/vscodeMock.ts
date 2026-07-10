import * as path from "path";

let installed = false;

export function installVscodeMock(): void {
  if (installed) {
    return;
  }
  installed = true;

  const moduleLoader = require("module") as {
    _load: (this: unknown, ...args: any[]) => unknown;
  };
  const originalLoad = moduleLoader._load;
  const vscodeMock = {
    workspace: {
      getConfiguration: () => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
        inspect: () => ({}),
      }),
      workspaceFolders: [],
    },
    env: {
      language: "en",
      openExternal: async () => true,
    },
    window: {
      createTerminal: () => ({ sendText: () => undefined }),
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
    },
    commands: {
      executeCommand: async () => undefined,
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
      parse: (value: string) => ({ toString: () => value }),
      joinPath: (base: { fsPath?: string }, ...parts: string[]) => ({
        fsPath: path.join(base.fsPath ?? "", ...parts),
      }),
    },
    ViewColumn: {
      Active: -1,
    },
  };

  moduleLoader._load = function patchedLoad(this: unknown, ...args: any[]): unknown {
    if (args[0] === "vscode") {
      return vscodeMock;
    }
    return originalLoad.apply(this, args);
  };
}
