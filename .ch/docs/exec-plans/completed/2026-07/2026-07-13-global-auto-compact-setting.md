# 全局执行后自动压缩上下文设置

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：本次会话
- handoff_to：

## 背景

“执行后自动压缩上下文”当前保存在工作区 `workspace-settings`，与刚迁为全局的“隐式子代理”设置不一致。用户要求它同样改为全局配置，同时保留未显式配置时默认开启的行为。

## 目标

将 `autoCompactContextAfterRun` 保存到 `~/.sinitek_cli/settings.json`，在工具设置全局页展示，并让 Codex、Claude、OpenCode 的 after-run 自动压缩链路统一读取该全局值。

## 范围

- 在 `ToolSettingsState` 中持久化和归一化全局 `autoCompactContextAfterRun`。
- 把 UI 控件从“工作区”页移到“全局”页，并同步中英文说明。
- 兼容迁移工作区 `autoCompactContextAfterRun` 和旧 `autoCompactContextBeforeRun`；全局值优先。
- 将运行时 getter、PanelState 依赖与自动压缩触发链路改为全局语义。
- 更新定向测试和产品/运行时事实来源文档。

## 非目标

- 不改变自动压缩仅在成功、已有会话且超过 5 分钟后触发的规则。
- 不改变手动压缩命令、CLI 原生压缩实现或 OpenCode fallback。
- 不改动 Loop 编排、隐式子代理设置或外部 CLI 配置文件。

## 验收标准

- [x] 工具设置全局页展示“执行后自动压缩上下文”，默认开启，中英文一致。
- [x] `autoCompactContextAfterRun` 写入全局 `settings.json`，运行时全局值优先。
- [x] 旧工作区 after-run/before-run 字段仅作为迁移输入，并在全局保存成功后不再写入。
- [x] 自动压缩原有 5 分钟、成功和已有会话的触发条件不变。
- [x] 相关构建、定向测试和差异检查通过。

## 影响面

- 代码目录：`src/toolSettings.ts`、`src/workspaceSettingsStore.ts`、`src/sessionMessageActions.ts`、`src/panelStateBuilder.ts`、`src/extension.ts`、`src/webview/`、相关测试。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`。
- 配置与脚本：全局 `~/.sinitek_cli/settings.json`；不写入外部 CLI 配置。

## 风险与缓解

- 风险：已有工作区显式关闭值在迁移后丢失，或后访问工作区覆盖全局值。
  - 缓解：只在全局字段缺失时迁移当前工作区有效值；全局字段存在时始终优先；全局写入失败时保留旧工作区值。
- 风险：默认值从工作区迁出后变为关闭。
  - 缓解：全局解析缺失时固定返回 `true`，并以单测覆盖。

## 验证计划

- 最小相关验证：检查全局归一化/优先级、旧字段迁移、设置消息、Webview 全局页归属和运行时 getter。
- 单元自测命令：`npm run build`，随后运行 ToolSettings、workspace settings、session message、Webview、自动压缩和 OpenCode integration 相关 Node tests。
- 扩展验证：`git diff --check`；确认 Loop 和隐式子代理控件仍保留原有作用域。

## 测试与清单同步

- 单元测试新增/更新：更新 ToolSettings、workspace settings、设置消息、Webview 全局页和 PanelState 依赖定向测试。
- 单元自测结果：`npm run build` 通过；ToolSettings、workspace settings、设置消息、Webview、OpenCode Loop UI、PanelState、上下文压缩、Codex/OpenCode runtime/config 定向测试共 78/78 通过。
- 失败处理记录：无测试失败。
- 功能清单：已更新现有“执行后自动压缩上下文”条目为全局设置。
- 相关文档同步：已更新能力规格、运行时参考、运行时设计文档和隐式子代理迁移说明。

## 任务列表

- [x] 核对当前工作区存储、运行时 getter、Webview 控件和测试影响面。
- [x] 将存储、迁移和运行时读取改为全局语义。
- [x] 更新 UI/i18n、测试和事实来源文档。
- [x] 执行构建、定向测试和差异检查。

## 决策记录

- 2026-07-13：全局缺省值保持 `true`，以维持既有“执行后自动压缩上下文”默认开启行为。
- 2026-07-13：工作区 `autoCompactContextAfterRun` 优先于旧 `autoCompactContextBeforeRun` 作为迁移候选；二者均不能覆盖已存在的全局值。
- 2026-07-13：工作区存储层保留迁移候选；仅在全局写入成功的迁移或用户更新路径显式删除，避免两个全局迁移或磁盘写入失败时丢失旧值。

## 当前结论

已完成。自动压缩开关现在与隐式子代理一样在全局工具设置中保存，默认开启；所有 after-run 判断统一读取全局值。旧工作区 after-run/before-run 字段仅在全局值缺失时迁移，成功后清理；全局写入失败时保留旧字段。未执行真实带凭据 CLI 会话，但配置、面板、运行时依赖和 OpenCode fallback 相关自动化测试已覆盖。
