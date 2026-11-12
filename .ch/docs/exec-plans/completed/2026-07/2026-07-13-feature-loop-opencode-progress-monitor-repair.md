# Loop 与 OpenCode 实时进度监控修复

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：1 day
- handoff_to：

本原计划覆盖两个功能域及其文档同步。为避免把已交付 OpenCode 监控故障、Loop 新能力和文档交付合并：本文件仅代表 Loop 子任务主对话进度能力；OpenCode 监控修复见 [bugfix 计划](2026-07-13-bugfix-opencode-progress-monitor.md)，跨域事实来源更新见 [文档计划](2026-07-13-docs-progress-monitor-references.md)。原始共同验证结果在本计划按证据归属说明，不重复宣称独立运行。

## 背景

已交付的 OpenCode 子代理气泡依赖 `opencode run --port` 暴露本地 HTTP/SSE API。运行日志证明 OpenCode 1.17.18 虽接受该参数，却没有监听预留端口，监控器持续收到 `ECONNREFUSED`。同时，Loop 主从模式的“子代理”是插件启动的独立 CLI 子任务，而不是 OpenCode API 的 parent/child session；这些子任务只更新各自标签页，主对话在子任务完成前没有进度气泡。

## 目标

让 Loop 独立子任务在父任务目标对话持续显示独立进度气泡；实时事件不可用时，从消息存储补齐可见状态或新增文本，并正确收口生命周期。

## 范围

- Loop 子任务标签页到主任务标签页的进度桥接与生命周期收口。
- Loop 子任务消息存储的每秒快照同步（强于原 60 秒兜底要求）。
- Loop 子任务可见消息快照同步、父子 tab 路由及生命周期回归测试。
- 本计划验收 Loop 主气泡行为；OpenCode service repair 及独立文档更新分别在关联计划验收。

## 非目标

- 不改变 Loop 的任务拆分、并发度、重试或完成判定。
- 不展示 reasoning、工具输入、密钥、绝对路径等敏感内容。
- 不读取 OpenCode 私有 SQLite 数据库。
- 不改变 Codex App Server 已有子线程分流协议。

## 验收标准

- [x] Loop 子任务启动后，主对话立即出现带子任务名称的独立运行中气泡。
- [x] Loop 子任务可见 assistant 文本实时同步到主气泡；事件遗漏时每秒从消息存储补齐快照，强于原 60 秒兜底要求。
- [x] Loop 子任务完成、失败、中断和进程退出均能收口气泡，且不覆盖父任务最终答复。
- [x] Loop 子任务启动即显示独立运行态气泡，并从权威消息存储每秒同步可见 assistant 快照。
- [x] 子任务完成、失败、中断及进程退出可收口气泡，且不覆盖父任务最终答复。
- [x] 与 Loop 子任务进度桥接相关的单测和 build 结果见原计划汇总验证；OpenCode、文档结果各自归属关联计划。

## 影响面

- 代码目录：`src/cli/`、`src/loop*`、`src/extension.ts`、`src/subagentProgress.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：沿用 Node 子进程、HTTP 与现有消息持久化，不新增依赖或技术栈

## 风险与缓解

- 风险：Loop 子任务消息同时写入子标签页和主气泡，导致重复或父结论误判。
- 缓解：按 taskId/subtaskId 建立独立气泡身份，只同步可见 assistant 快照，并保留 `subagentId` 元数据隔离最终结论。
- 风险：父标签页关闭、恢复或切换会话后，进度更新路由错误。
- 缓解：运行时保存父目标标识，写入前重新解析消息存储；兜底轮询使用任务记录和子标签页映射校验。
- OpenCode 服务进程泄漏/端口冲突与监控失败降级属于 [bugfix 计划](2026-07-13-bugfix-opencode-progress-monitor.md) 的风险，不是 Loop 子任务 bridge 的验收范围。

## 验证计划

- 最小相关验证：Loop 进度快照提取/去重/父子路由/生命周期。
- 单元自测命令：来源记录包含 Loop runner/lifecycle、OpenCode monitor/command runner、subagent progress、final conclusion 测试的合并运行结果；不将总数伪称为某个拆分计划独占结果。
- 扩展验证：原记录 `npm run build`、相关 Node tests 和 `git diff --check` 均报告通过；OpenCode attach 冒烟归 bugfix 计划。原计划也提及 VSIX 强制安装，但未给出命令细节，本拆分不据此新增版本或发布断言。

## 测试与清单同步

- 单元测试新增/更新：新增 `loopSubtaskProgress.test.ts`；更新通用子代理、OpenCode monitor 与 command runner 回归，覆盖主 tab 接线、快照过滤、生命周期、serve 启动、运行时 overlay 清理、健康检查、attach 参数和重连退避。
- 单元自测结果：`npm run build` 通过；10 个相关测试文件共 100/100 通过；`git diff --check` 通过。
- 失败处理记录：首轮仅有新测试回调变量被 TypeScript 推断为 `never`，归类为测试夹具类型问题，改为回调数组后重跑通过。真实 CLI 冒烟确认 `/global/health` 与 `run --attach` JSONL 传输可用；手工服务未注入插件私有配置环境，模型请求返回 OpenCode `UnknownError`，未将其误判为 attach 传输失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：来源记载已同步 CLI runtime reference、VS Code runtime 设计、能力规格和 PITFALLS；详见 [文档计划](2026-07-13-docs-progress-monitor-references.md)，来源未提供逐文档差异或独立验证输出。

## 任务列表

- [x] 冻结 Loop 子任务进度源、父气泡路由和生命周期契约。
- [x] 实现 Loop 主 tab 即时状态气泡与每秒可见消息快照同步。
- [x] 实现 Loop 主 tab 即时状态气泡与每秒可见消息快照同步。
- [x] 完成 Loop 进度桥接相关测试、构建及父答复隔离检查（原计划合并记录；拆分后不声称全部结果仅属于本计划）。
- [x] OpenCode 监控修复和事实来源文档移至关联计划；保留原归档状态与共同证据边界。

## 决策记录

- 2026-07-13：运行日志显示 `run --port 57925` 后端口持续拒绝连接，不能继续把 CLI 参数存在视为服务可用。
- 2026-07-13：Loop 子任务是插件拥有的独立进程，应直接复用插件消息流和持久化状态，不伪装成 OpenCode 内部 child session。
- 2026-07-13：OpenCode 内部子代理改用受管 `serve + /global/health + run --attach`；启动失败时降级为普通父任务，不因观测能力阻断任务执行。
- 2026-07-13：Loop 主气泡只同步非 thinking、非内部子代理的 assistant 文本；工具输入和 reasoning 继续只留在子任务 tab，避免敏感内容扩散。

## 当前结论

Loop 子任务现在启动即在主对话显示独立进度气泡，并每秒从子 tab 权威消息存储同步可见 assistant 快照。原计划报告构建、10 个相关测试文件共 100/100、差异检查通过；还报告真实 attach 传输和 VSIX 强制安装，但没有逐项命令/退出码，故该合并记录不能单独证明具体发布版本或安装范围。OpenCode 监控行为已移至 [bugfix 计划](2026-07-13-bugfix-opencode-progress-monitor.md)，文档同步已移至 [文档计划](2026-07-13-docs-progress-monitor-references.md)。当前窗口需重载后才会使用新 Extension Host，重载前已运行旧任务不会被新逻辑追溯接管。
