# 执行计划：已执行会话的 CLI 切换确认 — 新功能开发

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-28
- claim_ttl：本轮任务
- handoff_to：
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-28-confirmed-cli-switch.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-28-docs-confirmed-cli-switch.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

允许用户确认后切换 CLI，保持原每 CLI 会话映射。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-28-feature-confirmed-cli-switch.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- AI 对话 Tab 首次执行后会持久化 `executionLocked`，此前 Webview 和宿主会禁止切换 CLI。需求改为允许下拉切换；当前 CLI 已有会话 ID 时，必须先显示警告并由用户确认，确认条件不依赖 `executionLocked`。

## 目标

- 允许 AI 对话面板切换 CLI；仅在当前 CLI 有会话 ID 时显示“切换其它 CLI 会丢失上下文，确定？”，取消不修改当前 Tab/CLI，确认后复用原有每 CLI 会话映射。

## 范围

- Webview CLI 选择器及事件处理。

- 面板消息处理、宿主 Tab CLI 切换及执行锁默认保护。

## 非目标

- 不改变模型快照、会话 ID 映射或其它 `setCurrentCli` 入口的执行锁语义。

- 不引入新的弹窗系统或本地化语言包。

## 验收标准

- [x] 已执行 Tab 的 CLI 下拉仍可选；目标 CLI 被禁用时沿用现有限制。

- [x] 当前 CLI 有 session ID 时展示精确警告，不依赖 `executionLocked`；取消保持 CLI/Tab 状态不变。

- [x] 确认后切换成功并保留每 CLI 会话映射；没有 session ID 时无需确认即可切换。

- [x] 非面板入口的执行锁拒绝行为仍通过回归测试。

## 影响面

- 代码目录：`src/extension.ts`、`src/sessionTabs.ts`、`src/sessionMessageHandlers.ts`、`src/panelMessageHandlers/session.ts`、`src/webview/viewContentScript/`

- 配置与脚本：无

## 风险与缓解

- 风险：确认后错误复用其他 CLI 的会话或覆盖原 CLI 映射。

- 风险：为 UI 放宽锁影响宿主内部切换入口。

- 缓解：增加仅供面板选择消息调用的专用授权路径，保留默认锁拒绝。

## 验证计划

- 最小相关验证：会话消息处理、Tab 锁与 Webview 选择器测试。

- 单元自测命令：`npm run build`；`node --test dist/test/session/conversationTabLock.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/loop/opencodeloopmodewebview.test.js`；`npm run test:unit`。

## 测试与清单同步

- 单元自测结果：2026-10-28 复核后 `npm run build` 通过；6 个相关测试文件共 97 个单测全部通过；ontology validate、`npm run validate:whitespace` 和 `git diff --check` 通过。此前全量 2158 个测试中 2137 通过、20 个失败、1 个跳过，失败集中在既有 DSH/Grok 配置、历史渲染和 Loop+ 测试夹具，未命中本次新增测试。

- 失败处理记录：全量失败按范围外/既有基线问题记录，不修改无关代码；本次相关测试单独通过。

## 任务列表

- [x] 查明现有锁定与会话映射路径

- [x] 实现面板专用 CLI 切换确认

- 同步事实源

## 决策记录

- 2026-10-28：执行锁默认行为保持不变；只为面板 CLI 下拉选择开放专用切换路径。

- 2026-10-28：确认条件仅检查当前 CLI session ID，不依赖 `executionLocked`；无 ID 时无需确认但仍允许切换，有 ID 时必须确认。

## 当前结论

- 已完成面板专用 CLI 切换授权：当前 CLI 有 session ID 时先确认，取消保持原状态，确认后沿用目标 CLI 映射；无 session ID 直接切换。确认条件不依赖 `executionLocked`；其它宿主入口仍保留默认执行锁保护。构建、相关单测和 ontology 校验通过；全量测试存在与本次无关的既有失败。
