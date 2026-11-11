# Loop / Loop+ 子任务完成标签清理

- 日期：2026-11-11
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈 Loop / Loop+ 子任务完成后经常残留标签，并提示可能与停止后重新启动有关。追踪自动完成、手动继续、父任务恢复和关闭锁，修复同一子任务重新派发后旧标签残留的问题。

## 范围与非目标

- 范围：子任务标签的创建、重新派发、完成清理及相关回归测试。
- 非目标：修改调度策略、验收门槛、CLI 协议或用户会话保留策略；不发布扩展。

## 验收标准

- 普通完成和停止后继续完成均自动清理对应子任务标签。
- 停止或失败时保留可继续的标签；不关闭主任务、普通对话或仍在执行的标签。
- 清理标签不删除真实 CLI 会话或聊天记录，跨 CLI 行为一致。
- 相关回归测试、构建、文档及本体校验通过。

## 影响面与风险

- 代码：`src/extension.ts`、`src/extensionHost/loopSubtaskTabs.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/loopPlusOrchestration.ts` 及子任务标签相关测试；既有生命周期模块保持不变。
- 文档：功能清单、子会话复用设计、必要的 ontology 规则。
- 风险：误关仍在执行或不同子任务标签；以任务身份和运行锁约束，补隔离回归。
- 回滚：撤回本次聚焦改动，不改变持久化结构。

## 验证计划

- 最小相关验证：用真实标签控制器和宿主复现停止、重新派发与完成。
- 单元自测：`npm run build` 后运行标签宿主、子任务生命周期、Loop+ 运行时相关测试。
- 扩展验证：检查本机日志中是否有可用生命周期事件；不向仓库写入私有日志或任务内容。
- 本机日志未提供自动关页或手动继续事件，不能仅靠日志确认具体用户任务。

## 任务列表

Tasklist:
- [completed] 复现停止后重新派发的标签残留
- [completed] 修复并验证完成清理与隔离边界
- [completed] 同步文档并归档验证结论

## 测试与清单同步

- 回归证据：改动前新增“先普通停止、随后要求关页”的结算前、结算后两条测试均因旧 Tab 未关闭失败；修复后两条通过。
- 新增覆盖：真实标签控制器/宿主的旧 Tab 清理、跨 CLI 与任务隔离、停止和失败保留、运行锁、快照中新出现的替代 Tab、旧 attempt 不误关尚在等待启动的新 Tab、空元数据及关闭失败。
- 主模型链路：验证真实 adapter + orchestration 的中断 → `controls.reprompt` → 旧 Tab 关闭 → 原 CLI 会话续接 → 新 attempt 完成 → 新 Tab 关闭 → 父任务完成；恢复后缺少旧句柄仍触发对应子任务清理。
- `npm run build`：通过。
- 相关 Node 回归：287 项通过，覆盖子任务生命周期、自动压缩、会话复用、标签宿主、手动继续、Loop+ adapter/wiring/entry/orchestration、任务状态机、决策解析和跨 CLI 派发。
- `node scripts/run_unit_tests.js`：3753 项，3743 通过、7 失败、3 跳过。失败不属于本次新增回归。
- 基线对照：将修改前 `HEAD=e41004e0` 用 `git archive HEAD` 导出到系统临时目录、复用已安装依赖、独立构建后执行同一批失败文件；同样 35 项中 28 通过、7 失败，失败用例名称完全一致。
- 历史失败分类：`loopPlusGroupChatPanel.test.ts` 4 项旧页面计数/验收文案断言不匹配；`looppluswebviewintegration.test.ts` 2 项既有 VM 夹具缺少 `retainChatBubbleEntries`。均未修改这些页面代码或测试。
- 环境失败分类：`cliGlobalSkills.test.ts` 1 项在 macOS 默认长临时目录下创建 Unix socket 报 `listen EINVAL`；`TMPDIR=/tmp node --test dist/test/config/cliGlobalSkills.test.js` 的 17 项全部通过。不改动无关测试。
- 夹具修正：首次新增标签测试构建因缺少必填 `sessionIdByCli` 失败，补齐夹具后构建及回归通过，不涉及生产接口变化。
- 本体：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；本体脚本单测 9 项通过。
- 空白：`git diff --check` 与改动范围的 `check_trailing_whitespace.js` 通过。
- 文档：已同步功能清单、中断后会话复用设计、Loop+ 调度边界、现有控制关页 PITFALLS 及两条 ontology 规则。
- 本机验证边界：检查本机最近日志，没有足以还原用户任务的自动关页或手动继续事件；未修改本机运行数据，未发起收费 CLI 任务，未启动图形 Extension Development Host 做点击验收。实际 VS Code 重载后的页面交互仍需人工确认。
- 记忆判断：可复用原因与规避已进入现有 PITFALLS 和设计事实来源，不重复写入 EVENT_MEMORY，不更新 ROLLING_SUMMARY。
- 并行工作边界：收尾时工作区另外出现群聊气泡保留逻辑、群聊页面及其测试的并行修改和对应 active plan，均未由本次任务修改、覆盖或回退；上述验证结果对应本次修复验证时的代码快照，不将其它会话后续改动纳入本次交付声明。

## 修复结论

- adapter 将关页要求与进程中止状态分离，允许停止后升级为 `closeTab: true`，并以缓存 Promise 保证关页幂等；停止结果结算前后都生效。
- 主模型控制恢复后的旧 attempt 时，即使没有运行句柄，仍通过宿主按父任务和子任务身份清理旧闲置 Tab。
- 经典 Loop、Loop+ 自动完成及手动继续完成共用清理入口，处理同一子任务当前及更早的闲置标签；运行中标签、更新的替代 attempt、其它任务和普通对话不受影响。
- 不修改调度、验收、持久化结构或 CLI 会话保留策略；未发布扩展。

## 当前结论

已完成修复、回归、基线对照与文档同步。不存在本次范围内未解决的自动化回归；未完成真实 VS Code 图形点击验收，不将测试夹具验证当作真实 GUI 验收。
