# 聊天本地图片预览与下载

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex

## 背景与目标

上一轮仅允许 HTTP(S) 与 data URL，本地生成图片被拒绝，独立预览不能依赖聊天 Webview 的资源地址。本轮由扩展宿主解析本地图片，修复内容区预览，并为图片与 SVG 提供下方下载链接。

## 范围与非目标

- 范围：Markdown 图片、SVG 围栏、资源解析桥接、内容区预览、系统另存为、提示词、测试与规格。
- 非目标：更换框架、依赖、重启 VS Code、安装扩展、调用图片生成 API、修改无关 README。

## 验收标准

- 本地绝对路径、工作区相对路径、file URI、HTTP(S) 与 data URL 图片可以预览。
- SVG 与普通图片下方有可键盘操作的“下载图片 / 下载 SVG”链接；通过系统另存为写入实际图片字节，取消不写文件。
- 本地图片由宿主转换为受限图片数据，不放开 Webview 文件系统根目录；脚本协议、非图片和超限文件拒绝并提示。
- Linux/macOS、Windows 路径均有回归覆盖；SVG 仍通过 img 被动展示。

## 影响面与风险

- 代码：src/webview、src/finalAnswerProtocol.ts、对应测试。
- 文档：功能清单、能力规格、本体、PITFALLS。
- 风险：本地读取、远程下载超限、预览竞态、保存覆盖；采用格式校验、大小限制、超时、最新请求约束及系统保存对话框缓解。

## 验证计划

- 单元自测：npm run build；node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js。
- 浏览器：结构化 Chromium 场景覆盖本地加载、预览点击、下载、SVG、窄屏、错误提示。
- 真实 Extension Host 用户手工验收；不自动重启或替换插件。

## 测试与清单同步

- 单元测试新增/更新：新增 chatImageResource.test.ts，扩展 chatImagePreview.test.ts、viewProvider.test.ts、promptRuntime.test.ts。覆盖真实临时图片、file URI/相对/Windows/UNC 路径、图片格式与大小、HTTP 状态与分块超限、异步加载状态、预览竞态、系统保存、取消与 SVG 矢量保留。
- 单元自测命令：`npm run build`；`node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/chatImageResource.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`。
- 单元自测结果：构建通过，43 项相关测试全通过；日志 `/tmp/sinitek-local-image-tests.log`。
- 扩展验证：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，81 项中 77 通过、4 项失败；三项指令折叠摘要位置断言与一项缺少 enabledRuleCliNames 的隔离夹具，与前两轮已复现的 HEAD 基线一致，不修改范围外逻辑。日志 `/tmp/sinitek-local-image-expanded.log`，基线见同目录 2026-10-23-chat-image-preview.md。
- 失败处理记录：首次编译暴露消息回调返回类型不一致，已改为显式异步 Promise<void>，重跑构建及测试通过。浏览器夹具缺少 sharp，未安装依赖，改用 Node 内置 zlib 生成 PNG。
- 浏览器验证：结构化 Chromium 场景在 1440×1000 与 420×900 通过，实际生产渲染/事件函数配合 provider 与真实本地文件读取；系统保存对话框和 Webview bridge 为模拟，保存使用真实临时文件并逐字节比对 PNG 与 SVG。覆盖实际解码、鼠标与键盘预览、下载链接、无裁切溢出及缺失文件中文提示，浏览器、HTTP 和请求错误均为 0。截图已查看，结果位于 ignored 的 `.tmp/chat-local-image-preview/{desktop-result,narrow-result}/`。
- 机械设计扫描：仅命中原有 blockquote 的 border-left，HEAD 已存在，不在本轮修改；日志 `/tmp/sinitek-local-image-design.json`。
- 文档与本体：已同步 FEATURE_INVENTORY.md、sinitek-cli-plugin-capabilities.md、cli-plugin-runtime.json 和 PITFALLS.md；本体验证通过、9 项脚本测试通过，`git diff --check` 通过。

## 当前结论

- 已完成：宿主读取并校验本地图片，转换为 data URL；预览与下载复用相同资源解析，不依赖 HTTP 服务或 Webview 私有地址，也不扩大本地资源根目录权限。
- 图片与 SVG 下方提供系统另存为下载链接；SVG 保留矢量格式。提示词同步允许真实本地图片并建议绝对路径。
- 未覆盖：真实 VS Code Extension Host 和系统另存为对话框由用户验收；未自动重启 VS Code、替换安装插件、调用生成 API、提交代码或修改无关 README/package/coreBootstrap 变更。
- 稳定经验已沉淀 PITFALLS，不额外扩写热区记忆和 EVENT_MEMORY。
