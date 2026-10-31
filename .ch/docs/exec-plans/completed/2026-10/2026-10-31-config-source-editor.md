# CLI 配置源码着色与保存校验

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex

## 背景与目标

七个 CLI 的配置源码目前使用普通文本域，保存前的 JSON/TOML 检查不一致。复用成熟的第三方编辑器提供语法着色，并统一保存前语法校验和错误弹窗，保留各 CLI 已有字段校验。

## 范围与非目标

- 覆盖 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode 的 JSON/TOML 源码，包括 Codex auth.json。
- 不替换现有可视化编辑器、不改变配置档案归属与激活逻辑、不变更技术栈。
- 所有资源离线加载，颜色复用 VS Code 主题变量；不把用户配置交给外部服务。

## 验收标准

- JSON/TOML 编辑时可见语法着色，切换档案与编辑模式保持草稿和现有行为。
- 保存非法格式时弹窗说明文件、格式及解析错误，不覆盖原档案或运行配置。
- 合法 JSON/TOML 可正常保存；OpenCode 源码支持 JSONC 注释和尾逗号，可视化编辑仍限严格 JSON；其他 JSON 配置按严格 JSON 校验，既有业务字段校验继续生效。
- 新增回归测试，构建、相关单测和浏览器验收通过。

## 影响面与风险

- 代码：配置页面静态资源、Webview 资源加载、配置服务保存边界与相关测试。
- 风险：CSP/打包资源遗漏、编辑器尺寸变化、TOML 合法语法误拒绝、草稿被旧状态覆盖。
- 缓解：本地打包的成熟编辑器与解析器、宿主写入前统一校验、模拟保存及 headless Chromium 验证。

## 验证计划

- `npm run build`、`node --check media/config/assets/config-app-ui.js`。
- 相关配置服务、配置页面和新增编辑器/格式校验回归测试。
- 浏览器验证 JSON/TOML 着色、编辑、切换与错误弹窗，记录实际覆盖与环境限制。
- 更新功能清单、配置能力文档和 ontology，并运行 ontology 校验。

## 当前结论

- 已通过 ontology 和 CodeGraph 定位配置页和保存入口，确认原有普通文本输入与分散校验不能覆盖所有保存路径。
- 已接入本地 CodeMirror，并通过 Webview 与扩展宿主双层校验统一保存边界。

## 实施结论

- 配置源码编辑器覆盖 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode；Codex 的 `auth.json` 单独使用 JSON 着色和校验。
- OpenCode 源码模式无损保存 JSONC 注释与尾逗号，模型读取、运行 overlay、Skills 合并及档案复制同步支持 JSONC；可视化编辑仍限严格 JSON。Claude、DSH、ZCode、Codex `auth.json` 使用严格 JSON。
- 格式校验发生在所有配置档案写入之前；解析失败会携带具体文件名、格式和 TOML 行列位置，且不会覆盖既有档案或运行配置。
- 新增 CodeMirror、TOML 解析器及编辑器样式均随 VSIX 打包，资源离线加载并复用 VS Code 主题变量。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/config/*.test.js dist/test/cli/opencodeconfigmodels.test.js dist/test/cli/opencoderuntimeconfig.test.js dist/test/shared/vsixPackaging.test.js`：326/326 通过；日志 `/tmp/sinitek-config-source-all-config-tests.log`。
- 格式校验、配置服务、OpenCode JSONC 与打包的定向回归子集：81/81 通过；日志 `/tmp/sinitek-config-source-final-tests.log`。
- Headless Chromium 使用真实配置页 HTML、合成档案和实际宿主校验函数，在 1440×1000、760×1000 两种视口均通过：每种视口完成 Claude JSON、Codex TOML/auth、OpenCode JSONC 三次合法保存，以及 JSON、TOML、auth、未闭合 JSONC 注释四次非法保存拦截与错误弹窗；未触碰用户实际配置。
- 浏览器结果 `/tmp/sinitek-config-source-editor-smoke/result.json`；最终着色截图 `editor-1440.png`、`editor-760.png` 已视觉复核。无意外页面、控制台或网络错误，仅记录预期的非法 TOML 保存失败日志。
- `node --check media/config/assets/config-app-ui.js`、本任务文件范围的 `git diff --check`：通过；新增编辑器样式、校验模块、测试和归档计划另行检查无行尾空白。
- Ontology 在实现阶段曾通过全量校验；归档后的最终全量校验受并行 Loop 文件删除影响，报告 6 处范围外来源引用失效，涉及 `src/loopGroupChat.ts`、`src/webview/loopGroupChatPanel.ts`、`src/test/loop/loopGroupChatPanel.test.ts`。本任务规则与全部来源路径独立校验通过，未修改 Loop 本体规则。
- `npm run test:page`：352 项中 347 项通过、5 项失败。失败均涉及并行修改中的 Loop 相关断言，归类为范围外失败；日志 `/tmp/sinitek-config-source-final-page.log`。
- 全仓库 whitespace 检查仍报告并行修改的 `src/extension.ts` 三处和 `src/test/session/sessionMessageHandlersCoreCoverage.test.ts` 一处空白问题；本任务修改范围无空白错误，未修复范围外文件。

## Git 提交边界验证

- 按用户要求仅提交本任务的 24 个文件；`package.json` 只纳入 CodeMirror/TOML 依赖，产品文档和 Ontology 仅纳入本任务条目，不提交并行的 Loop、模型下拉及其他文档变更。
- 从暂存区生成独立快照，基于原远端 `master` 加上本任务变更验证，不依赖共享工作区中的并行修改。
- 独立快照 `npm run build`、JavaScript 语法检查、全量 Ontology 校验通过；配置/OpenCode/打包测试 326/326 通过，页面测试 356/356 通过。
- 提交前快照日志：`/tmp/sinitek-config-source-commit-build.log`、`/tmp/sinitek-config-source-commit-tests.log`、`/tmp/sinitek-config-source-commit-page.log`。前述共享工作区的范围外失败记录保留作为当时状态，不影响独立提交快照的验证结论。

## 文档与记忆收尾

- 已同步功能清单、配置能力说明及 `plugin.rule.config_source_editor_validation`，计划归档引用指向本文件。
- 本次功能不改变架构边界，不需更新 `ARCHITECTURE.md`；稳定行为已写入规格和 Ontology，验证过程保留在本计划，不额外更新长期记忆。
