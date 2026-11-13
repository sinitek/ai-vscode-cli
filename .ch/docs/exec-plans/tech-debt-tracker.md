# 技术债跟踪

记录那些**值得做，但暂时不足以单开计划**的后续事项。

starter 默认不预填当前仓库的历史条目；请在真实项目里按需补充。

| 日期 | 主题 | 描述 | 建议处理时机 |
| --- | --- | --- | --- |
| 2026-10-31 | 严格覆盖率门槛与分组测试覆盖缺口 | `test:core-coverage`、`test:page-coverage` 的既有 100% 全局门槛未达标；独立还原 `43b085a` 复测同样失败。部分已有回归未被分组清单纳入，全量采样仍有未覆盖的防御分支。保留门槛和有效测试，后续按源文件补行为覆盖并统一分组入口；当前门槛与分组入口以[测试基线](../TESTING.md)和 `package.json` 的 `test:core-coverage`、`test:page-coverage` 脚本为准。 | 下一轮测试覆盖率治理，或相关模块新增行为时顺带补齐 |
| 2026-11-13 | commandRunner Windows 历史测试失败 | `commandRunnerCoverage.test.js` 当前为 11/17；使用 `a589f3c9` 的实现与测试对照仍失败同样 6 项，涉及带空格的 Node 命令路径与平台夹具。今日登录 shell 新增回归 1/1 通过。详细命令、失败分类及日志见 [Windows 验证记录](../references/codex-thread-handoff-windows-validation.md#补充回归与失败分类)。 | 命令解析或跨平台测试夹具维护时补齐；保留现有失败证据 |
| 2026-11-13 | Codex 释放修复的原生平台与宿主验收缺口 | 三份昨日修复已完成源码审查与 Windows 隔离集成复验并归档；原生 macOS/Linux、其它版本的能力/专属 owner live、已安装扩展与真实 VS Code 多窗口/Loop+、其它 CLI、真实模型及未知外部 writer 仍未验收。macOS/Linux 删除只调用一次已有 mock 回归，不等于原生验收。详细范围及报告见 [最终复验记录](../references/codex-thread-handoff-windows-validation.md#最终复验与归档边界)；`fullyVerified=false` 保留。 | 有对应原生环境时执行 `npm run verify:loop-plus`，真实宿主/其它 CLI/外部 writer 按各自场景补验，不以 Windows 报告替代 |
