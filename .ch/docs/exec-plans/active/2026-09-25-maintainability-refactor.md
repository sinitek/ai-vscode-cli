# 可维护性重构

- 日期：2026-09-25
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- 当前阶段：第 1–7 阶段完成。阶段 4、5、6 已在当前工作区落地并复核。阶段 7 只回写 `ARCHITECTURE.md` 与两份维护性文档，不改 `src`。
- 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件仍留在 `active/`，不在本次收尾中搬迁。

## 背景

技能发现、JSON 决策扫描和 OpenCode one-shot / parallel 运行循环各有一份重复实现，继续各改各的会让空描述、路径优先级和重试顺序漂移。classic Loop 与 Loop+ 的决策字段看起来相似，但状态机不同，不适合借这次去重合并。

## 目标

把可共享的纯函数和 OpenCode attempt 骨架的边界写清楚，并给出互不重叠的后续写范围。设计轮交付两份文档，不改变运行行为。阶段 4、5、6 已在工作区落地；阶段 7 把三份文档收成已完成，仍不改变运行行为。

## 范围

- 核对 HEAD 中 `src/config/codexSkills.ts`、`src/config/geminiSkills.ts`、`src/config/claudeSkills.ts` 的 `normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`、`extractSkillDescription`、`toShortDescription`。
- 核对 HEAD 中 `src/loopPlusDecision.ts` 与 `src/extensionHost/promptRunRuntime.ts` 的 `extractJsonObjectTexts` / `findJsonObjectEnd`。
- 核对 `src/extensionHost/promptOneShotRuntime.ts` 与 `src/extensionHost/promptParallelRuntime.ts` 的 OpenCode 运行骨架差异。
- 写明共享纯函数、显式端口 Template Method、协议不合并、不新增 DI 容器的原因。
- 写明空 frontmatter、Windows / POSIX 路径风险、非目标和验证命令。

## 非目标

- 阶段 7 文档收尾不修改 `src`，不删除仍被端口调用的 host 逻辑。
- 不合并 `LoopMainDecision` 与 `LoopPlusDecision`。
- 不新增 DI 容器，不修改 `src/extension.ts` 组合根，不继续拆 `loopOrchestration.ts` 或 `graphRunPanel.ts`。
- 不统一技能根列表、家目录、`/etc` 判断、`toShortDescription` 和配置写回。
- 不改变 JSON 扫描算法，不把扫描并进 `parseJsonObjectText`。
- 不把 one-shot 与 parallel 收成 `mode` 旗标。不删除 one-shot 启动超时，也不给 parallel 补上这份超时。
- 不改任务记录、active ids、loopPlus 快照。
- 不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。本轮没有用户可见行为变化。`ARCHITECTURE.md` 只按当前 `wc -l` 回写 host 行数和模板边界。

## 验收标准

- [x] `docs/MAINTAINABILITY_REFACTOR.md` 存在，并用中文写明上述符号的异同与四个设计理由。
- [x] `.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md` 存在，包含范围、非目标、验收、风险、验证和阶段。
- [x] 后续第 4、5、6 阶段的写范围互不重叠，第 7 阶段不与它们并行。
- [x] 本轮没有为了设计去改 `src`。
- [x] 阶段 4、5 的文档回写没有为了同步状态去改 `src`。
- [x] 第 4 阶段：技能发现共享函数与 `src/test/config/skillDiscovery.test.ts` 已在当前工作区落地并复核。`skillDiscovery.ts` 提供 `normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`，以及 `stop-at-first-key` / `continue-on-empty` 两种 `extractSkillDescription`。Codex 使用前者，Claude 与 OpenCode 使用后者。`toShortDescription` 和技能根选择仍留在原文件。
- [x] 第 5 阶段：`src/shared/jsonObjectText.ts` 已提供 `extractJsonObjectText` 与 `extractJsonObjectTexts`，并被 `loopPlusDecision.ts` 与 `promptRunRuntime.ts` 调用。两套决策归一化没有合并。
- [x] 第 6 阶段：`src/extensionHost/openCodePromptRunTemplate.ts` 已用显式端口 Template Method 固定 OpenCode attempt 顺序。`createPromptOneShotRuntimeHost` 与 `createPromptParallelRuntimeHost` 的对外签名不变，没有收成 `mode` 旗标。运行身份、one-shot 启动超时和 parallel tab 流仍留在各自 host。
- [x] 第 7 阶段：`ARCHITECTURE.md` 已按当前 `wc -l` 回写 `promptOneShotRuntime.ts`（1193 行）、`promptParallelRuntime.ts`（1078 行）和 `openCodePromptRunTemplate.ts`（705 行）。本次不改 `src`，不删除仍被端口调用的 host 逻辑，不更新功能清单。

## 影响面

- 代码目录：阶段 4、5、6 的写范围已在工作区落地。阶段 7 不改代码，也不删除仍被端口调用的 host 逻辑。
- 文档目录：`docs/MAINTAINABILITY_REFACTOR.md`、本计划、`ARCHITECTURE.md`。
- 配置与脚本：无。

## 风险与缓解

- 风险：抽取 `extractSkillDescription` 时把 Codex 的“遇到空 description 立即停止”做成 OpenCode/Claude 的“继续扫描”，内置技能会从 `SKILL_DESC` 文案变成后一条 description 或缺失文案。
- 缓解：两个具名策略 `stop-at-first-key` 与 `continue-on-empty`，测试分开锁住。`toShortDescription` 不进共享模块。
- 风险：共享路径函数时合并家目录或去掉 `win32` 判断，Windows 会去读错误的 `\etc\...`，或 Codex 不再认 `CODEX_HOME`。
- 缓解：`resolveCodexSkillRoots`、`resolveOpenCodeSkillRoots`、`CLAUDE_SKILLS_DIR` 留在原文件。共享函数不做 `realpath`。
- 风险：把 JSON 扫描改成 `parseJsonObjectText` 的 jsonc 模式，或“修复”字符串外的反斜杠转义，选中的决策对象会变。
- 缓解：新模块原样搬走循环；注释剥离仍只属于 `src/shared/jsonObject.ts`。
- 风险：Template Method 用全局 active run 或 `mode` 旗标，parallel 多 tab 被 one-shot 的单运行身份覆盖。
- 缓解：`isRunActive` 与流处理是必填端口。parallel 继续使用 `parallelRunsByTabId`。不继承 `Partial` deps 断言。
- 风险：阶段 7 收尾时顺手合并两套 Loop 决策、新增 DI 容器，或把 one-shot / parallel 收成 `mode` 旗标。
- 缓解：非目标不放宽。历史行号继续只作锚点。阶段 7 只改三份文档，不回滚阶段 4、5、6 的工作区实现，不继续拆 `src/extension.ts`、`loopOrchestration.ts` 或 `graphRunPanel.ts`。
- 回滚：本次只改 `ARCHITECTURE.md` 与两份维护性文档。阶段 4、5、6 的代码各自回滚自己的写范围，不在本次文档回写里动 `src`。

## 验证计划

- 最小相关验证：三份文档存在，且阶段 6、7 都标成已完成；阶段 4、5 的描述与当前 `skillDiscovery.ts`、`jsonObjectText.ts` 及调用点一致；历史行号仍作为锚点保留；`ARCHITECTURE.md` 中的行数与 `wc -l` 当前结果一致；本次 diff 不新增 `src` 改动。
- 单元自测命令：阶段 4、5、6 的测试文件已在工作区。本次文档收尾不重跑构建。
- 扩展验证：阶段 6 已落地。模板与既有 one-shot、parallel 测试命令留在下方，本次不执行；重试、fresh-session recovery 与 tab 流仍由各自 host 端口承担。

文档回写命令：

```bash
test -f ARCHITECTURE.md
test -f docs/MAINTAINABILITY_REFACTOR.md
test -f .ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md
wc -l src/extensionHost/promptOneShotRuntime.ts src/extensionHost/promptParallelRuntime.ts src/extensionHost/openCodePromptRunTemplate.ts src/extension.ts src/extensionHost/promptInteractiveRuntime.ts src/extensionHost/loopOrchestration.ts src/extensionHost/openCodeSubagentRuntime.ts src/extensionHost/promptExecutionShared.ts
git diff --name-only -- ARCHITECTURE.md docs/MAINTAINABILITY_REFACTOR.md .ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md
git diff --name-only -- src
```

阶段 4、5、6 既有测试命令；本次阶段 7 不执行：

```bash
npm run build && node --test dist/test/config/skillDiscovery.test.js
npm run build && node --test dist/test/shared/jsonObjectText.test.js dist/test/loop/loopPlusDecision.test.js
npm run build && node --test dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js
```

## 测试与清单同步

- 单元测试新增/更新：阶段 4 的 `src/test/config/skillDiscovery.test.ts`、阶段 5 的 `src/test/shared/jsonObjectText.test.ts` 与阶段 6 的 `src/test/extensionHost/openCodePromptRunTemplate.test.ts` 已在工作区。默认仍不改 `src/test/loop/loopPlusDecision.test.ts`。阶段 7 不改测试。
- 单元自测结果：本次文档收尾未跑单元测试，也未执行 `npm run build`。阶段 4、5、6 的完成结论来自对照当前源码复核，不是来自本次重新构建。
- 失败处理记录：无失败需要分类。
- 功能清单：不需要同步。没有权限、命令或用户可见流程变化。
- 相关文档同步：两份维护性文档与 `ARCHITECTURE.md` 已把阶段 6、7 标成完成。host 行数与当前 `wc -l` 一致。

## 任务列表

- [x] 阶段 1：写 `docs/MAINTAINABILITY_REFACTOR.md`，锚住 HEAD 行号与行为差异。
- [x] 阶段 2：写本执行计划。
- [x] 阶段 3：把空描述、路径、JSON 扫描、协议和 DI 约束冻结进两份文档，不新增测试文件。
- [x] 阶段 4：技能发现共享函数与测试已在当前工作区落地并复核。不改 runtime。
- [x] 阶段 5：JSON 扫描共享函数已替换两处私有副本并复核。两套决策归一化没有合并，未改 `jsonObject.ts` 的 jsonc 解析。
- [x] 阶段 6：OpenCode Template Method 已落地。工厂签名不变，不把 one-shot / parallel 收成 `mode` 旗标。运行身份、启动超时和 tab 流仍留在各自 host。
- [x] 阶段 7：`ARCHITECTURE.md` 行数已回写。不删除仍被端口调用的 host 逻辑，不与源码改动并行。

阶段 4 写范围：`src/config/skillDiscovery.ts`、`src/config/codexSkills.ts`、`src/config/geminiSkills.ts`、`src/config/claudeSkills.ts`、`src/test/config/skillDiscovery.test.ts`。

阶段 5 写范围：`src/shared/jsonObjectText.ts`、`src/loopPlusDecision.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/test/shared/jsonObjectText.test.ts`。

阶段 6 写范围：`src/extensionHost/openCodePromptRunTemplate.ts`、`src/extensionHost/promptOneShotRuntime.ts`、`src/extensionHost/promptParallelRuntime.ts`、`src/test/extensionHost/openCodePromptRunTemplate.test.ts`。

这三组路径不相交。`src/extension.ts` 不属于任何一组。

## 决策记录

- 2026-09-25：技能目录列举和 JSON 扫描共享；根策略、短描述、决策归一化不共享。
- 2026-09-25：空 `description:` 保持 Codex 立即停止、OpenCode/Claude 继续扫描。不引入 YAML 解析器。
- 2026-09-25：OpenCode 重复的是 attempt 顺序，用显式端口 Template Method，不用类继承、DI 容器或 `mode` 旗标。
- 2026-09-25：不合并 classic `continue|completed|blocked` 与 Loop+ `dispatch|accept|wait|blocked|completed`。
- 2026-09-25：设计轮停止在第 3 阶段。当时工作区里的 src 改动尚未按本文验收。
- 2026-09-25：阶段 4、5 已在当前工作区落地并复核。HEAD 行号保留为历史锚点，工作区实现已前移到 `src/config/skillDiscovery.ts` 与 `src/shared/jsonObjectText.ts`。不合并 classic Loop 与 Loop+ 的决策归一化，不新增 DI 容器，不把 one-shot / parallel 收成 `mode` 旗标。
- 2026-09-25：阶段 6 已在工作区落地。`openCodePromptRunTemplate.ts` 用显式端口固定 OpenCode attempt 顺序。one-shot 与 parallel 工厂签名不变。运行身份、启动超时和 tab 流留在各自 host。
- 2026-09-25：阶段 7 完成文档收尾。`ARCHITECTURE.md` 的 `promptOneShotRuntime.ts` 为 1193 行，`promptParallelRuntime.ts` 为 1078 行，`openCodePromptRunTemplate.ts` 为 705 行。不删除仍被端口调用的 host 逻辑，不更新功能清单，不改任务记录、active ids 或 loopPlus 快照。

## 当前结论

阶段 1–7 已完成。阶段 4 的共享技能发现、阶段 5 的 JSON 对象扫描和阶段 6 的 OpenCode 显式端口 Template Method 已在工作区落地，并已对照调用点复核。阶段 7 已回写 `ARCHITECTURE.md` 与两份维护性文档。不合并两套 Loop 决策，不新增 DI 容器，不把 one-shot / parallel 收成 `mode` 旗标。没有未决问题阻塞这份收尾。
