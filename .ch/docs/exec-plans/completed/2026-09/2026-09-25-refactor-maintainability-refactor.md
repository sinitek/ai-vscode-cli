# 可维护性重构 — 行为保持重构

- 日期：2026-09-25
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- 当前阶段：本类型阶段 4、5、6 的行为保持实现已在历史工作区落地并复核。原计划第 1–7 阶段完成是共同历史背景；阶段 1–3 设计与阶段 7 文档回写独归关联 docs，三组独立测试开发不归本记录（原test计划已删除）。
- 设计：`docs/MAINTAINABILITY_REFACTOR.md`。其中历史行号保留为锚点，并已注明工作区前移。本文件收尾时曾留在 `active/`，之后已归档到 `.ch/docs/exec-plans/completed/2026-09/`。
- 类型：refactor
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-25-maintainability-refactor.md`

## 本类型目标

阶段4共享技能发现、阶段5共享JSON对象扫描、阶段6显式端口OpenCode Template Method，保留空description差异、两套决策协议及host工厂签名。

## 范围与所有权

- 阶段4共享技能发现、阶段5共享JSON对象扫描、阶段6显式端口OpenCode Template Method，保留空description差异、两套决策协议及host工厂签名。
- 本记录只承担 行为保持重构；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 阶段4共享技能发现、阶段5共享JSON对象扫描、阶段6显式端口OpenCode Template Method，保留空description差异、两套决策协议及host工厂签名。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按阶段 4–6 的实现路径和调用点核对共享函数、算法与 host 兼容边界；历史完成依据是源码对照复核，文档收尾未执行 build 或单测。测试开发与既有命令记录由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管，迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-25-docs-maintainability-refactor.md](2026-09-25-docs-maintainability-refactor.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

技能发现、JSON 决策扫描和 OpenCode one-shot / parallel 运行循环各有一份重复实现，继续各改各的会让空描述、路径优先级和重试顺序漂移。classic Loop 与 Loop+ 的决策字段看起来相似，但状态机不同，不适合借这次去重合并。

### 范围

- 阶段 4：抽取技能发现共享函数，保留 Codex 与 OpenCode/Claude 的空描述差异、各自技能根选择和短描述行为。
- 阶段 5：原样抽取 JSON 对象扫描并替换两处私有副本，不合并 classic Loop 与 Loop+ 的决策归一化。
- 阶段 6：通过显式端口 Template Method 固定 OpenCode attempt 顺序，保留 one-shot / parallel 工厂签名及各自 host 的运行身份、启动超时和 tab 流。
- 设计理由、空 frontmatter 与 Windows / POSIX 风险说明、验证命令的文档编写由关联 docs 承担；本计划仅遵守其中的实现兼容约束。

### 非目标

- 不新增 DI 容器，不修改 `src/extension.ts` 组合根，不继续拆 `loopOrchestration.ts`。
- 不统一技能根列表、家目录、`/etc` 判断、`toShortDescription` 和配置写回。
- 不改变 JSON 扫描算法，不把扫描并进 `parseJsonObjectText`。
- 不把 one-shot 与 parallel 收成 `mode` 旗标。不删除 one-shot 启动超时，也不给 parallel 补上这份超时。
- 不改任务记录、active ids、loopPlus 快照。
- 不更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。本轮没有用户可见行为变化。`ARCHITECTURE.md` 的 host 行数和模板边界回写属于关联 docs，不属于本类型交付。

### 验收标准

- [x] 第 4 阶段：`src/config/skillDiscovery.ts` 提供 `normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`，以及 `stop-at-first-key` / `continue-on-empty` 两种 `extractSkillDescription`。Codex 使用前者，Claude 与 OpenCode 使用后者。`toShortDescription` 和技能根选择仍留在原文件；对应独立测试开发不归本记录，原test计划已删除，不计入本类型验收。
- [x] 第 5 阶段：`src/shared/jsonObjectText.ts` 已提供 `extractJsonObjectText` 与 `extractJsonObjectTexts`，并被 `loopPlusDecision.ts` 与 `promptRunRuntime.ts` 调用。两套决策归一化没有合并。
- [x] 第 6 阶段：`src/extensionHost/openCodePromptRunTemplate.ts` 已用显式端口 Template Method 固定 OpenCode attempt 顺序。`createPromptOneShotRuntimeHost` 与 `createPromptParallelRuntimeHost` 的对外签名不变，没有收成 `mode` 旗标。运行身份、one-shot 启动超时和 parallel tab 流仍留在各自 host。

### 影响面

- 代码目录：阶段 4、5、6 的实现写范围已在历史工作区落地，具体路径见下方任务列表。
- 关联交付依赖：阶段 1–3 的设计约束及阶段 7 对 `docs/MAINTAINABILITY_REFACTOR.md`、原执行计划和 `ARCHITECTURE.md` 的回写由关联 docs 保管；第 7 阶段不改代码的事实不作为本类型完成项。

### 风险与缓解

- 风险：抽取 `extractSkillDescription` 时把 Codex 的“遇到空 description 立即停止”做成 OpenCode/Claude 的“继续扫描”，内置技能会从 `SKILL_DESC` 文案变成后一条 description 或缺失文案。
- 缓解：两个具名策略 `stop-at-first-key` 与 `continue-on-empty`；分开锁住策略的独立测试开发不归本记录（原test计划已删除）。`toShortDescription` 不进共享模块。
- 风险：共享路径函数时合并家目录或去掉 `win32` 判断，Windows 会去读错误的 `\etc\...`，或 Codex 不再认 `CODEX_HOME`。
- 缓解：`resolveCodexSkillRoots`、`resolveOpenCodeSkillRoots`、`CLAUDE_SKILLS_DIR` 留在原文件。共享函数不做 `realpath`。
- 风险：把 JSON 扫描改成 `parseJsonObjectText` 的 jsonc 模式，或“修复”字符串外的反斜杠转义，选中的决策对象会变。
- 缓解：新模块原样搬走循环；注释剥离仍只属于 `src/shared/jsonObject.ts`。
- 风险：Template Method 用全局 active run 或 `mode` 旗标，parallel 多 tab 被 one-shot 的单运行身份覆盖。
- 缓解：`isRunActive` 与流处理是必填端口。parallel 继续使用 `parallelRunsByTabId`。不继承 `Partial` deps 断言。

### 任务列表

- [x] 阶段 4：技能发现共享函数已在历史工作区落地并复核。不改 runtime；独立测试开发原由现已删除的test计划记录，不计入本完成项。
- [x] 阶段 5：JSON 扫描共享函数已替换两处私有副本并复核。两套决策归一化没有合并，未改 `jsonObject.ts` 的 jsonc 解析。
- [x] 阶段 6：OpenCode Template Method 已落地。工厂签名不变，不把 one-shot / parallel 收成 `mode` 旗标。运行身份、启动超时和 tab 流仍留在各自 host。
阶段4实现写范围：src/config/skillDiscovery.ts、codexSkills.ts、geminiSkills.ts、claudeSkills.ts；对应独立测试开发不归本记录（原test计划已删除）。
阶段5实现写范围：src/shared/jsonObjectText.ts、src/loopPlusDecision.ts、src/extensionHost/promptRunRuntime.ts；对应独立测试开发不归本记录（原test计划已删除）。
阶段6实现写范围：src/extensionHost/openCodePromptRunTemplate.ts、promptOneShotRuntime.ts、promptParallelRuntime.ts；对应独立测试开发不归本记录（原test计划已删除）。
这三组路径不相交。`src/extension.ts` 不属于任何一组。

### 决策记录

- 2026-09-25：技能目录列举和 JSON 扫描共享；根策略、短描述、决策归一化不共享。
- 2026-09-25：空 `description:` 保持 Codex 立即停止、OpenCode/Claude 继续扫描。不引入 YAML 解析器。
- 2026-09-25：OpenCode 重复的是 attempt 顺序，用显式端口 Template Method，不用类继承、DI 容器或 `mode` 旗标。
- 2026-09-25：不合并 classic `continue|completed|blocked` 与 Loop+ `dispatch|accept|wait|blocked|completed`。
- 2026-09-25：阶段 4、5 已在当前工作区落地并复核。HEAD 行号保留为历史锚点，工作区实现已前移到 `src/config/skillDiscovery.ts` 与 `src/shared/jsonObjectText.ts`。不合并 classic Loop 与 Loop+ 的决策归一化，不新增 DI 容器，不把 one-shot / parallel 收成 `mode` 旗标。
- 2026-09-25：阶段 6 已在工作区落地。`openCodePromptRunTemplate.ts` 用显式端口固定 OpenCode attempt 顺序。one-shot 与 parallel 工厂签名不变。运行身份、启动超时和 tab 流留在各自 host。

## 分类依据与真实状态

refactor：只分配阶段4/5/6行为保持实现，不再承接阶段7文档收尾；test：三组新增测试实际存在；docs：阶段1–3设计和7文档回写独立交付。完成依据是源码对照复核，收尾未执行build/单测，不将阶段完成改写成验证通过。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
