# Loop+ attempt identity handoff

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：[Loop+ 冻结验收批次](2026-11-15-perf-loop-plus-frozen-review-batch.md)；共同交付用户所选第 3、4 项优化。本计划负责 attempt 生命周期，关联计划负责冻结验收与群聊投影；共用集成证据及最终 Git 收尾，各自维护验收和真实状态。
- 状态：in-progress
- 负责人：Codex
- owner：loop-plus-attempt-identity
- claimed_at：2026-11-15
- claim_ttl：本轮执行
- handoff_to：Git 交付与计划归档

## 背景

修复前，Loop+ 宿主已为每次子任务执行分配唯一 `attemptId`，但执行输入、运行历史和聊天消息缺少它，重叠重试只能靠 prompt、round、subtask 与时间窗口猜测归属。当前身份基础设施与生命周期接线已落地，剩余门禁见下文。

## 目标

将宿主分配的身份贯穿实际执行、完成记录、用户/助手消息和手动续接上下文；明确身份参与查询时必须严格匹配。

## 范围

- 增加可选 `loopAttemptId` 到 PromptRunInput、TaskRunDraft/Record、ChatMessage，并保留历史归一化及消息存储字段。
- 默认支持的交互 CLI 路径也必须将输入身份写入 thinking/助手/subagent 消息和终态运行记录；身份仅来自 `PromptRunInput.loopAttemptId`。
- Loop+ adapter 显式映射 `request.attemptId`，订阅与扫描共享同一严格候选判定。
- 从最近有效子任务消息解析 `attemptId`，传入手动续接输入及有需要的记录查询。
- 将可选身份接入手动续接通知、冷恢复与唤醒前查询，以及完成/停止/reprompt 的自动压缩和 Tab 清理；完成结果持久化后才放行对应收尾。
- 更新会话复用设计约定并添加身份隔离回归。

## 非目标

- 不调整调度策略、验收冻结/FIFO、冲突策略、持久化容错或全量历史迁移；classic Loop 与旧无身份调用继续兼容。

## 验收标准

- [x] 明确 attemptId 时，缺失或错误身份的运行/消息不命中；重叠尝试严格隔离。
- [x] 订阅完成事件和事后扫描用一致的身份判定，原有时间、状态、去重边界保留。
- [x] run/message 序列化、归一化、上下文解析及续接输入保留身份；旧记录/classic 流兼容。
- [x] 手动续接通知在现有回调参数后携带可选身份；明确身份在冷恢复与完成前严格匹配开放 reservation。
- [x] 完成、停止、reprompt 控制清理的自动压缩和标签清理按对应 attempt 结算；迟到、重复及替代 attempt 通知被隔离。
- [x] `npm run build` 与最小相关 node:test 通过，或在报告中按类别记录失败/未覆盖。
- [x] round-16 保留式同步共享功能清单、ontology、会话设计和阶段计划，保留稳定 ID 与冻结契约。
- [x] 真实 Extension Development Host 身份组合检查通过并获主审接受，覆盖范围见下文。
- [x] 全量测试已执行，原 46 项失败分别修复、定向验证并获主审接受；保留原失败统计，不宣称重跑全量全绿。
- [x] round-24 五份文档最终差异已获主任务审阅接受。
- [ ] Git 提交推送；完成后更新实际结果、状态、归档和引用。

## 影响面

- 代码目录：`src/` execution adapter、one-shot/interactive runtime、message/run types、续接解析、extension/host 通知、自动压缩和 Tab 清理。
- 文档目录：本设计文档、Loop 子任务会话复用设计、外部 attempt 报告。
- 配置与脚本：无。

## 风险与缓解

- 风险：身份交接跨 extension、runtime、orchestration、auto-compaction 和 Tab 清理边界。
- 缓解：现代续接从上下文传身份；宿主在冷恢复副作用前核对 reservation；完成订阅与事后扫描继续共享 identity selector，并以跨模块受控 Promise 回归确认顺序。
- 风险：共享 dist 被并发验证清理。
- 缓解：构建及 dist 测试必须在指定临时目录锁内串行执行。

## 验证计划

- 最小相关验证：`npm run build` 后 `node --test` 执行 Loop+ orchestration、runtime integration 与 attempt-scoped Tab cleanup 测试；此前身份字段和交互 runtime 的通过结果按原报告引用。
- 单元自测命令：遵循 `.ch/docs/TESTING.md` 的 Node 内置测试流程；禁止运行发布脚本。
- 前序生命周期组合阶段以 adapter/host/runtime 可控 Promise 回归为主；早期宿主启动失败及后续真实宿主补验通过分别保留在下方。已有有效结果直接复用，本轮只检查更新的文档状态与引用。

## 测试与清单同步

- 单元测试新增/更新：attempt identity selector、持久化归一化和续接上下文测试；交互 runtime 的助手/thinking/subagent/终态记录身份透传测试；扩展既有 runtime fixture。
- 单元自测结果：`npm run build` 成功；5 个编译后 Node 测试文件共 119 项通过。
- 失败处理记录：第一次 build 发现 hidden-retry trace options 类型不接受新增字段，移除此非归属字段后通过；第一次相关测试因 legacy 手动续接对象多出 `loopAttemptId: undefined` 有 1 项断言失败，改为仅在身份存在时写入，复验 119/119 通过。
- 交互路径补修：Code review 发现 `isInteractiveSupported` 进入 `promptInteractiveRuntime` 后未写入身份；本轮补上助手、thinking/subagent 消息元数据和终态 `TaskRunRecord`，并增加 host 与 adapter 严格选择回归。
- 本轮验证：持有 `/tmp/sinitek-loop-plus-msg_1794684101461_8c456617d055-verification.lock` 目录锁，依次执行 `npm run build`（通过）及 `node --test dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`（97/97 通过，0 失败、0 跳过）。覆盖交互输入身份至成功助手/thinking/subagent 消息和终态记录、adapter 身份严格匹配及无身份旧路径兼容；该交互阶段未执行真实 CLI，当时停止/reprompt/通知/自动压缩交接尚待后续；现已落地的接线及相关单测见下文生命周期阶段，不据此推导真实宿主已通过。
- 本轮生命周期交接：`notifySubtaskContinuation` 在 `onCompleted` 后新增可选 `attemptId`；仅当调用方显式提供身份时，才要求它与开放 reservation 匹配，冷恢复在状态写入前拒绝不匹配身份。未提供身份的旧调用保留既有兼容行为，不补猜身份。extension 从解析的消息/run 传入身份；唤醒前运行查询也按身份过滤。运行完成/控制退役给 auto-compaction 传相同身份，受控关页按 attempt 过滤。
- 生命周期回归：覆盖冷 host 的旧身份拒绝/匹配身份验收、已中断 reservation 的错身份与重复通知、带 attempt 身份的压缩提交，以及旧 attempt 不关闭替代 Tab。实际命令与计数见下文生命周期阶段验证。
- 生命周期阶段验证：持有原子目录锁 `/tmp/sinitek-loop-plus-msg_1794684101461_8c456617d055-verification.lock` 串行执行 `npm run build`（通过）及 `node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/session/sessionTabCliSwitch.test.js`（186/186 通过，0 失败、0 取消、0 跳过）。首次运行为 183 通过、3 超时；失败归因为现有 Loop+ compaction fixture 未填写 `loopAttemptId`，严格通知无法启动该夹具 flight。为 fixture 补入实际 request 身份后重跑通过，未放宽源码匹配。最终验证后仅编辑计划与沟通报告文档。
- 压缩库阶段验证（round-12-loop-plus-compaction-attempt-isolation.md）：持锁 `npm run build` 通过，`node --test dist/test/loop/loopSubtaskAutoCompact.test.js` 为 14/14 通过、0 失败/跳过；覆盖 defer 身份快照、过期/缺失/重复通知、无身份旧 pending、同会话串行及独立会话推进。库单测不替代宿主端到端验证。
- 入口路由验收补充：上一轮 186 项结果不包含 `loopPlusEntryRouting.test.js`；本轮发现旧断言仍要求 `closeSubtaskTabs` 两参数接线。生产代码已将 `attemptId` 传至 `closeLoopSubtaskTabs`，手动续接也在原 `onCompleted` 回调之后传 `context.attemptId`；本轮更新回归断言验证这两项接线及参数顺序。保留上一轮 186 项有效结果，本轮只重跑入口路由测试。
- 本轮入口验证：持有原子目录锁 `/tmp/sinitek-loop-plus-msg_1794684101461_8c456617d055-verification.lock` 串行执行 `npm run build`（通过）及 `node --test dist/test/extensionHost/loopPlusEntryRouting.test.js`（2/2 通过，0 失败/跳过）。首次运行新增断言因切片字符串不匹配而失败；修正为在整份源码中检查续接通知、`onCompleted` 回调和 `context.attemptId` 的顺序后通过。此后只改文档和沟通报告。
- 早期 Extension Development Host 检查（历史失败）：按本地开发手册尝试使用 app CLI `code --version`（1.144.0，arm64）并隔离启动；`open -na "/Applications/Visual Studio Code.app" --args ...` 返回 0，但未创建 user-data 目录/日志或 host 进程。直接运行 `Contents/MacOS/Code --new-window ...` 退出 9，输出该 app binary 对 `--new-window`、`--extensionDevelopmentPath`、`--user-data-dir` 等参数均为 `bad option`。该阶段未能启动，未计作通过；后续排除 `ELECTRON_RUN_AS_NODE=1` 干扰并完成产物对齐后的结果见下节。
- 当前真实宿主结果：`round-17-repair-loop-plus-host-artifact-alignment.md` 已通过并获主审接受。VS Code 1.144.0 arm64 激活、命令注册及 openPanel 成功，源码与正确大小写的编译产物对齐；冷宿主拒绝显式旧 attempt，零状态写入并保留替代 reservation。匹配完成先持久化，再压缩和清理；重复通知不重复提交或清理，实际调用生产 Tab 关闭守卫并保留替代 attempt 的 Tab。最终启动器退出 0、`harnessCompleted:true`，自建资源已清理；不等于 GUI 自然退出或所有 UI、真实 CLI、平台及调度交错已验证。
- 并发所有权：`src/loopSubtaskAutoCompact.ts` 的身份过滤接口由并行压缩任务维护；读取确认其现有末尾参数为可选 `attemptId`，本轮只按该接口接入调用点，未修改库实现。共享 ontology 与 `FEATURE_INVENTORY.md` 已由 round-16 文档任务保留式同步，最终审阅仍归根任务。
- 功能清单：round-12 记录身份基础设施；round-16 同步生命周期接线与相关单测；round-24 更新真实宿主和全量失败修复闭环，保留文档最终审阅与 Git 尚未完成的边界。
- 相关文档同步：更新 Loop 子任务会话复用设计中的身份契约和后续交接边界。

## 全量执行与失败修复闭环（round-24 收口）

原 `round-16-loop-plus-final-full-tests.md` 的有效 `npm run test:unit` 已执行：构建通过，Node 共 4,221 项，4,172 通过、46 失败、3 跳过；Python 全量为 88 通过、1 跳过。保留这次真实失败统计。随后六项修复均由主审接受，定向结果如下；不累加重叠套件，也不将它们拼成一次新的全量全绿运行。

| 原失败范围 | 原失败数 | 已接受的修复与定向结果 | 来源报告 |
| --- | --- | --- | --- |
| Webview VM | 2 | 提取真实 retention 依赖闭包；3 项通过 | `round-23-repair-loop-plus-webview-vm-fixture.md` |
| 执行计划契约 | 3 | 两套 harness 精确四类与排除规则；7 项通过 | `round-23-repair-execution-plan-contract-tests.md` |
| 四套交互 Tab 夹具 | 32 | 稳定 Tab 对象与 adoption，保留准备期保护；58 通过、1 个既有 live 跳过，包含新增七项准备期保护回归 | `round-23-repair-interactive-tab-test-fixtures.md` |
| Codex 压缩/修补组合 | 5 | 修正压缩未结束即要求 A Tab 关闭的旧断言，保留 B 实际启动的压缩门禁及 writer 释放边界；5 项通过 | `round-23-repair-loop-plus-codex-combination-tests.md` |
| 完成事件 VM | 3 | 补可观察完成事件端口，验证真实持久化失败分支；5 项通过 | `round-23-repair-task-completion-vm-fixture.md` |
| DSH skill socket | 1 | 短路径真实 socket 触达安装拒绝、脱敏、回滚和清理；17 通过、0 跳过 | `round-23-repair-dsh-skill-socket-fixture.md` |

原 46 项失败均已闭环。socket 轮最后一次 `npm run build` 覆盖此前全部源码及测试修复，其后没有源码修改；本轮仅同步文档，不重跑构建、Node、Python 全量或宿主。生命周期 186/186、压缩库 14/14、入口路由 2/2，以及关联冻结计划的 238/34 项仍各按原范围复用。

原 Node 三项 opt-in DSH live 跳过及 Python 一项 Windows cmd 跳过仍保留；四套 Tab 验证中的一个 live skip 与原全量范围重叠，不增加为第四个跳过。真实宿主身份检查使用生产通知、持久化、压缩编排与 Tab 守卫及最小 Tab 夹具，不代替完整 Webview/浏览器、真实 CLI/付费模型或 Windows/Linux 实机验证。

## 任务列表

- [x] 核对 CodeGraph 调用链、记忆/ontology 可用边界及现存会话设计。
- [x] 贯通运行、消息、适配器选择和续接输入身份。
- [x] 添加最小回归并串行构建/运行测试。
- [x] 完成身份及宿主交接实施与相关受控 Promise 单测；不计作真实 Extension Development Host 验证。
- [x] round-16 完成共享文档保留式同步。
- [x] 真实宿主身份组合补验通过并获主审接受。
- [x] 执行全量测试并完成原 46 项失败的定向修复与主审。
- [x] 主任务最终审阅 round-24 文档并接受。
- [ ] 明确暂存已审阅内容，检查暂存差异，提交推送并核对远端。
- [ ] Git 收尾时按真实完成情况标记 completed，归档至 `completed/2026-11/`，同步双方互链及仓库引用并检查目标存在；本轮不提前移动计划。

## 决策记录

- 2026-11-15：`attemptId` 唯一来源为宿主 `request.attemptId`；持久化字段统一命名 `loopAttemptId`，查询/续接上下文使用 `attemptId`。
- 2026-11-15：身份缺失和错误仅在调用方明确给出 attemptId 时拒绝；无身份的旧查询保留既有匹配路径。

## 当前结论

身份字段及停止/reprompt/手动续接通知/自动压缩的生产交接已落地。显式身份严格匹配、旧无身份兼容、完成持久化后收尾及替代 attempt 隔离契约不变；相关单测与已接受的真实宿主身份检查各按上述范围有效。全量测试已执行，原 46 项失败已逐项修复、定向验证并获主审接受，原全量失败统计保留；最新 socket 轮构建覆盖全部源码修复，不宣称另有一次全量全绿运行。round-24 五份文档的最终差异已获主任务审阅接受，生产、测试与宿主验证交付亦已审阅。round-25 将明确暂存这些已审阅内容，检查暂存差异后提交并正常推送现有上游；Git 交付尚待执行。计划暂保持 `in-progress`，远端确认实施提交后再记录实际结果、按 `completed/2026-11/` 归档并同步引用。
