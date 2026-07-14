# 执行前自动上下文压缩开关

- 日期：2026-05-21
- 状态：completed
- 负责人：Codex

## 背景

当前“压缩上下文”仅支持用户手动点击常用指令触发。用户希望在工具设置中提供自动化开关：开启后，执行任务前若不是新会话，先做上下文压缩，再自动继续任务执行。

## 目标

1. 在聊天面板工具设置中新增“执行前自动压缩上下文”开关，默认开启。
2. 该开关按项目级（workspace settings）持久化。
3. 开关开启时，任务执行前仅对 codex / claude / gemini 的非新会话自动触发上下文压缩；压缩结束后继续自动执行原任务。
4. 同步更新能力规格与功能清单，并完成构建验证。

## 范围

- `src/extension.ts`：workspace setting、任务前置压缩编排。
- `src/webview/types.ts`、`src/webview/viewContent.ts`：工具设置 UI、panel state。
- `.ch/docs/product-specs/*`、`.ch/docs/references/*`：事实来源同步。

## 非目标

- 不改现有“常用指令 -> 压缩上下文”的手动行为。
- 不调整Loop模式协议和多任务调度策略。

## 验收标准

- [x] 工具设置出现新开关，默认开启，支持中英文。
- [x] 设置持久化到 workspace settings，重开面板后保持。
- [x] 开关开启时，非新会话任务会先压缩再执行；新会话不触发压缩。
- [x] 仅 codex / claude / gemini 生效，其他 CLI 不触发。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/*`
- 文档目录：`.ch/docs/product-specs/*`、`.ch/docs/references/*`
- 配置与脚本：无新增依赖

## 风险与缓解

- 风险：压缩逻辑与任务执行复用同一运行状态，可能互相抢占。
- 缓解：沿用现有压缩命令链路，在任务启动前串行执行，压缩完成后再开始任务。
- 风险：新会话判定不准确导致首轮任务被误压缩。
- 缓解：以目标会话 ID 是否存在作为“新会话”判定，并限制到已支持自动压缩的 CLI。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：静态检查 sendPrompt -> 自动压缩 -> runPrompt / runLoopPrompt 的编排链路

## 测试与清单同步

- 单元测试：本次以构建和链路校验为主；仓库现有测试未覆盖该编排路径。
- 功能清单：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/references/cli-runtime-reference.md`。

## 任务列表

- [x] 新增 workspace setting + panel state + 工具设置开关 UI
- [x] 在任务入口增加“非新会话自动压缩后执行”的串行编排
- [x] 同步文档并完成构建验证

## 决策记录

- 2026-05-21：自动压缩默认开启；最终覆盖 codex / claude / gemini。

## 当前结论

已完成。实现要点：

- 在 `workspaceSettings` 新增 `autoCompactContextBeforeRun`（默认 `true`）并接入工具设置 UI。
- 在 `sendPrompt` 编排链路中，任务实际启动前新增串行前置步骤：当开关开启且目标为 Codex/Claude/Gemini 的非新会话时，先执行上下文压缩，再继续原任务。
- 自动压缩失败时不阻断原任务，会记录日志并继续执行。
- 已执行 `npm run build`，通过。
