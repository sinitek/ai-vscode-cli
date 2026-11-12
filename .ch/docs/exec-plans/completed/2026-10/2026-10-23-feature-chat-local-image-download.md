# 聊天本地图片预览与下载 — 新功能开发

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-23-chat-local-image-download.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-23-bugfix-chat-content-image-preview.md); [文档](2026-10-23-docs-chat-local-image-download.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

新增本地图片资源读取与图片/SVG 系统下载。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 本地读取/下载和 bugfix 独立预览复用同一受限资源桥；预览正确性依赖后者去除 Webview 私有地址依赖。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-23-feature-chat-local-image-download.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 上一轮仅允许 HTTP(S) 与 data URL，本地生成图片被拒绝，本轮由扩展宿主解析本地图片，并为图片与 SVG 提供下方下载链接。

## 范围与非目标

- 范围：Markdown 图片、SVG 围栏、资源解析桥接、内容区预览、系统另存为、提示词。

- 非目标：更换框架、依赖、重启 VS Code、安装扩展、调用图片生成 API、修改无关 README。

## 验收标准

- 本地绝对路径、工作区相对路径、file URI、HTTP(S) 与 data URL 图片可以预览。

- SVG 与普通图片下方有可键盘操作的“下载图片 / 下载 SVG”链接；通过系统另存为写入实际图片字节，取消不写文件。

- 本地图片由宿主转换为受限图片数据，不放开 Webview 文件系统根目录；脚本协议、非图片和超限文件拒绝并提示。

- SVG 仍通过 img 被动展示。

## 影响面与风险

- 代码：src/webview、src/finalAnswerProtocol.ts、对应测试。

## 验证计划

- 单元自测：npm run build；node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js。

- 浏览器：结构化 Chromium 场景覆盖本地加载、预览点击、下载、SVG、窄屏、错误提示。

- 真实 Extension Host 用户手工验收；不自动重启或替换插件。

## 测试与清单同步

- 扩展 chatImagePreview.test.ts、viewProvider.test.ts、promptRuntime.test.ts。

- 单元自测命令：`npm run build`；`node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`。

- 单元自测结果：构建通过，43 项相关测试全通过；日志 `/tmp/sinitek-local-image-tests.log`。

- 扩展验证：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，81 项中 77 通过、4 项失败；三项指令折叠摘要位置断言与一项缺少 enabledRuleCliNames 的隔离夹具，与前两轮已复现的 HEAD 基线一致，不修改范围外逻辑。日志 `/tmp/sinitek-local-image-expanded.log`，基线见同目录 2026-10-23-feature-chat-image-preview.md。

- 失败处理记录：首次编译暴露消息回调返回类型不一致，已改为显式异步 Promise<void>，重跑构建及测试通过。浏览器夹具缺少 sharp，未安装依赖，改用 Node 内置 zlib 生成 PNG。

- 浏览器验证：结构化 Chromium 场景在 1440×1000 与 420×900 通过，实际生产渲染/事件函数配合 provider 与真实本地文件读取；系统保存对话框和 Webview bridge 为模拟，保存使用真实临时文件并逐字节比对 PNG 与 SVG。覆盖实际解码、鼠标与键盘预览、下载链接、无裁切溢出及缺失文件中文提示，浏览器、HTTP 和请求错误均为 0。截图已查看，结果位于 ignored 的 `.tmp/chat-local-image-preview/{desktop-result,narrow-result}/`。

- 机械设计扫描：仅命中原有 blockquote 的 border-left，HEAD 已存在，不在本轮修改；日志 `/tmp/sinitek-local-image-design.json`。

## 当前结论

- 图片与 SVG 下方提供系统另存为下载链接；SVG 保留矢量格式。提示词同步允许真实本地图片并建议绝对路径。

- 未覆盖：真实 VS Code Extension Host 和系统另存为对话框由用户验收；未自动重启 VS Code、替换安装插件、调用生成 API、提交代码或修改无关 README/package/coreBootstrap 变更。
