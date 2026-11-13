# 可复用逻辑重构执行计划 — 行为保持重构

- 日期：2026-08-01
- 状态：completed
- 负责人：Codex
- owner：main
- claimed_at：2026-08-01T09:31:44+08:00
- claim_ttl：本次任务完成前
- handoff_to：已归档，无后续 active handoff
- 类型：refactor


### 背景

Loop parallel 和多个 Loop 路径构建模块分别维护了相同或高度相似的值级归一化逻辑。重复实现会让路径边界、空值 fallback、大小写和写入范围冲突判断在后续修复时产生漂移。
上游盘点和边界论证确认本次只抽取两个不依赖业务模块的共享原语：安全路径片段清洗，以及写入范围元数据归一化与路径重叠判断。Loop 的冲突结果、调度流程和领域语义不属于共享层。

### 目标

在不改变现有 Loop 行为、导出兼容性和目录布局的前提下，集中维护重复的值级逻辑：
- 由 `src/shared/pathSegments.ts` 提供 `sanitizePathSegment(value: unknown, fallback: string)`。
- 由 `src/shared/writeScope.ts` 提供 `normalizeWriteFiles(value: unknown): string[]`、`normalizeConflictGroup(value: unknown): string | null` 和 `writeFilePathsOverlap(left: string, right: string): boolean`。
- 保留 Loop 现有兼容包装和调用方的业务策略，使共享工具不反向依赖 `loop` 模块。

### 范围

- 新增 `src/shared/pathSegments.ts`，统一复用 `loopTaskStore.ts` 和 `loopGroupChat.ts` 的安全路径片段清洗。
- 新增 `src/shared/writeScope.ts`，统一复用 `loopParallel.ts` 的写入文件路径、冲突组归一化和父子路径重叠判断。
- 更新 `src/loopTaskStore.ts`、`src/loopGroupChat.ts`、`src/loopParallel.ts` 的导入或兼容包装。
- 保留现有路径格式：路径片段只允许 ASCII 字母、数字、`_`、`.`、`-`；非法字符替换为 `_`，空值使用调用方 fallback。
- 保留现有写入路径格式：反斜杠转正斜杠、折叠重复分隔符、清理前导 `./` 和中间 `/./`、移除末尾 `/`、小写化、过滤空值并去重。
- 保留 Loop 的冲突结果结构、遍历顺序、描述文本、fallback 常量和目录拼接。

### 非目标

- 不抽取完整的 Loop conflict detector、执行分组算法、冲突消息生成或子任务领域类型。
- 不合并路径片段清洗和写入文件路径清洗两类不同语义。
- 不改变 Loop 的持久化目录、通信 artifact 目录、文件命名、调度流程或用户可见功能。
- 不替换技术栈、测试框架、核心依赖或无关模块。
- 不生成、刷新或修改 `.ch/docs/memory/`、generated recall 产物。

### 验收标准

- [completed] Loop task store 和 Loop 群聊 的路径片段清洗均委托同一个共享工具，既有导出包装和 fallback 语义保持兼容。
- [completed] Loop parallel 的写入文件/冲突组归一化和路径重叠判断均复用共享工具，父子路径边界不误匹配，例如 `src/foo` 不匹配 `src/foobar`。
- [completed] Loop 的冲突结果结构、遍历顺序和消息格式仍由各自调用方负责。
- [completed] 确认本次仅为内部结构重构，无用户可见功能、权限或流程变化，因此无需更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；该结论保留在本计划中。

### 影响面

- 代码目录：`src/shared/`、`src/loop*.ts`。
- 文档目录：仅新增本 active exec plan；不修改架构、运行手册、产品功能清单或国际化资源，因为行为契约不变。
- 配置与脚本：不修改 `package.json`、TypeScript 配置或构建脚本。

### 风险与缓解

- 风险：共享写入路径清洗若改变斜杠、`./`、末尾斜杠或大小写行为，可能改变冲突检测结果。
  缓解：先按现有实现建立表格化边界测试，再保持兼容包装并执行 Loop 回归测试。
- 风险：父子路径重叠判断可能把同名前缀目录误判为父目录。
  缓解：使用路径分隔符边界判断，并固定覆盖 `src/foo`、`src/foo/bar`、`src/foobar` 三类用例。
- 风险：把 目录布局下沉到共享层会造成过度抽象和语义回归。
  缓解：共享层只接受通用值，不依赖 Loop；局部规则和兼容导出保留在调用方。
- 风险：删除既有 helper 导出会影响测试或其他调用方。
  缓解：保留 `normalizeLoopWriteFiles` 等兼容入口，先迁移实现再考虑后续清理。
- 风险：直接工作区并发节点可能触碰同一计划文件。
  缓解：当前节点仅写入本计划文件；后续计划更新应由调度器在本节点完成后进行，并避免与源码实现冲突组交叉写入。

### 测试与清单同步

- 功能清单：无需同步。理由是本次只改变内部实现复用边界，不改变插件功能、用户流程、权限或配置契约。
- 相关文档同步：本计划记录抽象边界、非目标和验证命令；若实现过程中发现行为、架构或运行方式变化，应由后续节点另行更新对应事实来源。

### 任务列表

- [completed] 完成 Loop 重复逻辑盘点与共享边界论证
- [completed] 创建 active exec plan 并记录范围、验收、风险和验证命令
- [completed] 提取并接入共享路径片段清洗工具
- [completed] 提取并接入共享写入范围工具
- [completed] 完成评审、记录证据并归档执行计划

### 决策记录

- 2026-08-01：共享层只提供无状态、值级纯函数；Loop 的冲突策略、结果结构、调度流程和目录规则保留在调用方。
- 2026-08-01：保留既有 Loop helper 导出作为兼容包装，避免在内部重构中扩大调用方迁移范围。
- 2026-08-01：路径片段清洗和写入文件路径清洗不合并，因为前者替换非法字符，后者必须保留路径分隔符和目录边界语义。
- 2026-08-01：本次没有用户可见行为变化，不更新 `FEATURE_INVENTORY.md`；如后续实现改变公开契约，需重新评估并同步事实来源。

### 当前结论

两条共享原语已在当前工作区完成接入并通过上游专项验证；本节点确认导入、命名、兼容包装和测试引用一致。该变更仅调整内部实现复用边界，不改变插件功能、用户流程、权限或配置契约，因此无需更新 `FEATURE_INVENTORY.md`。2026-08-03 收尾时已关闭剩余评审/归档待办并将计划归档到 `completed/`；后续若需要更大范围重构，应另起执行计划。

## 分类依据与真实状态

refactor：原目标明确保持 Loop 行为及导出兼容，只抽取两个值级纯函数；test：原范围及测试同步明确新增共享工具测试、更新 Loop 回归。原文明确不改架构/手册/功能清单，记录本计划不构成独立 docs 任务。专项通过与 8/3 仅文档归档未扩大验证保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
