# 任务配置重写失败降级继续执行

- 日期：2026-11-02
- 状态：completed
- 类型：bugfix
- 负责人：Codex

## 关联计划

- 七类CLI执行路由及失败/取消边界回归开发见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-task-config-rewrite-fallback.md`）。
- 原文记录的历史文档分工：功能规格、清单、运行参考、ontology与runbook历史同步原归 `2026-11-02-docs-task-config-rewrite-fallback.md`。 该 companion 已退役；完整写作及校验记录无法由索引复核。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

用户明确要求：任务前配置重写失败时跳过重写，但仍应启动任务。前一轮优化保留了失败阻断，本轮将任务入口的重写改为尽力执行，配置中心和显式切换继续保持成功后提交的契约。

## 范围与非目标

- 范围：统一 `runPrompt` 入口的重写降级、警告与日志、子任务配置绑定；独立回归开发已从计划目录移除，其历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-task-config-rewrite-fallback.md`）；行为文档原指向已退役 docs companion（完整记录未恢复）。
- 非目标：吞掉 CLI 运行错误、跳过实际配置有效性检查、无视取消或新选择、回滚多文件写入、增加跨进程锁或修改真实用户配置。
- 当前工作区干净，沿用现有工作区；不创建新分支或 worktree。

## 验收标准

- 七类 CLI 的交互式、一次性和并行路由在重写失败后仍到达实际运行派发。
- 等待中的配置应用失败时也允许使用当前可用配置；警告不发送任务 error 状态，不冒充激活成功。
- 同一次任务的后续命令修复重试不再重复失败的配置重写；下一次新任务可再次尝试。
- 写入被新请求替代、主动取消、缺失绑定档案以及实际 OpenCode 配置预检失败仍按原有逻辑处理。
- 子任务配置绑定不把失败的目标档案记录为已成功应用的配置。
- 最小回归、构建和全量单测通过；事实文档/ontology同步的独立验收原指向已退役 docs companion（完整记录未恢复）。

## 影响面与风险

- 代码：`src/extension.ts`；测试：`src/test/extensionHost/promptSessionHealth.test.ts`。
- 风险：当前运行配置可能不等于用户选择，甚至已有部分写入；警告明确提示不一致可能性，不承诺回滚或 CLI 一定能成功。
- 缓解：显式切换保持严格，实际 CLI/预检错误不吞；失败应用的子任务绑定配置 ID 留空。
- 回滚：还原本轮任务入口降级，不改档案存储格式或 CLI 依赖。

## 验证计划

- 先更新失败行为回归并确认旧实现失败，再修改入口。
- `npm run build`，`node --test dist/test/extensionHost/promptSessionHealth.test.js dist/test/config/configApplyQueue.test.js`。
- 扩展到配置域、任务派发/命令修复及完整单测；校验 ontology 和 `git diff --check`。
- 使用现有真实源码 VM harness 验证统一入口与实际分支调用；不调用真实模型或读取用户凭证。

## 测试与文档同步

- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-task-config-rewrite-fallback.md`）。
- `npm run build`：通过；`npm run test:unit`：2534 项，2533 通过、1 跳过、0 失败。唯一跳过是既有 DSH live 用例，需要显式 live 开关、回环模型地址和凭证，本次不启用。
- ontology 结构校验通过；ontology 自测 9 项通过；`git diff --check` 通过。
- 原 docs companion `2026-11-02-docs-task-config-rewrite-fallback.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。原文曾以该页为文档交付证据入口；此处无法复核其完整记录。[references 索引](../../../references/index.md)仅作导航。
- 架构不变；可复用行为进入事实文档，不追加自动任务流水到热区记忆。

## 当前结论

已通过 CodeGraph 调用关系和磁盘源码核对并修改统一 `runPrompt`：等待失败或重写异常只告警并继续；`task-config-rewrite-skipped` 日志记录具体原因；同次请求的后续重写跳过，下一次请求可重新尝试。手动切换仍复用原有提交队列，不伪装成功，取消、新选择替代与实际运行错误保持原有边界。

## 本机隔离验证

从当前 `src/extension.ts` 提取真实 `runPrompt` 函数，并复用现有源码 VM harness，接入实际 `configService.applyConfig`。临时 HOME 中把 `.codex/auth.json` 建为目录，稳定触发真实文件写入错误 `EISDIR`。观察到一条警告、一次实际运行分支派发、无任务 error 状态；派发端采用观察桩，不启动模型。临时目录已清理，未接触用户配置或真实凭证。

## 未验证边界

- 未运行真实 VS Code Extension Host、真实模型或 Windows 系统；本轮不修改 UI 结构、路径解析、CLI 协议或配置存储格式，故未运行浏览器测试。
- 继续启动不承诺 CLI 一定成功；当前运行文件可能与所选档案不同或已有部分写入，不提供事务回滚或跨进程原子性。
- 未打包或安装扩展；当前源码与构建产物已包含变更，日常已安装版需要正常更新插件才能使用本行为。
