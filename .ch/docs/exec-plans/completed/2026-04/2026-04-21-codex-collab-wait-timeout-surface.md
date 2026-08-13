# Codex 协作子任务 wait 超时上屏修复

- 日期：2026-04-21
- 状态：completed
- 负责人：Codex

## 背景

AI 对话里存在一种中途“无声中断”问题：Codex 在使用 explorer/worker 子任务后调用 wait，若返回的是超时结果（例如 `{"status":{},"timed_out":true}`）而不是业务异常，当前 VS Code 插件不会把这类情况转成用户可见错误，导致对话气泡没有明确报错信息。

用户提供了两份运行日志，要求先确认日志中是否存在“任务半途结束但未报错”的现象，再把这类超时情况明确输出到 AI 对话中。

## 目标

1. 确认当前日志与运行链路中是否存在 Codex 回合结束但未产生对话内错误提示的情况。
2. 定位 Codex app-server 协作/子任务事件在插件中的解析缺口。
3. 在 explorer/worker 等协作子任务 wait 超时场景下，把错误明确显示到 AI 对话中，而不是静默结束。

## 范围

- `src/interactive/codexRunner.ts` 中对 Codex app-server 协作事件/条目的解析与失败判定。
- `src/extension.ts` 中 AI 对话消息上屏逻辑的联动验证。
- 必要的 i18n 文案与事实来源文档同步。

## 非目标

- 不改动 Codex CLI 本身。
- 不改动 Claude/Gemini 交互链路。
- 不做与本问题无关的大范围 UI 重构。

## 验收标准

- [x] 已记录日志中“turn interrupted/ended 但没有明确错误输出”的证据或局限。
- [x] Codex 协作子任务 wait 超时会被识别为失败信号。
- [x] AI 对话里能看到明确错误提示，而不是仅结束或静默中断。
- [x] 至少完成最小相关验证（自动化或构建），并记录未覆盖风险。

## 影响面

- 代码目录：`src/interactive/`、`src/extension.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/exec-plans/active/`，必要时 `.ch/docs/runbooks/PITFALLS.md` / 功能事实来源
- 配置与脚本：无预期技术栈变更

## 风险与缓解

- 风险：Codex app-server 协作事件协议已扩展，现有 runner 只识别旧 item 类型，容易误判或漏判。
- 缓解：结合生成的 app-server TypeScript schema、现有日志与最小复现路径实现保守解析，仅对明确的超时/失败状态上屏。

## 验证计划

- 最小相关验证：补充/执行围绕 Codex 协作 wait 超时解析的自动化断言，外加 `npm run build`。
- 扩展验证：如时间允许，构造一次实际协作子任务超时回合，检查对话气泡是否出现错误。

## 测试与清单同步

- 单元测试：仓库暂无现成测试基建，本次补充 `scripts/validate_codex_collab_timeout.js` 作为最小回归校验。
- 功能清单：无需更新，本次为既有交互链路缺陷修复，无新增能力。
- 相关文档同步：已补充 `.ch/docs/runbooks/PITFALLS.md` 记录根因与验证方式。

## 任务列表

- [x] 阅读仓库入口与相关规则，建立任务列表
- [x] 初步检查用户日志并确认“中断无错误”现象
- [x] 定位 Codex 协作事件/条目协议与当前解析缺口
- [x] 实现超时转错误并上屏
- [x] 执行验证并同步必要文档

## 决策记录

- 2026-04-21：先以插件侧兼容修复为主，不改动外部 Codex CLI；优先基于 app-server schema 补齐 collab 相关事件解析。
- 2026-04-21：确认 `account/rateLimits/updated` 属于普通 notification，不是本次中断根因；真正需要补的是 `rawResponseItem/completed` 与 `collabAgentToolCall` 的解析。

## 当前结论

- 已确认现有 `codexRunner` 之前只识别传统 item 类型，缺少对 `rawResponseItem/completed` 与 `collabAgentToolCall` 的解析。
- 用户提供日志里没有 `account/rateLimits/updated`，且代码已确认该通知不会直接触发中断；更可疑的是 `wait` 超时结果 `{"status":{},"timed_out":true}` 没有转成错误。
- 已补充 `src/interactive/codexAppServerEvents.ts` 解析协作子任务事件，在 `src/interactive/codexRunner.ts` 中把 `wait` 超时与 collab 子任务失败转成对话内错误。
- 已执行 `npm run build` 与 `node scripts/validate_codex_collab_timeout.js`；当前剩余建议是手工构造一次 explorer 超时回合做 UI 侧验收。
