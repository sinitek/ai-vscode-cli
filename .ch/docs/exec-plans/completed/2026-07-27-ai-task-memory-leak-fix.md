# AI 任务内存泄漏修复

- 日期：2026-07-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-27
- claim_ttl：1d
- handoff_to：

## 背景

AI 任务执行链路存在两类内存风险：Claude 交互任务停止时没有把本地 `AbortController` 传入 SDK `query`，可能导致底层 Claude 子进程和监听器继续运行；OpenCode 和 Webview raw stream 对长输出缺少上限，长任务可能造成扩展进程或 Webview 内存持续增长。

## 目标

修复停止语义和长输出内存边界，同时保持现有流式展示、导出、重试、会话续接和最终答案判断不降级。

## 范围

覆盖 `src/interactive/claudeRunner.ts`、OpenCode 执行路径中的原始输出缓存、Webview raw stream 记录上限和相关单元测试。

## 非目标

不重构 AI 任务编排架构，不改变 CLI 参数、会话存储格式、最终答案策略或 OpenCode/Codex/Claude 的用户可见协议。

## 验收标准

- [x] Claude `stopAndRebuild()` / `dispose()` 能真正 abort 当前 SDK `query`。
- [x] OpenCode 后端 raw stdout/stderr 缓存有字节上限，仍能解析会话 ID、最终输出和错误摘要。
- [x] Webview raw stream 记录有条数和字节上限，流式面板、计数和导出仍可用。
- [x] 相关测试覆盖新增边界，`npm run build` 和最小相关测试通过。

## 影响面

- 代码目录：`src/interactive/`、`src/extension.ts`、`src/webview/viewContentScript/`
- 文档目录：`.ch/docs/exec-plans/`
- 配置与脚本：无计划变更

## 风险与缓解

- 风险：过早截断 OpenCode 输出影响最终答案解析。
- 缓解：使用尾部保留策略，并保留独立小窗口用于 sessionId 提取。
- 风险：Webview 截断影响 raw stream 导出完整性。
- 缓解：只截断内存中的实时预览，并展示截断提示，导出当前可见 retained stream。
- 风险：Claude abort 改动破坏正常完成。
- 缓解：复用 SDK 官方 `abortController` 入口，正常完成时不主动 abort。

## 验证计划

- 最小相关验证：新增/更新 `claudeRunner`、Webview runtime、OpenCode command runner 相关测试。
- 单元自测命令：`npm run build`，再运行相关 `node --test dist/test/*.js`。
- 扩展验证：检查无 TypeScript 编译错误和关键运行路径测试失败。

## 测试与清单同步

- 单元测试新增/更新：已新增 `src/test/boundedText.test.ts`，并更新 `src/test/claudeRunner.test.ts`、`src/test/clipagescriptruntimecoverage.test.ts`、`src/test/contextCompactionRunner.test.ts`。
- 单元自测结果：
  - `npm run build`：通过。
  - `node --test dist/test/boundedText.test.js dist/test/claudeRunner.test.js dist/test/clipagescriptruntimecoverage.test.js dist/test/contextCompactionRunner.test.js`：27/27 通过。
  - `node --test dist/test/opencodeCommandRunner.test.js`：48/48 通过。
- 失败处理记录：无失败；Webview runtime coverage 中出现的 render/window error 日志为既有测试的预期故障注入，测试结果通过。
- 功能清单：本次为可靠性修复，不新增用户可见功能，预计无需更新功能清单。
- 相关文档同步：执行计划记录即可。

## 任务列表

- [x] 修复 Claude SDK abortController 传递与清理
- [x] 增加 OpenCode 有界 raw 输出缓存
- [x] 增加 Webview raw stream 记录上限
- [x] 补充测试并执行验证

## 决策记录

- 2026-07-27：优先修复真实停止语义缺口；长输出改为有界预览/解析缓存，不改变用户会话消息和最终答案策略。
- 2026-07-27：发现 abort 生效后上下文压缩停止路径可能收到后续异步错误，统一忽略 active run 已清理后的 stale error，避免停止后追加失败提示。

## 当前结论

已完成内存泄漏修复和最小相关验证；本次为可靠性修复，不新增用户可见功能清单项。
