# Grok 配置驱动多模型管理

- 日期：2026-10-17
- 状态：completed
- 负责人：Codex

## 背景与目标

Grok TOML 已支持多个 `model.<id>`，但对话模型候选仍来自手工管理列表，配置可视化缺少新增与删除交互。参考 OpenCode，统一以配置文件为事实来源。

## 范围与非目标

- 增加配置驱动的模型解析、默认与失效选择回退、普通与 Loop/Graph 角色选择。
- Grok 下拉只展示配置模型，左侧 SVG 按钮重新读取配置；不改变 Codex / OpenCode 交互。
- 配置可视化新增、编辑、删除多个模型，保留未展示字段，提供中英文文案。
- 不升级依赖、不改密钥、不覆盖用户现有配置；真实调用使用仓库外临时 Grok home。

## 验收标准

- Grok 普通与角色模型候选来自当前配置，移除“默认”“管理”候选。
- 刷新能同步外部 TOML 变化，失效选择回退有效默认或首个模型。
- 可视化添加、切换、删除模型可往返 TOML，删除默认项时更新默认引用，非法输入不可保存。
- `gpt-6.1-sol` 通过真实 Grok 运行器调用验证，或明确记录真实环境失败证据。
- 构建、相关回归、浏览器验证完成，功能清单与 ontology 同步。

## 影响面

- `src/cli/`、`src/extensionHost/modelSettings.ts`、`src/extension.ts`。
- `src/webview/`、`media/config/assets/config-app-ui.js` 与相关测试。
- 功能清单、CLI 运行时参考、ontology。

## 风险与缓解

- 配置别名与实际 API 模型名不同：选择和 `--model` 使用配置表键，API 名保留在该表的 `model` 字段。
- 外部修改导致选择过期：刷新后只从当前候选解析，运行前再次验证。
- 多模型切换丢失未知字段：以原始 TOML document 保留式更新。
- 真实验证消耗模型额度：仅使用无工具短提示并限制调用量，使用临时目录，不写用户配置。

## 验证计划

- 构建：`npm run build`。
- 单元：新增配置解析测试；扩展 Grok Webview、配置可视化与宿主测试。
- 浏览器：headless Chromium 覆盖多模型新增、切换、删除与刷新按钮。
- 真实：本机 Grok CLI / ACP，以临时配置验证 `gpt-6.1-sol`。

## 测试与清单同步

- 新增 `src/test/cli/grokConfigModels.test.ts` 与 `src/test/extensionHost/grokConfigModels.test.ts`，覆盖 TOML 表键、默认回退、非法/空配置、磁盘重读、档案隔离、无档案选择及运行前验证。
- 扩展配置可视化、鉴权映射、Grok 宿主连线与 Webview 测试，覆盖新增/切换/删除、未知字段保留、实际所选模型凭据、大小写区分，以及普通/主从模式刷新按钮重定位。
- `npm run build`：通过；`node --check media/config/assets/config-app-ui.js`、`git diff --check`：通过。
- 最小相关回归命令：`node --test dist/test/cli/grokConfigModels.test.js dist/test/cli/grokmodelselection.test.js dist/test/webview/grokmodelselection.test.js dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/interactive/grokRunner.test.js`，52/52 通过。
- `npm run test:page`：242/242 通过。
- `npm run test:unit`，最终构建后再用 `node scripts/run_unit_tests.js` 复核：1566 项，1562 通过、4 项历史失败。`cliCommandRepair.test.ts` 三项断言仍按三个 CLI 计数；`grokCliEnum.test.ts` 将包含规则选择器的全页 Grok option 数量断言为 1，实际为 2。以 `git archive HEAD src tsconfig.json package.json media` 提取独立临时源码、复用依赖并构建，运行这两个测试文件同样四项失败，归类为历史断言问题，不在本任务扩大修复。
- 功能清单及详细能力文档已同步，CLI runtime reference 与 ontology 已描述配置驱动候选及所选模型鉴权。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 仍报告 15 个既有缺失 `source_refs`，涉及仓库已不存在的运行时、Graph 与 Loop+ 设计文档；HEAD 含同样引用且对应文件不在 HEAD，本次未新增该问题。
- 稳定兼容经验已写入 `.ch/docs/runbooks/grok-model-config.md` 并从 `PITFALLS.md` 链接；无需重复写入 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。

## 浏览器与真实调用

- 采用真实配置页/Webview HTML 与项目资源，在仓库外本地预览服务中使用无密钥 IPC 夹具，不写用户档案。
- `node /tmp/sinitek-grok-browser-check.cjs`：新增、编辑、切换、设置默认、删除确认、保存、重复名称拒绝及未知 TOML 字段保留通过；普通选择刷新后保留有效选择、移除失效选择后回退、Graph 主从均无“默认/管理”通过。
- `PLAYWRIGHT_MODULE_PATH=<本机缓存路径>/playwright/index.mjs node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario /tmp/sinitek-grok-smoke.json`：通过，无浏览器错误、HTTP 错误或请求失败。桌面与 390px 窄屏截图人工复核通过，主模型下拉左侧 SVG 刷新按钮与下拉同排。
- Grok Build 1.0.62 的真实 `GrokInteractiveRunner` 使用临时 `GROK_HOME`，保留另一个默认模型，显式选择非默认 `gpt-6.1-sol`；ACP `session/new` 确认 `currentModelId=gpt-6.1-sol`，`session/prompt` 回复 `GROK_SOL_MODEL_OK`，进程正常退出。未修改用户正式配置与凭据。
- 真实验证发现当前接口的 Responses SSE 包含 `response.metadata`，此版本 Grok 拒绝解析并返回 `-32603`。仅在临时配置中将该模型设为 `api_backend = "chat_completions"` 后完整调用成功；不能将非流式 Responses 成功等同于 ACP 流式兼容。具体排查与配置方式见 runbook。
- 本机临时证据：`/tmp/sinitek-grok-focused-tests.log`、`/tmp/sinitek-grok-page-tests.log`、`/tmp/sinitek-grok-all-tests.log`、`/tmp/sinitek-grok-head-baseline.log`、`/tmp/sinitek-grok-ontology-check.log`、`/tmp/sinitek-grok-smoke/result.json`、`/tmp/sinitek-grok-smoke/interaction-result.json` 及同目录截图；这些不纳入仓库。

## 收尾与边界

- 验收完成，直接在当前分支实施，未提交或创建新分支。`package.json` 的版本变更是并行用户修改，原样保留，不作为本次成果。
- 临时真实配置目录与凭据测试副本已清理；收尾停止本任务预览服务并清理临时测试脚本/场景，仅保留无密钥的测试日志与截图。
- 未打包安装或重新加载用户正在运行的 VS Code 插件；浏览器使用 IPC 夹具，真实 CLI 调用单独验证。使用新代码仍需重新加载开发宿主或安装新构建后重载窗口。
