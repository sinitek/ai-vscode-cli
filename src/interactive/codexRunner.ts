import { CodexInteractiveRunner as CoreRunner, type CodexRunnerOptions } from "./codexRunnerCore";
import { captureCodexHostRuntime } from "./codexRuntimeHost";
export * from "./codexRunnerCore";

export class CodexInteractiveRunner extends CoreRunner {
  public constructor(options: CodexRunnerOptions) {
    super(options, captureCodexHostRuntime());
  }
}
