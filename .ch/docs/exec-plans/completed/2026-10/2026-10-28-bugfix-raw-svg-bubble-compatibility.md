# 裸 SVG 气泡兼容 — 已发布行为修复

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-28-raw-svg-bubble-compatibility.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-28-docs-raw-svg-bubble-compatibility.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复整段原始 SVG 气泡不能复用安全图片预览。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-28-bugfix-raw-svg-bubble-compatibility.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 完整 SVG 未使用 Markdown 围栏时被当作原始 HTML 转义，无法复用现有图片预览。仅在气泡整段去除首尾空白后以 SVG 根标签开头、结束标签结尾时，于共享 Markdown 显示层补充 svg 围栏，不修改持久化消息。

## 范围与非目标

- 范围：共享 Markdown 渲染。

- 非目标：不修改 CLI 协议、提示词、历史消息、流式时序、主题或图片安全策略。

## 验收标准

- 单行、多行、CRLF 和首尾空白的完整裸 SVG 与显式 svg 围栏展示一致。

- 已有围栏不重复包裹；说明文字混排、未闭合 SVG 和普通 HTML 保持原行为。

- 图片预览和下载复用已有实现，256 KiB 与 DTD/实体校验不变。

- 构建、相关单测与 Chromium 实际 SVG 加载验证通过。

## 影响面与风险

- 共享 `src/webview/chatMarkdown.ts` 同时供普通对话和 Loop / Loop+ 使用。

- 仓库已有其他未提交修改，避免覆盖；本次修改使用局部补丁。

- 风险：误把 HTML 或部分流式 SVG 转为图片；通过完整根标签边界和反例测试约束。

- 回滚：撤销本次局部渲染条件和对应测试即可，不涉及数据迁移。

## 验证计划

- `npm run build`：通过。

- `node --test --test-reporter=dot dist/test/webview/chatMarkdown.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/loop/loopGroupChatPanel.test.js`：37 项通过。

- Chromium smoke scenario `raw-svg-bubble-compatibility`：passed；browserErrors、httpErrors、requestFailures 均为 0；截图 `/tmp/raw-svg-bubble-smoke-results/success.png`。验证裸 SVG 和显式围栏图片实际解码、尺寸一致、预览下载调用，且混排及残缺 XML 不误转图片。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。

- `node scripts/check_trailing_whitespace.js` 与 `git diff --check`：通过。

## 测试与清单同步

- 不改变架构和运维，无需更新相关文档。

- 不产生跨会话开放事项或通用新规，暂不更新热区记忆。

## 当前进展

- 已定位共享显示入口及现有 SVG 图片转换链路。

- 最新工作区检索到 908 个 Codex 消息存储，仅 1 条 SVG 相关命中，但来源为已带 `xml` 围栏的搜索结果；没有发现需要裸 SVG 自动围栏的实际 Codex 记录。需求依据为兼容性诉求。

- 构建、37 项相关单测、Chromium 实际渲染、ontology 校验与 diff/空白校验均通过；临时冒烟服务已关闭。
