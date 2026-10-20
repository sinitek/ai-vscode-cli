# Loop 子任务跨 CLI 路由

- 日期：2026-10-19
- 状态：completed
- 负责人：Codex
- owner：loop-cross-cli-submodels
- claimed_at：2026-10-19
- claim_ttl：本轮实现
- handoff_to：

## 背景

Loop、Loop+、Graph 的子任务原来只能使用主 CLI 的模型字符串。需要在子模型行选择另一个 CLI 分组当前选中配置下的模型，并真正用该 CLI 执行。

## 目标

子任务路由携带可选 cli 与 configId，UI 提供「子模型 CLI 分组」，执行时切换子 Tab/runner，且主任务 target 不变。

## 范围

- 模型存储、Loop/Graph 路由归一化、继续选择、面板消息与 PromptRunInput。
- 经典 Loop、Loop+、Graph 的子执行 CLI。
- Webview 子模型行与回归测试、规格、ontology。

## 非目标

- 不改 coding/plan 主模型区，不给 Claude 增加模型选择。
- 不改 Loop+ 调度语义、Graph DAG 协议、package.json 或运行时配置。
- 不把所有 Graph 节点切到子 CLI；plan/summary 仍用 planner。
- 不启动真实外部 CLI 进程。

## 验收标准

- [x] 四种主 CLI 都能选择子 CLI；Claude 可作主 CLI 或子 CLI。
- [x] 旧记录缺 cli/configId 时保持同 CLI；非法 CLI 不进入 runner。
- [x] 跨 CLI 不回退主模型、主配置、主会话、主思考档或 OpenCode variant。
- [x] 显式跨 CLI 配置失效时失败，不静默跑主 CLI。
- [x] Loop、Loop+、Graph 宿主调用捕获到子 target CLI，主 target 不变。

## 影响面

- 代码目录：src/subtaskCliRoute.ts、src/loopTaskStore.ts、src/graph、src/extensionHost、src/webview、src/continueModelChoice.ts、src/modelSelectionStore.ts
- 文档目录：产品规格、ARCHITECTURE.md、运行时说明、ontology、本计划
- 配置与脚本：无依赖变更

## 风险与缓解

- 风险：显式字段拷贝遗漏导致恢复丢路由。
- 缓解：公共请求链同时保留 loopSubtaskCli 与 loopSubtaskConfigId。Loop+ `tryRun` 必须把这两个字段传给编排，否则 attempt 会落回主 CLI。

## 验证计划

- 最小相关验证：路由、执行、Webview、继续选择、Loop+ 集成与思考上限源码契约。
- 单元自测命令：见下方结果。
- 扩展验证：headless Chrome 测量静态子模型行；未启动真实 CLI。

## 测试与清单同步

- 单元测试新增/更新：src/test/loop/subtaskCliRoute.test.ts、src/test/extensionHost/subtaskCliExecution.test.ts、src/test/webview/loopSubtaskCliRoute.test.ts，并更新 continueModelChoice 与 loopSubtaskThinking 的源码契约断言。
- 单元自测结果：`npm run build` 通过。`node --test` 相关集合 114 通过；Loop+ 集成、定时任务存储、子任务生命周期通过；思考上限 5 项通过。失败先按夹具缺失、实现漏传字段和过期源码断言分类后修复。
- 失败处理记录：经典 Loop 夹具补齐 `t` 与群聊依赖；Loop+ 适配器把 `loopSubtaskCli` / `loopSubtaskConfigId` 传入 `tryRun`；Graph 测试改用完整 messages host；静态 HTML 断言改为实际行顺序；继续与思考上限断言改为当前执行 CLI 契约，Graph 仍不传 `applySubtaskCap: true`。
- 功能清单：`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：能力规格、ARCHITECTURE.md、cli-runtime-reference、ontology `plugin.rule.loop_graph_cross_cli_subtask`

## 任务列表

- [x] 数据契约与归一化
- [x] 三条执行链
- [x] Webview 子 CLI 行
- [x] 回归测试与文档

## 决策记录

- 2026-10-19：角色路由扩展可选 cli/configId，不新建平行任务存储。子 CLI 选择按主配置隔离，缺省跟随主 CLI。Claude 无 model 仍是有效子路由。
- 2026-10-19：Loop+ 编排输入必须携带子 CLI 与配置；只写 live prompt 不能覆盖 attempt 启动前的绑定。

## 当前结论

实现与文档已完成。宿主测试捕获到正确的子 target CLI，主 target 不变。headless Chrome 确认子模型行在 480px 与 220px 下不重叠；220px 的 stage 溢出来自既有主模型 grid，不是新增子行。未验证真实外部 CLI 进程启动。
