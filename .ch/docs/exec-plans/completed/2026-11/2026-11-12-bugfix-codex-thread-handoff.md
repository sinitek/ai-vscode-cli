# Codex 会话跨连接安全交接

- 日期：2026-11-12
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景

Windows 用户反馈 Loop+ 恢复会话时反复出现 `already has an active writer`。排查导出报告记录了同一扩展宿主的两个 app-server、旧进程持锁及真实连接池隔离复现；历史请求与具体 connection key 的对应关系仍缺失。

Git 历史显示共享连接池由 `8e34f79f`（2026-09-26，当时版本 0.23.0）引入，`f9a4fe56`（2026-11-04，当时版本 1.7.7）将配置指纹加入连接 key，随后发布进入 1.8.x。不能仅凭版本相关性认定唯一触发原因，也不能移除配置指纹绕过隔离。

## 目标与范围

- 在同一扩展宿主内按 Codex HOME 和 thread 协调跨连接交接，保留不同会话并行。
- 旧连接仍服务其它 Tab 时只卸载目标会话；等待确认后再恢复。
- 区分逻辑连接关闭与操作系统进程退出，兼容 Windows 的异步终止。
- 对不可安全交接和未知写入者明确失败，避免通用重试反复撞锁。
- 增加脱敏生命周期诊断、回归用例并同步运行时规格和 ontology。

## 非目标

- 不删除锁、修改用户会话或认证配置，不升级依赖或 CLI，不杀死共享/外部进程。
- 不创建全局项目串行队列，不修改已有其它 CLI 模型管理工作。

## 验收标准

- 两个 listener 共享旧进程，一个 thread 跨 key 迁移时原会话保留，另一 Tab 不被终止。
- 同一 thread 的加载/交接不能重叠；不同 thread 不被全局串行化。
- 卸载失败/超时、旧进程延迟退出、外部 active writer 均不被误报成功。
- `thread/closed` 清理真实加载缓存；配置指纹继续区分进程。
- 最小相关单测及 `npm run build` 通过，并完成隔离真实 CLI 协议验证。

## 影响面与风险

- 代码：`src/interactive/codexAppServerPool.ts`、`src/interactive/codexRunner.ts`、`src/interactive/codexRunnerProcess.ts`、`src/promptRetry.ts` 及相关测试。
- 风险：unsubscribe 回包不一定等于写锁已释放；必须按实际 CLI 协议等待关闭事件或进程退出。
- 开发：detached worktree 隔离修改；最终只合并本任务文件，保留原工作区未提交改动。
- Windows 原生验收：本机是 macOS；补充模拟 Windows 进程测试，不能声称替代 Windows 真实验收。

## 验证计划

- `npm run build`
- `node --test dist/test/interactive/codexAppServerPool.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/core/promptRetry.test.js`
- 临时 CODEX_HOME、临时 workspace 和仅本次启动进程的真实 Codex 交接实验，不调用模型。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 任务列表

- [completed] 核对历史并确认本机协议
- [completed] 修复线程交接与退出等待
- [completed] 增加回归和最小真实验证
- [completed] 同步文档并合并工作区验证

## 决策与验证记录

- 2026-11-12：本机 `codex-cli 0.167.0` 导出的 schema 支持 `thread/unsubscribe`，返回 `notLoaded` / `notSubscribed` / `unsubscribed`，并支持 `thread/closed` 通知；下述真实实验已核对释放时序。
- 协议实验确认 `unsubscribed` 回包不等于释放；真实 `thread/closed` 延迟约 60 秒。交接采用总上限 75 秒、有取消检查的等待，仅 closed / notLoaded / 实际进程退出作为释放证据；同 thread 的重复完整操作直接拒绝，不排队隐藏重试。
- manager 按 `configFingerprint` 决定 runner 复用，Codex 压缩原有 getOrCreate / setRunner 两处均未透传；现已补齐并保护读取超时。压缩沿用当前提问启动能力，但重新计算其它身份字段，真实变化不能绕过配置隔离。
- `codexRunnerProcess.ts` 最近的历史修改是 `1125f1d8`（2026-08-20），早于 1.8.x；不能把近期现象直接归因于新增 taskkill。现有异步终止缺口仍需修复，尤其是 Windows。
- 已补共享旧进程保留其它 Tab、回包先于实际释放、notLoaded、notSubscribed、错误/未知状态/超时、放弃 resume 迟到回包、重复 thread、新建 thread、HOME 隔离、停止、外部 writer、Windows taskkill 失败以及 exit 后 stdout 排空回归。
- 初次扩大验证暴露旧生命周期 FakeChild 只记录 kill、不发出退出事件，残留同名 thread 导致后续用例等待；归类为夹具问题，补真实 close/signal 模拟，不回退生产退出确认。调整后 Codex/manager/生命周期及压缩/retry 共 224 项通过，新增读取超时与 stdout 回归后最小范围 92 项通过；最终合并后重跑扩大范围。
- `npm run build` 通过；ontology validate 通过，ontology skill 单测 9 项通过，`git diff --check` 通过。
- `node scripts/verify_codex_thread_handoff.js --live` 在临时 HOME/workspace 和本机 HTTP 错误响应下创建真实持久会话：先复现两个真实 app-server 的 writer 冲突，再于约 60055 ms 后恢复同一 thread，同时旧进程及其它 thread 保留；仅 1 次本机 HTTP 请求，不调用付费模型、不读取用户会话。本机 0.167.0 与用户报告 0.167.1 不同，仍需 Windows 原生验收。

## 当前结论

历史支持近期连接身份变化扩大风险，但尚未锁定用户历史故障具体 key 字段。本任务已修复可复现的生命周期缺口和压缩指纹透传遗漏，不以删除指纹或盲目重试替代交接。

## 最终交付与验证

- 已以局部补丁合入原工作区，保留其原有其它任务改动；未创建分支、未提交、未发布扩展。隔离 worktree 的 node_modules 链接不进入交付。
- 原工作区执行 `npm run build` 成功，随后执行 `node --test dist/test/interactive/codex*.test.js dist/test/interactive/manager.test.js dist/test/interactive/runnerLifecycle*.test.js dist/test/core/promptRetry.test.js dist/test/core/contextCompactionRunner.test.js`，227 项全部通过。
- 最终实现再次执行 `node scripts/verify_codex_thread_handoff.js --live`，先复现 writer 冲突，再于 60032 ms 后恢复同一 thread，旧进程其它会话仍加载；仅 1 次本机模拟 HTTP 请求。临时目录和本次进程均已清理。
- 原工作区 ontology validate 通过（134 条规则，含原工作区已有规则），ontology skill 单测 9 项通过；本次源代码/测试/脚本/文档的定向空白检查及 `git diff --check` 通过。
- 已同步功能清单、运行时参考、运行时设计、避坑指南及 ontology。该任务属于 CLI 生命周期，不修改 Webview，无需 Playwright；复用知识写入运行时参考/PITFALLS，未自动写入 ROLLING_SUMMARY 或重复新增 EVENT_MEMORY。

## 未覆盖边界

- 本机为 macOS，Windows 只完成 taskkill 成功/启动失败/非零退出及延迟退出的模拟测试，尚未在原用户 Windows + Codex 0.167.1 环境复测；可在该环境运行同一隔离验证脚本。
- 宿主内 HOME + thread 互斥不等于跨 VS Code 窗口/外部 CLI 的强制接管。未知外部 writer 明确失败并保留数据，不删除锁或终止外部进程。
- CLI 卸载延迟由实际 thread/closed 决定；等待可能接近一分钟，不保证每次连接身份切换都立即完成。旧 CLI 不支持 unsubscribe 或不能确认释放时会安全报错，而不是冒险恢复。
