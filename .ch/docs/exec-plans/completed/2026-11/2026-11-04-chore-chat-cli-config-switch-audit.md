# AI 对话面板同 CLI 配置切换生效排查

- 日期：2026-11-04
- 状态：completed
- 类型：chore
- 负责人：Codex

## 背景与目标

确认 AI 对话面板在同一 CLI 内切换配置后，下一次执行是否使用新配置，尤其检查配置应用、异步发送、交互 runner 复用和底层连接池。

## 范围与非目标

- 覆盖面板配置选择、宿主执行前配置确认、运行参数/环境、交互会话和连接复用。
- 本轮按现状排查处理：确认问题、给出验证证据与修复建议，不擅自改变运行行为；不改动用户真实 CLI 配置或调用付费模型。
- 保留任务开始时已有配置服务、配置面板、模型发现及 Loop 测试改动。

## 关联计划

- 独立文档交付：[2026-11-04-docs-chat-cli-config-switch-audit.md](2026-11-04-docs-chat-cli-config-switch-audit.md)。本计划不承接文档写作或测试开发。

## 验收标准

- 给出配置选择到实际执行的可核对代码链路。
- 明确普通执行、已有交互会话、同档案内容更新和运行中切换的边界。
- 对确认问题提供自动化证据；记录相关测试与构建结果，明确尚未修复。
- 记录排查结论及既有验证证据；排障事实同步由关联 docs 计划承接。

## 影响面与风险

- 预计涉及：面板消息、配置档案解析、提示词运行时、交互 runner、CLI 连接池及相关测试。
- 风险：异步状态与配置文件应用的时序；会话复用可能固定进程启动时的凭据或供应商配置。
- 缓解：先定位并用隔离夹具验证，不读取或记录真实密钥；保持已有会话续接语义。
- 回滚：仅回退本任务新增差异，不覆盖工作区既有改动。

## 验证计划

- 最小验证：配置切换、运行前准备与交互会话复用相关单测。
- 扩展验证：相关模块回归、`npm run build`、ontology 校验。
- 本机验证：优先使用项目真实函数配合隔离 CLI 进程；真实供应商请求须避免改写用户配置或产生费用。
- 构建、相关现有测试及隔离配置切换实验已经执行，结果见下。

## 任务列表

Tasklist:
- [completed] 核对配置切换与执行链路
- [completed] 验证旧配置残留的可能路径
- [completed] 整理风险证据与修复建议
- [completed] 汇总结论与适用边界

## 召回与当前进展

- memory-recall focus：`CLI 配置切换 config profile session resume 环境变量`；anchor 为空。命中两个既有 Loop 计划，只作为上下文入口。
- ontology 状态 ready；已查询 `plugin.config_profile` 与 CLI 会话语义，当前规则强调运行前复核配置及会话续接。
- CodeGraph 可用，但相关文件有磁盘变更提示；以当前源码核对为准。

## 已确认链路

1. `src/webview/viewContentScript/eventBindings.ts` 设置待应用档案，并向宿主发送 `applyConfig`；发送/队列在提交前等待，显式失败回滚，不是简单地只改下拉值。
2. `src/panelMessageHandlers/session.ts` 调用 `applyConfigById`；`src/extension.ts` 通过按 CLI 串行的 `configApplyQueue` 落盘后提交工作区身份。
3. `runPrompt` 等待队列并重新应用任务绑定档案、执行快照或当前激活档案，然后进入交互/并行/单次执行。该保护保证的是配置文件，不包含旧进程重载。
4. `src/interactive/manager.ts` 按 CLI/session 找 runner，复用规则由 `runnerLifecycleStrategies.ts` 决定；Codex 还会经 `codexAppServerPool.ts` 复用底层进程。

## 确认风险与证据

### Claude：切换档案但模型等启动参数相同

- `runnerLifecycleStrategies.ts` 的 Claude `canReuse` 不比较配置 ID、配置内容或环境指纹。
- `claudeRunner.ts` 的 `ensureSession` 在已有 SDK 会话存活时直接返回；`loadClaudeSettings` 只在新建该会话时读取，其环境作为 `queryOptions.env` 传入 SDK。
- 隔离 SDK 夹具执行第一回合 A，将临时 `settings.json` 环境标记改为 B，再按相同模型获取 runner：仍是同一 runner，SDK query 只创建一次，第二回合输出 A；释放并重建后输出 B。
- 因而切换凭据/地址但保留相同模型和模式时，不能保证 SDK 会话使用新配置。

### Codex：同档案内容更新

- Codex runner 的 `canReuse` 只检查命令、cwd 和 `configId`，不检查同 ID 内容变化。
- `codexRunner.ts` 对已加载 thread 的活连接会提前复用；连接 key 只有命令、args、cwd、home 与 provider 名，不包含完整 provider/认证配置。
- 隔离临时 `CODEX_HOME_DIR`，由真实 Node 子进程实现 app-server 协议并只在启动时读取测试 endpoint：配置从 `https://audit-a.invalid` 改到 `https://audit-b.invalid`，同档案第二回合仍返回 A。单 Tab 改到不同档案并释放旧连接后，重建进程返回 B。

### Codex：多 Tab 共享连接后切换不同档案

- 另一个 Tab 仍持有同一 app-server 时，释放第一个 Tab 的 runner 不会关闭共享连接。
- 若不同档案沿用同一 provider 名、命令、cwd 与 home，新 runner 的池 key 与旧连接一致，仍会取得旧进程。
- 同一隔离真实子进程实验：两个 Tab 使用档案 A，只启动一个进程；写入 B 后第一个 Tab 改为不同配置 ID，新 runner 已建立，但进程总数仍为 1，下一回合仍返回 A。
- 这里只确认插件没有强制创建新进程或传递完整新配置；真实 Codex 是否自行热加载具体字段尚未用供应商请求验证，不能把本实验写成真实供应商路由测量。

### 既有失败降级与并发边界

- `src/extension.ts` 的 `continueWithoutConfigRewrite` 在等待应用失败或任务前重写抛错后，只发出“运行配置可能与所选档案不一致”警告并继续。本次任务跳过后续重写；这是现有规格明确允许的降级，不是本轮新引入缺陷。
- 显式切换失败仍走错误/回滚，不能和任务前重写的继续执行混淆。
- 配置队列只在本扩展进程内按 CLI 串行写文件，不是配置应用到 CLI 真正读入之间的跨进程锁；运行中进程迁移也不在现有保证内。
- Grok、DSH、Kimi Code、ZCode 的 runner 复用条件也未接入统一配置内容指纹，但未逐项实测其供应商配置热加载，因此不把它们记为已经复现的供应商路由错误。OpenCode 不在六种交互 runner 的验证范围内。

## 修复建议与非目标

- 从有效配置、认证和相关环境生成不暴露原文的稳定指纹，统一传入 runner；Codex 必须同时纳入 app-server pool key，不能只重建上层 runner。
- 新回合发现指纹变化时创建/取得相应的新进程，仍按原 thread/session 恢复上下文；不要全局销毁其他 Tab 的活动回合。
- 补充 Claude 同模型换档案、Codex 同档案编辑、多 Tab 同 provider 换档案的长期回归测试。
- 如果产品要求严格保证所选档案，还必须单独决策是否取消“任务前配置重写失败仍继续”的现有降级；本轮不变更该契约。

## 验证结果与文档同步

- `npm run build`：通过（TypeScript 全量编译）。
- `node --test dist/test/config/configApplyQueue.test.js dist/test/interactive/runnerLifecycleStrategies.test.js dist/test/interactive/manager.test.js dist/test/interactive/codexAppServerPool.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/promptSessionHealth.test.js`：120/120 通过，0 失败/跳过；输出临时存于 `/tmp/sinitek-config-switch-tests.log`。
- `node --test dist/test/interactive/claudeRunner.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js`：42/42 通过，0 失败/跳过；共计 162 项相关现有测试通过。
- `node <<'NODE' ... NODE` 隔离实验：使用编译后的真实 manager/runner，替换 Claude SDK query；将 Codex spawn 定向至真实 Node 协议子进程；三种风险路径断言全部通过，重建对照场景读到 B。临时配置与测试进程全部释放，不访问用户真实配置或供应商。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains / 16 concepts / 15 relations / 98 rules / 2 workflows）。
- 单元测试未新增/修改：本轮没有改动运行代码；诊断实验用于确认现状，不把错误复用行为固化为长期期望断言。修复时应补前述期望重载的回归。
- 失败处理：无构建或测试失败，不涉及历史失败修复。
- 本机真实验证边界：已验证真实子进程与 stdin/stdout 协议复用，未启动已安装的供应商 CLI 或付费请求，未验证 Extension Development Host；因此不宣称所有 CLI 的实际网络 endpoint 均已测量。
- 功能清单无需更新：本轮不改变功能、行为或验收契约；已把已确认风险及现有保证的边界写入 `runbooks/PITFALLS.md`。
- ontology 无需更新：没有改变业务概念、状态机、权限或实现事实来源；现有任务前重写降级规则保持不变。
- 不更新 `ROLLING_SUMMARY.md` / `EVENT_MEMORY.md`：可复用结论已进入 runbook，本轮仅留下排查证据，不重复复制到记忆热区。
- 文档 whitespace 校验通过；计划按日期归档至 `completed/2026-11/`，runbook 引用归档后的实际路径。

## 当前结论

当前不能承诺“同一 CLI 切换配置后，下一次执行必然使用新配置”。配置提交/任务前落盘已有防护，但长连接配置身份缺失与既有失败降级仍构成例外。此轮仅排查，运行逻辑尚未修复。
