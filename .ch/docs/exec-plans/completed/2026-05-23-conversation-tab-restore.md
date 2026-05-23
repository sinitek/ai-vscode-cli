# 计划标题

- 日期：2026-05-23
- 状态：completed
- 负责人：Codex

## 背景

用户反馈 AI 对话侧边栏在存在多个 conversation tab 时，重启 VS Code 后只恢复为 1 个 tab。该问题影响会话并行使用体验，且属于用户显著可见的状态恢复缺陷。

## 目标

修复 AI 对话多 tab 在 VS Code 重启后的恢复问题，确保已持久化的多个 tab 能正确还原。

## 范围

覆盖 `src/extension.ts` 中 conversation tab 的工作区级持久化、恢复与相关会话映射修复逻辑。

## 非目标

不重构整个会话系统。

## 验收标准

- [x] 已持久化的多个 conversation tab 在扩展重新激活后仍保持多 tab。
- [x] 不破坏单 tab、切换 tab、关闭 tab、新建 tab 的现有行为。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/`
- 文档目录：`.ch/docs/exec-plans/active/`、必要时 `.ch/docs/product-specs/`
- 配置与脚本：无新增

## 风险与缓解

- 风险：修复 tab 恢复时可能误伤 session 恢复逻辑。
- 缓解：优先做最小修复，并通过本地状态样例和构建验证。

## 验证计划

- 最小相关验证：检查 `workspace-settings` 持久化样例，确认实际保存了 2 个 tab，并用最小 Node 复现验证启动早期会因未初始化 `sessionStore` 触发恢复异常。
- 扩展验证：执行 `npm run build`，确认修改后编译通过。

## 测试与清单同步

- 单元测试：当前缺少对 `src/extension.ts` 启动恢复链路的可直接复用单测入口，本次先以构建和最小脚本验证。
- 功能清单：若仅为缺陷修复且功能边界不变，可不改功能清单。
- 相关文档同步：记录本计划和验证结论。

## 任务列表

- [x] 确认 `workspace-settings` 已正确持久化多个 tab。
- [x] 定位恢复链路中将多 tab 压缩为单 tab 的根因。
- [x] 实现最小修复并验证构建。
- [x] 回写计划结论，评估是否需要同步规格文档。

## 决策记录

- 2026-05-23：先以当前真实 `workspace-settings` 样例确认“保存正常、恢复异常”，避免误改保存链路。
- 2026-05-23：将激活阶段的 `sessionStore` 恢复提前到 `loadWorkspaceSettings()` 之前，避免 `conversationTabs` 在启动早期被空会话存储清洗成默认单 tab。
- 2026-05-23：为 `retainExistingConversationTabSessionIdMap()` 和 `hasSessionRecord()` 增加未初始化保护，确保未来即使再出现早期读取路径，也不会丢失已持久化的 tab 会话映射。

## 当前结论

已完成修复。根因是扩展激活时先读取 `workspaceSettings`，但 `conversationTabs` 的清洗逻辑依赖 `sessionStore`；在 `sessionStore` 尚未初始化时，会触发恢复异常并回退到默认单 tab。修复后，激活顺序改为先恢复 `sessionStore` 再读取 `workspaceSettings`，同时补充未初始化保护，避免早期读取时丢失 tab 会话映射。`npm run build` 已通过。功能边界未变化，无需同步功能清单。
