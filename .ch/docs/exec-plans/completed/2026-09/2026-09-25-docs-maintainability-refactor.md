# 可维护性重构 — 文档

- 日期：2026-09-25
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- 当前阶段：本类型阶段 1–3 设计与阶段 7 文档回写已完成，不改 `src`。原计划第 1–7 阶段完成是共同历史背景；阶段 4–6 的实现及三组测试开发分别独归关联 refactor / test。
- 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件收尾时曾留在 `active/`，之后已归档到 `.ch/docs/exec-plans/completed/2026-09/`。
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-25-maintainability-refactor.md`

## 本类型目标

阶段1–3编写维护性设计、冻结行为差异与写范围；阶段7回写ARCHITECTURE及两份维护文档，保留HEAD行号历史锚点和host行数。

## 范围与所有权

- 阶段1–3编写维护性设计、冻结行为差异与写范围；阶段7回写ARCHITECTURE及两份维护文档，保留HEAD行号历史锚点和host行数。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 阶段1–3编写维护性设计、冻结行为差异与写范围；阶段7回写ARCHITECTURE及两份维护文档，保留HEAD行号历史锚点和host行数。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-09-25-refactor-maintainability-refactor.md](2026-09-25-refactor-maintainability-refactor.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 历史记录

- 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件收尾时曾留在 `active/`，之后已归档到 `.ch/docs/exec-plans/completed/2026-09/`。

### 目标

把可共享的纯函数和 OpenCode attempt 骨架的边界写清楚，并给出互不重叠的后续写范围。设计轮交付两份文档，不改变运行行为。阶段 7 把三份文档收成已完成，仍不改变运行行为。作为回写依赖，阶段 4、5、6 已在历史工作区落地的事实来自关联 refactor / test，不是本类型的实施目标或验收项。

### 范围

- 核对 HEAD 中 `src/config/codexSkills.ts`、`src/config/geminiSkills.ts`、`src/config/claudeSkills.ts` 的 `normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`、`extractSkillDescription`、`toShortDescription`，记录其异同，不修改这些实现。
- 核对 HEAD 中 `src/loopPlusDecision.ts` 与 `src/extensionHost/promptRunRuntime.ts` 的 `extractJsonObjectTexts` / `findJsonObjectEnd`。
- 核对 `src/extensionHost/promptOneShotRuntime.ts` 与 `src/extensionHost/promptParallelRuntime.ts` 的 OpenCode 运行骨架差异，作为设计依据，不承接代码抽取。
- 写明共享纯函数、显式端口 Template Method、协议不合并、不新增 DI 容器的原因。
- 写明空 frontmatter、Windows / POSIX 路径风险、非目标和验证命令。
- 阶段 7 回写 `ARCHITECTURE.md` 与两份维护性文档的完成状态、host 行数和模板边界，保留历史行号锚点。

### 非目标

- 阶段 7 文档收尾不修改 `src`，不删除仍被端口调用的 host 逻辑。

### 验收标准

- [x] 阶段 1：`docs/MAINTAINABILITY_REFACTOR.md` 存在，并用中文写明上述符号的异同与四个设计理由。
- [x] 阶段 2、3：原执行计划存在，包含范围、非目标、验收、风险、验证和阶段，并冻结空描述、路径、JSON 扫描、协议和 DI 约束；其历史正文按类型分配到本组三份关联计划。
- [x] 后续第 4、5、6 阶段的写范围互不重叠，第 7 阶段不与它们并行。
- [x] 本轮没有为了设计去改 `src`。
- [x] 阶段 4、5 的文档回写没有为了同步状态去改 `src`。
- [x] 第 7 阶段：`ARCHITECTURE.md` 已按历史收尾时的 `wc -l` 回写 `promptOneShotRuntime.ts`（1193 行）、`promptParallelRuntime.ts`（1078 行）和 `openCodePromptRunTemplate.ts`（705 行）。本次不改 `src`，不删除仍被端口调用的 host 逻辑，不更新功能清单。

### 影响面

- 配置与脚本：无。

### 风险与缓解

- 风险：阶段 7 收尾时顺手合并两套 Loop 决策、新增 DI 容器，或把 one-shot / parallel 收成 `mode` 旗标。
- 缓解：非目标不放宽。历史行号继续只作锚点。阶段 7 只改三份文档，不回滚阶段 4、5、6 的工作区实现，不继续拆 `src/extension.ts`、`loopOrchestration.ts`。
- 回滚：本次只改 `ARCHITECTURE.md` 与两份维护性文档。阶段 4、5、6 的代码各自回滚自己的写范围，不在本次文档回写里动 `src`。

### 验证计划

- 最小相关验证：三份文档存在，且阶段 6、7 都标成已完成；阶段 4、5 的描述与当前 `skillDiscovery.ts`、`jsonObjectText.ts` 及调用点一致；历史行号仍作为锚点保留；`ARCHITECTURE.md` 中的行数与 `wc -l` 当前结果一致；本次 diff 不新增 `src` 改动。
- 单元自测命令：阶段 4、5、6 的测试文件已在工作区。本次文档收尾不重跑构建。
- 关联交付的历史事实：阶段 6 已落地，重试、fresh-session recovery 与 tab 流仍由各自 host 端口承担。模板与既有 one-shot、parallel 历史测试命令见删除审计，本次不执行，不作为文档验收通过证据。
历史文档回写命令（含迁移前路径，仅保留记录，本轮不执行）：
```bash
test -f ARCHITECTURE.md
test -f docs/MAINTAINABILITY_REFACTOR.md
test -f .ch/docs/exec-plans/completed/2026-09/2026-09-25-maintainability-refactor.md
wc -l src/extensionHost/promptOneShotRuntime.ts src/extensionHost/promptParallelRuntime.ts src/extensionHost/openCodePromptRunTemplate.ts src/extension.ts src/extensionHost/promptInteractiveRuntime.ts src/extensionHost/loopOrchestration.ts src/extensionHost/openCodeSubagentRuntime.ts src/extensionHost/promptExecutionShared.ts
git diff --name-only -- ARCHITECTURE.md docs/MAINTAINABILITY_REFACTOR.md .ch/docs/exec-plans/completed/2026-09/2026-09-25-maintainability-refactor.md
git diff --name-only -- src
```

### 测试与清单同步

- 功能清单：不需要同步。没有权限、命令或用户可见流程变化。
- 相关文档同步：两份维护性文档与 `ARCHITECTURE.md` 已把阶段 6、7 标成完成。host 行数与当前 `wc -l` 一致。

### 任务列表

- [x] 阶段 1：写 `docs/MAINTAINABILITY_REFACTOR.md`，锚住 HEAD 行号与行为差异。
- [x] 阶段 2：写本执行计划。
- [x] 阶段 3：把空描述、路径、JSON 扫描、协议和 DI 约束冻结进两份文档，不新增测试文件。
- [x] 阶段 7：`ARCHITECTURE.md` 行数已回写。不删除仍被端口调用的 host 逻辑，不与源码改动并行。

### 决策记录

- 2026-09-25：设计轮停止在第 3 阶段。当时工作区里的 src 改动尚未按本文验收。
- 2026-09-25：阶段 7 完成文档收尾。`ARCHITECTURE.md` 的 `promptOneShotRuntime.ts` 为 1193 行，`promptParallelRuntime.ts` 为 1078 行，`openCodePromptRunTemplate.ts` 为 705 行。不删除仍被端口调用的 host 逻辑，不更新功能清单，不改任务记录、active ids 或 loopPlus 快照。

### 当前结论

阶段1–3的设计、行为差异及约束说明和阶段7的ARCHITECTURE/两份维护文档回写已完成；阶段4–6代码及测试分别见关联refactor/test。收尾对照源码复核但未执行build或单测，不改变该未验证边界。

## 分类依据与真实状态

refactor：只分配阶段4/5/6行为保持实现，不再承接阶段7文档收尾；test：三组新增测试实际存在；docs：阶段1–3设计和7文档回写独立交付。完成依据是源码对照复核，收尾未执行build/单测，不将阶段完成改写成验证通过。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
