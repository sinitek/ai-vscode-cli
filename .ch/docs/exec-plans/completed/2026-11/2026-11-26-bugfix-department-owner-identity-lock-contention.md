# 产研部任务持久化、停机交接与 Tab 关页诊断修复

- 日期：2026-11-26
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

2026-11-25 的 Loop+ 产研部任务在轮次追加时未确认持久化，随后群聊读取无法取得受控任务记录，组织快照仍保留组长 running。普通 Loop 任务更新对共享 `transaction.lock` 有限等待并重试；部门 Owner 写入此前没有相同处理，提交失败会封闭仓储。另有历史事件明确记录 `owner-route-inactive`：扩展停机在停止 Loop 执行前同步关闭 Owner 路由，使运行中任务的收尾写入失败。

## 目标

- 部门 Owner 写入对已确认的共享身份事务锁争用进行与普通更新一致的有界重试。
- 扩展停机先阻止新任务并请求停止、等待部门运行排空，再关闭 Owner 路由。
- 继续对锁超时及所有非争用错误 fail closed，不清理或接管未知锁。
- 记录重试结果和 Owner 路由失败原因，支持按 task ID 串联 Loop 追加、更新、读取与群聊操作。
- 记录所有会话 Tab 关页请求、拒绝原因和宿主确认移除结果；未解析出 Loop 身份时仍保留记录，便于发现元数据缺失。
- 用回归测试覆盖短暂争用成功和持续争用拒绝。

## 范围

- `src/loopTaskIdentityCatalog.ts` 的部门 Owner 锁争用重试与结构化日志。
- `src/extensionHost/departmentOwnedTaskRepository.ts` 与 `src/loopTaskStore.ts` 的安全路由失败诊断。
- `src/extensionHost/departmentruntimecomposition.ts` 与 `src/extension.ts` 的异步停机排空顺序。
- `src/test/extensionHost/departmentProductionTaskStore.test.ts` 回归覆盖。
- `src/test/extensionHost/extensionDeactivateStopAll.test.ts` 停机顺序回归覆盖。
- `src/extensionHost/sessionTabs.ts`、`src/test/session/sessionTabCliSwitch.test.ts` 的 Loop Tab 关页诊断与回归。
- 更新对应设计/排障文档，并检查 ontology 与功能清单同步需要。

## 非目标

- 不自动清除 stale lock、不重建损坏身份目录、不推断或接管未知 Owner。
- 不把不可用任务当作普通 Loop 任务读取。
- 不自动把没有真实执行证据的历史 running 任务标记为完成。
- 不修改用户运行数据或本地事故日志。

## 验收标准

- [x] 已持有共享事务锁时，部门 Owner 提交等待并在锁释放后成功，仓储仍可读写。
- [x] 锁持续超过有界窗口时，提交明确拒绝且不删除未知锁。
- [x] 停机请求停止部门运行并等待其排空后，才关闭部门 Owner 路由；未确认时保留 Owner marker。
- [x] 非锁争用提交失败不触发重试。
- [x] 诊断日志包含 task ID、操作、有限原因类别及锁重试结果，不包含任务正文、会话或路径。
- [x] 所有 Tab 关页日志可区分请求、拒绝/跳过与确认移除；未识别 Loop 身份的关页仍保留诊断。
- [x] 定向回归测试与排除无关阻断文件后的全量 TypeScript 编译通过；已记录标准构建的工作区外部阻断。

## 影响面

- 代码目录：`src/loopTaskIdentityCatalog.ts`、`src/loopTaskStore.ts`、`src/extensionHost/departmentOwnedTaskRepository.ts`、`src/extensionHost/departmentruntimecomposition.ts`、`src/extensionHost/sessionTabs.ts`、`src/extension.ts`
- 文档目录：Loop 群聊状态边界、Loop+ 排障 runbook、ontology
- 配置与脚本：无

## 风险与缓解

- 风险：将非锁错误误判为争用会重复执行提交。
- 缓解：只在 `open(transaction.lock)` 返回 `EEXIST` 时重试，并且仅在部门 Owner 提交路径启用；锁等待最多 100ms、最多三次重试，不自动清锁。
- 风险：诊断泄露运行内容。
- 缓解：只记录 task ID、操作名、固定原因枚举、重试次数与耗时。

## 验证计划

- 最小相关验证：生产存储共享锁争用及扩展停机顺序回归。
- 单元自测命令：`./node_modules/.bin/tsc -p .tmp/tsconfig.verify-owner-tab-20261126.json --pretty false`；随后运行 `node --test dist/test/session/sessionTabCliSwitch.test.js dist/test/extensionHost/departmentProductionTaskStore.test.js dist/test/extensionHost/extensionDeactivateStopAll.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试新增/更新：对生产部门任务存储注入短暂及持续 `transaction.lock` 争用；断言停机排空在关闭 Owner 前完成。
- 单元自测结果：新增测试夹具的 taskRole 类型收敛为 `null` 后，首次 `npm run build` 通过；末次构建被工作区另一个未跟踪测试 `src/test/extensionHost/loopplusprotocolpausecontinuation.test.ts` 的两处 TS2352 阻断。隔离 tsconfig 只排除该文件后，全量 TypeScript 编译通过；上述定向测试 56/56 通过；ontology 校验通过（208 条规则），ontology 单测 9/9 通过；本次文件空白校验通过。
- 失败处理记录：未修改该未跟踪测试文件，避免侵入工作区其他改动；标准全量构建当前仍需该文件所有者修正类型断言后重跑。
- 功能清单：不新增用户能力、不改变群聊或关页行为，仅增加常驻诊断，因此无需更新功能清单。
- 相关文档同步：更新部门 Owner 写入/停机边界与 Loop+ 主 Tab 消失排查步骤，新增 ontology 关页诊断规则。

## 任务列表

- [x] 核对并实现 Owner 共享锁有界重试。
- [x] 修复停机期间 Owner 路由过早关闭。
- [x] 补充 Owner 路由失败原因与锁争用结果日志。
- [x] 增加争用成功/超时及停机排空的回归测试。
- [x] 为 Loop Tab 关页补充常驻诊断事件与拒绝/移除断言。
- [x] 更新设计文档、runbook 与 ontology，运行定向测试和构建。

## 决策记录

- 2026-11-26：只重试可确认的 `EEXIST` 共享锁争用，不把损坏目录、写入失败或未知锁当作可恢复状态。
- 2026-11-26：停机期间保留 Owner 写路由，直到部门运行完成停止/排空；不以 marker 释放冒充真实执行结束。
- 2026-11-26：所有 Tab 关页仅追加诊断，不放宽活动运行及主任务关页锁；常驻日志只记录任务/标签标识和固定结果原因，不记录会话或对话内容。

## 当前结论

当前修复 Owner 提交锁争用与停机路由过早撤销两个已确认缺陷，并增加所有会话 Tab 关页常驻诊断。源码调用链显示普通/Loop+ 主任务 Tab 在运行时受宿主关页锁保护，子任务自动清理按任务/子任务/attempt 身份筛选；本次未发现无条件自动移除主任务 Tab 的路径。历史 Tab 消失事件缺少当时关页日志，不能追溯断言具体移除者；新事件 `conversation-tab-close` 可区分宿主请求、拒绝及实际移除，且在 Loop 身份未解析时仍记录，应在下一次复现时按 `tabId`、可用的 `loopTaskId` 和时间顺序核对。2026-11-25 13:27 的首次提交失败没有保留内部原因，不能断言历史那次一定由锁争用触发；9:51 的另一任务明确记录 `owner-route-inactive`，与停机顺序缺陷吻合。
