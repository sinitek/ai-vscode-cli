import type { ToolSettingsState } from "./toolSettings";
import type { InteractiveMode } from "./cli/types";

export type ModeAvailability = { loopEnabled: boolean; loopPlusEnabled: boolean; departmentEnabled: boolean };

export function resolveModeAvailability(settings: Partial<ToolSettingsState> | null | undefined): ModeAvailability {
  return {
    loopEnabled: typeof settings?.loopEnabled === "boolean" ? settings.loopEnabled : true,
    loopPlusEnabled: typeof settings?.loopPlusEnabled === "boolean" ? settings.loopPlusEnabled : true,
    departmentEnabled: typeof settings?.departmentEnabled === "boolean" ? settings.departmentEnabled : false,
  };
}

export function assertModeAvailable(mode: InteractiveMode, settings: Partial<ToolSettingsState> | null | undefined): void {
  const availability = resolveModeAvailability(settings);
  const enabled = mode === "loop" ? availability.loopEnabled
    : mode === "loop_plus" ? availability.loopPlusEnabled
      : mode === "department" ? availability.departmentEnabled : true;
  if (!enabled) {
    const label = mode === "loop" ? "Loop" : mode === "loop_plus" ? "Loop+" : "产研部";
    throw new Error(`${label}已在工具设置中关闭，未启动任务。`);
  }
}
