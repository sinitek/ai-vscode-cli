# 对话图片输出与内容区预览 — 新功能开发

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-23-chat-image-preview.md`（历史标识，原文件已替换）
- 关联计划：[维护/构建/发布治理](2026-10-23-chore-draw-ai-image-installation.md); [文档](2026-10-23-docs-chat-image-preview.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

新增最终回复图片展示与内容区预览，不调用生成服务。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。chore 用户技能安装不是 feature 图片预览的运行时前置；两者独立交付，生图端到端仍需用户环境与人工验收。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-23-feature-chat-image-preview.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标与范围

- 复用现有 Markdown 渲染，向普通对话及隐藏重试的最终回复规则补充图片格式；图片在气泡内自适应显示，点击或键盘激活后在 VS Code 内容区预览。

## 非目标

- 不重建聊天渲染系统，不调用付费生图服务，不读取任意本地图片文件，不修改现有 CLI 配置或技术栈。保留开始任务后发现的其他工作区改动。

## 验收标准

- 普通对话与隐藏重试提示包含 `![图片说明](图片地址)` 输出约定，不伪造图片地址。

- HTTP(S) 与受限图片 data URL 能展示；脚本协议、任意 HTML、文件协议不能用于图片加载或预览。

- 图片不超出气泡，支持鼠标及键盘打开内容区预览，不调用外部浏览器。

- 相关回归测试、`npm run build`、浏览器冒烟通过；宿主真实使用由用户验证。

## 影响面与风险

- 提示规则：`src/finalAnswerProtocol.ts`。

- 图片展示和预览：`src/webview/`。

- 预览 Webview 禁用脚本、本地资源和默认网络权限，仅允许经过校验的图片源。

## 验证计划

- `npm run build`。

- `node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js`。

- 对生成的实际 Webview HTML 做 headless Chromium 图片加载、点击与窄屏布局验证。

## 验证结果

- `npm run build`：通过。

- 上述最小相关单测：25 项通过，0 失败；另执行 `node --test dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`，10 项通过。

- `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`：81 项中 77 通过、4 失败。三项指令折叠摘要位置断言过期，一项隔离测试缺少 `enabledRuleCliNames`。将 HEAD 版本测试编译至临时目录、针对这四项运行，复现相同失败；对应业务源码没有本轮修改，归类为历史断言/夹具问题，不扩大修复范围。

- Chromium 冒烟使用当前构建生成的完整聊天 HTML 与模拟 VS Code bridge：1440×1000、420×900 两种视口，验证 HTTP 与 data 图片真实解码、点击请求预览、图片无裁切且不溢出；桌面另验证 Enter/Space 请求预览。独立预览 HTML 验证通过，三组均无浏览器/网络错误。截图保留在忽略目录 `.tmp/chat-image-preview/` 下的三个 `*-result/` 目录。

- 首轮截图发现全局按钮 26px 固定高度裁切图片；已通过图片按钮 `height: auto` 修复。

- UI 静态扫描只报告原有 Markdown blockquote 的 3px 边线提醒，与本次图片样式无关，未改动。

- Ontology 校验和 `git diff --check` 通过；产品规格、功能清单与本体规则同步。

## 技能安装与人工验收边界

- 没有调用生图 API、探查或写入用户密钥；实际生成依赖用户现有的 API 环境配置。

- 未自动重启 VS Code、启动真实 CLI 生图或覆盖已安装扩展。真实 Extension Host 内的内容区打开行为和生图端到端流程留给用户按约定验证；本轮浏览器使用模拟 bridge，宿主路由以单测覆盖。
