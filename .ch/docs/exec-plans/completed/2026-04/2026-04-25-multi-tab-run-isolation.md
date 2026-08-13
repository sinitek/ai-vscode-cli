# 多 Tab 运行隔离修复计划

- 日期：2026-04-25
- 状态：completed
- 负责人：Codex

## 背景

用户反馈：AI 对话存在多个 conversation tab 并发任务时，如果某个 tab 切换到其他 CLI 分组（例如切到 Gemini），会导致另一条仍在执行的 Codex 分组任务被断开。当前行为违反多 tab 并发任务隔离预期。

## 目标

修复 conversation tab 切换 CLI 分组/切换会话时对 interactive runner 的误释放问题，确保一个 tab 的分组操作不会中断其他 tab 中正在执行的任务。

## 范围

- 排查 `src/extension.ts` 中 tab、CLI 分组、会话切换的编排逻辑。
- 修复 `src/extension.ts` 与 `src/interactive/runnerRetention.ts` 的 runner 释放策略。
- 补充最小回归测试或可执行验证，覆盖“其他 tab 正在运行时切换分组”的场景。
- 同步事实来源文档中的能力/限制说明。

## 非目标

- 不改动 Codex / Claude / Gemini 的底层 CLI 协议实现。
- 不做与本次问题无关的 UI 重构或技术栈变更。
- 不扩展新的会话模型或新的任务调度能力。

## 验收标准

- [x] 在一个 tab 执行中的 Codex/Claude interactive 任务，不会因其他 tab 切换 CLI 分组而被 `dispose`。
- [x] 切换历史会话、切换 CLI 分组时，仅清理安全且不在执行中的 runner。
- [x] 最小相关验证通过，并记录未覆盖项。

## 影响面

- 代码目录：`src/extension.ts`、`src/interactive/runnerRetention.ts`、`src/test/runnerRetention.test.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：无新增配置；沿用现有 `npm run build`

## 风险与缓解

- 风险：runner 清理范围收窄后，可能留下更多空闲 runner。
- 缓解：仅保留空闲释放与精确释放逻辑，不放宽正在执行回合的生命周期控制。

## 验证计划

- 最小相关验证：构建 TypeScript，执行新增/更新的最小回归测试脚本（如可落地）。
- 扩展验证：手工复现“Tab A 运行 Codex、Tab B 切到 Gemini”并确认 A 持续输出。

## 测试与清单同步

- 单元测试：优先补充可稳定复现的最小逻辑测试；若仓库缺少测试基建，则记录原因并使用构建验证。
- 功能清单：如行为定义变化，更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：记录本次踩坑到 `PITFALLS.md`，便于后续规避。

## 任务列表

- [x] 识别多 tab 并发任务与分组切换的关键代码路径
- [x] 修复 runner 销毁策略，避免误伤其他 tab 任务
- [x] 补充回归验证并执行构建
- [x] 同步事实来源文档并总结残余风险

## 决策记录

- 2026-04-25：先从扩展编排层收敛 `disposeAll()` 调用，避免在分组/会话切换时全局销毁 interactive runner。
- 2026-04-25：新增 `src/interactive/runnerRetention.ts`，把“是否仍被 tab 引用 / 是否仍处于运行态”的判断抽成可测试的纯逻辑，并在 `selectCli`、`selectSession`、`closeConversationTab`、`resetConversationTabSession` 复用。

## 当前结论

已完成修复：`src/extension.ts` 不再在 `selectCli` / `selectSession` 中全局 `disposeAll()`，改为基于 `sessionIdByCli` 引用和当前运行态判断是否可以精确释放 session 对应的 interactive runner。`closeConversationTab` 与 `resetConversationTabSession` 也同步改成同一套精确释放逻辑，避免误伤仍被其他 tab 保留的 session 绑定。

已验证：
- `npm run build`
- `node --test dist/test/runnerRetention.test.js`

未覆盖：
- 尚未在 VS Code 真机 UI 中录制自动化回归；仍建议按“Tab A 运行 Codex / Claude，Tab B 切到 Gemini / 历史会话”的路径做一次手工验证。
