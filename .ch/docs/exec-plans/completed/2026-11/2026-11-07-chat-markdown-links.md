# AI 对话 Markdown 链接打开

- 日期：2026-11-07
- 状态：completed
- 负责人：Codex

## 背景与目标

普通助手答复的 Markdown 链接直接落入 Webview 导航，没有扩展宿主打开链路，生成的 PPTX、PDF、页面总览等文件链接可能点击无效。建立普通对话及 Loop 群聊共享的受限链接协议，优先在 VS Code 编辑器区打开。

## 范围与非目标

- 覆盖 Markdown 链接渲染、点击委托、宿主路径解析、图片与 Markdown 预览、默认文件编辑器和错误恢复。
- 支持绝对/相对路径、file URI、sandbox 本地路径、中文空格、Windows 驱动器与 UNC；网页交给系统浏览器。
- 不增加 PDF/Office 渲染依赖，不自动安装扩展，不执行命令链接，不伪造 sandbox 文件或猜测替代路径。

## 验收标准

- 本地文件链接发往宿主，不在 Webview 内跳转；图片复用现有受限预览，Markdown 使用内置预览，其他文件使用 VS Code 文件编辑器。
- PDF/PPTX 等格式优先调用已安装且声明相应类型的自定义预览编辑器；没有预览器时不进入二进制文本编辑器，提供中文说明及显式选择编辑器、系统打开或查找预览扩展选项。
- 危险协议、凭据 URL、空地址被拒绝；不存在文件给出中文提示。
- 新增解析、渲染、点击和宿主回归测试，构建及相关页面测试通过。

## 影响面与风险

- 代码：`src/webview/`；测试：`src/test/webview/`。
- 文档：功能清单、产品能力说明、运行时设计及 ontology。
- 风险：模型生成的地址跨越 Webview/宿主信任边界；前后端均校验地址，仅用户点击触发打开，不执行任意协议。
- 回滚：撤回共享链接渲染及消息路由，不影响现有图片能力。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/chatLink*.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/viewProvider.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`
- 本机 Chromium 渲染真实 Markdown 并点击文件/网页链接验证消息桥；不将浏览器替代真实 Extension Host 验收。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 测试与清单同步

- 新增 `chatLink.test.ts`、`chatLinkHost.test.ts`，覆盖协议拒绝、路径解析、Windows/UNC、行列、真实 Marked 渲染、点击、文件打开、预览器缺失和失败恢复；更新 `chatImagePreview.test.ts` 的多监听器夹具及 `viewProvider.test.ts` 的宿主路由回归。
- `npm run build`：通过。
- `node --test dist/test/webview/*.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`：479/479 通过。
- 首轮最小测试 83/85：一项是新增点击监听器后的旧夹具覆盖监听器问题，分类为夹具问题；另一项是 `README.md:8` 被误判为协议，分类为实现缺陷，修正为允许有文件扩展名的行列后缀。修正后最小测试 86/86；再补充预览器缺失用例后页面与群聊扩大回归 479/479。
- Chromium：复用缓存 Playwright/Chromium 和仓库 smoke runner，临时静态夹具加载真实 Marked、共享 Markdown 脚本、普通消息区事件绑定与群聊点击处理片段。分别点击 PPTX、图片总览、网页，并用 Enter 激活 PDF；两种入口均收到 4 条正确 `openChatLink` 消息，没有导航/浏览器/网络错误。截图与结果在 ignored 的 `.tmp/chat-links-smoke/`、`.tmp/loop-chat-links-smoke/`。
- 浏览器首轮失败是临时夹具未调用已有 `neutralizeInlineScriptEndTags` 导致内联脚本提前闭合，分类为夹具问题；复用现有 helper 后两次通过，不修改产品脚本嵌入方式。临时 server/scenario 收尾删除。
- 功能清单、产品能力说明、运行时设计及 ontology 已同步。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、112 rules）。`git diff --check`：通过。
- `npm run validate:whitespace`：失败仅命中未修改的 `AGENTS.md:8`；`git diff -- AGENTS.md` 为空，`git show HEAD:AGENTS.md` 可复现该行尾空格，分类为历史/范围外问题，不修改根级规则。改用 `{ git diff --name-only --diff-filter=ACMR -z; git ls-files --others --exclude-standard -z; } | xargs -0 node scripts/check_trailing_whitespace.js` 校验全部本次变更（含新文件）：通过。

## 决策与当前结论

- 根因是普通 Markdown 链接未接入扩展宿主，而非 Marked 未生成链接；普通对话、历史回显及群聊共用一个实现，不另造文件浏览器。
- 默认二进制文本编辑器可能打开成功却没有文档预览，因此 PDF/Office 先检查已有自定义预览声明，不依赖 `vscode.open` 抛错才反馈缺失预览器。
- 不增加解码依赖、不自动安装预览扩展、不猜测不存在的 sandbox 路径；本次不改持久化原文或图片下载协议。
- 未运行完整 VS Code Extension Development Host 端到端；真实 PDF/PPTX 预览内容仍取决于用户安装的扩展。Chromium 验证只证明真实浏览器中的渲染与消息桥，宿主文件分流由单元测试验证。
- 未执行发布脚本或自动安装构建产物；没有运行无关全量核心单测。
- 记忆判断：本次稳定规则进入产品规格、运行时设计和 ontology；不修改热区或 `ROLLING_SUMMARY.md`，不追加例行任务日志。
