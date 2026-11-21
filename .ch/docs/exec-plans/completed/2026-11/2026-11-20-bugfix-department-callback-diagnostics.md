# 组长回调拒绝诊断补全

- 日期：2026-11-20
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-20
- claim_ttl：本轮任务结束
- handoff_to：无

## 背景与目标

2026-11-20 的本机 Extension Host 日志确认一名 Codex 组长在已授权执行期间发生 `callback-consumer-rejected`，随后以 `leader-owner-channel-or-delivery-unknown` 失败。日志未记录被拒绝的回调名称或具体消费者异常，无法区分流事件、通知和交互请求路径。随后根任务与组长均已停止，不能把本地源码修复当成已恢复或重放原任务。

补足隐私安全的回调名称、逻辑序号及固定拒绝原因分类，并用 Owner 和 callback 协议回归验证；不猜测历史消费者异常。

## 范围与非目标

- 为 callback consumer rejection 诊断记录协议白名单内的回调名称、逻辑序号及固定错误分类；callback ACK 发送失败记录回调上下文。
- 保持 ACK 拒绝、Owner unknown、后续调用拒绝及组织容量保留语义不变。
- 不记录回调参数、异常正文、令牌或会话内容。
- 不修改或清理 `~/.sinitek_cli/` 中的任务、Owner、锁、容量和执行记录；不尝试接管或重启已停止任务。

## 验收标准

- [x] Extension Host 错误日志与 stderr 对 `callback-consumer-rejected` 记录被拒绝的回调名称。
- [x] 日志增加 `callbackSequence` 和白名单 `callbackRejectionReason`，未知异常统一脱敏为 `unknown`。
- [x] 回归测试验证不记录回调参数及异常正文，且拒绝仍保持 unknown/fail-closed。
- [x] 运行构建、最小相关测试及变更文件空白检查。
- [x] 记录原任务状态与历史根因不可回溯的边界；功能清单无需更新，ontology 诊断边界已同步。

## 影响面

- 代码目录：`src/extensionHost/departmentleadercodexbootstrap.ts`、`src/test/runtime/departmentleadercodexowner.test.ts`、`src/test/runtime/departmentleadercallbackprotocol.test.ts`
- 文档目录：本执行计划、`.ch/docs/design-docs/department-leader-native-owner.md`、`.ch/docs/runbooks/local-development.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`
- 配置与脚本：无

## 风险与缓解

- 风险：放宽 callback 拒绝会掩盖未消费的执行事件或请求。
- 缓解：不改变回调、ACK、终态、清理和容量行为，仅增加白名单名称元数据。
- 风险：日志可能泄漏用户事件内容。
- 缓解：只记录白名单 callback name、序号及固定错误码，不记录 args、异常对象、堆栈或消息。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/runtime/departmentleadercodexowner.test.js dist/test/runtime/departmentleadercallbackprotocol.test.js`
- 扩展验证：`git diff --check`；若没有本机 Extension Host 可用于新建任务，则不冒充真实运行验证。

## 测试与清单同步

- 单元测试新增/更新：更新 callback rejection 回归并覆盖 ACK send failure，断言安全诊断字段、异常脱敏和 fail-closed 行为。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/runtime/departmentleadercodexowner.test.js` 通过，32/32。
- 失败处理记录：本轮构建和相关测试无失败。
- 功能清单：无需更新；不改变用户可见能力、行为、权限或验收流程。
- Ontology：更新既有 Codex 组长回调规则中的诊断字段边界；概念、关系和权限不变。
- 相关文档同步：更新 Codex 组长 Owner 设计、日志排查入口和本计划。

## 任务列表

- [x] 核对本机日志、任务快照、执行凭证与当前状态。
- [x] 增加回调名称、序号、固定拒绝原因诊断和隐私安全回归断言。
- [x] 运行构建、相关测试和变更文件校验，记录原任务恢复边界。

## 决策记录

- 2026-11-20：日志证明回调消费者拒绝是运行失败触发点，但没有保留具体回调名称或异常正文；不从相邻清理日志推断这两种失败存在因果关系。
- 2026-11-20：只补诊断字段，不吞掉消费者异常、不确认执行清理、不改变容量归还门禁。
- 2026-11-20：按后续要求将诊断扩展到逻辑 callback 序号、固定拒绝原因及 ACK send failure 上下文；任意异常文本只归类为 `unknown`。
- 2026-11-20：`npm run build`、组长 Owner 32 项回归、`git diff --check` 与四个变更文件的尾随空白检查均通过。

## 当前结论

根任务记录为 `stopped` 且 runtime `stopping=true`；三名组长 Loop 任务记录为 `stopped`，另一名为 `needs-review`。日志另记录一名组长在 `20:54:01 +08:00` 报 `department-producer-no-live-generation`；该信号与 `20:54:14 +08:00` 的 callback consumer rejection 属于不同组长，不能据此断言因果关系。

只读检查发现失败组长的 Owner worker 进程仍存活并持有 `owner.lock` 及本地 socket。使用原 Owner client 的 `observeExecution` 返回 `unknown` / `owner-lost-or-cleanup-unverified`；持久 Owner 记录为 `cleanup-failed` 且没有 receipt。Loop 任务停止不证明原生执行已清理。本次没有向 Owner 发 stop/seal、没有杀进程、清锁、重启、接管或改写任务/容量数据；在拿到原始 Owner 的终态和完整 receipt 前，不应重试或释放此代资源。

代码只修复未来诊断缺口；原错误未记录 callback 名称、异常正文或参数，故具体 handler 根因不可追溯。未来若再次出现相同失败，可根据白名单回调名称与逻辑序号定位 handler/事件；固定错误分类帮助区分代次变化、消费者缺失和来源不可观察，其余归为 `unknown`；执行仍按原 fail-closed 合同处理。

## 2026-11-20 后续诊断字段补充

- 用户要求为下次排查再增加上下文；没有重跑、清理或接管历史任务，也没有触碰 `~/.sinitek_cli/` 运行数据。
- `department-leader-native-failed` 在 callback 失败时增加白名单 `callbackName`、逻辑 `callbackSequence`；消费者拒绝增加 `callbackRejectionReason`，只允许 `department-leader-generation-changed`、`department-leader-consumer-missing`、`department-producer-observation-scope-unavailable`、`unknown`。ACK 发送失败也带回调名和序号。
- 异常正文、堆栈、参数、prompt、凭据仍不进入诊断；ACK、unknown、后续调用拒绝和清理/容量门禁不变。
- 新增回归覆盖三种固定分类、未知异常脱敏及 ACK send failure 上下文。首次新增序号断言误按单阶段值预期 5，测试显示真实逻辑序号为全局 IPC 序号 10，修正断言后通过；`npm run build` 通过，`node --test dist/test/runtime/departmentleadercodexowner.test.js dist/test/runtime/departmentleadercallbackprotocol.test.js` 通过，60/60。Ontology validate 和 ontology 单测 9/9 通过；`git diff --check` 通过。
- 同步 `src/test/runtime/departmentleadercodexowner.test.ts`、`.ch/docs/design-docs/department-leader-native-owner.md`、`.ch/docs/runbooks/local-development.md` 与 `cli-plugin-runtime` ontology 规则。排查入口：`~/.sinitek_cli/logs/sinitek-cli.YYYY-MM-DD.log` 搜索 `department-leader-native-failed`。
