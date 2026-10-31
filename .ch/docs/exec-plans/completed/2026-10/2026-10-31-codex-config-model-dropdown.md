# Codex 配置模型替代默认占位项

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex

## 背景与目标

Codex 当前 `config.toml` 已设置根级 `model` 时，对话面板仍展示没有模型名称的“默认”项。本次以配置模型替代占位项，与用户管理的模型合并去重，保留已有手动选择。

## 范围与非目标

- 范围：根级 TOML 模型解析、宿主模型刷新及选择、普通与主／子模型下拉、相关单元测试、功能清单和 ontology。
- 非目标：修改用户配置、将配置模型自动写入管理列表、更改 CLI 协议、覆盖工作区已有源码编辑器或输入法修复。

## 验收标准

- [x] 配置 `model` 非空时显示真实名称，不再显示“默认”，与管理列表按现有大小写不敏感规则去重。
- [x] 配置无 `model`、空值、非法 TOML 或读取失败时保留原有默认行为，不误读嵌套 `model`。
- [x] 普通、Loop／Graph／Loop+ 主子模型和跨 CLI Codex 子模型一致，已有手动选择保持有效。
- [x] 配置刷新及移除不污染模型管理存储；相关单测和构建通过。ontology 校验存在范围外来源路径问题，详见验证记录。

## 影响面与风险

- 代码：`src/cli/`、`src/extensionHost/`、`src/webview/`、`src/test/`。
- 文档：功能清单、能力规格、ontology。
- 风险：配置刷新残留、模型名称大小写、主子角色选择和工作区已有未提交改动；通过原有合并方法、独立缓存和针对性回归覆盖。

## 验证计划

- `npm run build`。
- 根级模型解析、宿主配置刷新、选择策略、Webview 普通／角色／跨 CLI 下拉回归。
- Webview 逻辑由 DOM 下拉单元测试覆盖；当前仓库没有可供本需求直接访问的独立 Web 服务，因此未启动 headless Chromium。
- 不启动真实 CLI 任务、不读取凭据。
- ontology 验证与测试、`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：`src/test/cli/codexConfigModel.test.ts`、`src/test/extensionHost/cliModelSelectionStrategies.test.ts`、`src/test/webview/grokmodelselection.test.ts`。
- 单元自测结果：针对 Codex 解析、宿主选择和 Webview 下拉的回归测试 26 个通过；ontology Python 单测 9 个通过。
- 失败处理记录：当前工作区重新执行 `npm run build` 时被既有 `src/extensionHost/loopPlusOrchestration.ts:773` 传入 `requireAcceptanceFeedback`、但 `src/loopPlusDecision.ts` 的 `LoopPlusDecisionOptions` 未声明该字段阻断；未修改范围外 Loop+ 代码。使用构建已生成的目标测试产物执行完整单测时还有 12 个既有 Loop+/静态壳/状态契约失败，Codex 相关用例无失败。
- 功能清单：已同步 `FEATURE_INVENTORY.md` 与 `sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：已同步 `.ch/docs/ontology/domains/cli-plugin-runtime.json`；ontology Python 单测 9 个中 8 个通过，1 个为范围外来源路径校验失败。

## 任务列表

Tasklist:
- [completed] 定位配置读取和模型下拉链路
- [completed] 接入配置模型与去重并补充回归
- [completed] 完成构建验证并同步文档归档

## 决策记录

- 2026-10-31：配置模型来自当前运行时 `config.toml`，只作为配置级回退和候选项，不自动持久化到用户管理列表；用户显式选择优先。无有效配置模型时保持旧行为。

## 验证结果与当前结论

- 已完成 Codex 根级 `config.toml` `model` 的读取、模型候选合并、大小写不敏感去重及普通/Loop/Loop+/Graph 主子模型回退逻辑。
- 配置模型只作为当前配置档案的默认候选，不写入用户管理列表；用户显式选择优先，配置变更不会覆盖有效的手动选择。
- 配置缺失、空值、非法 TOML、读取失败和配置移除均保持原有默认行为，不读取嵌套 `model`。
- 已完成构建、针对性回归测试和本次范围空白校验；全量单测为 2502 通过、1 失败、1 跳过，失败是无关的 `sessionMessageActionsCoreCoverage` 设置路由断言（期望 10、实际 8）。ontology 校验仅报告 6 条范围外来源路径缺失，本次新增 Codex 规则的来源路径均存在；计划已归档。
