# ZCode 执行失败与模型选择入口修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈 ZCode 任务执行报错，且 AI 对话面板看不到模型下拉框。
本机原生日志确认：之前成功使用服务实际提供的模型，随后配置及保存档案改成了服务未提供的范例模型，导致 HTTP 404；插件前端的模型选择能力判断遗漏 ZCode，已有测试仅验证选项而未验证可见性。

## 范围与非目标

- 补齐 ZCode 普通对话及多角色模式的模型选择、空状态与无障碍名称。
- 备份后修复本机真实配置及保存档案，保留凭据、协议和其他字段。
- 保留工作区已有的模型显示标签及相关测试改动。
- 不自动把范例模型映射到其他模型，不引入新依赖，不改其他 CLI 行为，不新建分支或提交。

## 验收标准

- 普通对话显示可用的 ZCode 模型下拉框，显示模型 ID、提交供应商限定值，不显示不支持的模型管理入口。
- Loop、Graph、Loop+ 显示主／子模型选择；空配置给出中文配置指引；切换 CLI 后正确恢复控件。
- 本机真实配置与保存档案一致，使用服务列表中存在且此前成功的模型，保留可恢复备份。
- 构建、最小回归测试、Headless Chromium 和真实 ZCode runner 验证通过。

## 影响面与风险

- 代码：`src/webview/viewContentScript/modelManager.ts`、`src/webview/viewContentStrings.ts` 和对应 Webview 回归测试。
- 文档：功能清单、ZCode 用户指南、ontology 规则与本计划。
- 本机配置只在核对服务模型列表后修改，先备份并保持 `0600`，不输出或写入仓库凭据。
- 真实 Webview 的 VS Code 桥接与浏览器隔离验证需分别说明；旧扩展宿主必须重新加载新代码。

## 验证计划

- 增强现有测试，先确认旧代码无法通过可见性断言，再修复。
- `npm run build`。
- `node --test dist/test/config/zcodeConfig.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`，按影响面扩大到模型选择和 ZCode runner 单测。
- 使用仓库 Chromium smoke skill 验证真实 HTML 与脚本的桌面／窄屏入口。
- 使用插件编译后的 ZCode runner 执行两次简短请求，确认模型可用与会话复用。
- `git diff --check`、ontology 校验、UI 机械检测。

## 测试与清单同步

- 单元测试新增/更新：模型选择可见性、空状态、角色模式、切换及消息提交。
- 单元自测结果：`npm run build` 通过；ZCode 配置／协议／runner／trace 和模型策略核心测试 50/50 通过；ZCode Webview 定向测试 4/4 通过。
- 扩展回归：13 个相关测试文件共 191 项，188 项通过、3 项失败；使用修改前的 `modelManager.ts` 注入同一测试进程，确认三项具有相同失败。排除这三项后重跑 188/188 通过。
- 失败处理记录：三项为已有的错误气泡标签状态断言、Grok 单测提取器遗漏 `getLoopRoleThinkingOptionsForCli`、Grok 模式布局断言，与本次修复无关，未扩大修改范围。新增测试初次沿用基类的运行中 Loop 标签，夹具会强制切换模式；现明确使用与 ZCode 匹配的普通标签和空会话。
- 回归证据：在正确的普通对话夹具下，修改前源码仍无法通过新增的模型可见性断言，修复后通过。
- 浏览器：Chromium smoke runner 在 1440px 与 420px 各验证 coding／loop／graph／loop_plus／empty，10/10 通过；同时验证可见／启用状态、候选数、标签、选择消息和视口范围；浏览器、HTTP、网络错误均为 0。桌面和窄屏截图人工检查通过。
- 真实执行：`node /tmp/sinitek-zcode-selector-live.cjs` 通过；插件编译后的启动准备和 ZCode runner 连续两轮分别收到 `ZCODE_MODEL_OK`、`ZCODE_REUSE_OK`，同会话、runner 可复用、思考档位 high。
- 本机配置：真实配置和保存档案均已备份并修复；深度比较确认内容一致，原凭据与 API 协议保留，权限均为 `0600`。
- 结构检查：`git diff --check`、ontology `--validate` 通过；Impeccable 对两个修改的 UI 文件检测结果为 `[]`。
- 功能清单及相关文档：已同步功能总表、`docs/zcode-guide.md` 与 ontology；架构未变化。原因和恢复方式已有长期事实来源，无需额外更新热区记忆、事件记忆或 runbook。
- 验证边界：浏览器使用真实 Webview HTML／脚本与隔离 VS Code 桥接夹具；真实 CLI 验证使用本机服务。没有自动重载当前 VS Code 窗口，重载后的真实扩展面板交互仍需用户确认。

### 扩展回归命令

```sh
node --test dist/test/config/zcodeConfig.test.js dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeRunner.test.js dist/test/interactive/zcodeTrace.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/kimiCodeModelSelection.test.js dist/test/webview/grokmodelselection.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/loop/opencodeloopmodewebview.test.js dist/test/session/conversationTabModelSelection.test.js
```

完整结果在 `/tmp/sinitek-zcode-selector-unit.log`；修改前基线结果在 `/tmp/sinitek-zcode-selector-baseline.log`。相同命令追加 `--test-skip-pattern='keeps the owning conversation tab errored|Grok thinking options keep|Grok uses role model rows'` 后结果在 `/tmp/sinitek-zcode-selector-regression-final.log`。

## 任务列表

- [completed] 核对日志与现有实现
- [completed] 修复执行错误和模型选择
- [completed] 完成回归验证与文档同步

## 决策记录

- 2026-10-29：CodeGraph 定位调用关系后直接核对当前源码；按本机原生日志及服务实际模型列表修复配置，不猜测模型别名。
- 2026-10-29：当前工作区存在用户未提交的相关改动，保留原改动并就地修复，不创建分支或隔离工作区。
- 2026-10-29：用户通过结构化输入选择安装修复版。执行 `python3 scripts/export_vscode_extension.py --target current`，生成并审计 20.59 MiB 的 darwin-arm64 VSIX；使用本机 `code --install-extension <vsix> --force` 成功安装。包内与已安装的模型管理脚本、文案及 ZCode 配置模块 SHA-256 均与当前编译输出一致。未执行窗口重载。

## 当前结论

两个根因均已修复：恢复本机可用模型并同步保存档案；补齐 ZCode 前端选择能力、配置模型语义和中文空状态。构建、相关回归、10 组浏览器验证、两轮真实请求和本机安装完成。用户需重新加载 VS Code 窗口启用新代码；三项已确认的历史测试失败保留记录，不在本任务扩修。
