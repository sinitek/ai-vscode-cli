# CLI 配置源码着色与保存校验 — 新功能开发

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-31-config-source-editor.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-31-docs-config-source-editor.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

新增离线配置源码编辑器与统一保存前语法校验。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-31-feature-config-source-editor.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 七个 CLI 的配置源码目前使用普通文本域，保存前的 JSON/TOML 检查不一致。复用成熟的第三方编辑器提供语法着色，并统一保存前语法校验和错误弹窗，保留各 CLI 已有字段校验。

## 范围与非目标

- 覆盖 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode 的 JSON/TOML 源码，包括 Codex auth.json。

- 不替换现有可视化编辑器、不改变配置档案归属与激活逻辑、不变更技术栈。

- 所有资源离线加载，颜色复用 VS Code 主题变量；不把用户配置交给外部服务。

## 验收标准

- JSON/TOML 编辑时可见语法着色，切换档案与编辑模式保持草稿和现有行为。

- 保存非法格式时弹窗说明文件、格式及解析错误，不覆盖原档案或运行配置。

- 合法 JSON/TOML 可正常保存；OpenCode 源码支持 JSONC 注释和尾逗号，可视化编辑仍限严格 JSON；其他 JSON 配置按严格 JSON 校验，既有业务字段校验继续生效。

- 构建、相关单测和浏览器验收通过。

## 影响面与风险

- 代码：配置页面静态资源、Webview 资源加载、配置服务保存边界与相关测试。

- 风险：CSP/打包资源遗漏、编辑器尺寸变化、TOML 合法语法误拒绝、草稿被旧状态覆盖。

- 缓解：本地打包的成熟编辑器与解析器、宿主写入前统一校验、模拟保存及 headless Chromium 验证。

## 验证计划

- `npm run build`、`node --check media/config/assets/config-app-ui.js`。

- 浏览器验证 JSON/TOML 着色、编辑、切换与错误弹窗，记录实际覆盖与环境限制。

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

## Git 提交边界验证

- 从暂存区生成独立快照，基于原远端 `master` 加上本任务变更验证，不依赖共享工作区中的并行修改。

- 独立快照 `npm run build`、JavaScript 语法检查、全量 Ontology 校验通过；配置/OpenCode/打包测试 326/326 通过，页面测试 356/356 通过。

- 提交前快照日志：`/tmp/sinitek-config-source-commit-build.log`、`/tmp/sinitek-config-source-commit-tests.log`、`/tmp/sinitek-config-source-commit-page.log`。前述共享工作区的范围外失败记录保留作为当时状态，不影响独立提交快照的验证结论。

## 文档与记忆收尾

- 计划归档引用指向本文件。

- 本次功能不改变架构边界，验证过程保留在本计划，不额外更新长期记忆。
