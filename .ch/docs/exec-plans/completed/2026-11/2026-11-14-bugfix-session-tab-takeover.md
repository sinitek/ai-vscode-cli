# 同会话标签自动接管

- 日期：2026-11-14
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-14-bugfix-loop-plus-resume-settlement.md`（沿用现有 Loop 续接与收口修复）
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop / Loop+ 续接已有会话时可能新建 Tab，旧 Tab 仍持有同一会话。现有交互宿主以 SESSION_RUN_ACTIVE 拒绝执行。改为启动时自动停止旧任务并关闭重复 Tab，同一 CLI 会话同时仅由目标 Tab 使用。

## 范围与非目标

覆盖公共执行入口、交互宿主末端所有权检查、运行中及空闲重复标签、取消与迟到回调。复用既有停止和关闭能力，不删除会话历史，不更改 CLI 写锁协议、框架或依赖。保留工作区已有修改，直接在当前工作区延续修复。

## 验收标准

- 新标签启动同一 CLI/session 时先停止并关闭旧标签，继续本次执行。
- 空闲重复标签同样关闭；不同会话、不同 CLI 不受影响。
- 同标签重复调用保持保护；取消或已关闭目标不得迟到启动。
- 停止/关闭失败不得继续启动造成并行写入，旧回调不得覆盖新调用。

## 影响面与风险

- 代码：`src/extension.ts`、`src/extensionHost/promptInteractiveRuntime.ts`、`src/extensionHost/sessionTabOwnership.ts`、`src/extensionHost/interactiveTurnClaude.ts`、统一检测测试清单及相关测试。
- 文档：运行时设计、Loop 会话复用设计、功能清单与 ontology。
- 风险：异步准备竞争、Loop 调度取消传播和旧调用迟到；以身份复核、现有取消及底层 CLI 写锁缓解。

## 验证计划

- `npm run build`。
- 最小接管、交互宿主、标签关闭、Loop / Loop+ 回归。
- `npm run verify:loop-plus` 验证隔离本机 CLI 所有权与交接；不使用用户运行数据。
- ontology validate 与 skill 单测、`git diff --check`。

## 测试与清单同步

- 新增/更新回归：运行中与空闲接管、并发准备、取消、失败和 CLI/session 隔离。
- 单元自测结果：接管专项初次 50/50 通过；扩大最小范围最终 153/153 通过；修正夹具类型后统一检测重新构建成功，811/811 回归通过，无跳过或取消。
- 实际命令：`npm run build`；`node --test dist/test/extensionHost/sessionTabOwnership.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/session/sessionTabCliSwitch.test.js`；`npm run verify:loop-plus`。
- 失败分流：第一次扩大检测中 63 项失败，62 项源于 VM 抽取函数夹具缺少新接管依赖，1 项源于嵌套路由结构导致原有源码断言过期；夹具注入真实接管模块，生产路由保留原结构后全部通过。新增夹具的 per-CLI 会话映射缺失及不允许 null 的类型问题均已修正；最终统一检测包含重新构建与全部回归。
- 本机隔离验证：macOS，插件配置解析到的 Codex 0.167.2，3 次 pool 交接与 1 次公共 runner 交接全部通过，同一线程恢复、其它线程保留、旧进程实际退出与临时资源清理均确认；使用隔离 HOME 和本机模拟模型，无真实模型费用。
- 验证报告：`/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-loop-plus-3718fb3c-4112-49c6-a1e5-1a232dcb03a3.json`，完整日志为同目录同名 `.log`。
- 结构校验：ontology validate 通过，ontology skill 单测 9/9 通过，`git diff --check` 通过。
- 验证边界：未在 Windows 实机或图形 Extension Development Host 手工点击；本次没有修改 Webview 前端，标签关闭宿主与既有 Webview 关闭回归均已执行。不代表已安装版本已更新。
- 功能清单、运行时设计、Loop 会话复用设计与 ontology：均已同步。
- 记忆召回：focus 为 Loop Loop+ 会话 标签 session ownership cancel tab，anchor 为空；热区为占位，采用设计与当前代码核对事实。

## 任务列表

- [x] 核对现有会话所有权、停止与关页流程。
- [x] 实现接管并补充回归。
- [x] 构建与本机隔离验证。
- [x] 同步文档并归档。

## 决策记录

- 2026-11-14：按用户明确要求，将跨标签活跃会话拒绝改为自动接管；原同标签防重入和底层写锁保留。关闭重复 Tab 不删除会话历史。
- 2026-11-14：接管检查同时读取标签和实际运行绑定，防止持久标签状态落后于 runner；公共入口为所有运行时提供工作区/目标对象取消保护，交互宿主在异步准备前后复核。Claude 迟到任务列表回调增加所属运行检查。

## 收尾

源码与当前平台隔离运行时验收完成。稳定规则已进入设计、功能清单与 ontology，无需另写热区记忆或重复事件摘要。沿用既有停止与标签关闭协议，无依赖、CLI 进程锁或持久会话格式变更。
