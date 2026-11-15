# 子任务成功收尾与标签自动关闭

- 日期：2026-11-15
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-15-bugfix-conversation-response-latency.md`；共享当前工作区，保留其未提交修改，本计划只处理成功收尾与关页。

## 背景与目标

用户反馈子任务已通知主任务却显示错误、未自动关闭，怀疑与未触发压缩有关。只读核对指定本机会话：真实终态是成功，约 15 秒后 `runPrompt-failed` 记录 `RUNTIME_CONFIG_LOCK_TIMEOUT`，诊断 operation 为 `release`；父任务却将同一 attempt 的验收事件记为 failed。证据表明配置执行租约释放异常覆盖了真实执行结果，导致成功关页回调没有执行。历史磁盘不足记录与本次最新终态时间不一致，不据此推断本次失败。运行时私有 ID、正文和完整日志不写入仓库。

## 范围与验收

- 配置执行租约清理失败单独记录并后台有界重试，不覆盖成功、停止或真实执行失败；重试只释放原租约，不能越过仍存活的锁所有者。
- Loop / Loop+ 成功汇报后，无自动压缩、压缩跳过、压缩成功或压缩失败均执行现有安全关页；保留 attempt、对象、CLI、会话、工作区与运行中保护。
- 不修改真实 CLI 会话、任务记录、配置或历史失败事件；不改变框架、不发布扩展。

## 影响面、风险与缓解

公共 Prompt 执行与后台压缩的配置租约 finally、配置租约清理辅助、宿主回归测试。释放不成功期间仍保留持久化租约，配置切换继续拒绝；重试耗尽明确记录，宿主退出后的既有死亡租约回收仍有效。真实执行异常与执行根清理失败仍保留原语义。

## 验证计划

- 先在原实现上复现成功执行后 release 超时导致错误状态。
- `npm run build` 后运行配置租约、公共 Prompt、Loop 生命周期、Loop+ 集成与标签清理相关回归。
- 使用系统临时目录和真实文件锁覆盖释放超时、互斥保护与重试后租约移除；不访问用户配置进行写入。
- 本机日志只读验证已完成；不涉及 Webview 样式，不以浏览器点击代替宿主回归。

## 测试与清单同步

- 单元测试：新增共享配置租约释放失败不覆盖终态、后台重试和重试耗尽用例；公共 Prompt 收尾超时回归；无压缩时关页回归。复用 Loop+ 压缩失败后关页与身份保护用例。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/loop/loopSubtaskLifecycle.test.js dist/test/loop/loopSubtaskAutoCompact.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/session/sessionTabCliSwitch.test.js` 通过，304/304；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 通过，9/9。
- 失败分类：定向测试没有失败；未运行真实 VS Code 图形宿主，修复路径由源码级宿主编排测试覆盖。
- 功能清单、会话复用设计、本体：收尾同步租约清理与成功关页边界。
- 记忆：根因和规避方式写入相关 runbook；无需写入滚动摘要或重复追加事件记忆。

## 任务列表

- [completed] 只读核对指定会话与源码，定位租约释放超时覆盖成功结果
- [completed] 复现并修复收尾异常，补充无压缩自动关页回归
- [completed] 构建与定向验证，更新事实来源并归档

## 当前结论

配置租约首次释放失败现在记录 Loop 身份和重试次数，并对原租约有限后台重试；异常不再从 `runPromptNow` 冒泡改写 CLI 终态。真实完成结果会进入现有汇报与安全关页路径，不压缩、压缩失败或压缩成功均符合原有关页设计。功能清单、会话复用设计、共享配置 ontology 和避坑 runbook 已同步。
