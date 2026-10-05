# 修复资源管理器拖拽文件引用

- 日期：2026-10-05
- 状态：completed
- 负责人：Codex

## 背景与目标

AI 对话输入框仅解析标准 URI 列表和单个 file URI，未识别 VS Code Explorer 使用的 ResourceURLs、CodeFiles 和纯文本绝对路径，导致文件与目录拖拽不能插入相对路径引用。

## 范围与非目标

- 补齐 Webview 拖拽载荷解析，继续由扩展宿主调用 workspace.asRelativePath。
- 覆盖多选、目录、Windows、特殊字符、异常载荷和普通文本/附件回退。
- 不改界面布局、CLI、工作区所有权或附件上传协议。

## 验收标准

- 资源管理器文件与目录拖拽发送 resolveDropPaths，并插入 @ 开头的工作区相对路径。
- 多选引用去重，含空格路径使用现有提示词解析支持的引号形式。
- Windows 路径不当作 URI scheme；非法 JSON 不阻断其他数据格式。
- 普通文本不会当成路径引用；无路径的文件拖拽继续上传附件。

## 影响面与风险

- 代码：src/webview/viewContentScript/runStreamAndQueue.ts、src/extension.ts。
- 测试：src/test/webview/clipagescriptruntimecoverage.test.ts。
- 文档：功能清单、运行时设计与当前执行计划。
- 风险：拖拽有多种格式，避免把任意文本转成路径；保持原有附件回退。
- 回滚：恢复本次拖拽解析、路径规范化和引用格式化变更。

## 验证计划

- npm run build。
- node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js。
- 已通过脚本化 Webview harness 验证拖拽消息与光标插入。
- `node /tmp/sinitek-explorer-drop-browser/smoke.cjs`：使用实际 Webview HTML、Chromium 的 DataTransfer/DragEvent 和真实 vscode-uri 解析，六种场景全部通过，无 console/page/network 错误；结果与截图位于 `/tmp/sinitek-explorer-drop-browser/`。宿主相对路径回传采用测试桥接，不等同于真实 VS Code Explorer 手工拖拽。
- 已通过附件回退测试；未在 Extension Development Host 中手工拖拽真实 Explorer 项目树。

## 测试与清单同步

- 回归断言：专用数据字段、目录与多选、跨平台路径、坏 JSON、文本和附件回退。
- 功能清单：补充资源管理器拖拽引用能力。
- Ontology：保持已有 Webview/UI 不直接访问文件系统的边界，无概念、权限或状态机变更。
- Memory：单次修复过程留在本计划，不修改热区摘要。
- 验证结果：`npm run build` 通过；拖拽、附件回退和消息处理相关测试通过。
- 最小回归命令：`node --test --test-name-pattern='Explorer|prompt drops|handles run stream, queue, attachments' dist/test/webview/clipagescriptruntimecoverage.test.js`，4/4 通过；`node --test dist/test/session/sessionMessageHandlersCoreCoverage.test.js`，15/15 通过。
- 扩展相关验证：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/extensionHost/promptRuntime.test.js`，115/116 通过，唯一失败为基线可复现的任务列表旧断言。
- i18n：复用现有消息与错误文案，没有新增或修改用户可见文本，不需新增翻译。
- 已知范围外失败：完整 Webview 覆盖测试中的既有任务列表断言失败；使用 `git show HEAD:src/webview/viewContentScript/runStreamAndQueue.ts` 的基线代码复现，确认与本次改动无关。

Tasklist:

- [completed] 定位资源管理器拖拽数据与现有处理差异
- [completed] 补齐拖拽解析和回归测试
- [completed] 验证构建和浏览器交互并同步清单

## 当前结论

已兼容 VS Code Explorer 的 `ResourceURLs`、`CodeFiles`、标准 URI 列表和内部 URI 列表；路径统一转成 file URI 后交给扩展宿主解析为工作区相对路径，含空格路径以 JSON 引用插入。普通文本和无路径文件拖拽仍保持原有行为。
