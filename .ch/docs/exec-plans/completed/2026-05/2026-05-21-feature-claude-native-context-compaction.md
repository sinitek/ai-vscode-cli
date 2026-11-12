# Claude 原生上下文压缩切换

- 日期：2026-05-21
- 状态：completed
- 负责人：Codex
- 类型：feature
- 迁移来源：`.ch/docs/exec-plans/completed/2026-05/2026-05-21-claude-native-context-compaction.md`

## 关联计划

- [docs：Claude 原生上下文压缩切换——文档同步](2026-05-21-docs-claude-native-context-compaction-documentation.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[1]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 背景

当前插件的 Claude “压缩上下文”仍使用“先生成摘要，再切到新会话 bootstrap”的模拟方案，与已落地的 Codex 原生压缩链路不一致。用户要求将 Claude 改为官方指定方式，并完成本地验证。

## 目标

将 Claude 上下文压缩切换为官方 `/compact` 原生链路，并保留对旧版不支持环境的最小兼容回退。

## 范围

- 调整 Claude interactive runner 的 compaction 触发与完成判定。
- 调整聊天面板 compaction 命令在 Claude 下的执行路径与状态提示。

## 非目标

- 不改动 Codex / Gemini 的 compaction 行为。
- 不重构 Claude interactive runner 的整体执行模型。
- 不新增新的 UI 入口或设置项。

## 验收标准

- [x] Claude compaction 默认走官方 `/compact`，不再默认使用摘要模拟。
- [x] Claude compaction 能基于原生 compact 事件/状态判定完成，并正确维护 session 映射。
- [x] 若当前 Claude 环境明确不支持原生 compact，会回退到旧摘要模拟链路，且日志可区分。
- [x] `npm run build` 与最小相关测试通过。

## 影响面

- 代码目录：`src/interactive/claudeRunner.ts`、`src/extension.ts`、`src/i18n.ts`
- 配置与脚本：无新增配置；沿用现有 `npm run build` 与 `node --test`

## 风险与缓解

- 风险：不同 Claude Code 版本对 `/compact` 的返回事件或报错文案可能不完全一致。
- 缓解：以 `compact_boundary` / `status=compacting` 作为原生主判定，并仅在明确“不支持 compact/slash command”时回退。
- 风险：原生 compact 后 session id 可能变化，导致历史映射异常。
- 缓解：沿用现有 `onSessionId` 更新逻辑，并在 compaction 结果中显式返回前后 session id。

## 验证计划

- 最小相关验证：`npm run build`、Claude compaction 相关单测。
- 扩展验证：若本机 Claude CLI 与认证可用，执行一次最小 compaction smoke test，确认出现原生 compact 信号而非摘要 bootstrap。

## 任务列表

- [x] 实现 Claude 原生 `/compact` 与事件判定
- [x] 保留旧摘要模拟作为旧环境兼容回退
- [x] 更新聊天面板状态提示与 i18n
- [x] 执行构建/验证

## 决策记录

- 2026-05-21：Claude compaction 默认改为官方 `/compact`；仅在明确不支持原生 compact 的旧环境中回退到摘要模拟。

## 当前结论

已完成 Claude 原生 compaction 切换：
- 代码默认使用官方 `/compact`，通过 SDK `status=compacting` / `compact_boundary` 判定原生完成。
- 若当前 Claude 环境明确不支持原生 compact，则回退到旧摘要模拟链路。
- 已执行 `npm run build`、`node --test dist/test/claudeRunner.test.js`、`node --test dist/test/codexAppServerEvents.test.js`。
- 已执行真实 CLI smoke：本机 `claude 2.1.118` 在非空续接会话中执行 `/compact`，实际返回了 `status=compacting`、`compact_boundary(trigger=manual)` 与最终 `result: success`，确认原生 compact 事件链路成立。
