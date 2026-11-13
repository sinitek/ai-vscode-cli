# 聊天本地图片预览与下载 — 新功能开发

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-23-chat-local-image-download.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-23-bugfix-chat-content-image-preview.md); 原 docs companion `2026-10-23-docs-chat-local-image-download.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 依赖与背景

历史职责边界：feature 本地读取/下载和 bugfix 独立预览复用同一受限资源桥；预览正确性依赖后者去除 Webview 私有地址依赖。

## 历史归档范围

新增本地图片资源读取与图片/SVG 系统下载。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

## 历史验证与未决事项

兼容同源归档的既有标题入链。历史结果见下方“测试与清单同步”和“当前结论”：保留扩展回归 77/81、4 项基线失败及编译/夹具修复；浏览器 bridge 和保存对话框为模拟，真实 Extension Host 与系统另存为未覆盖。以下均为当时记录，本轮未重跑。

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
