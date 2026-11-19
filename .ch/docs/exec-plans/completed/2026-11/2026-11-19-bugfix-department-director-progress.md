# 产研部总监进度随决策刷新

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与范围

组长结算会唤醒总监，但总监任务没有经典 Loop 子任务轮次；`waiting` 还绕开了经典决策持久化。修复总监 JSON 的进度提交与群聊刷新。

## 验收标准

- 组长结算后，总监有效决策保存 `progressPercent`，并刷新已打开群聊的总体进度。
- 等待仍在执行的组长时也能更新百分比。缺省字段保留上次进度，组织完成门禁通过后显示 100%。
- 普通 Loop 和 Loop+ 沿用各自的进度协议。

## 验证计划

- `npm run build`，执行产研部生产组合、经典 Loop 状态机、JSON 解析和群聊相关单测。
- 更新功能清单、群聊契约和 Ontology，检查 `git diff --check`。

## 当前结论

- 回归测试先复现组长结算后 `55%` 仍未写入。修复后确认后续派工显示 55%、等待中的总监显示 62%、最终完成显示 100%。
- `npm run build` 通过。使用 `node --test` 运行产研部生产组合、运行组合、生产任务存储、经典 Loop 状态机及决策解析、等待看门狗和群聊相关的 10 个测试文件，232 项通过。Ontology 校验和 9 项 Ontology 单测通过。
- 在物理隔离副本运行 `node scripts/verify_department_full_eh_integration.js --product <隔离构建副本> --report <证据路径>`，使用真实 VS Code、Codex CLI 和本机确定性模型响应。通过专用 Webview 适配器确认工具栏自动显示 50% 和 100%，对应任务记录均已持久化。证据在 `/tmp/sinitek-director-progress.eSY3LX/retry-report.json`。
- 已同步功能清单、群聊契约和 Ontology。
