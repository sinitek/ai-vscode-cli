import type { CliName, ThinkingMode } from "./cli/types";
import type { OpenCodeCanonicalModelRole } from "./cli/opencodeconfigmodels";
import type { LoopSubtaskMode } from "./loopPlusSubtaskMode";

export type LoopPlusConfigRole = "frontend" | "fullstack";

export type LoopTaskRoleForModelSelection = "main" | "subtask";

export type CliModelStore = {
  selectedByConfigId: Record<string, string>;
  optionsByConfigId: Record<string, string[]>;
  thinkingByCliAndModel: Partial<Record<CliName, Record<string, ThinkingMode>>>;
  loopThinkingByConfigId: Record<string, Partial<Record<LoopTaskRoleForModelSelection, Record<string, ThinkingMode>>>>;
  openCodeVariantByConfigAndModel: Record<string, Record<string, string>>;
  openCodeVariantByConfigModelAndRole: Record<string, Record<string, Partial<Record<OpenCodeCanonicalModelRole, string>>>>;
  selectedLoopByConfigId: Record<string, Partial<Record<LoopTaskRoleForModelSelection, string>>>;
  /** Loop+ 子-前端在目标档案上的模型。不写入 subtask 槽，避免覆盖子-后端。 */
  selectedLoopFrontendModelByConfigId: Record<string, string>;
  selectedLoopFrontendThinkingByConfigId: Record<string, Record<string, ThinkingMode>>;
  selectedLoopSubtaskCliByConfigId: Record<string, CliName>;
  /** Loop+ 子-前端 CLI，按主配置档案隔离。经典 Loop 不读取。 */
  selectedLoopFrontendCliByConfigId: Record<string, CliName>;
  /** Loop+ 子-全栈 CLI，按主配置档案隔离，不写入子-后端或子-前端槽。 */
  selectedLoopFullstackCliByConfigId: Record<string, CliName>;
  selectedLoopFullstackThinkingByConfigId: Record<string, Record<string, ThinkingMode>>;
  /** 显式模型值。空字符串表示用户选择了 CLI 默认模型，与整组配置缺失区分。 */
  loopRoleExplicitModelByConfigId: Record<string, Partial<Record<LoopPlusConfigRole, string>>>;
  /** Loop+ 子任务模式，按主配置档案隔离。缺省 fullstack，不覆盖其它档案。 */
  selectedLoopSubtaskModeByConfigId: Record<string, LoopSubtaskMode>;
  /** 全栈角色已从原子模型初始化过。再次切换模式不得重拷贝。 */
  loopFullstackRoleSeededByConfigId: Record<string, true>;
  loopRolesByConfigId: Record<string, Record<string, { main: boolean; subtask: boolean }>>;
  openCodeRoleModelsByConfigId: Record<string, Partial<Record<OpenCodeCanonicalModelRole, string>>>;
};

export type ModelSelectionStoreState = {
  store: CliModelStore;
  lastReadError: string | null;
  lastWriteError: string | null;
};

export type ModelSelectionStoreLogger = (event: string, payload?: unknown) => void;

export type ModelSelectionStoreOptions = {
  modelStoreFile: string;
  defaultModelStoreKey: string;
  isThinkingMode: (value: unknown) => value is ThinkingMode;
  normalizeThinkingModeForCli: (cli: CliName, mode: ThinkingMode) => ThinkingMode;
  logError?: ModelSelectionStoreLogger;
};
