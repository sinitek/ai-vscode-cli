# Memory Evals

这个目录用于存放手写 golden questions，以及围绕 `memory-eval` 的 starter 说明。

starter 默认只保留：

- `README.md`
- `TEMPLATE.md`

不要把当前模板仓库自己的真实 eval run 结果、真实问题集或历史报告放进这里。真实项目在接入后，再按自己的主题补充问题集。

## 设计边界

- `memory-eval` 是评测入口，不是新的事实来源
- 原始事实仍来自 `.ch/docs/memory/`、`design-docs/`、`runbooks/`、`product-specs/`、`exec-plans/`
- 评测报告应输出到 `.ch/docs/generated/memory-index/eval-runs/` 这类可重建目录，而不是回写这里

## 推荐用法

1. 复制 `TEMPLATE.md`，为真实项目创建一个或多个问题集
2. 为每个问题填写：
   - `question`
   - `focus`
   - `expected_source_paths`
   - 可选 `expected_observation_ids`
   - 可选 `notes`
3. 在真实项目仓库根目录运行：

```bash
python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root .
```

可选参数示例：

```bash
python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root . --suite starter
python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root . --questions .ch/docs/memory-evals/team-memory.md
python3 .agents/skills/memory-eval/scripts/evaluate_memory_recall.py --root . --focus "release handoff"
```

## 结果定位

推荐生成：

- Markdown report：方便审阅命中情况、漏召回和读取成本
- summary JSON：方便后续自动汇总或做简单回归比较

这些结果应当是一次独立运行的产物，能靠仓库内脚本和事实源重新构建。
