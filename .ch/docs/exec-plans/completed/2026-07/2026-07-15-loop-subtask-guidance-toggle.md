# Loop 子任务规则隔离与 Workflow Skills 移除

- 日期：2026-07-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-15
- claim_ttl：当前实现与验证期
- handoff_to：-

## 背景

Loop 模式原先会向开发类子任务注入内置 Workflow Skill 指引，并且子 CLI 可能自动发现工作区根目录的 `AGENTS.md` 或 `CLAUDE.md`。用户已决定移除该 Skills 能力，不再提供开关；Loop 主任务继续读取项目规则，子任务固定以隔离执行根运行，并以尽量少的轮次完成当前职责和必要检查。

## 目标

- 删除内置 Workflow Skill 快照、加载器、注入链路和维护脚本。
- Loop 主任务保持真实工作区执行与项目规则加载；Codex、Claude、OpenCode 子任务均通过隔离执行根，不自动发现工作区根 `AGENTS.md` / `CLAUDE.md`。
- 子任务 prompt 明确要求在单次执行中完成当前授权范围，并只做最小必要验证。
- 保持中英文国际化、持久化兼容和现有 Loop 行为的其他边界。

## 范围

- `media/loop-workflow-skills/`、对应脚本、运行时加载/提示词/持久化使用链路。
- Loop 子任务的执行轮次约束和三 CLI 调用参数/工作目录。
- 最小相关单元测试、功能清单和运行时设计/参考文档。

## 非目标

- 修改普通 Coding 模式或 Loop 主任务的项目规则行为。
- 改动用户根目录或工作区中的 `AGENTS.md`、`CLAUDE.md` 内容。
- 改动 CLI 的全局安装、用户配置或权限模型。

## 验收标准

- [x] 不再分发或加载 `media/loop-workflow-skills/`，主任务和子任务 prompt 不再产生/接收 Skills catalog 或 guidance。
- [x] 子任务 prompt 要求单次完成和最小必要检查。
- [x] 主任务在真实工作区执行；三种 CLI 的子任务调用均使用不含根 `AGENTS.md` / `CLAUDE.md` 的可测试隔离执行目录。
- [x] 相关单测、类型检查和构建通过；用户可见能力文档同步。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopPromptBuilders.ts`、`src/loopDebateRunner.ts`、`src/cli/`、`src/interactive/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：移除 Workflow Skill 同步/校验脚本

## 风险与缓解

- 风险：CLI 的规则发现机制或参数在版本间不同。
- 缓解：三者统一使用受控临时执行根，并以测试验证根规则和 Skills 路径未被链接；调用层分别叠加 Codex `--ignore-rules`、Claude SDK `settingSources: []` 与 OpenCode `--pure`。
- 风险：移除 Skills 后子任务质量要求弱化。
- 缓解：保留任务本身的明确验收要求，并把执行方式收敛为一次实现和最少必要检查。

## 验证计划

- 最小相关验证：Skills 移除后的 Loop prompt/决策构建、子任务隔离执行根、三种 CLI 参数/工作目录单测。
- 单元自测命令：从 `package.json` 和现有测试目录确认后记录。
- 扩展验证：`npm run compile`、`npm test` 或最小相关测试命令与 `npm run build`（按脚本实际存在情况）。

## 测试与清单同步

- 单元测试新增/更新：新增 `loopSubtaskExecutionRoot.test.ts`；更新 CLI 参数和 Loop prompt/队列回归。
- 单元自测结果：`npm run build` 通过；定向 Node 测试 66/66 通过、0 fail。
- 失败处理记录：首轮构建曾发现已删除模块的残留 `normalizedCompactSkillCatalogSection` 引用，已移除后重跑构建通过。
- 功能清单：已更新 `FEATURE_INVENTORY.md` 与详细能力规格，将 Workflow Skills 标为 removed 并新增子任务规则隔离能力。
- 相关文档同步：已更新架构、运行时设计、CLI 运行参考、安全、Skills 来源和本地开发 runbook。

## 任务列表

- [x] 阅读仓库约束、相关运行时资料并确认 CodeGraph 可用。
- [x] 定位原 Skills 链路和三种 CLI 调用链，确认隔离策略。
- [x] 删除内置 Workflow Skills 资源、加载/注入链路和维护脚本。
- [x] 实现子任务最少轮次提示和规则文件隔离。
- [x] 添加或更新测试和事实来源文档。
- [x] 运行最小相关测试、编译/构建并归档计划。

## 决策记录

- 2026-07-15：将用户“也必要让他看”按上下文解释为“也不要让他看”；因为需求明确要求在调用三种 CLI 时屏蔽规则文件。
- 2026-07-15：用户取消开关方案，改为永久删除内置 Workflow Skills；主任务保留项目规则，子任务固定隔离根规则。

## 当前结论

已完成：已删除内置 Workflow Skills 资源、loader、注入链路和维护脚本。主任务仍以真实工作区运行；子任务通过隐藏根规则与项目 Skills 目录的临时根执行，写入经符号链接回到真实工作区。调用层分别使用 Codex `--ignore-rules`、Claude SDK `settingSources: []` 与 OpenCode `--pure`，子任务 prompt 收敛为单次完成当前授权范围和最小必要验证。

验证结论：`npm run build` 通过；`node --test dist/test/loopSubtaskExecutionRoot.test.js dist/test/opencodeCommandRunner.test.js dist/test/loopPromptBuilders.test.js dist/test/loopPromptQueue.test.js dist/test/loopMainFailure.test.js dist/test/loopSubtaskThinking.test.js` 共 66 项通过、0 项失败；`git diff --check` 通过。
