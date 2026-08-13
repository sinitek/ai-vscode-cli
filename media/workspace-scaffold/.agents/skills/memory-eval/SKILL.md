---
name: memory-eval
description: Use when you need to score whether memory recall hit the expected source docs for a small set of hand-written golden questions and produce a rebuildable eval report.
---

# Memory Eval

目标：给当前 repo-native memory MVP 提供一个最薄的评测入口，复用已有 `memory-indexer` / `memory-recall` 产物，判断 recall 是否命中了应该先读的来源。

## 什么时候用

- 你已经有一组手写 golden questions，想检查 recall 是否把正确来源排到前面
- 你刚调整了记忆热区、索引或召回规则，想做一次轻量回归
- 你要给主任务、审阅者或后续会话留一份可重建、可审阅的 eval report

## 不该什么时候用

- 不要把它当成新的事实来源
- 不要在这里重写 `memory-recall` 的召回逻辑
- 不要把真实 eval run 结果预置进 starter

## 工作流

1. 先准备手写 golden questions：
   - 默认目录：`.ch/docs/memory-evals/`
   - starter 只保留 `README.md` 和 `TEMPLATE.md`
2. 在真实项目仓库根目录运行：
   - `python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root .`
   - 如需只跑某个 suite：`python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root . --suite starter`
   - 如需做一次临时 focus 检查：`python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root . --focus "memory recall quality"`
3. 先看输出的 Markdown report，再看同目录 summary JSON。

## 输入边界

- golden questions 是手写、可审阅的 Markdown 模板实例
- `memory-eval` 读取或调用：
  - `memory-indexer` 生成的 `summary.json`
  - `memory-recall` 生成的 `recall-summary.json`
  - 未来可选的 `claims.jsonl`
- `expected_source_paths` 应优先指向原始事实来源或长期文档，而不是 eval 报告本身

## 默认输出

建议输出到：

- `.ch/docs/generated/memory-index/eval-runs/<timestamp>-<suite>-report.md`
- `.ch/docs/generated/memory-index/eval-runs/<timestamp>-<suite>-summary.json`

每次 eval run 还会在对应 `eval-runs/.workspaces/` 下创建隔离的 recall 工作区：

- 评测过程中复用或重建的 `summary.json` / `claims.jsonl`
- 每道题的 `recall-pack.md` / `recall-summary.json` / `retrieval-debug.md`

这些 recall 产物只服务于当前评测，不会覆盖正常使用的 `.ch/docs/generated/memory-index/.local/recall-pack.md` 或 `.local/recall-summary.json`。

这些产物必须保持：

- 文本化
- 可重建
- 可审阅
- 可独立归档

## 当前最小指标

- `expected_source_hit`
- `source_precision_at_k`
- `estimated_read_tokens`
- `privacy_leak_count`

如果后续 `claims.jsonl` 稳定，再补 `unsupported_claim_rate`；第一版不强行实现。

## 不要这样做

- 不要把 eval report 当成长期事实来源
- 不要把 starter 模板仓库里的真实运行结果一起提交
- 不要把评测脚本做成依赖第三方服务或第三方包的流程
