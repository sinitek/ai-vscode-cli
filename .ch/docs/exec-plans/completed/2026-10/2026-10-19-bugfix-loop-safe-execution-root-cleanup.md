# Loop 子任务执行根安全清理 — 已发布行为修复

- 日期：2026-10-19
- 状态：completed
- 负责人：Codex
- owner：loop-safe-cleanup
- claimed_at：2026-10-19
- claim_ttl：本次修复执行期间
- handoff_to：无
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-19-loop-safe-execution-root-cleanup.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-19-docs-loop-safe-execution-root-cleanup.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复 Loop 临时执行根递归清理可能删除真实源工作区的问题。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-19-bugfix-loop-safe-execution-root-cleanup.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- Windows Loop 子任务通过目录 junction 和文件链接呈现真实工作区，结束时若对临时执行根递归删除，底层运行时可能把链接目标当作目录内容处理，造成真实项目文件丢失。

## 目标

- 让 Loop 子任务结束清理只撤销本次创建且仍可识别的链接项，禁止递归删除临时执行根或未知内容。

## 范围

- `src/loopSubtaskExecutionRoot.ts` 的链接登记与安全清理。

- Loop 执行根单元测试。

- Loop 运行时事实来源。

## 非目标

- 不修改通用 `removePathBestEffort` 的其他调用方。

- 不改变 Loop 子任务的规则目录隔离、链接写入语义或其他 CLI 调度流程。

- 不恢复同事日志中的业务文件，不执行真实用户工作区删除或恢复。

## 验收标准

- [x] 清理不调用对 Loop 执行根的递归删除。

- [x] 只移除本次登记且身份仍匹配的符号链接或硬链接。

- [x] 未知文件、真实目录和身份校验失败时保留现场。

- [x] 清理后真实源工作区文件、目录和内容保持不变。

- [x] 相关单元测试和 `npm run build` 通过。

## 影响面

- 代码目录：`src/loopSubtaskExecutionRoot.ts`、`src/test/loop/loopSubtaskExecutionRoot.test.ts`。

- 配置与脚本：无。

## 风险与缓解

- 风险：清理失败后临时目录残留。

- 缓解：只允许非递归移除已确认的链接项，残留优先于误删；记录失败项并允许后续安全重试。

- 风险：Windows hardlink 无法通过链接类型识别。

- 缓解：以 bigint 登记根和链接的设备号、inode、创建时间，清理时再次核对，硬链接还要匹配当前源文件；inode 不可识别时不清理。

## 验证计划

- 最小相关验证：`npm run build` 后运行 `dist/test/loop/loopSubtaskExecutionRoot.test.js`。

- 单元自测命令：`npm run build`；`node --test dist/test/loop/loopSubtaskExecutionRoot.test.js`。

- 扩展验证：在 Windows VS Code/Electron 宿主中验证目录 junction、NTFS hardlink、跨盘回退和占用场景；当前环境不冒充 Windows 验收。

## 测试与清单同步

- 单元自测结果：最终 `npm run build` 通过；最小执行根回归 18/18，通过扩大后的 9 个测试文件共 118/118，无失败或跳过。命令：`node --test dist/test/loop/loopSubtaskExecutionRoot.test.js dist/test/shared/fsCleanup.test.js dist/test/cli/opencodeCommandRunner.test.js dist/test/cli/opencoderuntimeconfig.test.js dist/test/cli/commandResolution.test.js dist/test/loop/loopPromptBuilders.test.js dist/test/loop/loopPromptQueue.test.js dist/test/loop/loopMainFailure.test.js dist/test/loop/loopSubtaskThinking.test.js`。

- 文档与结构校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过（45 条规则）；ontology Python 测试 9/9 通过；改动范围 `npm run validate:whitespace -- <改动路径>` 与 `git diff --check` 通过。

- 失败处理记录：首次构建中的 TS7006 属于新增测试 mock 参数缺失类型，已补齐；不是运行时实现缺陷。

- 明确清理只撤销登记链接。

- 稳定规则落在事实来源，无需重复写入滚动摘要或事件记忆。

## 任务列表

- [x] 实现非递归安全清理

- [x] 运行测试和构建验证

## 决策记录

- 2026-10-19：不通过调整 `fs.rmSync` 参数规避平台差异，改为显式记录并撤销创建的链接；未知内容和清理失败均保留。

- 2026-10-19：按用户要求直接修改当前 `master`，不创建分支或 worktree。通用递归清理 helper 和调度流程保持不变，不扫描或迁移旧版残留执行根。

- 2026-10-19：Windows junction 使用非递归 `rmdirSync`，不沿用上一轮草稿中统一 `unlinkSync` 的做法；Mac/Linux 符号链接和 Windows 文件链接用 `unlinkSync`。

## 当前结论

当前 `master` 上修复已完成，保留未提交状态。执行根不再走通用递归删除；创建失败和正常结束均按登记身份非递归拆链，异常只记录并保留。构建、118 项相关测试、ontology 校验和 9 项脚本测试全部通过。验证环境为 macOS / Node v22.23.2；Windows 分支使用真实本地硬链接和符号链接配合平台模拟，不能代替真实 Windows VS Code/Electron 的 junction、占用和跨卷验收，该项保留为发布前现场验收要求。未对真实用户项目或旧版残留临时根执行删除、恢复或自动迁移。
