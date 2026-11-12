# extension.ts 入口运行时重构计划 — 文档

- 日期：2026-08-02
- 状态：completed
- 负责人：Codex
- claimed_at：2026-08-03T15:36:41+08:00
- completed_at：2026-08-03T16:50:13+08:00
- claim_ttl：已完成并归档
- handoff_to：无
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-02-extension-entry-refactor.md`

## 本类型目标

同步 ARCHITECTURE、vscode-cli-extension-runtime 与 cli-runtime-reference 的运行时边界；保留 4968 评审快照与 4971 并发变动的非阻断漂移。

## 范围与所有权

- 同步 ARCHITECTURE、vscode-cli-extension-runtime 与 cli-runtime-reference 的运行时边界；保留 4968 评审快照与 4971 并发变动的非阻断漂移。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 同步 ARCHITECTURE、vscode-cli-extension-runtime 与 cli-runtime-reference 的运行时边界；保留 4968 评审快照与 4971 并发变动的非阻断漂移。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-02-refactor-extension-entry-refactor.md](2026-08-02-refactor-extension-entry-refactor.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 范围

- 更新运行时边界文档和本执行计划的阶段记录。

### 本轮写入范围

- `update-extension-exec-plan` 授权写入：`.ch/docs/exec-plans/completed/2026-08/2026-08-02-extension-entry-refactor.md`。
- `sync-extension-runtime-docs` 授权写入：`ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划。

### 影响面

- 文档目录：`sync-extension-runtime-docs` 已同步 `ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划。

### 风险与缓解

- 当前未决风险：无功能或测试 blocker；`review-extension-boundary` 已完成生命周期、依赖方向、显式依赖和剩余组合根职责核查，未要求返工。非阻断文档漂移是 `ARCHITECTURE.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md` 仍记录评审快照 4968 行，尚未反映范围外提交后的当前 4971 行；这两个文件不在 summary 节点写入范围内。

### 测试与清单同步

- 功能清单：本次实现保持用户行为不变，仅调整内部结构和测试 canonical source；因此继续不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 或兼容入口功能清单。
- 相关文档同步：`sync-extension-runtime-docs` 已同步 `ARCHITECTURE.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/references/cli-runtime-reference.md` 和本计划中的组合根与 host 边界、最终行数、focused 验证结果和停止条件。

### 阶段记录

- 2026-08-03 文档同步时当前行数：`src/extension.ts` 5092 行，`promptOneShotRuntime.ts` 994 行，`promptInteractiveRuntime.ts` 1210 行，`promptExecutionShared.ts` 59 行。
- 2026-08-03 收束：实施与验证均已通过，`review-extension-boundary` 未要求返工，执行计划归档到 `completed/`；两份运行时文档中的 4968 行评审快照作为非阻断数字漂移留待拥有对应写权限的后续任务同步。

### 任务列表

- [x] 同步运行时边界文档和本计划。
- [x] 同步运行时边界文档和本计划的本轮最终行数、验证结果与停止条件。

### 决策记录

- 2026-08-03：文档同步确认当前 `extension.ts` 4968 行，未达 3000 行但符合最佳实践边界；功能清单无需更新，因为没有用户可见行为变化。

## 分类依据与真实状态

refactor：源文明确命令/Loop/CLI/持久化行为不变，仅内聚抽取；test：原测试适配节点实际新增两组 runtime 测试及迁移 canonical source；docs：原 sync-extension-runtime-docs 节点实际同步三份运行时文档。851/851 与当前产物 852/852 属历史复验，临时 outDir 的74项环境失败、未达3000行及4968/4971漂移不得抹去。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
