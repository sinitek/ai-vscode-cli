# Codex 子智能体（multi_agent）工具设置开关

- 日期：2026-04-22
- 状态：completed
- 负责人：Codex

## 背景

用户反馈 Codex 在 app-server + 子智能体协作场景下稳定性较差，希望保留 app-server 主链路，但提供一个项目级工具设置开关，用于显式控制是否允许 Codex 使用官方 multi_agent / 子智能体能力，且默认关闭。

## 目标

1. 在聊天面板“工具设置”中新增 Codex 子智能体开关。
2. 该开关为项目级持久化设置，默认关闭。
3. 当开关关闭时，Codex app-server 启动阶段显式传递官方参数禁用 `multi_agent`。
4. 同步更新相关事实来源文档并完成构建验证。

## 范围

- `src/interactive/codexRunner.ts` 中 Codex app-server 启动参数与 config 透传。
- `src/interactive/manager.ts` 与 `src/extension.ts` 中 runner 构造、工作区设置与 panel state 同步。
- `src/webview/types.ts` 与 `src/webview/viewContent.ts` 中工具设置 UI 与状态联动。
- `.ch/docs/product-specs/*` 与必要 runtime 参考文档。

## 非目标

- 不移除或替换 app-server 主链路。
- 不修改 Claude / Gemini 行为。
- 不引入新的技术栈或额外服务端依赖。

## 验收标准

- [x] 工具设置出现“Codex 子智能体”开关，默认关闭，中英文完整。
- [x] 设置为项目级持久化，重开面板或 VS Code 后保持上次选择。
- [x] 开关关闭时，Codex app-server 显式禁用 `multi_agent`；开启时恢复默认行为。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/interactive/*`、`src/extension.ts`、`src/webview/*`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无新增外部依赖

## 风险与缓解

- 风险：runner 缓存导致切换开关后仍复用旧参数。
- 缓解：把开关纳入 Codex runner 缓存判定条件，参数变化时重建 runner。
- 风险：仅改 UI 不改底层参数，导致用户误以为已禁用。
- 缓解：同时在 app-server 启动参数与 thread config 两层显式关闭 `multi_agent`。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：静态核对工具设置 -> workspace settings -> panel state -> runner 构造 -> app-server 参数链路

## 测试与清单同步

- 单元测试：仓库暂无现成测试基建，本次以 TypeScript 构建与代码链路审查为主。
- 功能清单：需要更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：补充 `.ch/docs/references/cli-runtime-reference.md` 的 Codex app-server 行为说明。

## 任务列表

- [x] 定位并接入项目级 workspace setting 与工具设置 UI
- [x] 将开关透传到 Codex app-server 参数 / config
- [x] 更新文档并执行构建验证

## 决策记录

- 2026-04-22：保持 app-server 为默认主链路，仅增加官方 `multi_agent` 开关，不默认切换 direct-cli。

## 当前结论

- 已为项目级 workspace settings 增加 `codexMultiAgentEnabled` 开关，并在面板“工具设置”中提供中英文 UI，默认关闭。
- Codex app-server 在开关关闭时会同时附加 `--disable multi_agent`，并向 thread config 写入 `features.multi_agent=false`，保持 app-server 主链路不变。
- 已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/references/cli-runtime-reference.md`。
- 已执行 `npm run build`，通过。
