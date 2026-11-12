# OpenCode 配置列表删除图标 — 新功能开发

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-opencode-list-delete-icons.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-opencode-list-delete-icons.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

为 OpenCode Provider 和模型列表新增行内删除入口。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-feature-opencode-list-delete-icons.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 用户明确本次范围为 OpenCode 可视化配置的 Provider 列表和模型列表逐行增加删除图标，其它不动。

## 范围与非目标

- 复用现有删除确认、删除工具函数、主题图标和配置保存逻辑。

- 每行按钮删除对应条目，点击删除未选中项时保持当前编辑选择。

- 保留详情区原有删除按钮、列表宽度、新增和编辑入口；不改 Codex、Grok 或配置 schema。

## 验收标准

- [x] 两个列表每行名称右侧均有可访问的删除图标。

- [x] 确认删除对应条目，取消保持内容与当前选择。

- [x] 当前项删除后的回退和最后一项删除后的空态沿用现有逻辑。

- [x] 构建、相关单元测试、桌面和窄屏浏览器交互验证通过。

## 影响面与风险

- 代码：`media/config/assets/config-app-ui.js`

- 主要风险：删除按钮误用当前选中项、点击引发选中切换、窄列表挤压图标。通过显式传递目标、停止事件冒泡及浏览器检查控制。

## 验证结果

- `npm run build`：通过。

- `node --test dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/configappcompactcontrols.test.js dist/test/config/configappcompactlayoutstyles.test.js dist/test/config/codexConfigVisualEditor.test.js dist/test/config/grokConfigPage.test.js`：52/52 通过，含新增 3 项行内删除回归。

- Chromium + Playwright：加载实际生成的 Webview HTML 与仓库静态资源，以隔离宿主消息桥和配置夹具验证；桌面 `1440×1000`、窄屏 `390×844` 均通过。

- 浏览器覆盖：Provider/模型取消与确认、未选中目标删除后保留当前选择、当前及最后一项删除、空态、新增、详情区原删除入口、编辑保存与应用、档案切换后回读、JSON/可视化切换、未知字段保留、长名称下图标可点击且不重叠；页面、控制台和网络错误均为 0。

- 浏览器运行命令：`node /tmp/sinitek-opencode-list-delete-smoke/verify.cjs`；关键输出：`Chromium browser verification passed: desktop and mobile interactions, save/apply, empty states, zero errors.` 临时服务器、脚本与截图在收尾后清理。

- 边界：未在原生 VS Code Extension Development Host 内验证，也未读写用户真实 CLI 配置。保存与应用通过隔离宿主桥验证。

- 文件尾空白与 `git diff --check`：通过。

## 测试与文档同步

- 失败处理：构建与相关单测无失败。浏览器脚本初次运行遇到断言导入、中文按钮名称匹配和预览刷新路由问题，均属于临时验证夹具；修正后完整场景通过，无需追加产品改动。

- 不改变概念、关系、状态、输入输出或事实来源路径，无需更新。

- 记忆：当前任务记录保留于计划，无新增稳定运行约束或跨任务决策，无需更新热区或事件记忆。

## Tasklist:

- [completed] 确认 OpenCode 两个列表和现有删除逻辑

- [completed] 构建、浏览器验证与归档

## 当前结论

- 已完成 OpenCode 两个列表的删除图标与验证。详情区删除、新增编辑、布局宽度、配置结构和保存流程沿用既有行为。
