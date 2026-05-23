# 工具设置持久化与自动压缩默认值调整

- 日期：2026-05-23
- 状态：completed
- 负责人：Codex

## 背景

当前聊天面板“工具设置”中的配置存在两套持久化链路：一部分写入 `~/.sinitek_cli/workspace-settings/`，另一部分仍写入 VS Code 全局配置。用户要求这些工具设置统一存储到 `~/.sinitek_cli/`，避免重启 VS Code 后配置回退；同时要求“任务执行后自动压缩上下文”默认开启。

## 目标

1. 将工具设置面板中的配置统一收口到插件自有目录 `~/.sinitek_cli/`。
2. 对项目级设置继续使用 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`。
3. 为全局工具设置新增独立存储文件，并保留对旧 VS Code 配置的兼容读取。
4. 将“执行后自动压缩上下文”默认值改为开启，并同步 UI 与事实来源文档。

## 范围

- `src/extension.ts`：工具设置读写、workspace/global 持久化、panel state。
- `src/cli/config.ts`、`src/i18n.ts`：对运行时读取链路补充插件自有配置优先级。
- `.ch/docs/product-specs/*`、`.ch/docs/references/*`、`.ch/docs/design-docs/*`：事实来源同步。

## 非目标

- 不调整 VS Code `package.json` 中已有配置项的 contribution 定义。
- 不重构非“工具设置”面板之外的其他配置中心存储结构。
- 不改变手动“压缩上下文”的触发逻辑。

## 验收标准

- [x] 工具设置中的配置在重启 VS Code 后仍能从 `~/.sinitek_cli/` 恢复。
- [x] 项目级设置与全局设置的作用域保持不变，不误改现有行为边界。
- [x] “执行后自动压缩上下文”在未显式配置时默认开启。
- [x] 旧 VS Code 配置仍可兼容读取，避免现有用户配置直接丢失。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/cli/config.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：新增 `~/.sinitek_cli/settings.json` 运行时文件

## 风险与缓解

- 风险：不同模块仍直接读取 VS Code config，导致 UI 与运行态值不一致。
- 缓解：将工具设置读取统一经过插件自有 settings helper，并在 `extension.ts` 初始化时同步 logger/i18n 相关状态。
- 风险：直接切默认值会覆盖已有显式关闭用户。
- 缓解：仅在“未显式存储任何值”时使用新的默认值；已有 workspace/global 配置继续优先。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：静态核对 tool settings UI -> message -> `~/.sinitek_cli` 持久化 -> panel state -> command/runner 读取链路

## 测试与清单同步

- 单元测试：当前仓库以构建和静态检查为主，本次至少执行 `npm run build`
- 功能清单：同步 `FEATURE_INVENTORY.md`
- 相关文档同步：同步 capability / runtime / design 文档

## 任务列表

- [x] 核对工具设置现有存储链路与默认值
- [x] 实现工具设置统一落盘到 `~/.sinitek_cli/`
- [x] 调整自动压缩默认值并保持兼容读取
- [x] 更新事实来源文档与功能清单
- [x] 完成构建验证

## 决策记录

- 2026-05-23：工具设置保留原有作用域语义，项目级继续走 `workspace-settings`，全局设置新增 `~/.sinitek_cli/settings.json`。
- 2026-05-23：默认值提升为“执行后自动压缩开启”，但不覆盖已显式关闭的用户存量设置。

## 当前结论

已完成。当前行为如下：

- 工具设置中的全局项统一写入 `~/.sinitek_cli/settings.json`
- 项目级工具设置继续写入 `~/.sinitek_cli/workspace-settings/<workspaceKey>.json`
- 运行时仍兼容读取旧的 VS Code 全局配置，并在首次命中时迁移到插件自有 settings 文件
- “执行后自动压缩上下文”在未显式配置时默认开启；已显式关闭的存量用户配置不会被覆盖
- 已执行 `npm run build`，通过
