# Vibe 路由误报与子任务 CLI 配置同步修复

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

Vibe（coding）消息可能带有残留的 Loop 子任务 CLI 路由字段，当前端或宿主将其误当成子任务路由时会报目标 CLI 配置缺失。另一个竞态是目标 CLI 配置已存在，但启动或切换后状态尚未同步到面板和宿主。

## 目标

让 Vibe 忽略并清理无关的子任务路由字段；Loop、Loop+、Graph 及子任务续跑在跨 CLI 配置 ID 尚未同步时，每隔 3 秒刷新并重查，最多重试 3 次，成功后派发，耗尽后明确失败。

## 范围

- 子任务路由发送门控与配置 ID 同步重试。
- Webview 路由提示、自动发送行为和用户文案。
- 回归测试、产品规格、功能清单与 Ontology 事实同步。

## 非目标

- 不改变主 CLI、主配置、同 CLI 路由或子任务执行语义。
- 不将显式跨 CLI 路由静默回退到主 CLI。

## 验收标准

- [x] Vibe 遇到残留跨 CLI 路由字段时正常发送，不显示缺配置错误。
- [x] 跨 CLI 配置 ID 缺失时每 3 秒刷新和重查，最多 3 次；同步成功则派发。
- [x] 重试耗尽时不派发，展示同步失败提示。
- [x] 构建、相关单测和 Ontology 校验通过。

## 影响面

- 代码目录：`src/`、`src/webview/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：无

## 风险与缓解

- 风险：等待和状态刷新延长发送响应时间。
- 缓解：只对需要跨 CLI 子任务配置 ID 的路由执行，最多等待 9 秒；Vibe 不进入重试路径。

## 验证计划

- 最小相关验证：构建后运行会话路由、配置重试与 Webview 子任务路由单测。
- 单元自测命令：`npm run build`；`node --test dist/test/session/sessionMessageActions.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/webview/loopSubtaskCliRoute.test.js`
- 扩展验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`；`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：Vibe 残留路由忽略、同步成功后派发、重试耗尽不派发。
- 单元自测结果：`npm run build` 通过；三组定向测试 44/44 通过；Ontology 校验通过；Ontology Python 单测 9/9 通过；`git diff --check` 通过。
- 失败处理记录：首次构建发现重试 helper 的 catch 分支给 `string | undefined` 变量赋 `null`；移除冗余赋值后重跑构建通过。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新产品规格及 `plugin.rule.loop_graph_cross_cli_subtask`。

## 任务列表

- [x] 完成核心路由和重试实现
- [x] 补齐重试耗尽集成回归
- [x] 同步规格、功能清单与 Ontology
- [x] 构建并运行相关验证
- [x] 记录结果并归档计划

## 决策记录

- 2026-10-28：配置未同步时由宿主作为最终权威重试，避免 Webview 的瞬时状态阻断发送；仅跨 CLI 子任务路由触发重试。

## 当前结论

核心修复、成功/失败回归与事实文档均已完成。`npm run build`、三组定向测试、Ontology 校验、Ontology Python 单测和 whitespace 检查通过。计划归档到 `.ch/docs/exec-plans/completed/2026-10/2026-10-28-vibe-subtask-cli-config-sync.md`。
