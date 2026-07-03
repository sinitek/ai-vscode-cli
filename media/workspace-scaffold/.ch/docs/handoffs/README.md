# Handoffs 目录说明

这里用于存放**跨会话交接文档**。

它的目标不是替代执行计划，而是把一次工作暂停时最关键的上下文收口下来，让下一次接手的人或代理能快速恢复状态。

## 什么时候写 handoff

- 本轮工作是非平凡任务
- 任务没有一次性收尾
- 预计会在下一次会话继续
- 本轮出现了新的结论、风险、未完成承诺或待上提内容

## 什么时候不必单独写

- 任务非常小，且已经在当前响应里完全收尾
- `exec plan` 已经足够完整，并且不会发生跨会话交接

## 推荐方式

优先复制 `TEMPLATE.md` 或使用 `session-handoff` skill 对应脚本生成初稿：

```bash
python3 .agents/skills/session-handoff/scripts/create_session_handoff.py --slug <slug> --title "<title>"
```

脚本只是模板实例化器：它会在本目录下生成带日期和 slug 的 handoff 文件，替换 `TEMPLATE.md` 中的占位符，并带上当前 active plan、pending item 和 active risk 的简短快照。交接质量仍取决于人工补全“本轮摘要 / 已完成 / 未完成 / 验证 / 上提检查”。

如果不需要脚本，也可以直接复制模板：

```bash
cp .ch/docs/handoffs/TEMPLATE.md .ch/docs/handoffs/$(date +%F)-<slug>.md
```

复制后手动替换日期、标题和 `source_of_truth` 即可。

## 使用原则

- handoff 是 episodic 记忆，不是长期热区。
- 长期有效的结论不要只留在 handoff；收尾时应按 `.ch/docs/MEMORY.md` 的规则上提。
- handoff 是交接模板和检查清单，不是复杂数据生成器；不要让脚本承载人工判断。
- starter 默认只保留 `README.md` 和 `TEMPLATE.md`，不要把当前仓库自己的 handoff 留进模板。
