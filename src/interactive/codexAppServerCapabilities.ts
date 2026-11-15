import * as core from "./codexAppServerCapabilitiesCore";
import { captureCodexHostRuntime } from "./codexRuntimeHost";
export { canShareCodexAppServer, type CodexThreadUnloadCapability } from "./codexAppServerCapabilitiesCore";

export function resolveCodexThreadUnloadCapability(input: core.CodexCapabilityInput): Promise<core.CodexThreadUnloadCapability> {
  return core.resolveCodexThreadUnloadCapability(input, captureCodexHostRuntime());
}
