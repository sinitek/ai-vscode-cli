# Codex 402 终态错误重试修复

- 日期：2026-07-14
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-14T17:30:50+0800
- claim_ttl：本次会话
- handoff_to：无

## 背景

Codex 通过本地 LLM proxy 请求模型池时返回 `402 Payment Required`、`remaining 0`。扩展把该终态错误纳入隐藏重试；同时错误 trace 被标记为普通 trace，外层误认为本轮已经恢复并清零重试计数，导致界面长期停留在 `1/5` 并无限重试。

## 目标

明确区分 Codex 错误 trace 与正常进度，并把 HTTP 402、支付要求和明确余额/积分耗尽识别为不可重试错误，使任务首次失败后正常收口并展示原始错误。

## 范围

- Codex app-server 可见错误 trace 类型。
- 共享隐藏重试的明确计费终态错误门禁。
- 相关单元测试、CLI 运行时参考、功能清单与踩坑记录。

## 非目标

- 不改变 429、网络中断和其他暂时性错误的既有隐藏重试。
- 不修改 LLM proxy、模型路由、积分或用户 Codex 配置。
- 不调整隐藏重试次数和退避时间序列。

## 验收标准

- [x] Codex 可见错误 trace 使用结构化 `error` 类型，不会触发恢复计数重置。
- [x] `402 Payment Required`、明确积分/余额耗尽被判定为不可隐藏重试。
- [x] 429 和普通网络错误继续可隐藏重试，取消、Runner 释放和 ENOENT 仍不可重试。
- [x] 最小相关单测和 TypeScript 构建通过；统一单测的范围外失败已分类并记录。
- [x] 事实来源文档和 PITFALLS 完成同步。

## 影响面

- 代码目录：`src/interactive/`、`src/panelDiagnostics.ts`、`src/extension.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无配置变化；复用现有 npm 测试和构建脚本

## 风险与缓解

- 风险：过宽的余额错误匹配会阻止暂时性错误重试。
- 缓解：仅匹配 HTTP 402、Payment Required、明确 insufficient credits/balance/points 或 points required 且 remaining 0；单测保留 429 与网络错误正例。
- 风险：trace 类型扩展影响普通工具、思考或 Webview 展示。
- 缓解：只把 Runner 生成的可见错误标为 `error`，展示仍映射为普通 trace 气泡；普通与 thinking trace 保持原协议。

## 验证计划

测试分层、适用性与失败处理统一遵循 `.ch/docs/TESTING.md`。

- 最小相关 unit（命令、结果或不适用理由）：最终 `node --test dist/test/hiddenRetry.test.js dist/test/panelDiagnostics.test.js dist/test/codexRunnerRuntime.test.js` 28/28 通过
- 模块/统一 unit（命令、结果或等价关系）：`npm run test:unit` 的 build 通过，但用户并行开发中的 `chromiumPlaywrightSmoke.test.ts` 因缺少 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs` 进入长时间失败等待，确认后终止本次进程；排除该文件后 618 条中 617 通过，唯一失败仍是 `longTermMemory.test.ts` 读取同一缺失 canonical Skill 目录，与本次改动无关
- typecheck/build（命令、结果或不适用理由）：最终 `npm run build` 通过
- Chromium headless smoke（适用性及理由、scenario、命令、退出码、`result.json`/截图、未覆盖风险）：不适用；本次不改变 Webview DOM、样式或浏览器交互，只改变宿主端错误重试决策和 trace 元数据。

## 测试与清单同步

- 单元测试新增/更新：新增 `panelDiagnostics.test.ts` 计费终态/暂时性错误边界；更新 `codexRunnerRuntime.test.ts` 验证 error trace 元数据
- 单元自测结果：最小相关 28/28 通过；宽范围 617/618 通过，唯一失败来自缺失的未提交 Chromium Skill canonical 目录
- 失败处理记录：分类为范围外/并行开发工作树不完整；未修改 `chromiumPlaywrightSmoke.test.ts` 或补造 canonical Skill 资产
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步 CLI 运行时参考与 PITFALLS

## 任务列表

- [x] 实现 402/余额终态错误门禁与 error trace 类型
- [x] 补充回归测试
- [x] 同步事实来源文档
- [x] 运行分层验证并记录结果

## 决策记录

- 2026-07-14：保留现有 5 次退避策略，只拦截明确计费终态错误；错误 trace 通过结构化类型与正常进度分离，不依赖字符串清洗。

## 当前结论

修复完成。HTTP 402/明确计费耗尽在交互异常和非零退出路径均首次收口；Codex error trace 不再清零重试计数。最终 build 与 28 条定向测试通过，宽范围测试的唯一失败已证明属于缺失 Chromium Skill 资产的并行开发基线。
