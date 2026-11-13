# AI 对话 Markdown 链接打开

- 日期：2026-11-07
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 功能实现及安全链接协议由本计划记录；独立回归开发的历史结果见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-chat-markdown-links.md）。历史文档范围：功能清单、能力说明、运行时设计和 ontology 同步。原 docs companion `2026-11-07-docs-chat-markdown-links.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

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
- 解析、渲染、点击和宿主打开行为满足上述安全契约；构建及相关页面验证历史结果见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-chat-markdown-links.md），独立测试开发不属于本计划。

## 影响面与风险

- 代码：`src/webview/`；`src/test/webview/`的开发范围曾由独立 test 类型计划承接；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-chat-markdown-links.md）。
- 功能清单、产品能力说明、运行时设计及ontology交付独立原由已退役 docs companion 承接（仅历史分工）。
- 风险：模型生成的地址跨越 Webview/宿主信任边界；前后端均校验地址，仅用户点击触发打开，不执行任意协议。
- 回滚：撤回共享链接渲染及消息路由，不影响现有图片能力。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/chatLink*.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/chatImagePreview.test.js dist/test/webview/viewProvider.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`
- 本机 Chromium 渲染真实 Markdown 并点击文件/网页链接验证消息桥；不将浏览器替代真实 Extension Host 验收。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 实现结论

- 独立回归与历史验证结果见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-chat-markdown-links.md）；文档同步与 ontology 结果原指向已退役 docs companion（完整记录未恢复）。真实功能实现不由测试或文档记录替代。

## 决策与当前结论

- 根因是普通 Markdown 链接未接入扩展宿主，而非 Marked 未生成链接；普通对话、历史回显及群聊共用一个实现，不另造文件浏览器。
- 默认二进制文本编辑器可能打开成功却没有文档预览，因此 PDF/Office 先检查已有自定义预览声明，不依赖 `vscode.open` 抛错才反馈缺失预览器。
- 不增加解码依赖、不自动安装预览扩展、不猜测不存在的 sandbox 路径；本次不改持久化原文或图片下载协议。
- 未运行完整 VS Code Extension Development Host 端到端；真实 PDF/PPTX 预览内容仍取决于用户安装的扩展。Chromium 验证只证明真实浏览器中的渲染与消息桥，宿主文件分流由单元测试验证。
- 未执行发布脚本或自动安装构建产物；没有运行无关全量核心单测。
- 记忆判断：本次稳定规则进入产品规格、运行时设计和 ontology；不修改热区或 `ROLLING_SUMMARY.md`，不追加例行任务日志。
