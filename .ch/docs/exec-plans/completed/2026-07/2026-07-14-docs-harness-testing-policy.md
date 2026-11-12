# Harness 测试分层政策与计划证据槽

- 日期：2026-07-14
- 状态：completed
- 负责人：协作
- owner：Loop 主任务 `msg_1783998484827_4b2d85596667a`
- claimed_at：2026-07-14T03:18:27Z
- claim_ttl：本 Loop 任务完成前；每轮主任务复核时续期
- handoff_to：已归档，无后续 active handoff

## 背景

同日 Chromium Playwright 能力工作发现，Harness 需要把现有单元自测规则保持在 `.ch/docs/TESTING.md` 单一事实源，同时在计划模板及入口中表达 unit、typecheck/build 与条件触发浏览器 smoke 的层级，并为命令、结果、失败分类及未验证事项留证据槽。此文档交付与 Playwright runner 的实现、VSIX hygiene 是不同类型的工作，不归入其它类型交付；原测试能力计划已按用户授权删除，历史验证限制见删除审计。

## 目标与范围

- 保留 `.ch/docs/TESTING.md` 作为单元测试政策唯一事实源；其它入口只放导航和分层触发说明，不复制完整规则。
- 将“最小 unit → 模块/统一 unit → typecheck/build → 符合条件时 Chromium smoke”的层级、计划证据槽和失败分类交付到规则/模板/相应 Harness 入口。
- 保留已批准的不扩改 Planner/Implementer/Reviewer profiles 的边界。
- 不实现 Playwright runner，不改 `.vscodeignore`、安装实现或 VSIX 发布物；依赖分别见 [历史验证证据](../../migrations/test-plan-removals/2026-11-11-jul-sep.json) 和 [打包维护计划](2026-07-14-chore-harness-vsix-hygiene.md)。

## 验收标准与历史结果

- [x] 规则仍以 `.ch/docs/TESTING.md` 为唯一事实源，相关入口保持薄导航/分层规则。
- [x] 计划模板具有测试与验证证据槽；同步范围按源计划记录为根与 scaffold 的规则/模板及 execution-plan Skill 镜像。
- [x] 归档记录将政策集成批次标为完成。该历史勾选说明计划被关闭归档，不是本轮重新执行的验证，也不替代链接目标计划的独立验收。
- 原计划列明的 `cmp -s` 镜像比较及定向 `git diff --check` 归属于政策集成任务；本轮只迁移拆分记录，没有重新运行这些历史命令。逐文件真实改动与当时完整输出未包含在来源计划中，故不补造命令结果。

## 依赖、风险与当前结论

- 依赖 [历史验证证据](../../migrations/test-plan-removals/2026-11-11-jul-sep.json) 定义的 L0/L1/L2 分层和条件 Chromium smoke 边界；政策文档不表示真实 Chromium 已验证。
- 依赖 [打包维护计划](2026-07-14-chore-harness-vsix-hygiene.md) 对包候选和 VSIX 内容的独立证据；本计划不作包内容声明。
- 状态沿用原计划 `completed`。只有历史记录明确的规则原则、集成范围与批次状态被保留；文件镜像检查未在本次复跑。

## 验证

- 历史计划要求：三对根/scaffold 镜像 `cmp -s`、规则与证据槽复核、定向 `git diff --check`。历史来源将政策集成批次标记为完成，但没有给出本计划可独立核验的具体命令输出。
- 本轮验证：迁移后相对路径与类型规则检查；共享文档差异空白检查。具体结果记录在本轮报告。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
