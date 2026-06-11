# 自动重试开始态可见性修复

- 日期：2026-06-11
- 状态：completed
- 负责人：Codex

## 背景

当前 hidden retry 只会在进入等待期时展示“将在 N 秒/分钟后开始第 X/Y 次自动重试”。等待结束后，扩展会直接发起下一轮 CLI 请求，但不会把“自动重试已开始”回传到 Webview。若 CLI 后续长时间没有输出，用户会误以为重试未执行，且标签页可能持续停留在错误态。

## 目标

让自动重试在真正开始执行时具备明确可见状态，避免用户只能看到等待文案，无法判断是否已经重试。

## 范围

- `src/extension.ts` hidden retry 开始阶段的系统消息补充
- `src/webview/viewContent.ts` 对 hidden retry 等待/开始态的识别与标签状态切换
- `src/i18n.ts` 文案国际化
- 必要的规格文档与测试同步

## 非目标

- 不调整 hidden retry 次数、延迟序列或重试资格判定
- 不重构现有任务运行条或消息气泡架构

## 验收标准

- [x] 自动重试等待结束时，聊天区会追加“第 X/Y 次自动重试已开始”提示
- [x] 自动重试开始后，标签页不再继续保持“等待重试”的错误态
- [x] 分钟级延迟的第 4/5 次等待文案仍能被前端正确识别
- [x] `npm run build` 通过

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/viewContent.ts`、`src/i18n.ts`、`src/hiddenRetry.ts`、`src/test/hiddenRetry.test.ts`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：新增系统提示与现有系统消息合并后，用户仍难区分状态切换
- 缓解：文案使用明确的“已开始”语义，并在 Webview 侧同步恢复标签运行态

- 风险：依赖文案匹配的前端识别逻辑只覆盖秒级延迟
- 缓解：统一改为覆盖秒/分钟延迟的正则匹配

## 验证计划

- 最小相关验证：hidden retry 纯函数测试 + `npm run build`
- 扩展验证：代码审查 one-shot / interactive / parallel 三条 hidden retry 分支都补到开始态

## 测试与清单同步

- 单元测试：补充 hidden retry 进度信息纯函数覆盖
- 功能清单：同步 hidden retry 可见性行为说明
- 相关文档同步：同步能力规格与运行时参考

## 任务列表

- [x] 结合用户日志确认是否真的发起过 retry
- [x] 定位 hidden retry 等待期和开始期的状态断点
- [x] 补充 retry 开始态消息与 Webview 状态恢复
- [x] 同步规格文档
- [x] 执行验证并归档计划

## 决策记录

- 2026-06-11：不改 hidden retry 策略本身，只补“开始执行”可观测性与标签状态恢复，保持现有重试次数和延迟不变。

## 当前结论

用户日志已证明第 1 次 retry 在等待 5 秒后重新发起了 `spawn_prepare` 和 `turn.started`。本次已补齐三条执行链路（interactive / one-shot / parallel）的“自动重试已开始”系统提示，并把 Webview 的等待态识别改为同时覆盖秒/分钟延迟。验证通过：`npm run build`、`node --test dist/test/hiddenRetry.test.js`。
