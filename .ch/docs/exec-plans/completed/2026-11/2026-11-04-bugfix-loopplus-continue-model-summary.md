# Loop+ 续接弹窗角色模型展示修复

- 日期：2026-11-04
- 状态：completed
- 类型：bugfix
- 负责人：Codex

## 背景与目标

「继续 Loop 任务」仍只格式化旧的主/子模型字段，未展示 Loop+ 前后端两个子模型。面板预览读取当前配置时还遗漏了全栈 CLI、子任务模式和独立角色模型回调，与真正续跑时读取的配置不一致。

## 范围与非目标

- 修复群聊续接弹窗的原配置/当前配置摘要，分别遵循各自的全栈或前后端模式。
- 复用已有模式兼容规则和 CLI / 模型格式化逻辑；经典 Loop 文案不变。
- 本计划只承接摘要取值与渲染修复，不承接面板状态与 HTML 回归开发；历史测试摘要见关联删除审计，功能清单和设计事实来源由关联 docs 计划承接。
- 不修改调度协议、配置持久化、模型实际执行或依赖版本；保留工作区已有的模型导入改动。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-loopplus-continue-model-summary.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 文档交付：[2026-11-04-docs-loopplus-continue-model-summary.md](2026-11-04-docs-loopplus-continue-model-summary.md)。本计划只承接摘要取值与渲染修复。

## 验收标准

- split 展示主模型、子-后端和子-前端及相应 CLI / 模型。
- fullstack 只展示主模型和实际子-全栈，不误显隐藏的前后端配置。
- 原配置与当前配置模式不同时，两个选项分别展示正确角色。
- 旧任务沿用现有模式推断；缺失模型、CLI 默认模型和不可恢复原配置正常展示。
- 相关回归测试、`npm run build` 和本机 Chromium 弹窗验证通过。

## 影响面与风险

- 代码：`src/continueModelChoice.ts`、`src/panelDiagnostics.ts`、群聊 Webview 文案及渲染。
- 历史测试影响面包括 `src/test/loop/loopGroupChatCoordinator.test.ts`、`src/test/loop/loopGroupChatPanel.test.ts` 等新增回归，删除审计仅保留摘要；`2026-11-04-docs-loopplus-continue-model-summary.md` 承接功能清单和 Loop+ 调度设计同步。本计划仅记录修复验证证据，不承接回归开发。
- 风险：误把隐藏角色作为实际模型、预览与续跑配置不一致、影响经典 Loop。通过模式交叉矩阵及旧任务测试规避。

## 验证计划

- 历史顺序为补回归用例、确认失败后修复实现，结果见下文；原 test 计划已删除，其摘要按上列删除审计中的完整来源值定位。
- 单元自测：`npm run build && node --test dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/continueModelChoice.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopPlusSubtaskMode.test.js`。
- 浏览器：使用实际群聊 HTML 与隔离的 VS Code Webview bridge，在 Chromium 中打开续接弹窗，检查两组选项文案及切换；不调用真实模型或改动用户配置。
- 结构：`git diff --check`，按需验证 ontology 引用完整性。

## 任务列表

Tasklist:
- [completed] 定位续接任务文案与子模型配置
- [completed] 修复双子模型展示与摘要取值
- [completed] 验证模式边界并记录未覆盖宿主

## 验证结果与失败分流

- 红灯验证：新增 6 个回归用例全部失败，明确覆盖原模式遗漏、当前角色读取遗漏、双角色摘要及旧任务/缺失模型摘要问题；其余 30 项通过。日志：`/tmp/sinitek-loopplus-continue-red.log`。
- `npm run build`：通过。
- 最小相关六组单测：76 / 76 通过；最终增加经典 Loop 隐藏角色保护断言，并扩展到 `dist/test/webview/loopPlusFullstackMode.test.js`、`dist/test/core/panelDiagnostics.test.js`，112 / 112 通过。日志：`/tmp/sinitek-loopplus-continue-final-tests.log`。
- Chromium：原配置 split / 当前 fullstack 及反向切换，在 1280 × 1000、480 × 1000 两种视口共 4 / 4 通过。使用真实编译后的面板状态构建器、群聊 HTML 和内容增量更新，隔离 VS Code bridge；检查原/当前摘要、隐藏角色不出现、选项可切换、元素在视口内且不重叠。无浏览器、HTTP 或请求错误，已查看桌面及窄屏截图。
- 浏览器最初一次失败属于夹具断言问题：同 CLI 的后端摘要保持既有模型名格式，不额外补 CLI 前缀；修正合成场景预期后全部通过，未因此修改产品代码。
- 浏览器证据：`/tmp/sinitek-loopplus-continue-smoke/continue-fullstack-to-split-1280/result.json`、`/tmp/sinitek-loopplus-continue-smoke/continue-fullstack-to-split-480/result.json`、`/tmp/sinitek-loopplus-continue-smoke/continue-split-to-fullstack-1280/result.json`、`/tmp/sinitek-loopplus-continue-smoke/continue-split-to-fullstack-480/result.json`；截图在对应目录的 `success.png`。
- UI 机械检测无新增问题；`git diff --check`、`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 均通过。
- 未启动真实 VS Code Extension Development Host 或调用真实模型：本次只修复面板摘要与预览取值，不改变执行参数和调度语义，使用隔离浏览器覆盖真实页面渲染和交互。

## 文档与记忆判断

- 关联 docs 计划承接 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `.ch/docs/design-docs/loop-plus-scheduling.md` 同步；本计划仅引用该交付结果。
- 本次未改变业务概念、角色归属、模式状态机或执行契约，既有 ontology 的角色路由规则仍成立，无需改动 ontology 数据。
- 根因及模式兼容边界已进入设计事实来源；单次 UI 修复不额外扩写热区记忆或新增 runbook，不写入 `ROLLING_SUMMARY.md` / `EVENT_MEMORY.md`。

## 当前结论

已修复摘要格式化和当前配置预览取值两处根因，原配置/当前配置独立展示各自模式，经典 Loop 保持兼容；历史记录中的构建、112 项相关回归和 4 组 Chromium 场景全部通过（结果见本计划上文，删除审计仅保留摘要），无未决实现事项。代码定位使用 CodeGraph，图谱提示变动的文件均按磁盘源码核对。
