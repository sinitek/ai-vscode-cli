# Loop+ 子任务配置锁超时修复

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

本机日志当天多次记录 Codex `runPrompt-failed` 配置锁超时，Loop+ 子任务 Tab 未能启动。已安装 1.9.6 与当前源码均包含同进程排队、面板只读快照；只读取证时已无 mutex，历史日志缺少持锁者和任务关联，不能断言各次事故原因一致。

锁等待循环存在可确定的边界缺陷：`link` 返回 EEXIST 后，若锁已经释放或死进程锁已恢复，仍先检查截止时间而直接失败；宿主暂停/系统休眠或异步调度延迟可放大该窗口。本次补回归并修正此边界，增加安全诊断以区分真实占锁与恢复失败。

## 范围与非目标

- 共享配置锁等待、崩溃恢复边界与任务启动错误日志；相关回归、功能清单、运行手册及 ontology 同步。
- 不改变 CLI/框架版本，不强拆活进程锁，不修改用户配置和任务存储，不发布或替换已安装扩展。

## 验收标准

- 截止时刻锁已释放或安全恢复时，仍可原子取得锁并启动；真实占用仍有界拒绝。
- 不允许两个写事务同时进入；配置切换、未就绪保护和执行租约保持有效。
- 超时含可检索错误码与持锁进程/等待信息；启动失败日志可定位 Tab、Loop 任务和调用角色，不包含配置内容或凭据。
- 构建、相关单测、隔离多进程验证及 ontology 校验通过，明确真实环境验证边界。

## 影响面、风险与缓解

- 代码：`src/config/sharedRuntimeConfig.ts`、`src/extension.ts`、相关配置/宿主测试。
- 文档：运行时参考、功能清单、排障手册、ontology。
- 风险：截止后的最终尝试必须仍用原子硬链接，不允许以快照判断替代互斥；只回收确认死亡且 token 相同的 owner。
- 回滚：撤回本次差异；不变更持久化格式。

## 验证计划与测试同步

- 先用定向回归复现截止时刻的释放/恢复竞态，确认旧逻辑失败。
- `npm run build` 后运行 `sharedRuntimeConfig`、`configService`、`promptSessionHealth`、`loopPlusRuntimeIntegration` 等相关单测。
- 使用系统临时目录和真实独立 Node 进程验证争锁、回收与同档案并行，无真实模型费用。
- 完成后同步功能清单，校验 ontology 和变更空白；不涉及 UI 修改，无需浏览器验证。

## 实施结果

- 到期后增加一次最终原子硬链接尝试，不根据只读快照放行。刚释放或已安全回收的锁可以继续；其它存活持锁者仍阻止进入事务，不增加无限重试。
- 新增 `RuntimeConfigLockTimeoutError` / `RUNTIME_CONFIG_LOCK_TIMEOUT`，诊断携带操作阶段、持锁 PID/存活状态、实际等待与上限；`runPrompt-failed` 关联 Tab、角色和 Loop 主/子任务及 attempt。
- 新增 5 项回归：截止时释放、截止时死锁回收、活锁诊断与失败后恢复、最终尝试被替代持锁者抢先、子任务失败状态与关联诊断。
- 已同步运行时参考、功能清单、排障手册与 ontology。稳定经验已进入排障手册，不重复追加 EVENT_MEMORY 或 ROLLING_SUMMARY。

## 验证记录

- 修复前：`npm run build && node --test --test-name-pattern='at the deadline' dist/test/config/sharedRuntimeConfig.test.js`。构建通过，两项新增回归均失败于原始中文超时，确认竞态可复现。
- 修复后：`npm run build && node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/extensionHost/promptSessionHealth.test.js`，85 项通过，无失败/跳过；覆盖真实独立 Node 进程互斥、崩溃锁/租约恢复、同档案并发和启动失败收尾。
- 扩展范围：`node --test dist/test/config/configService.test.js dist/test/config/runtimeConfigVerification.test.js dist/test/config/currentConfigOwnership.test.js dist/test/config/configApplyQueue.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopModelRouting.test.js`，194 项通过，无失败/跳过。两组共 279 项。
- 中间构建失败归类为新增测试夹具类型缺项：补齐必需的 `modelPrompt` 后，上述构建和最小回归通过，无业务断言放宽。
- 本机真实只读验证：用编译后的 `SharedRuntimeConfig` 对七类 CLI 的实际协调目录各并发 `read()` 100 次，700 次均返回就绪快照；读取前后核对 selection.json 和目标原生文件 SHA-256，均未变化。只读取运行日志/已安装 1.9.6 代码；未调用模型、未修改用户任务或配置。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`，9 项通过。
- `git diff --check` 通过；归档后复核本次文件的空白与引用目标。

## 结论与验证边界

本机日志确认 2026-11-15 存在多次 Codex 配置锁超时。当前已无 mutex，残留 owner 候选文件不能证明仍持锁；已安装 1.9.6 也包含此前只读快照与进程内排队修复，因此不能把本次问题再次归因于旧实现。此次复现并修复截止时锁释放/回收的确定缺陷，保留真实活锁超时保护；历史日志未记录 owner/Tab/attempt，不能证明各次历史报错都来自该竞态。

召回 focus 为 `Loop+ 子任务 配置锁 多窗口 启动超时`，anchor 为空；baseline 召回未命中专有历史记录，结合 ontology 事实来源和 CodeGraph 定位，遇到 stale 图节点直接核对当前文件。

验证平台为本机 macOS。未执行 Windows/Linux 原生验证、完整 Extension Development Host 点击/付费模型流程或浏览器验证；本次无 UI 修改，锁行为通过真实文件系统/多进程与宿主定向回归验证。不发布、不替换已安装扩展；用户须加载包含本次修复的新构建并重载窗口后复验现场。
