# ZCode 上下文用量与原生压缩修复 — 新功能开发

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-29-zcode-context-compaction.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-29-bugfix-zcode-context-usage.md); [文档](2026-10-29-docs-zcode-context-compaction.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

接入 ZCode 原生手动/自动压缩并按原生终态确认完成。

## 本子计划实施范围

仅承担下列归属条目的新功能开发；其它类型交付见关联计划。

## 本子计划验收

遵守下列原文相应契约和验收条件，保留追加决策的优先级；不扩大历史验证结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 原生压缩完成后发送的用量依赖 bugfix 的真实用量判定；accepted 不构成完成，原测试曾覆盖请求前监听和同会话终态，仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-29-bugfix-zcode-context-usage.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-29-bugfix-zcode-context-usage.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 背景与目标

- 且常用指令未开放压缩入口。核对本机官方 ZCode 0.17.0：帮助明确列出 `/compact`，协议支持 `session/compact`；因此保留真实用量与原生压缩。

## 范围与非目标

- 修正未知用量展示、手动压缩入口、自动压缩说明与原生压缩完成确认。

- 复用既有执行后自动压缩开关、会话映射、主题样式。

## 验收标准

- ZCode 常用指令可以触发原生压缩；运行时禁用，结束后恢复。

- 执行后自动压缩覆盖 ZCode，相关说明准确。

- 压缩恢复原生会话，等待真实终态才报告成功；失败、取消不误报。

## 影响面与风险

- 代码：`src/interactive/`、`src/contextCompactionRunner.ts`、`src/webview/`。

- 原生压缩异步返回 `accepted`，不能当作完成；需在请求前挂接终态监听，覆盖早到事件和恢复会话。

## 验证计划

- 最小测试：ZCode 协议、runner、上下文压缩及页面运行时相关测试。

- 本机验证：`zcode --version`、`zcode --help`、最小真实对话及原生压缩。

## 任务列表

- [completed] 核查 ZCode 上下文与压缩能力

## 实现结论

- 两处现有常用指令可见性判断均补入 ZCode，更新全局自动压缩说明及 5 分钟门槛文案。

- 压缩前启动／恢复 runner；在请求前监听原生同会话终态，忽略接收确认、无关会话和普通回合完成事件。失败、取消、退出和释放均终止等待，防止假成功。

- 压缩完成后向原 Tab 发送真实新用量，保留原生会话映射。

## 验证结果

- `node --test dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeRunner.test.js dist/test/core/contextCompactionRunner.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/loop/loopMainAutoCompact.test.js dist/test/config/zcodeConfig.test.js dist/test/interactive/zcodeTrace.test.js`：85 项通过。

- 首轮构建发现宿主消息端口只接受任务列表消息，已扩展为最小联合类型以支持压缩后的用量通知；工具设置既有文案契约要求“全局设置”，已保留并增加 ZCode 和门槛断言，相关测试重跑通过。

- 本机官方 `zcode --version` 为 0.17.0；真实 runner 实测初始化用量为 `null`，一轮最小对话用量为 17956 / 200000，原生压缩终态后为 7837 / 200000。独立原生协议探测也确认 `compact_started → accepted → session_compacted`，接收确认不是完成。

- headless Chromium：1440×900 与 420×900 各 7 个结构化场景，共 14 项通过。覆盖零值隐藏、真实用量及悬停来源、手动指令发送、压缩中禁用、完成刷新、失败恢复、能力不可用和工具设置入口；无页面错误、HTTP 错误或请求失败。已查看宽屏完成态、窄屏压缩态和窄屏设置截图。
