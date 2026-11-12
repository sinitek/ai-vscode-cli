# 思考气泡五行滚动与展开收起 — 新功能开发

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：本次任务
- handoff_to：无
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-thinking-bubble-scroll.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-thinking-bubble-scroll.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

为思考气泡新增五行滚动和展开收起。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-feature-thinking-bubble-scroll.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 长思考内容占据过多聊天空间。仅对思考气泡提供默认五行可视高度、溢出滚动、新内容自动滚底，以及 SVG 图标一键展开和再次收起。

## 范围与非目标

- 范围：思考识别、消息创建及流式/Markdown 更新、主题样式、按钮文案。

- 非目标：不改变最终结论、工具结果、普通回复、CLI 协议或会话持久化。

- 保留工作区已有未提交修改，不创建分支或重置文件。

## 验收标准

- 思考正文按实际显示行高限高五行，长行换行也计入，超过时可滚动。

- 新增思考内容时，收起状态的内部滚动条自动到底部，不强制移动聊天外层。

- 长思考提供带 SVG、可键盘操作且含可访问名称的展开/收起按钮；短内容隐藏按钮。

- 展开显示全部正文，再次收起恢复五行并显示最新内容；重新渲染和流式更新保留展开状态。

- 最终结论、普通消息和工具结果不受影响。

## 影响面与风险

- 代码：`src/webview/viewContentScript/messageRendering.ts`、`src/webview/viewContentStyles/messages.ts`、`src/webview/viewContentStrings.ts`。

- 风险：运行中复用纯文本节点、结束时切换 Markdown、面板宽度变化可能导致高度和展开状态回退；用统一装饰与同步入口和浏览器验证覆盖。

- 文案沿用当前 Webview 的统一 `WEBVIEW_STRINGS` 入口；不另建语言分支。

## 验证计划

- 浏览器：复用本机 Playwright/Chromium，覆盖五行边界、流式滚底、SVG 按钮展开/收起、重绘、窄面板和最终结论排除。

## 任务列表

- Tasklist:

- [completed] 定位思考气泡实现与验证入口

- [completed] 实现五行限高、自动滚底及展开收起

## 测试与清单同步

- `npm run build`：最终执行通过。

- `node --test dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/looppluswebviewintegration.test.js`：72/72 通过。

- `node --test dist/test/webview/*.test.js`：最终执行 175/175 通过。

- 旧内容断言改查思考正文容器。

- 浏览器命令：`node .tmp/thinking-bubble/browser-smoke.cjs`。复用 `/tmp/pw-run/node_modules/playwright` 和本机 Google Chrome，无新增依赖；使用真实生成的 Webview HTML/脚本、模拟 VS Code API，非 Extension Development Host。

- Chromium 在 980px 和 360px 两个宽度验证：五行以内按钮隐藏；长文本和自动换行均限高 112px（14px 字号、22.4px 行高）；thinking trace 限高 96px（12px 字号、19.2px 行高）；新增内容内部滚底；SVG 点击与 Enter 切换；流式追加、重绘及 Markdown 更新保留展开；宽度变化重算按钮可见性；外层滚动浏览位置不被内部滚底抢占；最终结论无五行限制。页面、控制台及网络错误均为零。

- 本机验证产物：`.tmp/thinking-bubble/result.json`、`collapsed-980.png`、`expanded-980.png`、`collapsed-360.png`、`expanded-360.png`，仅本地留存。

- ontology：新增 `plugin.rule.thinking_bubble_viewport` 并附当前事实来源；精确查询通过。全量 `--validate` 仍报 15 条既有缺失设计文档引用；对比 HEAD 的 JSON 同样是这 15 条缺失引用，未在本任务扩范围修复。

- 空白：`git diff --check` 在本次文件范围通过；全文件空白脚本发现 `viewContentStrings.ts` 的既有 `thinkingOptionOff` 行末空格，HEAD 同样存在，本次未改该行。

- UI 检测器：只报告最终结论已有的 4px 强调边框，不属于本次思考气泡新增样式，保持不变。

- 过程失败分类：初次执行暴露测试夹具不支持真实 DOM 关系及嵌套正文断言，已修夹具；并行工作中 Grok 测试类型错误和新增指令折叠测试短暂失败均未由本任务修改，最后构建及 Webview 全量重跑通过。

- 记忆判断：局部交互改进，不写滚动摘要；无可复用事故或迁移记录则不写事件记忆。

## 当前结论

- 实现与验收完成。保留原有主题与最终结论展示；本任务不改变 CLI、持久化、跨平台路径或既有聊天外层滚动契约。已归档至 `.ch/docs/exec-plans/completed/2026-10/2026-10-18-feature-thinking-bubble-scroll.md`。
