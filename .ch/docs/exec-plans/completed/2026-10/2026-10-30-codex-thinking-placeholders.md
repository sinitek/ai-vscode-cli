# Codex 空思考占位气泡过滤

- 日期：2026-10-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-30
- claim_ttl：本次任务
- handoff_to：

## 背景与目标

实际本机 Codex 消息快照出现反复拼接的 `**Thinking**\n\n*Thinking process completed.*`，被当作非空思考正文显示。只隐藏该类占位展示，保留真实思考、正常回答、工具事件与原始消息。

## 范围与非目标

- 范围：自包含占位过滤函数、Codex assistant thinking 展示入口、核心与 Webview 回归、功能规格和本体规则。
- 非目标：不关闭全部思考、不改变 runner 增量协议、不改写用户日志或配置、不安装扩展或发布。

## 验收标准

- 纯占位以及反复紧邻拼接的占位不产生可见气泡。
- 占位后出现真实思考时恢复展示，正文不丢失；正常回答、用户消息和其他 CLI 不受影响。
- 实时增量和历史消息走同一展示逻辑，原始内容保持不变。
- 构建、相关回归、文档与本体校验通过，完成本机 Chromium 冒烟。

## 影响面与风险

- 实现：`src/codexReasoningContent.ts`、`src/webview/viewContentScript/traceRendering.ts`。
- 测试：`src/test/core/codexReasoningContent.test.ts`、`src/test/webview/codexThinkingPlaceholder.test.ts`。
- 文档：功能清单、能力规格、`plugin.rule.thinking_bubble_viewport`。
- 风险：直接清洗 runner 缓冲会破坏只追加增量前缀；因此限定展示层过滤，并保持注入 Webview 的函数完全自包含。

## 验证计划

- `npm run build`
- `node --test --test-timeout=20000 dist/test/core/codexReasoningContent.test.js dist/test/webview/codexThinkingPlaceholder.test.js`
- 扩展验证：Webview runtime、final-answer policy、Codex runtime；本机日志只读回放；Chromium 冒烟。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；`git diff --check`。

## 任务列表

- [completed] 核对本机 Codex 消息快照并定位渲染链
- [completed] 实现仅展示层过滤并补充回归测试
- [completed] 完成构建、回放、浏览器与文档校验

## 决策与验证记录

- 初始考虑统一 sanitizer，发现增量缓冲依赖前缀只追加，改为展示层过滤，不变更存档规则。
- 首轮回归发现向前扫描在索引 0 的终止条件缺失，已修正并增加普通加粗标题保护断言。
- `npm run build` 通过；相关核心、Webview 与 Codex runtime 测试共 50 项通过。
- Chromium 历史回放、逐字符流式续写及范围保护场景通过，包含 CRLF 重跑，无浏览器或网络错误。
- 本体校验、`git diff --check` 和目标文件空白校验通过。
- Webview 扩展回归有 5 项失败，已在 `HEAD` 基线复现：两个未定义标识符及两个既有断言失败，未纳入本次修复。

## 文档与记忆同步

- 功能清单、能力规格及思考气泡本体规则随实现同步。
- 不更新 `ROLLING_SUMMARY.md`；无需引入新业务概念。
