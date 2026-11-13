# 裸 SVG 气泡兼容 — 已发布行为修复

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-28-raw-svg-bubble-compatibility.md`（历史标识，原文件已替换）
- 关联计划：原 docs companion `2026-10-28-docs-raw-svg-bubble-compatibility.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 历史归档范围

修复整段原始 SVG 气泡不能复用安全图片预览。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

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
