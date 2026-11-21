# 产研部任务身份目录短时竞争

- 日期：2026-11-20
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-20-bugfix-department-callback-diagnostics.md` 提供拒绝原因观测
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-20
- claim_ttl：本轮任务结束
- handoff_to：无

## 背景与目标

本机日志在 15:34:14 UTC 的会话持久化和 15:35:49 UTC 的通知回调分别记录 `leader-task-unavailable`、`root-task-unavailable`；两条对应记录事后均能在受控来源找到。共享身份目录的写锁可让原宿主对仍存在的任务读到不可用，旧日志无法回溯失败瞬间的锁状态。用隔离的真实并发事务验证此机制，并修复可证实的竞争。

## 范围与非目标

- 对共享任务身份目录权威查询增加最多 100ms 的短锁等待；锁释放后重新读取完整快照并复核锁。
- 持续占用、未提交、损坏或身份冲突仍拒绝；不删锁、不接管、不重放组长调用或回调。
- 不改变 Owner、代次、执行清理、容量归还、任务保留期或回调协议；不修复或重启历史任务。

## 验收标准

- [x] 受控任务读取遇到短时共享事务竞争时，在有界预算内等原写者完成，再执行原校验。
- [x] 持续占用、未提交、损坏或身份冲突时仍拒绝；不删锁、不接管、不重放组长调用或回调。
- [x] 使用隔离目录复现旧实现失败并验证修复；运行构建、相关存储及组长测试。

## 影响面

- 代码：`src/loopTaskIdentityCatalog.ts`；生产受控任务路由回归 `src/test/extensionHost/departmentProductionTaskStore.test.ts`。
- 文档：部门任务仓储设计、`local-development.md` 排障手册、功能清单与 `cli-plugin-runtime` ontology。
- 运行数据：仅只读检查本机日志和任务快照；验证使用隔离临时 HOME，不改本机任务、Owner、锁或容量。

## 风险与缓解

- 风险：等待会同步阻塞 Extension Host 线程。
- 缓解：仅对身份目录锁等待，最多 100ms；持续锁或其它异常仍 fail closed，且不执行恢复操作。

## 验证计划

- 最小相关验证：`npm run build`。
- 单元自测命令：`node --test dist/test/extensionHost/departmentProductionTaskStore.test.js dist/test/loop/loopTaskStorePersistence.test.js dist/test/extensionHost/departmentinteractiveruntime.test.js`。
- 文档验证：ontology validate 与 ontology 单测；`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：生产受控任务路由短锁释放/持续占锁回归。
- 单元自测结果：构建通过；相关 73 项通过；ontology 验证通过，ontology 测试 9/9；`git diff --check` 通过。
- 失败处理记录：初始旧实现隔离复现得到短锁期间读取/更新均返回失败；隔离清理进程在一次尝试 close 时碰到预期 owner 仍存活的错误，测试隔离目录随即删除，未触及真实任务。修复后生产路由回归通过。
- 功能清单：已追加短时身份目录竞争行为和拒绝边界。
- 相关文档同步：仓储设计、排障 runbook、ontology 已更新。

## 任务列表

- [x] 核对本机日志与受控任务记录，定位身份目录权威读取路径。
- [x] 在隔离 HOME 复现短锁导致任务读取和更新拒绝，增加有界等待和生产路由回归。
- [x] 构建、运行 73 项相关测试及 ontology/差异校验，并同步事实来源文档。

## 决策记录

- 2026-11-20：日志中的 `leader-task-unavailable` 与 `root-task-unavailable` 对应记录后来仍存在于受控来源；producer 通过普通任务读取接口最终进入共享身份目录查找，而该查找原先遇到任意事务锁立即返回不可用。
- 2026-11-20：隔离 HOME 持有共享锁时，旧实现确定复现任务读取与更新同时失败；修复将读取等待限制为 100ms，锁释放后重新读目录，持续未知锁不清除且继续拒绝。
- 2026-11-20：历史日志未记录失败瞬间的 `transaction.lock` 状态，因此可确认失败机制能复现，但不能断言那两条历史错误一定由当时并发锁触发。近期调度并发变化可能提高竞争概率，需区分因果证据。

## 当前结论

实现和定向回归完成。`npm run build`、存储及组长相关 73 项测试、ontology validate、ontology 9 项单测和 `git diff --check` 均通过。未运行完整 `npm run test:unit`、Windows 或真实 Extension Host 任务；历史任务未被接管或重试。
