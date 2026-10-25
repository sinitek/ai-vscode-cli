---
plan_id: 2026-10-25-dsh-thinking-effort-follow-up
status: completed
created_at: 2026-10-25
---

# DSH 思考力度实际生效修复

## 背景与目标

DSH ACP 的 `session/set_config_option` 参数已经正确使用 `configId: "reasoning_effort"` 和原始 value，但模型状态构建阶段把 DSH 的力度固定成 `off`，导致面板选择无法稳定传递到下一次运行。修复状态读取路径，确保按模型保存的 `low`、`high`、`max` 等值进入 DSH 运行端口并在提示前经 ACP 确认。

## 范围与非目标

- 修改 DSH 模型状态构建中的思考力度来源。
- 增加按模型状态回读和 DSH 运行前应用 effort 的回归测试。
- 不改变 ACP 参数协议、DeepSeek 支持档位、Grok 行为或其它 CLI 的思考力度逻辑。

## 验收标准

1. DSH `modelState.thinkingModeByCli.dsh` 使用当前选中模型保存的力度，不再固定为 `off`。
2. 下一次 DSH 交互在 `session/prompt` 前调用 runner 的 `setThinkingMode`，传入已选择且经广告值确认的 raw value。
3. ACP runner 仍发送 `session/set_config_option` 的 `reasoning_effort` 标量参数。

## 影响面与风险

- 影响 `src/extensionHost/modelSettings.ts` 的 DSH 面板状态和 Loop 子任务 fallback。
- 若存量值无效，沿用通用 workspace 默认值；不会发送未被 ACP 广告的值。

## 验证结果

- `npm run build`：通过。
- DSH 配置、模型选择、Extension Host、ACP 协议 / runner 与 Webview 测试：75 项通过，0 项失败。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、17 concepts、16 relations、62 rules、2 workflows、3 documents）。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check`：通过。
- 未执行图形 Extension Development Host 点击验收；本次以构建和回归测试覆盖状态读取、运行前应用及 ACP runner 设置协议。

## 结论

ACP 参数格式正确。实际问题是 `buildModelState()` 将 DSH `thinkingModeByCli` 固定为 `off`，使面板通用模式快照错误。现改为基于当前选中 DSH 模型读取有效力度，并确认交互运行会在发送提示前应用选择值。
