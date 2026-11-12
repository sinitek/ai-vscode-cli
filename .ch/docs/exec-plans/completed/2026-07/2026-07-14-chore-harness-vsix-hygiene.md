# Harness scaffold VSIX 打包卫生

- 日期：2026-07-14
- 状态：completed
- 负责人：协作
- owner：Loop 主任务 `msg_1783998484827_4b2d85596667a`
- claimed_at：2026-07-14T03:18:27Z
- claim_ttl：本 Loop 任务完成前；每轮主任务复核时续期
- handoff_to：已归档，无后续 active handoff

## 背景与目标

Chromium smoke Skill 经 Harness scaffold 随插件分发，因而需要单独治理发布候选的卫生，避免仓库内部 `.codegraph`、Python 缓存污染包，并验证预期 `.mjs`、`.yaml`、`.md` 资源仍被包含。此项属于维护/发布治理，不是 Playwright 测试开发，也不是测试政策文档。

## 范围与非目标

- 按来源记录的批准决定，在 `.vscodeignore` 排除 `.codegraph/**`、`**/__pycache__/**`、`**/*.pyc`，并清理根和 media 镜像中已跟踪的 `*.pyc`；不得误排正常 Skill 资源。
- `vsce ls --no-dependencies` 候选清单负向/正向扫描、fresh build、实际 VSIX 导出及 ZIP 逐项检查属于发布证据门禁。
- 不改变 runner、scenario、单元测试政策或安装机制；相关交付见 [历史验证证据](../../migrations/test-plan-removals/2026-11-11-jul-sep.json) 与 [政策文档计划](2026-07-14-docs-harness-testing-policy.md)。
- 本次仅拆分计划，不执行发布脚本、构建、VSIX 导出或收费 CLI。

## 验收标准与历史结果

- [x] 来源决策记录批准上述 ignore 规则和已跟踪缓存清理，并要求保留正常 `.mjs/.yaml/.md` 资源。
- [x] 来源子任务表记载 `harden-vsix-scaffold-hygiene` 负责 `.vscodeignore` 和缓存清理，并以 `git ls-files`、`vsce ls --no-dependencies` 扫描为其验证职责；本计划保留该责任边界。
- [ ] 本来源没有证明实际 VSIX 导出与 ZIP 内容校验已成功；来源原文明确指出真实 VSIX 仍须下轮串行验证。归档批次复选框不改写此未验证结论。
- 历史结果：候选包泄漏被记录为发布卫生缺陷，ignore/清理被批准；可复核的逐条命令输出未在来源计划中提供，故不声称候选清单或 VSIX 门禁已通过。

## 风险、依赖与当前结论

- 误排 Skill 资源会造成 scaffold 功能缺失；包候选清单与实际 VSIX 证据应分别核实，不能以前者替代后者。
- 依赖 [历史验证证据](../../migrations/test-plan-removals/2026-11-11-jul-sep.json) 提供确定的发布资源闭包，并与 [政策文档计划](2026-07-14-docs-harness-testing-policy.md) 的 Harness 镜像边界保持一致。
- 状态沿用来源 `completed` 的归档语义，表示记录已关闭；实际 VSIX 导出/解包验证仍明确未证实，后续集成不得将其升级为通过。

## 验证

- 来源拟定验证：`git ls-files`、`vsce ls --no-dependencies` 正向/负向扫描、fresh build、VSIX 导出与 ZIP 逐项比对；真实 VSIX 验证注明后置串行。
- 本轮验证：只检查拆分路径、类型、映射和差异空白，不运行发布或历史业务命令。具体结果记录在本轮报告。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
