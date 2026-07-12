# OpenCode 小模型调用语义与运行时可观测性

- 日期：2026-07-12
- 状态：completed
- 当前阶段：实现、文档、测试与构建均已完成
- 负责人：Codex
- owner：当前用户会话
- claimed_at：2026-07-12T15:40:00+08:00
- claim_ttl：本任务完成即释放
- handoff_to：无

## 背景

用户已配置 OpenCode 主模型和小模型，但在普通任务执行中长期看不到小模型调用，怀疑插件未传递小模型、把大小模型传成同一个模型，或把两者思考力度混用。

本地配置、插件运行时临时 overlay 与 OpenCode 自身日志已给出一致证据：当前主模型为 `myAPI/gpt-5.6-sol`，运行时思考力度为 `max`；小模型为 `myAPI/gpt-5.6-luna`，思考力度为 `medium`。OpenCode 1.17.18 会把小模型用于 `agent=title` 等内部轻量任务，而普通 `build`、Loop 子任务和 `explore` 子代理继续使用主模型。最近的小模型标题请求确实发生过，但多次因网关 `Bad Gateway / Service temporarily unavailable` 失败。插件现有启动日志只显示主模型和主 variant，导致可观测性不足。

## 目标

1. 保持现有大小模型和两套思考力度的独立传递语义。
2. 在插件日志中明确记录每次 OpenCode 运行实际解析出的主/小模型及各自 variant。
3. 不在 OpenCode 模型选择区展示额外的小模型用途提示，保持界面简洁。
4. 增加端到端子进程测试，证明实际 `OPENCODE_CONFIG` 中大小模型和 reasoning effort 不会混用。

## 范围

- `prepareOpenCodeRuntime` 的诊断日志。
- OpenCode 模型选择区用途提示的移除与回归保护。
- `runCliStream` runtime overlay 的端到端测试。
- 能力规格、运行时参考与功能清单。

## 非目标

- 不改变 OpenCode 官方 `small_model` 的调用时机。
- 不把小模型改造成 Loop 子任务模型或 OpenCode `explore` 子代理模型。
- 不新增不存在的 `--small-model` / `--small-variant` CLI 参数。
- 不修改用户原始 OpenCode 配置文件。

## 验收标准

- [x] 日志可直接看到 primary/small model 与 primary/small variant。
- [x] UI 不显示额外的小模型用途提示。
- [x] 端到端测试验证子进程收到不同的 model/small_model 和 reasoning effort。
- [x] 构建与相关 OpenCode 测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：日志输出敏感配置。
- 缓解：只记录模型 ref、variant 和 config ID，不记录 API Key、baseURL 或临时配置正文。

## 验证计划

- 最小相关验证：`node --test dist/test/opencodeCommandRunner.test.js dist/test/opencodedualmodelwebview.test.js`
- 单元自测命令：同上
- 扩展验证：`npm run build`；必要时运行全量 Node 测试

## 测试与清单同步

- 单元测试新增/更新：更新 `src/test/opencodeCommandRunner.test.ts` 与 `src/test/opencodedualmodelwebview.test.ts`
- 单元自测结果：`npm run build` 通过；定向测试 `52/52` 通过；全量 `node --test dist/test/*.test.js` 为 `459/459` 通过；`git diff --check` 通过
- 失败处理记录：无
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已更新能力规格与 CLI 运行时参考

## 任务列表

- [x] 核对当前配置与临时 overlay
- [x] 核对插件大小模型传递链路
- [x] 核对 OpenCode 官方语义和本地调用日志
- [x] 增加运行时模型角色日志
- [x] 移除 UI 用途提示并增加回归断言
- [x] 增加 overlay 端到端测试
- [x] 完成构建回归和文档归档

## 决策记录

- 2026-07-12：确认不存在大小模型或思考力度混传；当前实际值为 `sol/max` 与 `luna/medium`。
- 2026-07-12：不改变 OpenCode 官方调度，只修复插件可观测性和概念表达。
- 2026-07-12：使用子进程级测试读取实际 `OPENCODE_CONFIG` overlay，锁定主/小模型及两套 reasoning effort 的独立传递行为。
- 2026-07-12：按用户要求移除模型选择区的小模型用途提示，相关语义仅保留在事实文档与运行时日志中。

## 当前结论

功能链路正确，问题属于小模型用途理解偏差、内部调用失败以及插件日志信息不足三者叠加。插件现记录两套运行时配置，并以端到端测试防止后续混传回归；模型选择区不再展示额外用途提示。
