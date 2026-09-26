# 可维护性重构设计

- 日期：2026-09-25
- 状态：阶段 1–7 已完成。阶段 4、5、6 已在当前工作区落地并复核。阶段 7 只回写 `ARCHITECTURE.md`、本文与执行计划，不改 `src`，不删除仍被端口调用的 host 逻辑，不更新功能清单。
- 事实来源：行为差异表与 OpenCode 骨架一节中的行号仍是抽取前的历史锚点，不随工作区前移改写。当前实现核对见「阶段 4、5 落地核对」和「阶段 6、7 落地核对」。
- 相关计划：`.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md`

`src/config/geminiSkills.ts` 是 OpenCode 技能模块，文件名保留历史 gemini 前缀。它导出 `listOpenCodeSkills` / `mergeOpenCodeSkillsConfig`，不要把它当成第三套产品协议。

## 结论

只做三件事，而且边界分开：

- 技能目录发现和 JSON 对象扫描抽成无 VS Code 依赖的共享函数。根目录策略、短描述和决策归一化留在原模块。
- OpenCode one-shot 与 parallel 共用显式端口的 Template Method。端口由现有 host 工厂在调用点构造，不新增容器。
- classic Loop 的 `LoopMainDecision` 与 Loop+ 的 `LoopPlusDecision` 继续分属两套协议。扫描器可以共享，归一化不可以合并。

## 技能目录发现

HEAD 里五个符号的分布（行号是历史锚点；工作区已前移，这些私有函数不再位于下表各行）：

| 符号 | `codexSkills.ts` | `geminiSkills.ts` | `claudeSkills.ts` |
| --- | --- | --- | --- |
| `normalizeWorkspaceRoots` | 151 | 24 | 无此符号 |
| `collectAncestorDirs` | 169 | 42 | 无此符号 |
| `listSkillDirNames` | 214 | 86 | 无此符号；同等循环内联在 `listClaudeSkills` 176 |
| `extractSkillDescription` | 108 | 119 | 10 |
| `toShortDescription` | 128 | 142 | 33 |

`normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames` 在 Codex 与 OpenCode 两份实现逐字相同。

- `normalizeWorkspaceRoots`：非数组返回 `[]`；跳过非字符串和 trim 后为空的项；`path.resolve` 后用 `Set` 去重，保留首次出现顺序。
- `collectAncestorDirs`：从 `path.resolve(startPath)` 起步，先放入自身，再用 `path.dirname` 向上，直到 `parent === current`。
- `listSkillDirNames`：`readdir` 失败返回 `[]`；跳过 `.` 开头的名字；收录目录；符号链接用 `fs.promises.stat`，目标是目录才收录，损坏链接吞掉。不排序，不检查 `SKILL.md`。

Claude 没有工作区根，也没有祖先遍历。`listClaudeSkills` 只读 `os.homedir()` 下的 `.claude/skills`（`CLAUDE_SKILLS_DIR`，第 8 行），目录循环与 `listSkillDirNames` 同构，然后就地读取 `SKILL.md`。

根目录策略不能合并，调用顺序就是优先级，先出现的同名技能获胜：

- `resolveCodexSkillRoots`（183）：每个工作区根的祖先上先 `.codex/skills` 再 `.agents/skills`；然后 `resolveAgentsHomeDir()/skills`；然后 `resolveCodexHomeDir()/skills`。后者认 `CODEX_HOME_DIR` 和 `CODEX_HOME`（`src/shared/userHomePaths.ts` 的 `resolveCodexHomeDir`）。非 `win32` 才追加字面量 `"/etc/codex/skills"`（208）。
- `resolveOpenCodeSkillRoots`（56）：祖先上只有 `.opencode/skills`；家目录是 `path.join(os.homedir(), ".opencode", "skills")`，没有走 `resolveOpenCodeHomeDir`；非 `win32` 才追加 `SYSTEM_OPENCODE_SKILLS_DIR`（9，`path.join(path.sep, "etc", "opencode", "skills")`）。
- Claude：没有 `resolve*SkillRoots`，没有 `/etc` 分支。

配置写回也不是同一协议，不能放进共享发现函数：

- Codex 写 TOML 块 `CODEX_SKILLS_BLOCK_START` / `END`，并可能插入 `[features] skills = true`。
- OpenCode 用 `parseJsonObjectText` 改 `skills.enabled` / `skills.disabled`。
- Claude 用 `parseJsonObjectText` 改 `permissions.deny` 里的 `Skill(name)`。

## 空 frontmatter description

三份 `extractSkillDescription` 都用 `/^---\s*\n([\s\S]*?)\n---\s*/`，按行跳过空行和 `#` 注释，只认以 `description:` 开头的行，并用同样的双引号 / 单引号去引号。差异只在空值：

- Codex（108）遇到 `description:` 立刻 `return unquoted.trim() || undefined`。空值、`""`、`''` 都返回 `undefined`，后面的 `description:` 不再看。
- OpenCode（119）与 Claude（10）逐字相同：trim 后非空才返回；空值继续扫描，因此后面的非空 `description:` 可以生效。都空则 `undefined`。

`toShortDescription` 在空描述上的可见结果不同，不能共享：

- Codex（128）签名是 `(locale, name, description?)`。原文非空时，`zh-CN` 且含中文才截断（超过 50）或补 `，适合日常使用。`（短于 20）；非中文 locale 且不含中文才按 90 / 30 处理，短句补 ` Great for everyday use.`。文案和 locale 文种不一致时丢掉原文，改查 `SKILL_DESC[locale][name]`，仍没有才 `t("skill.descriptionMissing", undefined, locale)`。所以空 frontmatter 仍可能显示内置技能文案。
- OpenCode（142）与 Claude（33）签名是 `(description?)`。非空原文原样返回，不截断、不补句、不查内置表。空则 `t("skill.descriptionMissing")`，不传 locale。

共享提取函数必须把这两种空值策略写成显式分支，不能引入 YAML 解析器，也不能顺便调用 `toShortDescription`。推荐两个具名策略，而不是布尔开关：

- `stop-at-first-key`：只给 Codex。
- `continue-on-empty`：只给 OpenCode 和 Claude。

## Windows 与 POSIX 路径

共享路径函数必须保持现在的平台行为，不能在抽取时“修正”：

- `path.resolve` 相对路径依赖 `process.cwd()`。Windows 上 `C:foo` 这类驱动器相对路径不是 `C:\foo`。
- `Set` 去重区分大小写，也区分尚未被 `path.resolve` 归一的形式。Windows 上 `C:\Repo` 与 `c:\repo` 不会并成一个根。不要加 `realpath`，否则符号链接工作区和真实目录会改变先到先得的遮蔽顺序。
- `collectAncestorDirs` 靠 `dirname === current` 停。这对 POSIX `/` 和 Windows `C:\` 成立。UNC 路径的父目录序列随 Node 版本变化，抽取时不要改停机条件。
- `/etc/...` 的平台判断必须留在各自的 `resolve*SkillRoots`。Codex 的系统路径是 POSIX 字面量；OpenCode 用 `path.sep` 拼接。若把判断挪进共享函数并在 Windows 上仍拼接，会分别得到无效的 `/etc/codex/skills` 或 `\etc\opencode\skills`。WSL 的 `process.platform` 是 `linux`，今天就会扫描 `/etc`，保持这样。
- 家目录解析不能在共享函数里统一。Codex 认 `CODEX_HOME_DIR` / `CODEX_HOME`；OpenCode 这份模块直接 `os.homedir()`，即使别处已有 `resolveOpenCodeHomeDir` 也没有使用；Claude 同样直接 `os.homedir()`。改成统一 helper 会改变技能可见集合。
- 符号链接用 `stat`。Windows junction 若抛 `EPERM`，今天会被当成非技能目录。共享的 `listSkillDirNames` 必须继续吞掉该错误。
- frontmatter 按 `\n` 切行，不认 YAML 的多行 `>` / `|`。CRLF 目前主要靠 `trim()` 吃掉 `\r`。不要为了 Windows 换解析器。
- `localeCompare` 排序留在 `listCodexSkills`、`listOpenCodeSkills`、`listClaudeSkills`。`listSkillDirNames` 不排序。

## JSON 对象扫描

HEAD 中这两对函数逐字相同（行号同样是历史锚点；工作区里扫描已挪到 `src/shared/jsonObjectText.ts`）：

- `extractJsonObjectTexts`：`src/loopPlusDecision.ts` 341，`src/extensionHost/promptRunRuntime.ts` 366。
- `findJsonObjectEnd`：`src/loopPlusDecision.ts` 359，`src/extensionHost/promptRunRuntime.ts` 384。

算法：从每个 `{` 起做花括号深度计数；`"` 切换字符串；`\` 置位转义，且转义在字符串外也生效；字符串内的括号忽略；找不到闭合就从该 `{` 后继续；找到则推入 `slice(start, end + 1).trim()`，并从闭合括号后继续。不识别代码围栏，不识别单引号，不剥注释，不验证 JSON。

调用点不同，必须留在原处：

- `parseLoopPlusDecision`（39）先拒绝非字符串和 trim 后为空的内容，再对每个候选 `JSON.parse`，交给 `normalizeLoopPlusDecision`，返回第一份有效 Loop+ 决策。
- `parseLoopMainDecision`（343）只把 `null` / 空值挡掉，空白字符串仍会扫描；归一化的是 `LoopMainDecision`。
- `extractJsonObjectText`（362）只返回第一个原文片段，不解析。host 在文件末尾把 `extractJsonObjectText`、`extractJsonObjectTexts`、`parseLoopMainDecision` 一并导出。共享后这些导出名保持不变。

`src/shared/jsonObject.ts` 的 `parseJsonObjectText` 是另一套算法：要求整段是一个对象，`jsonc` 模式会剥注释和尾逗号。决策文本里常有说明、示例和多个对象，不能改走这个解析器。扫描结果继续由调用方 `JSON.parse`，失败就看下一个候选。

转义标志在字符串外也生效是现有行为。共享时原样搬走，不在本重构里修复，否则会改掉哪一个对象被选中。

## 为什么这两处适合共享纯函数

- 两份路径归一、祖先遍历、目录列举没有业务分支，Codex 与 OpenCode 已是同一实现；Claude 只缺一层函数名。
- JSON 扫描不读文件、不写任务记录、不知道 classic 或 Loop+。`promptRunRuntime.ts` 里的 `applyLoopMainDecision` 会改 `LoopTaskRecord`，`loopPlusDecision.ts` 的 `normalizeLoopPlusDecision` 不会。共享扫描器可以切断这层耦合，同时不把任务存储引进纯模块。
- 差异点（根列表、短描述、空 description、决策字段）都在扫描之后。纯函数把“找到文本”和“解释文本”分开，单测不需要 VS Code host。
- 目录列举只有失败即空列表的 IO，没有配置写入。它可以和纯路径函数放在同一模块，但不要和 TOML / JSON 配置合并放在一起。

建议落点：

- `src/config/skillDiscovery.ts`：`normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`、带策略参数的 `extractSkillDescription`。不放 `toShortDescription`，不放 `resolve*SkillRoots`。
- `src/shared/jsonObjectText.ts`：`extractJsonObjectTexts` 与只返回首段的 `extractJsonObjectText`。`findJsonObjectEnd` 保持模块私有。不要改 `src/shared/jsonObject.ts`。

阶段 4、5 已按这两个落点在当前工作区实现并复核，细节见「阶段 4、5 落地核对」。阶段 6 的模板已落地，细节见「阶段 6、7 落地核对」。

## OpenCode 运行骨架

抽取前，`createPromptOneShotRuntimeHost`（`src/extensionHost/promptOneShotRuntime.ts` 189）和 `createPromptParallelRuntimeHost`（`src/extensionHost/promptParallelRuntime.ts` 173）各有一份 OpenCode attempt 循环。下面的行号是当时的历史锚点，不随阶段 6 前移改写。阶段 6 已把相同顺序收进 `src/extensionHost/openCodePromptRunTemplate.ts` 的 `runOpenCodePromptTemplate`。两个工厂的对外签名不变，没有收成 `mode` 旗标。

两边相同、应该收进模板骨架的顺序：

1. 非 `opencode` 直接抛错。
2. 空 `displayPrompt` 返回。
3. `prepareOpenCodeRuntime`，`role` 在 `taskRole === "subtask"` 时为 `subtask`，否则 `main`；`requiresSubtaskModel` 为 `loopTaskId || graphRunId`。
4. 组装 thinking prompt 与 hidden retry prompt。`includeFinalAnswerInstruction` 在有 `loopTaskId` 时关闭。人类交互只在没有 `loopTaskId`、没有 `graphRunId` 且全局开关打开时启用。
5. 按 session 或 pending draft 取消息，未预置用户消息时追加用户气泡。
6. `while (true)`：fresh-session recovery 标志、hidden retry 延迟、`prepareOpenCodeSubagentRuntime`、监视器不可用时只提示一次、`runCliStream`。
7. 退出码 0 时 `parseOpenCodeRunOutput`，再处理自然语言人类交互、`resolveOpenCodeSuccessfulExitOutcome`、缺最终结论时的重试，以及 `shouldRecoverOpenCodeLoopMainSessionInFreshSession`。
8. 失败时在 `HIDDEN_RETRY_MAX_RETRIES` 内重试，否则 `buildOpenCodeFailureMessage`。成功路径调用 `maybeAutoCompactContextAfterPromptSuccess`。

必须留在端口里的差异：

- 运行身份。one-shot 用 `isCurrentOneShotRunActive`（412），条件是 `getActiveRunId() === runId`，消息目标是 host 上的单份 active target。parallel 用 `isParallelRunActive`（347），条件是 `parallelRunsByTabId` 里该 `tabId` 的 `runId` 匹配且未 `stopped`；`resolveParallelMessageTarget`（352）会按 tab 重新加载消息。这是 parallel 能多 tab 并发的原因，不能收成一个全局 active run。
- 流解析。one-shot 自己维护 `activeOpenCodeJsonlBuffer`，上限 `OPENCODE_JSONL_PENDING_LINE_MAX_BYTES`（58，64 KiB），调用 `parseOpenCodeVisibleStreamEvents`，并用 `createOpenCodeStreamActivityTracker` 加启动空闲超时 `buildOpenCodeOneShotStartupTimeoutMessage`（182、725）。parallel 把同一类事件交给 `createOpenCodeTabStreamState`（314）、`consumeOpenCodeTabStreamChunk`、`appendOpenCodeFinalTextToTabStream`，没有这份启动超时。
- 状态出口。one-shot 使用 `logCliStartup`（mode 为 `"one-shot"`）、`startTaskRun`、`sendRunStatus`、trace。parallel 使用 `sendRunStatusForTab` 和 `appendTaskRun`。无工作区时只有 one-shot 打 `runPrompt-no-workspace`（298）。
- 依赖严格程度。one-shot 的 `PromptOneShotRuntimeHostDeps` 是必填类型。parallel 把 `PromptParallelRuntimeHostDeps` 定义成 `Partial<PromptParallelRuntimeRequiredHostDeps>`（163）再断言成完整依赖。模板不能继承这个 `Partial` 断言。
- 人类交互开关。one-shot 直接调用 `getGlobalHumanInteractionEnabled()`。parallel 先判断 `typeof ... === "function"`。抽模板时不得把 one-shot 也改成可选。
- 日志事件名保持 `runPrompt-one-shot-*` 与 `runPrompt-parallel-*`。拒绝文案分别是 `one-shot-run-unsupported:` 与 `parallel-run-unsupported:`。

这是 Template Method，不是一个 `mode` 旗标函数，也不是单独的 Strategy。不变的是 attempt 顺序；变的是“这次运行是否仍有效”和“这块 stdout 写到哪里”。用 class 继承会把端口藏进 `protected` 方法，现有代码是工厂函数加显式 deps，不该为了模式名改成类层次。

端口对象由 `runPromptOneShot` / `runPromptParallel` 在各自工厂内部构造，例如 `isRunActive`、`resolveMessageTarget`、`onStdoutChunk`、`onStderrChunk`、`publishSystem`、`adoptSession`。骨架函数放在新文件 `src/extensionHost/openCodePromptRunTemplate.ts`。`createPromptOneShotRuntimeHost` 与 `createPromptParallelRuntimeHost` 的对外签名保持不变，这样 `src/extension.ts` 不进入写范围。

## 为什么不能合并两套决策协议

扫描器相同，不代表协议相同。`LoopMainDecision` 定义在 `src/loopTaskStore.ts` 91，状态只有 `completed | continue | blocked`。`LoopPlusDecision` 定义在 `src/loopPlusDecision.ts` 28，状态是 `dispatch | accept | wait | blocked | completed`，没有 `continue`。

归一化规则不能合成一个函数：

- classic `continue`（`normalizeLoopMainDecision`，462 之后）要求 1 到 `LOOP_PARALLEL_SUBTASK_MAX`（`promptRunRuntime.ts` 200，值为 6）个子任务；缺省 acceptance 被补成 `{ passed: false, checks: [] }`。Loop+ 没有 `continue`。`dispatch` 要求至少 1 个子任务，且不能带 `reviewEventId` 或 `reviewEventIds`；`accept` 确认一个 `reviewEventId`，或按顺序确认一组 `reviewEventIds`，二者不能同时出现，子任务可以是 0 个；`wait` 要求子任务为空，且不能带这两种确认字段。
- classic `completed` 要求 `acceptance.passed`、全部 checks 通过、非空且全部通过的 `requirementCoverage`、`finalSummary`、`roundSummaries`，并把 `estimatedRemainingRounds` 写成 0。`answerConclusion` 可缺。Loop+ `completed`（`normalizeCompletedDecision`）要求 `answerConclusion` 与 `finalSummary` 都非空，不读 `roundSummaries`；确认字段可以缺省，单项用非空 `reviewEventId`，多项用非空且不重复的 `reviewEventIds`；剩余轮次沿用解析值，不强制为 0。
- classic `blocked` 不检查子任务，`finalSummary` 只要是字符串就保留，包括空串。Loop+ `blocked` 要求子任务为空，且不能带 `reviewEventId` 或 `reviewEventIds`；`finalSummary` 走 `readOptionalText`，trim 后为空就丢掉。
- Loop+ 仍拒绝 `confirmedEventIds` / `acceptedEventIds`（`hasImplicitQueueConfirmation`）。`reviewEventIds` 只在 `accept` 和 `completed` 上作为显式批次，不能和 `reviewEventId` 并存。classic 没有这条。
- acceptance checks：classic 会丢弃坏项并把缺省名字写成 `"acceptance"`；Loop+ 任一坏项就让整份决策失败。
- 子任务 prompt 下限今天都是 80，但是两个常量：`LOOP_SUBTASK_PROMPT_MIN_LENGTH`（`promptRunRuntime.ts` 201）和 `LOOP_PLUS_DECISION_PROMPT_MIN_LENGTH`（`loopPlusDecision.ts` 10）。上限 6 也分属 `LOOP_PARALLEL_SUBTASK_MAX` 与 `LOOP_PLUS_DECISION_SUBTASK_MAX`。数字相同不是合并协议的理由。
- classic 归一化后面紧跟着 `applyLoopMainDecision` 写任务记录。Loop+ 归一化是纯函数，供 Loop+ 编排单独消费。合成一个 normalizer 会让 `continue` 被 Loop+ 拒绝、`dispatch` 被 classic 拒绝，或者更糟：用默认分支把一种状态误收成另一种。

可以共享的只有“从散文里切出 JSON 对象文本”。`normalizeLoopMainDecision` 与 `normalizeLoopPlusDecision` 保持两个模块。

## 为什么不能新增 DI 容器

`ARCHITECTURE.md` 已规定组合根是 `src/extension.ts`：它向 host 注入显式回调；host 不得反向依赖 `extension.ts`；`loopOrchestration.ts` 的依赖类型必须可搜索，不能用宽泛 `Record<string, any>` 当事实边界。`promptExecutionShared.ts` 只放窄类型。

容器或 service locator 会：

- 把 Template Method 必须显式列出的端口变成运行时查找，缺钩子要到真正跑 OpenCode 才暴露。parallel 现有的 `Partial` 再断言已经是这个方向的漏洞，不能再用容器放大。
- 让 classic Loop、Loop+、Graph、one-shot、parallel 共用一个组装图。这和“协议不合并、host 按文件拆开”相反。
- 不消除任何一份重复实现，只把构造挪走。单测也会从“传入 fake 端口”变成“启动容器”。

依赖继续用函数参数和端口对象表达。不引入 inversify、tsyringe 或自研容器，也不把 `extension.ts` 改成第二套组合根。

## 阶段与互不重叠的写范围

第 1 到第 7 阶段均已完成。第 4、5、6 阶段已在当前工作区落地并复核。第 7 阶段是文档收尾，不与源码改动并行，也不删除仍被端口调用的 host 逻辑。

| 阶段 | 状态 | 允许修改的路径 | 禁止同时修改 |
| --- | --- | --- | --- |
| 1 设计文档 | 完成 | `docs/MAINTAINABILITY_REFACTOR.md` | `src/**` |
| 2 执行计划 | 完成 | `.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md` | `src/**` |
| 3 行为冻结 | 完成，只写在上述两份文档 | 同上 | 测试文件与 `src/**` |
| 4 技能发现 | 已落地并复核 | `src/config/skillDiscovery.ts`、`src/config/codexSkills.ts`、`src/config/geminiSkills.ts`、`src/config/claudeSkills.ts`、`src/test/config/skillDiscovery.test.ts` | 阶段 5、6 的全部路径 |
| 5 JSON 扫描 | 已落地并复核 | `src/shared/jsonObjectText.ts`、`src/loopPlusDecision.ts`、`src/extensionHost/promptRunRuntime.ts`、`src/test/shared/jsonObjectText.test.ts` | `src/shared/jsonObject.ts`、阶段 4、6 的路径；不要为了扫描去改 `src/test/loop/loopPlusDecision.test.ts`，除非公开签名被迫变化 |
| 6 OpenCode 模板 | 已落地并复核 | `src/extensionHost/openCodePromptRunTemplate.ts`、`src/extensionHost/promptOneShotRuntime.ts`、`src/extensionHost/promptParallelRuntime.ts`、`src/test/extensionHost/openCodePromptRunTemplate.test.ts` | `src/extension.ts`、`src/extensionHost/promptRunRuntime.ts`、阶段 4、5 的路径。工厂签名不变，因此默认也不改既有 `promptOneShotRuntime.test.ts` / `promptParallelRuntime.test.ts` |
| 7 收尾 | 已完成 | `ARCHITECTURE.md`、`docs/MAINTAINABILITY_REFACTOR.md`、`.ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md`。不改 `src` | 不与源码阶段并行改文件；不删除仍被端口调用的 host 逻辑；不更新功能清单；不改任务记录、active ids 或 loopPlus 快照 |

阶段 4、5、6 的路径集合不相交，可以在各自独占写范围内串行或由不同人接手，但不能两个阶段同时改同一个文件。阶段 7 不是新的并行写范围。

## 非目标

- 不合并 `LoopMainDecision` 与 `LoopPlusDecision`，不统一两边的 80 / 6 / 100 常量。
- 不新增 DI 容器，不把 host deps 改成 `Record<string, any>`。
- 不合并 Codex、OpenCode、Claude 的技能根列表、家目录解析、`/etc` 判断、配置写回和 `toShortDescription`。
- 不改变空 frontmatter 的两种行为，不引入 YAML 库，不对工作区根做 `realpath`。
- 不改变 JSON 扫描的转义、字符串和“失败再试下一个对象”语义，不把扫描并进 `parseJsonObjectText`。
- 不把 one-shot 与 parallel 收成一个 `mode` 旗标，不删除 one-shot 启动超时，也不给 parallel 补上这份超时。
- 不修改任务记录、active ids、loopPlus 快照、`src/extension.ts` 组合根。
- 阶段 4、5、6 已经落地，阶段 7 只回写文档，但不放宽以上任何一条。不合并两套 Loop 决策，不新增 DI 容器，不把 one-shot 与 parallel 收成 `mode` 旗标，不删除 one-shot 启动超时，也不给 parallel 补上这份超时。不更新功能清单。阶段 7 不改 `src`，不删除仍被端口调用的 host 逻辑。

## 阶段 4、5 落地核对

上文的 HEAD 行号只保留为历史锚点。工作区已经前移：那些私有副本已离开原文件的对应行。本节按当前工作区源码复核，本次没有改 `src`。

阶段 4 已落地并复核：

- `src/config/skillDiscovery.ts` 提供 `normalizeWorkspaceRoots`、`collectAncestorDirs`、`listSkillDirNames`，以及 `extractSkillDescription(content, strategy)`。策略为 `stop-at-first-key` 与 `continue-on-empty`。
- Codex（`src/config/codexSkills.ts`）使用 `stop-at-first-key`。OpenCode（`src/config/geminiSkills.ts`）与 Claude（`src/config/claudeSkills.ts`）使用 `continue-on-empty`。
- `toShortDescription` 仍留在三个原文件。`resolveCodexSkillRoots`、`resolveOpenCodeSkillRoots` 与 `CLAUDE_SKILLS_DIR` 仍留在原文件。Claude 只对家目录 `.claude/skills` 调用 `listSkillDirNames`，仍然没有工作区根和 `/etc` 路径。
- `src/test/config/skillDiscovery.test.ts` 已覆盖非数组根、空白根、`path.resolve` 去重顺序、祖先停在文件系统根、点文件与损坏符号链接，以及两种空 `description:`。短描述和技能根选择没有进共享模块。

阶段 5 已落地并复核：

- `src/shared/jsonObjectText.ts` 提供 `extractJsonObjectText` 与 `extractJsonObjectTexts`。`findJsonObjectEnd` 仍是模块私有。扫描循环与 HEAD 私有副本相同：字符串内括号忽略，转义在字符串外也生效，不闭合则从该 `{` 之后继续，不剥注释。
- `src/loopPlusDecision.ts` 从 `./shared/jsonObjectText` 引入 `extractJsonObjectTexts`。`src/extensionHost/promptRunRuntime.ts` 从 `../shared/jsonObjectText` 引入这两个导出，并继续由 host 导出。
- `normalizeLoopPlusDecision` 与 `normalizeLoopMainDecision` 没有合并，仍分别留在 `loopPlusDecision.ts` 与 `promptRunRuntime.ts`。没有把扫描并进 `src/shared/jsonObject.ts` 的 `parseJsonObjectText`。
- `src/test/shared/jsonObjectText.test.ts` 已覆盖多个对象、字符串内括号、转义引号，以及不闭合则跳过。

阶段 6 已落地并复核：

- `src/extensionHost/openCodePromptRunTemplate.ts` 提供 `runOpenCodePromptTemplate` 与显式端口类型 `OpenCodePromptRunPorts`。它固定 OpenCode attempt 顺序：非 `opencode` 拒绝、空 prompt 返回、准备 runtime、组装 thinking / hidden retry prompt、装载消息、`while (true)` 里的 fresh-session recovery、hidden retry、子代理监视器、`runCliStream`，以及成功退出后的结论与失败重试。当前 705 行。
- `createPromptOneShotRuntimeHost` 与 `createPromptParallelRuntimeHost` 的对外签名不变。两个工厂在内部把端口传给模板，没有收成 `mode` 旗标，也没有 DI 容器。
- 运行身份留在各自 host。one-shot 仍用 `getActiveRunId() === runId`。parallel 仍用 `parallelRunsByTabId` 上该 `tabId` 的 `runId` 匹配且未 `stopped`。
- 启动超时留在 one-shot host：`createStartupWatchdog` 继续调用 `buildOpenCodeOneShotStartupTimeoutMessage`。parallel 的 `createStartupWatchdog` 仍是空实现，没有补上这份超时。
- tab 流留在 parallel host：`createOpenCodeTabStreamState` 仍由 parallel 端口调用。one-shot 仍维护自己的 JSONL buffer。
- `src/test/extensionHost/openCodePromptRunTemplate.test.ts` 已在工作区。阶段 7 不改该测试，也不重跑构建。

阶段 7 已完成：

- `ARCHITECTURE.md` 已按 `wc -l` 回写：`promptOneShotRuntime.ts` 1193 行，`promptParallelRuntime.ts` 1078 行，并写明模板文件 705 行。同节里 `src/extension.ts` 为 5659 行，`promptInteractiveRuntime.ts` 为 1426 行，`loopOrchestration.ts` 为 3092 行；`openCodeSubagentRuntime.ts` 仍是 201 行，`promptExecutionShared.ts` 仍是 59 行。
- 没有删除仍被端口调用的 host 逻辑，没有改 `src`，没有更新功能清单，没有改任务记录、active ids 或 loopPlus 快照。
- 不合并 `normalizeLoopMainDecision` 与 `normalizeLoopPlusDecision`，不新增 DI 容器，不把 one-shot / parallel 收成 `mode` 旗标。

这不再是“未提交草稿、不能算阶段完成”。当前工作区里的上述实现就是阶段 4、5、6 的交付。阶段 7 只承认这些交付并回写文档，不授权再改 `src/extension.ts`、`loopOrchestration.ts` 或 `graphRunPanel.ts`。行为差异的行号继续以历史锚点保留，避免工作区再前移时把锚点改丢。

## 验证命令

文档回写：

```bash
test -f ARCHITECTURE.md
test -f docs/MAINTAINABILITY_REFACTOR.md
test -f .ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md
wc -l src/extensionHost/promptOneShotRuntime.ts src/extensionHost/promptParallelRuntime.ts src/extensionHost/openCodePromptRunTemplate.ts src/extension.ts src/extensionHost/promptInteractiveRuntime.ts src/extensionHost/loopOrchestration.ts src/extensionHost/openCodeSubagentRuntime.ts src/extensionHost/promptExecutionShared.ts
git diff --name-only -- ARCHITECTURE.md docs/MAINTAINABILITY_REFACTOR.md .ch/docs/exec-plans/active/2026-09-25-maintainability-refactor.md
git diff --name-only -- src
```

阶段 7 回写 `ARCHITECTURE.md` 与上述两份维护性文档，不改 `src`。`git diff --name-only -- src` 里若仍能看到阶段 4、5、6 落地时留下的路径，那不属于本次文档回写，不得回滚，也不得再拆 `src/extension.ts`、`loopOrchestration.ts` 或 `graphRunPanel.ts`。

阶段 4、5、6 的测试命令记录在下方，供实现复核使用；本次文档收尾不重跑构建：

```bash
npm run build && node --test dist/test/config/skillDiscovery.test.js
npm run build && node --test dist/test/shared/jsonObjectText.test.js dist/test/loop/loopPlusDecision.test.js
npm run build && node --test dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js
```

阶段 4 的测试至少覆盖：非数组根、空白根、`path.resolve` 去重顺序、祖先停在根、点文件与损坏符号链接、Codex 空 `description:` 不再向后读、OpenCode/Claude 空值继续向后读、`toShortDescription` 仍只在 Codex 命中 `SKILL_DESC`。阶段 5 的测试至少覆盖：字符串内括号、字符串外反斜杠、多个对象、不闭合则跳过、不剥注释。阶段 6 用既有 one-shot / parallel 测试守住重试、fresh-session recovery 和 tab 并发，模板单测只锁步骤顺序与端口被调用，不复制整份 host。
