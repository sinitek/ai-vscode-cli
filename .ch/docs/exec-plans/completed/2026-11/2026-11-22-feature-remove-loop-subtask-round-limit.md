# 移除 Loop/Loop+ 累计子任务轮次上限

- 日期：2026-11-22
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

移除 AI 任务配置中的累计子任务轮次上限，以及经典 Loop 和 Loop+ 的持久化预算、模型提示、派发与重派门禁。不改变单次派发上限、并发容量、验收、失败重试和产研部总监独立的协调保护。

## 验收与结果

- [x] 历史设置、任务字段和旧累计计数不再影响调度，历史结果与快照仍可读取。
- [x] 经典 Loop 在超过 200 个历史子任务后仍接受新派发；Loop+ 在超过 200 次历史尝试、超过 100 个子任务和 200 次主模型决策后仍可派发并完成。
- [x] 配置弹窗不再展示累计上限；每次派发数量、并发容量、验收顺序、失败保护和部门总监独立协调保护保持不变。
- [x] 更新功能清单、Loop+ 调度设计、运行时参考与 ontology；历史键明确记录为忽略。

## 验证记录

- `npm run build`：通过。
- `node --test --test-reporter=dot`，覆盖设置、经典 Loop、Loop+ 决策/调度/存储、Webview HTML 与脚本的 10 个定向测试文件：581 项通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；ontology 单测 9 项通过。
- `git diff --check`：通过。
- Webview 改动仅删除配置项，使用生成 HTML/脚本静态覆盖验证，不额外启动面向网站应用的 Chromium smoke harness。

## 最终结论

累计派发上限及其 UI、存储和调度门禁已移除。Loop+ 仍保留防止无进展主模型决策循环的独立安全保护；部门总监主任务的 `maxRounds` 协调用途也保持不变。
