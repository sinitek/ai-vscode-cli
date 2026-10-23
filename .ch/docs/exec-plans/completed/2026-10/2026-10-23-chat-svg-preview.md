# 最终回复 SVG 展示

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex

## 目标与范围

在已有聊天图片能力上，允许 AI 按需在最终回复使用 `svg` 代码围栏绘制自包含 SVG，自动展示并复用内容区点击预览。同步支持 Markdown SVG data URL。未标记为 svg 的代码及原始 HTML 保持原行为，不接入生图服务、不增加依赖。

## 验收与风险

- 提示规则明确 SVG 围栏、完整根元素、xmlns、viewBox 与自包含要求；普通对话和隐藏重试均生效。
- SVG 使用图片 data URL 加载，不将 SVG/HTML 直接插入聊天 DOM；预览仍禁用脚本及本地资源。
- 中文、缺省 xmlns、编码与 base64 SVG 可显示；拒绝 DTD、实体声明、超大和非 SVG 内容，其他代码仍显示为代码。
- 点击及键盘操作复用已有预览协议；验证 SVG 脚本、事件处理及外部资源不会执行或请求。

## 验证计划

- `npm run build`。
- 图片与 SVG、提示词、JSON 树、面板宿主、最终回复相关单测。
- Chromium 桌面/窄屏 SVG 实际解码、交互、尺寸及安全隔离检查；原生 VS Code 内容区仍由用户人工验收。
- 产品规格、功能清单、Ontology 同步；本体校验与 `git diff --check`。

## 当前结论

CodeGraph 确认提示词入口，新增图片 helper 尚未入图；直接核对当前实现后，决定继续复用 Marked 与图片预览，不执行内联 SVG。

## 实现与影响面

- `src/finalAnswerProtocol.ts` 增补可选 SVG 围栏说明，普通请求及隐藏重试复用原规则；机器协议 opt-out 不变。
- `src/webview/chatImagePreview.ts` 统一规范化 SVG：支持编码/base64 data URL，补齐 xmlns；缺少宽高且 viewBox 有效时补齐尺寸，已有尺寸不覆盖；限制 UTF-8 源码为 256 KiB，拒绝 DTD、实体声明及明显非 SVG。
- `src/webview/viewContentScript/traceRendering.ts` 复用现有 Marked renderer 和图片按钮；svg 围栏经 XML 解析检查后转换为 img，其他代码及原始 HTML 不改变，非法 SVG 保留源码。
- 鼠标与 Enter/Space 复用已有预览协议及 VS Code 宿主路由，不新增事件类型、外部服务或依赖。
- 更新产品规格、功能清单和既有 Ontology 规则；尺寸陷阱进入 runbook。没有新的架构边界或用户偏好，不重复写入热区、事件记忆或滚动摘要。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/webview/chatImagePreview.test.js dist/test/webview/viewProvider.test.js dist/test/webview/jsonTreeMessageRender.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js`：37 项通过，0 失败；日志 `/tmp/sinitek-chat-svg-tests.log`。
- `node --test dist/test/webview/clipagescriptruntimecoverage.test.js`：81 项中 77 通过、4 失败。新增 renderer.code 绑定要求在三处 Marked mock 补齐 code 方法；剩余三项摘要位置断言及一项缺少 enabledRuleCliNames 的隔离夹具失败，与前一轮图片任务的 HEAD 对比结果一致，归类为历史断言/夹具问题，不扩大修复范围。日志 `/tmp/sinitek-chat-svg-expanded.log`，基线见 `.ch/docs/exec-plans/completed/2026-10/2026-10-23-chat-image-preview.md`。
- Chromium 使用当前构建的完整聊天 HTML 和模拟 VS Code bridge：1440×1000 桌面、420×900 窄屏、900×600 独立预览三组通过。检查中文、base64、只有 viewBox 且无 xmlns 的 SVG 实际解码和可见尺寸，点击/Enter/Space 发送预览请求，按钮不裁切、图片不溢出，非法 XML 保留为代码；三组浏览器、HTTP 与请求失败均为空，截图已人工查看。
- 安全样本同时包含 script、onload、外部 image 和 foreignObject HTML 图片：聊天 DOM 无内联 SVG，脚本未执行，服务端外部请求计数为 0；预览 HTML 不含脚本或内联 SVG。
- 首轮 Chromium 上下文启动卡住，关闭本任务浏览器后以 `--disable-gpu` 重跑通过，未修改通用 runner。首轮有效截图发现 viewBox-only SVG 实际尺寸为 0；补齐固有尺寸后重新构建、通过 37 项相关测试及三组浏览器验证，记录至 `.ch/docs/runbooks/PITFALLS.md`。
- UI 机械扫描结果为 `[]`（`/tmp/sinitek-chat-svg-design.json`）；Ontology 校验、9 项本体脚本单测及 `git diff --check` 通过。
- 浏览器命令：`node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/chat-svg-preview/{desktop,narrow,preview}.json`，三份场景逐一执行；截图和结果保留在忽略目录 `.tmp/chat-svg-preview/{desktop,narrow,preview}-result/`。任务结束移除临时服务和场景文件，停止本任务服务。

## 验收边界与回退

- 未自动重启 VS Code、覆盖已安装扩展或调用生图 API。真实 Extension Host 的内容区展示仍按用户约定人工验收；浏览器桥接为模拟，原生预览路由另有单测覆盖。
- 不改动用户已有 README 及前一轮图片功能、技能安装；不更换框架、技术栈或依赖。
- 如需回退 SVG 能力，只撤销本轮 SVG helper 分支、代码围栏 renderer、提示增量和对应测试/规格，保留前一轮 Markdown 图片与原生预览能力。
