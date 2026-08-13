# Gemini Thinking Alias 迁移计划

- 日期：2026-04-26
- 状态：completed
- 负责人：Codex

## 背景

当前仓库对 Gemini 思考力度的实现方式，是在运行前向工作区写入 `.gemini/settings.json`，通过 `modelConfigs.*.generateContentConfig.thinkingConfig.thinkingLevel` 间接影响 Gemini CLI 行为。用户已确认这套模式过时，希望切换到更贴近官方当前能力的方案。

根据 2026-04-26 核对的官方资料：Gemini API/SDK 已支持请求级 `thinkingConfig`，但 Gemini CLI 公开文档仍未提供 `--thinking-level` / `--thinking-budget` 一类独立命令行参数；CLI 目前更适合通过 `settings.json` 中的 `modelConfigs` / alias 配置，再结合 `-m/--model` 参数进行选择。本次最终实现进一步收敛为：用 `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 指向一次性临时 system settings 覆盖层，再通过 `-m/--model` 选择运行时 alias，避免改写用户工作区或用户主配置文件。

## 目标

把 Gemini 思考力度从“运行时改写工作区 settings 文件”迁移为“临时 system settings 覆盖层 + `-m/--model` alias 参数选择”，让调用链更贴近官方 CLI 当前形态，并避免运行中反复改写项目配置文件。

## 范围

- 梳理 `src/extension.ts`、`src/cli/commandRunner.ts`、模型选择逻辑中的 Gemini thinking 实现。
- 设计并实现 Gemini thinking alias 生成/切换规则。
- 移除运行前动态写 `.gemini/settings.json` 的旧逻辑，并在安全条件下清理旧插件遗留文件。
- 补充最小回归测试与文档同步。

## 非目标

- 不将 Gemini 接入方式从 CLI 彻底切换为直连 API/SDK。
- 不改动 Codex / Claude 的 thinking 实现。
- 不引入新的技术栈或外部服务依赖。

## 验收标准

- [x] Gemini 运行时不再依赖写入工作区 `.gemini/settings.json` 来切换 thinking。
- [x] Gemini 调用链可通过 `-m/--model` 选择不同 thinking alias。
- [x] 现有构建通过，并有最小回归验证覆盖 alias 选择规则。

## 影响面

- 代码目录：`src/extension.ts`、`src/cli/commandRunner.ts`、`src/cli/geminiThinking.ts`、`src/test/*`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：沿用 `npm run build`，必要时新增最小 node test

## 风险与缓解

- 风险：不同 Gemini 模型族对 thinking 配置语义不同，若误把同一套参数强加给所有模型，容易出现运行失败或“off 不生效”。
- 缓解：把 alias 计算逻辑做成纯函数，按 Gemini 2.5 / Gemini 3 / unsupported 模型族分别映射；不支持的模型直接 passthrough，并补针对不同模型族的回归测试。

## 验证计划

- 最小相关验证：`npm run build` 与 `node --test dist/test/geminiThinking.test.js dist/test/runnerRetention.test.js`。
- 扩展验证：在 VS Code 中切换 Gemini thinkingMode，确认命令参数使用 `-m/--model sinitek-*` 变化，且工作区不再生成/更新 `.gemini/settings.json`。

## 测试与清单同步

- 单元测试：补 alias 解析/选择的最小逻辑测试。
- 功能清单：同步说明 Gemini thinking 现在走临时 system settings 覆盖层 + alias + model 参数选择。
- 相关文档同步：记录旧的“运行时写 settings”方案为何弃用，避免回退。

## 任务列表

- [x] 核对 Gemini 官方当前支持边界
- [x] 梳理仓库内 Gemini thinking 链路与模型选择逻辑
- [x] 实现 alias 驱动迁移并移除旧逻辑
- [x] 补充验证与同步文档

## 决策记录

- 2026-04-26：在 Gemini CLI 未公开提供独立 thinking 命令行参数的前提下，采用官方 CLI 更贴近的 alias + `--model` 选择方式，而不是继续运行时改写工作区 settings 文件。
- 2026-04-26：进一步收敛为“临时 system settings 覆盖层 + `GEMINI_CLI_SYSTEM_SETTINGS_PATH` + `-m/--model`”组合，避免污染用户工作区与用户主配置。

## 当前结论

已完成迁移：Gemini thinking 不再通过 `src/extension.ts` 运行时写工作区 `.gemini/settings.json`；现在会为当前 base model 生成一次性 runtime alias，把 alias 定义写入临时 system settings 文件，并通过 `GEMINI_CLI_SYSTEM_SETTINGS_PATH` 注入给 Gemini CLI，再用 `-m/--model` 选择该 alias。Gemini 2.5 / 3 / unsupported 模型族分别采用 budget、level、passthrough 三套策略；对旧插件遗留的 workspace `.gemini/settings.json`，只在能确认是历史模板文件时才安全删除。

已验证：
- `npm run build`
- `node --test dist/test/geminiThinking.test.js dist/test/runnerRetention.test.js`

未覆盖：
- 尚未做 VS Code 真机录制式回归；仍建议手工确认运行前后工作区不再生成 `.gemini/settings.json`，以及 Gemini 命令实参里出现 `-m sinitek-*` alias。
