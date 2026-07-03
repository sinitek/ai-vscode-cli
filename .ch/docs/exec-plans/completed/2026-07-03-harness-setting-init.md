# Harness 骨架工作区开关初始化

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-03
- claim_ttl：1d
- handoff_to：

## 背景

工具设置的工作区长期记忆开关已接入当前工作区 `.ch/.agents` harness scaffold。最新要求把这个入口升级为“harness 骨架”安装开关：默认关闭，用户点击开启时弹窗确认是否初始化，确认后安装 `media/workspace-scaffold`，并自动安装 CodeGraph。

## 目标

1. 工作区 harness/长期记忆开关默认关闭。
2. 扩展激活和工作区切换不再无条件自动安装 scaffold。
3. 用户在工具设置工作区页开启该开关时，弹窗确认初始化 harness 骨架。
4. 用户确认后，扩展安装 `media/workspace-scaffold` 并触发 CodeGraph 安装/初始化。
5. 用户取消时保持关闭，不写入启用状态。

## 范围

- `src/extension.ts`：设置保存、确认弹窗、scaffold 初始化、CodeGraph 终端命令。
- `src/toolSettings.ts`、`src/memory/runtimeGate.ts`：默认关闭口径。
- `src/webview/viewContent.ts` / `src/webview/types.ts`：工具设置文案、默认状态、开启流程回滚。
- `src/test/*.test.ts`：默认关闭与显式开启/关闭测试。
- 文档事实来源与功能清单同步。

## 非目标

- 不改变 `.ch/docs/memory/`、generated recall、`PITFALLS.md` 的存储结构。
- 不把 CodeGraph 索引结果提交进仓库。
- 不新增复杂 CodeGraph 状态 UI。

## 验收标准

- [x] 无配置时，工作区 harness/长期记忆开关显示关闭，运行时不 recall / inject / 写入。
- [x] 点击开启后，扩展侧弹窗确认；确认后才保存开启并安装 scaffold。
- [x] 用户取消确认时，开关恢复关闭，workspace settings 不被保存为开启。
- [x] 确认初始化会复制 `media/workspace-scaffold` 并创建 `ARCHITECTURE.md`、`AGENTS.md`、`CLAUDE.md`。
- [x] 确认初始化会在终端触发 CodeGraph 安装与当前工作区初始化命令。
- [x] 构建与相关单测通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/toolSettings.ts`、`src/memory/runtimeGate.ts`、`src/webview/`、`src/test/`
- 文档目录：`docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无新增

## 风险与缓解

- 风险：CodeGraph 命令不存在时自动初始化失败。
- 缓解：通过 VS Code 终端执行可见命令，不阻塞设置保存；命令包含安装/初始化顺序，失败信息由终端呈现。
- 风险：用户误点开启导致工作区被写入 scaffold。
- 缓解：后端确认弹窗作为真正写入前置条件，取消则不保存开启。
- 风险：旧配置默认为开启导致自动写入。
- 缓解：默认关闭，但保留显式 `true` / `false` 兼容；只有显式 `true` 才启用。

## 验证计划

- 最小相关验证：工具设置默认值、runtime gate、scaffold 初始化测试。
- 单元自测命令：`npm run build`；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js`
- 扩展验证：静态核对开启消息链路从 webview 到扩展确认再保存。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/toolSettings.test.ts`、`src/test/memoryRuntimeGate.test.ts`，并复用 `src/test/longTermMemory.test.ts` 覆盖 scaffold 安装。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js` 16/16 通过。
- 失败处理记录：首次测试发现旧默认开启断言，已按默认关闭新口径修正并重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `docs/cli-reference.md`、`docs/插件功能清单.md`、`docs/long_term_memory_design.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/references/codegraph.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 任务列表

- [x] 改默认关闭和运行时 gate 测试
- [x] 改 webview 开关事件为请求初始化并支持取消回滚
- [x] 改 extension 设置保存流程，确认后初始化 scaffold 和 CodeGraph
- [x] 同步文档和功能清单
- [x] 运行构建和测试

## 决策记录

- 2026-07-03：长期记忆开关升级为 harness 骨架开关，默认关闭；只有用户确认初始化后才写入工作区 scaffold。
- 2026-07-03：CodeGraph 自动安装用 VS Code 终端触发，避免阻塞 UI 或隐藏长耗时命令。

## 当前结论

已完成。工具设置“工作区”页的长期记忆入口已升级为默认关闭的 harness 骨架开关；用户开启时由扩展侧弹窗确认，确认后安装 workspace scaffold 并在终端启动 CodeGraph 设置。构建和相关单测均通过。
