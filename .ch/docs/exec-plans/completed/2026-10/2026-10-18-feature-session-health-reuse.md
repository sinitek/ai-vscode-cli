# 会话健康状态与异常会话续接拦截 — 新功能开发

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-session-health-reuse.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-session-health-reuse.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

增加会话健康持久化及异常会话续接拦截。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-feature-session-health-reuse.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- 首轮只有报错、没有正常操作、思考或回复气泡的会话不应再次复用。为会话维护可持久化的正常/异常状态；一旦出现有效气泡即保持正常，之后报错不降级。异常会话下次执行时在原 Tab 开启全新底层会话，保留旧会话存档。

## 范围与非目标

- 覆盖会话状态持久化、历史会话回填、统一执行入口、会话迁移。

- 不更改 CLI 协议、hidden retry 策略、前端样式或用户配置；不覆盖工作区已有 Grok 压缩相关改动。

## 验收标准

- 仅用户、系统、错误/警告或空消息不能使会话正常。

- 任一有效操作、思考或助手回复气泡可使会话正常；状态跨保存、重载、迁移保留。

- 异常会话再次执行不传入旧会话 ID，不复用旧 runner；正常会话仍正常续接。

- 支持所有 CLI 和后台目标 Tab，不误清其它 Tab 或 CLI 的会话。

- 相关测试与构建通过，ontology 不新增校验问题，既有缺失引用单独记录。

## 影响面与风险

- 代码：会话存储/生命周期、会话迁移、统一 prompt 执行入口。

- 风险：诊断 trace 被当作正常操作、历史正常状态丢失、后台执行影响当前 Tab。

- 回滚：仅回退本计划涉及的状态字段与入口检查，不删除会话存档。

## 验证计划

- `npm run build`

- 最小相关 session health、session store、session lifecycle、session history repair 单元测试。

- 本机验证：使用真实文件存储验证异常会话解绑、新会话接管与重载，不调用外部模型。

## 测试与清单同步

- 覆盖交互/one-shot/并行入口及等待期间映射变化。

- 构建：`npm run build` 最终通过。

- 最小自测：`node --test dist/test/session/sessionHealth.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/extensionHost/promptSessionHealth.test.js`，32 项全部通过。

- 全量自测：构建后执行 `node scripts/run_unit_tests.js`，1617 项中 1613 通过、4 失败。失败为 `cliCommandRepair.test.js` 的 3 条旧三 CLI 断言和 `grokCliEnum.test.js` 的 1 条 Grok option 数量断言。使用 `git archive HEAD` 导出到隔离临时目录、链接现有 node_modules、独立 `tsc -p ./` 后重跑这两个测试文件，同样 4 条失败；对比失败名称完全一致，分类为历史断言过期，本次不扩修。

- ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 仍有 15 处既有 source_refs 缺少设计文档；以 HEAD 域内容替换内存索引后对比同为 15，新增问题 0。`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 为 8 通过、1 失败，失败仅为上述全库引用校验。

- 失败处理记录：首次 build 清理 dist 时出现一次 `ENOTEMPTY`，重跑恢复，分类为临时文件系统/并发产物问题；新增入口测试首次缺少必填 `contextTags`，补齐夹具后构建与回归通过。

- 本机验证：生命周期与存储用例实际读写隔离临时文件，确认异常历史保留、新会话仅接收新请求、健康字段往返不丢失。不调用真实模型或外部 CLI；未运行 VS Code/Chromium E2E，本次不修改 Webview。

- 国际化与记忆：不新增用户可见文案，无需变更 i18n；无需另写热区、runbook 或 EVENT_MEMORY，未改写 ROLLING_SUMMARY。

## 当前进展

- 已用 memory-recall（focus：会话 首轮 失败 重试 resume session；无 anchor）召回并核对 ontology 的 `plugin.cli_session`。

- CodeGraph 已定位统一入口；索引存在过期文件，已直接读取相关源码核对。

- 工作区存在本任务前的未提交改动；在当前工作区保留式修改，不创建分支或覆盖现有改动。

- 保留所有本任务前及并行工作区改动；未修改技术栈、依赖、分支或提交。

- 未决风险仅为已证明与本次无关的 4 条历史测试失败、15 条 ontology 失效引用及未执行真实 VS Code/CLI E2E。
