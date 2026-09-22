# Loop 与 Graph 继续时选择主子模型

- 日期：2026-09-22
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-22
- claim_ttl：1d

## 背景

Loop 群聊和 Graph 运行图都有“我要说话”页面。继续时此前会直接使用某一套模型，用户无法在保持任务原主/子模型和当前 Loop 模式新配置之间选择。

## 目标

在这两个页面点击继续时，让用户选择保持已绑定的主/子模型，或改用当前 Loop 模式配置的主/子模型。

## 范围

- Loop 群聊继续确认框和 Graph 运行图继续确认框。
- Loop 任务创建时记录主/子模型；选择新配置时写回 Loop 或 Graph 的 modelRouting。
- 中英文文案、规格、设计和 ontology。

## 非目标

- 不改变主任务 Tab 直接输入继续、Graph 自动唤醒、Retry 和 Feedback 的模型选择。
- 不新增思考力度的独立继续选择。
- 不为没有记录原模型的历史任务伪造原模型。

## 验收标准

- [x] Loop 群聊和 Graph 运行图继续前展示两个互斥选项。
- [x] 已记录原模型时可以选择保持原主/子模型。
- [x] 选择新配置时使用当前 Loop 主/子模型并写回绑定。
- [x] 未记录原模型时原模型选项不可用。
- [x] 中英文文案和相关规格同步。

## 影响面

- 代码目录：`src/continueModelChoice.ts`、`src/loopTaskStore.ts`、`src/panelDiagnostics.ts`、`src/extensionHost/graphRuntime.ts`、`src/extensionHost/graphControls.ts`、`src/webview/loopDebatePanel*.ts`、`src/webview/graphRunPanel*.ts`
- 文档目录：产品规格、设计文档、运行时参考、ontology
- 配置与脚本：无

## 风险与缓解

- 风险：历史 Loop 任务没有原模型记录。
- 缓解：原模型选项禁用，并继续使用当前 Loop 配置。

## 验证计划

- `npm run build`
- `node --test dist/test/loop/continueModelChoice.test.js dist/test/loop/loopDebateCoordinator.test.js dist/test/loop/loopDebatePanel.test.js dist/test/graph/graphRunPanel.test.js dist/test/graph/graphExtensionRuntime.test.js`

## 决策记录

- 2026-09-22：新配置指当前 Loop 模式的主/子模型，不是普通 Coding 单模型。
- 2026-09-22：选择新配置后写回任务或 run，后续自动续跑沿用这次选择。

## 当前结论

Loop 群聊和 Graph 运行图继续前可以选择保持已绑定主/子模型，或改用当前 Loop 模式配置。选择新配置会写回 modelRouting。

验证：
- `npm run build` 通过。
- `node --test dist/test/loop/continueModelChoice.test.js dist/test/loop/loopDebateCoordinator.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/graph/graphRunPanel.test.js` 33/33 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。
- `dist/test/loop/loopDebatePanel.test.js` 有 1 条既有失败：`covers Loop debate panel lifecycle...` 期望英文 `Red/Blue debate group chat`，但本机工具语言设置为 zh-CN，`panel.show` 走 `resolveLocale()` 渲染中文。与本次模型选择无关。

