# 可复用逻辑重构执行计划

- 日期：2026-08-01
- 状态：in-progress
- 负责人：Codex（Graph 主任务）
- owner：main
- claimed_at：2026-08-01T09:31:44+08:00
- claim_ttl：本次 Graph run 完成前
- handoff_to：verify-build-tests、review-refactor

## 背景

Graph scheduler、Loop parallel 和多个 Loop/Graph 路径构建模块分别维护了相同或高度相似的值级归一化逻辑。重复实现会让路径边界、空值 fallback、大小写和写入范围冲突判断在后续修复时产生漂移。

上游盘点和边界论证确认本次只抽取两个不依赖业务模块的共享原语：安全路径片段清洗，以及写入范围元数据归一化与路径重叠判断。Graph/Loop 的冲突结果、调度流程和领域语义不属于共享层。

## 目标

在不改变现有 Graph/Loop 行为、导出兼容性和目录布局的前提下，集中维护重复的值级逻辑：

- 由 `src/shared/pathSegments.ts` 提供 `sanitizePathSegment(value: unknown, fallback: string)`。
- 由 `src/shared/writeScope.ts` 提供 `normalizeWriteFiles(value: unknown): string[]`、`normalizeConflictGroup(value: unknown): string | null` 和 `writeFilePathsOverlap(left: string, right: string): boolean`。
- 保留 Graph/Loop 现有兼容包装和调用方的业务策略，使共享工具不反向依赖 `graph` 或 `loop` 模块。

## 范围

- 新增 `src/shared/pathSegments.ts`，统一复用 Graph、`loopTaskStore.ts` 和 `loopDebate.ts` 的安全路径片段清洗。
- 新增 `src/shared/writeScope.ts`，统一复用 Graph scheduler 与 `loopParallel.ts` 的写入文件路径、冲突组归一化和父子路径重叠判断。
- 更新 `src/graph/types.ts`、`src/loopTaskStore.ts`、`src/loopDebate.ts`、`src/loopParallel.ts`、`src/graph/graphScheduler.ts` 的导入或兼容包装。
- 新增或更新 `src/test/pathSegments.test.ts`、`src/test/writeScope.test.ts` 及 Graph/Loop 相关回归测试，覆盖非法字符、空值 fallback、大小写、重复路径、父子路径边界和冲突组归一化。
- 保留现有路径格式：路径片段只允许 ASCII 字母、数字、`_`、`.`、`-`；非法字符替换为 `_`，空值使用调用方 fallback。
- 保留现有写入路径格式：反斜杠转正斜杠、折叠重复分隔符、清理前导 `./` 和中间 `/./`、移除末尾 `/`、小写化、过滤空值并去重。
- 保留 Graph 的 `unscopedWrite` 冲突语义、Loop/Graph 的冲突结果结构、遍历顺序、描述文本、fallback 常量、目录拼接和 debate 标识符归一化。

## 非目标

- 不抽取完整的 Graph/Loop conflict detector、执行分组算法、冲突消息生成或节点/子任务领域类型。
- 不把 Graph 的未声明写入判定伪装为普通写入范围，或迁移 `isGraphUnscopedWriteNode` 的业务规则。
- 不合并路径片段清洗、写入文件路径清洗和 debate 标识符归一化三类不同语义。
- 不改变 Graph/Loop 的持久化目录、通信 artifact 目录、文件命名、调度流程或用户可见功能。
- 不替换技术栈、测试框架、核心依赖或无关模块。
- 不生成、刷新或修改 `.ch/docs/memory/`、generated recall 产物或 Graph 运行态文件。

## 验收标准

- [completed] Graph、Loop task store 和 Loop debate 的路径片段清洗均委托同一个共享工具，既有导出包装和 fallback 语义保持兼容。
- [completed] Graph scheduler 与 Loop parallel 的写入文件/冲突组归一化和路径重叠判断均复用共享工具，父子路径边界不误匹配，例如 `src/foo` 不匹配 `src/foobar`。
- [completed] Graph 特有的 `unscopedWrite` 语义、两套冲突结果结构、遍历顺序和消息格式仍由各自调用方负责。
- [completed] 共享工具测试覆盖成功路径、非法字符或空值边界、大小写/重复项、父子路径和冲突组归一化；Graph/Loop 回归测试通过。
- [pending] `npm run build` 通过，相关 Graph/Loop 测试通过；失败时按测试规则记录失败类型、证据、影响范围和最小恢复动作。
- [completed] 确认本次仅为内部结构重构，无用户可见功能、权限或流程变化，因此无需更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；该结论保留在本计划中。

## 影响面

- 代码目录：`src/shared/`、`src/graph/`、`src/loop*.ts`。
- 测试目录：`src/test/pathSegments.test.ts`、`src/test/writeScope.test.ts`、`src/test/graphScheduler.test.ts`、`src/test/graphStore.test.ts`、`src/test/loopParallel.test.ts`、`src/test/loopTaskStore.test.ts`、`src/test/loopDebate.test.ts`。
- 文档目录：仅新增本 active exec plan；不修改架构、运行手册、产品功能清单或国际化资源，因为行为契约不变。
- 配置与脚本：不修改 `package.json`、TypeScript 配置或构建脚本。

## 风险与缓解

- 风险：共享写入路径清洗若改变斜杠、`./`、末尾斜杠或大小写行为，可能改变冲突检测结果。
  缓解：先按现有实现建立表格化边界测试，再保持兼容包装并执行 Graph/Loop 回归测试。
- 风险：父子路径重叠判断可能把同名前缀目录误判为父目录。
  缓解：使用路径分隔符边界判断，并固定覆盖 `src/foo`、`src/foo/bar`、`src/foobar` 三类用例。
- 风险：把 `unscopedWrite`、debate 标识符或目录布局下沉到共享层会造成过度抽象和语义回归。
  缓解：共享层只接受通用值，不依赖 Graph/Loop；局部规则和兼容导出保留在调用方。
- 风险：删除既有 helper 导出会影响测试或其他调用方。
  缓解：保留 `sanitizeGraphPathSegment`、`normalizeLoopWriteFiles` 等兼容入口，先迁移实现再考虑后续清理。
- 风险：直接工作区并发节点可能触碰同一计划文件。
  缓解：当前节点仅写入本计划文件；后续计划更新应由调度器在本节点完成后进行，并避免与源码实现冲突组交叉写入。

## 验证计划

- 最小相关验证：检查新增共享函数的导出、调用方导入和既有兼容包装；运行 `git diff --check`，确认仅有授权路径变化。
- 共享工具测试：构建后运行 `node --test dist/test/pathSegments.test.js dist/test/writeScope.test.js`。
- Graph/Loop 回归测试：构建后运行 `node --test dist/test/graphScheduler.test.js dist/test/graphStore.test.js dist/test/loopParallel.test.js dist/test/loopTaskStore.test.js dist/test/loopDebate.test.js`。
- 扩展验证：运行 `npm run build`；必要时运行项目统一命令 `npm run test:unit`，由统一验证节点根据耗时和已有测试基线决定是否扩展。
- 失败处理：按 `.ch/docs/TESTING.md` 区分实现缺陷、断言过期、夹具问题、环境/依赖问题和范围外历史失败；实现或测试修复后重跑最小相关命令，无法运行则记录错误摘要、影响和最小恢复动作。

## 测试与清单同步

- 单元测试新增/更新：新增共享工具行为测试；更新 Graph/Loop 现有测试以锁定兼容导出、路径格式和冲突边界。
- 单元自测结果：`test-path-segments` 已报告构建及路径测试通过；`test-write-scope` 已报告构建及 Graph/Loop 写入范围回归通过。完整构建与回归测试仍由 `verify-build-tests` 节点执行。
- 失败处理记录：当前无失败；后续失败必须按验证计划分类记录，不为通过测试修改无关代码。
- 功能清单：无需同步。理由是本次只改变内部实现复用边界，不改变插件功能、用户流程、权限或配置契约。
- 相关文档同步：本计划记录抽象边界、非目标和验证命令；若实现过程中发现行为、架构或运行方式变化，应由后续节点另行更新对应事实来源。

## 任务列表

Tasklist:
- [completed] 完成 Graph/Loop 重复逻辑盘点与共享边界论证
- [completed] 创建 active exec plan 并记录范围、验收、风险和验证命令
- [completed] 提取并接入共享路径片段清洗工具
- [completed] 提取并接入共享写入范围工具
- [completed] 补充共享工具与 Graph/Loop 回归测试
- [completed] 合并重构结果并执行构建和相关测试
- [pending] 完成评审、记录证据并归档执行计划

## 决策记录

- 2026-08-01：共享层只提供无状态、值级纯函数；Graph/Loop 的冲突策略、结果结构、调度流程和目录规则保留在调用方。
- 2026-08-01：保留既有 Graph/Loop helper 导出作为兼容包装，避免在内部重构中扩大调用方迁移范围。
- 2026-08-01：路径片段清洗和写入文件路径清洗不合并，因为前者替换非法字符，后者必须保留路径分隔符和目录边界语义。
- 2026-08-01：本次没有用户可见行为变化，不更新 `FEATURE_INVENTORY.md`；如后续实现改变公开契约，需重新评估并同步事实来源。

## 当前结论

两条共享原语已在当前工作区完成接入并通过上游专项验证；本节点确认导入、命名、兼容包装和测试引用一致。该变更仅调整内部实现复用边界，不改变插件功能、用户流程、权限或配置契约，因此无需更新 `FEATURE_INVENTORY.md`。完整构建与跨模块回归测试仍待 `verify-build-tests`，最终风险评审仍待 `review-refactor`。
