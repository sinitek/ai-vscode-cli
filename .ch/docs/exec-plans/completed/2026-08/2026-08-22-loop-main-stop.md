# Loop 主任务进行中状态可中断

- 日期：2026-08-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-22
- claim_ttl：本次会话
- handoff_to：

## 背景

Loop 主任务记录仍为 `running`、但主任务当前没有直接 CLI 进程（例如子任务全部中断）时，主任务 tab 的顶部停止按钮不会显示；点击停止也无法把任务收束。

## 目标

只要 Loop 主任务状态为 `running`，主任务 tab 就显示并允许点击停止；停止动作需要在无直接进程时仍将主任务及活动子任务收束为用户中止状态。

## 范围

- Webview 主任务 tab 的运行态与停止按钮展示。
- 扩展宿主 `stopRunForTab` 对 Loop 主任务的无进程停止兜底。
- 相关单元测试与功能事实文档核对。

## 非目标

- 不改变 Loop 子任务调度、重试或主任务复核策略。
- 不替换现有 CLI/VS Code 技术栈。

## 验收标准

- [x] 主任务 tab 对 `loopTaskStatus: running` 显示停止按钮。
- [x] 无活动运行进程时点击停止仍将 Loop 任务标记为 stopped。
- [x] 相关单元测试、构建通过。

## 影响面

- 代码目录：`src/webview/viewContentScript/`、`src/extension.ts`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`（按语义变化核对）。
- 配置与脚本：无。

## 风险与缓解

- 风险：普通对话 tab 的停止行为被误触发。
- 缓解：仅在 tab 明确为 Loop `main` 且任务状态为 `running` 时启用兜底；保留现有进程停止分支优先级。

## 验证计划

- 最小相关验证：Loop 状态控制、会话 tab 运行态、停止按钮脚本测试。
- 单元自测命令：`npm run build`；`node --test dist/test/loopDebate.test.js dist/test/conversationTabLock.test.js dist/test/loopmaingroupchatbutton.test.js`。
- 扩展验证：必要时运行浏览器 smoke；本次以单元与构建为主。

## 测试与清单同步

- 单元测试新增/更新：覆盖 persisted Loop running 状态驱动停止按钮，以及无进程停止回调路径。
- 单元自测结果：`npm run build`、Loop/tab/宿主回归测试通过；ontology 校验与测试通过。
- 失败处理记录：无；构建、相关单元测试与 ontology 校验均一次通过。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [completed] 定位主任务 tab 运行态与停止调用链
- [completed] 修复前端停止按钮与后端无进程停止兜底
- [completed] 补充测试并执行构建验证
- [completed] 核对功能清单、本体与计划归档

## 决策记录

- 2026-08-22：以 Loop 主任务持久化 `running` 状态作为停止按钮的兜底运行信号；不要求必须存在当前 CLI 进程。

## 当前结论

已完成 UI 运行态同步和宿主停止兜底：Loop 主任务记录为 running 时，主任务 Tab 会显示停止按钮；无直接 CLI 进程时，宿主仍会停止关联运行、统一标记父子任务为 stopped 并刷新面板。构建、相关单测、ontology 校验均通过。
