# 资源管理器右键加入携宁 CLI 引用

- 日期：2026-10-06
- 状态：in-progress
- 负责人：Codex

## 背景与目标

用户希望在 VS Code 资源管理器的文件和目录右键菜单中选择“加入到携宁 CLI 引用”，将 `@` 开头的工作区相对路径写入 AI 对话的多行输入框。当前拖拽和路径选择已有引用格式化与光标插入逻辑，但没有右键命令和宿主向输入框插入引用的通道。

## 范围与非目标

- 新增中英文命令、资源管理器菜单、命令注册和宿主到 Webview 的引用消息。
- 复用已有引用格式化、选区插入和输入框聚焦逻辑，支持多选、目录、Windows 路径和带空格路径。
- 首次打开或重新加载面板时，引用缓存到 `requestState` 握手后再发送。
- 不改变 CLI 调用、发送提示词、拖拽上传、自动上下文标签或 UI 样式。

## 验收标准

- 文件与目录均显示“加入到携宁 CLI 引用”，菜单命令有中英文翻译。
- 单选和多选使用工作区相对路径，统一 `/`，选择重复项时去重，工作区根目录引用为 `@.`。
- 仅处理文件/远程工作区资源；没有参数或不属于工作区的资源不插入绝对路径。
- 点击后打开 AI 对话，在当前选区插入引用，保留选区之外的已有提示词并聚焦输入框。
- 首次加载、重载和视图销毁后的下一次打开不会丢失待插入引用。
- 构建、最小相关回归测试、文档和 ontology 校验通过；浏览器与 VS Code 实机验证分别记录结果或限制。

## 影响面

- 代码：`src/commandRegistry.ts`、`src/extension.ts`、`src/webview/panelFileActions.ts`、`src/webview/viewProvider.ts`、`src/webview/viewContentScript/windowMessageDispatch.ts`。
- 配置：`package.json`、`package.nls.json`、`package.nls.zh-cn.json`。
- 测试：命令与路径解析、provider 就绪缓存、输入框插入回归。
- 文档：功能清单、运行时设计、业务 ontology。

## 风险与缓解

- 新视图的脚本尚未接收消息：复用现有 `requestState` 作为就绪握手。
- 引用格式与拖拽路径不一致：直接复用 `buildInsertText` 和 `insertPromptText`。
- 多根工作区：沿用现有路径选择器/拖拽的 `workspace.asRelativePath(uri, false)` 口径，不改变 CLI 工作目录规则。
- CodeGraph 存在旧符号和测试路径：已核对当前源码，不按过期图谱实现。

## 验证计划

- `npm run build`。
- `node --test dist/test/extensionHost/commandRegistry.test.js dist/test/webview/panelFileActions.test.js dist/test/webview/viewProvider.test.js`。
- Webview 输入框引用回归和现有拖拽回归；provider 既有覆盖测试。
- Chromium 实际渲染与消息插入验证；检查是否可运行 VS Code Extension Development Host。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`git diff --check`。

## 任务列表

Tasklist:
- [completed] 确认菜单、引用和输入框链路
- [in_progress] 实现资源管理器引用入口
- [pending] 补充测试并同步功能文档
- [pending] 验证构建与引用行为

## 当前结论

实现中。召回 focus 为“Explorer 文件目录 上下文 引用 prompt 输入框 webview”，未指定 anchor；命中现有 Loop+ 计划但与此功能不直接相关，已转向现有拖拽功能的当前实现和规格。未发现需要用户确认的需求分歧。
