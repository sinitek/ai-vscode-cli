# 执行计划：已执行会话的 CLI 切换确认

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-28
- claim_ttl：本轮任务
- handoff_to：

## 背景

AI 对话 Tab 首次执行后会持久化 `executionLocked`，此前 Webview 和宿主会禁止切换 CLI。需求改为允许下拉切换；当前 CLI 已有会话 ID 时，必须先显示警告并由用户确认，确认条件不依赖 `executionLocked`。

## 目标

允许 AI 对话面板切换 CLI；仅在当前 CLI 有会话 ID 时显示“切换其它 CLI 会丢失上下文，确定？”，取消不修改当前 Tab/CLI，确认后复用原有每 CLI 会话映射。

## 范围

- Webview CLI 选择器及事件处理。
- 面板消息处理、宿主 Tab CLI 切换及执行锁默认保护。
- 相关单元测试、功能清单和 ontology 规则。

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
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：无

## 风险与缓解

- 风险：确认后错误复用其他 CLI 的会话或覆盖原 CLI 映射。
- 缓解：沿用 Tab 的 `sessionIdByCli` 切换方法，增加映射保持测试。
- 风险：为 UI 放宽锁影响宿主内部切换入口。
- 缓解：增加仅供面板选择消息调用的专用授权路径，保留默认锁拒绝。

## 验证计划

- 最小相关验证：会话消息处理、Tab 锁与 Webview 选择器测试。
- 单元自测命令：`npm run build`；`node --test dist/test/session/conversationTabLock.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/loop/opencodeloopmodewebview.test.js`；`npm run test:unit`。
- 扩展验证：ontology validate。

## 测试与清单同步

- 单元测试新增/更新：确认、取消、无 session ID 切换、默认执行锁拒绝、选择器可用性、会话映射保持。
- 单元自测结果：2026-10-28 复核后 `npm run build` 通过；6 个相关测试文件共 97 个单测全部通过；ontology validate、`npm run validate:whitespace` 和 `git diff --check` 通过。此前全量 2158 个测试中 2137 通过、20 个失败、1 个跳过，失败集中在既有 DSH/Grok 配置、历史渲染和 Loop+ 测试夹具，未命中本次新增测试。
- 失败处理记录：全量失败按范围外/既有基线问题记录，不修改无关代码；本次相关测试单独通过。
- 功能清单：同步。
- 相关文档同步：同步能力规格与 ontology 规则。

## 任务列表

- [x] 查明现有锁定与会话映射路径
- [x] 实现面板专用 CLI 切换确认
- [x] 补充回归测试并同步事实源
- [x] 执行最小测试、构建和 ontology 校验

## 决策记录

- 2026-10-28：执行锁默认行为保持不变；只为面板 CLI 下拉选择开放专用切换路径。
- 2026-10-28：确认条件仅检查当前 CLI session ID，不依赖 `executionLocked`；无 ID 时无需确认但仍允许切换，有 ID 时必须确认。

## 当前结论

已完成面板专用 CLI 切换授权：当前 CLI 有 session ID 时先确认，取消保持原状态，确认后沿用目标 CLI 映射；无 session ID 直接切换。确认条件不依赖 `executionLocked`；其它宿主入口仍保留默认执行锁保护。构建、相关单测和 ontology 校验通过；全量测试存在与本次无关的既有失败。
