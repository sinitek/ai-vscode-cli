import * as core from "./codexAppServerPoolCore";
import { captureCodexHostRuntime } from "./codexRuntimeHost";
export * from "./codexAppServerPoolCore";

export function acquireCodexAppServer(
  spec: core.CodexAppServerConnectionSpec,
  listener: core.CodexAppServerListener,
): core.CodexAppServerConnection {
  return core.acquireCodexAppServer(spec, listener, captureCodexHostRuntime());
}

export class CodexAppServerConnection extends core.CodexAppServerConnection {
  public constructor(spec: core.CodexAppServerConnectionSpec) {
    super(spec, captureCodexHostRuntime());
  }
}
