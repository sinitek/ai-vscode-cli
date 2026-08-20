# Codex Spawn EAGAIN 资源耗尽修复

- 日期：2026-08-20
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-20
- claim_ttl：1d
- handoff_to：

## 背景

用户反馈插件长时间使用后 `codex` 启动失败，错误为 `spawn /Users/fangjiawei/.npm-global/bin/codex EAGAIN`，重启电脑后恢复。该错误通常指向进程、文件描述符或 pipe 等宿主资源耗尽，需要检查 CLI 子进程生命周期、取消清理、并发启动和日志/句柄释放。

## 目标

定位并修复导致长期使用后 `codex` spawn 失败的资源泄漏或并发失控问题，并补充最小回归测试。

## 范围

本次覆盖 CLI spawn、流式运行、取消/停止、子进程清理、相关日志和测试。

## 非目标

不替换 CLI 技术栈，不改用户配置格式，不引入新的长期后台服务。

## 验收标准

- [x] CLI 子进程在成功、失败、取消、spawn 异常场景下都会移出活跃跟踪并释放句柄。
- [x] 并发启动有合理生命周期保护，停止会遍历当前 runner 的全部活跃 app-server child，避免旧 child 覆盖漏杀。
- [x] `EAGAIN` 错误给出可诊断日志或用户可理解的错误信息。
- [x] 最小相关单元测试和 `npm run build` 通过。

## 影响面

- 代码目录：`src/cli/`、`src/interactive/`、`src/test/`
- 文档目录：`.ch/docs/runbooks/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：过度限制并发影响正常多会话使用。
- 缓解：先按现有入口和真实清理缺口修复，默认限制只保护活跃进程数量并保留明确错误提示。

## 验证计划

- 最小相关验证：针对子进程退出、取消、spawn 错误、并发上限补测试。
- 单元自测命令：`npm run build`，以及最小相关 `node --test dist/test/...`
- 扩展验证：只读检查本机 `codex --version` 与当前进程数量，不改写用户配置。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/codexRunnerLifecycle.test.ts`，覆盖 `EAGAIN` spawn error 收口和同 runner 多 child 停止。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/codexRunnerLifecycle.test.js dist/test/codexRunnerSubagent.test.js` 通过；`node --test dist/test/commandRunnerCoverage.test.js` 通过。
- 失败处理记录：首次 focused 测试暴露 early spawn/abort 会触发内部 completion promise unhandledRejection；已通过 `void promise.catch(() => undefined)` 标记内部 promise 已观察，保留 await 时的错误传播。
- 功能清单：本次属于内部可靠性修复，未新增用户可见功能，未更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/runbooks/PITFALLS.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 定位 `codex` spawn 调用、取消和清理路径
- [x] 修复资源释放、并发保护或诊断日志
- [x] 补充回归测试
- [x] 执行构建与最小相关测试
- [x] 收尾检查文档和 ontology 是否需要同步

## 决策记录

- 2026-08-20：将问题按长期资源耗尽处理，先检查子进程生命周期和活跃进程跟踪，再决定是否需要并发限流。

## 当前结论

已完成修复：`CodexInteractiveRunner` 改为集合跟踪所有活跃 app-server child；Codex app-server 在 macOS/Linux 下使用独立 process group；`requestChildShutdown` 优先清理进程组并 `unref` 升级定时器；`EAGAIN` spawn error 会输出可读错误、生命周期事件和日志；早期 failure 内部 promise 已标记为已观察，避免 unhandledRejection。只读验证确认本机仍有旧版启动的 Codex app-server 残留进程，未擅自杀进程。
