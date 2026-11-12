# Grok 流式错误与多模型主从编辑器 — 已发布行为修复

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-grok-stream-error-and-model-editor.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-18-feature-grok-model-editor.md); [文档](2026-10-18-docs-grok-stream-error-and-model-editor.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复 Grok 流协议错误细节、确定性错误重试和保存应用后的模型同步。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 编辑器与流协议 bugfix 独立；保存后候选即时同步依赖 bugfix 的保存/应用通知修正。docs 仍依赖两者及后续可选 name 裁定；原测试依赖仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-bugfix-grok-stream-errors.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标与范围

- 排查 Grok 使用 GPT 模型时正文出现后仍报错的真实链路，修正实际模型配置并保留真实错误，不把部分回复伪装成成功。

- 仅替换 `model` 与 `name`，没有当前模型时回退默认/首项，再回退空模板。

- 保留未知字段、主题语义色、现有模型刷新与档案隔离。不升级依赖，不改其他 CLI 的交互。

## 事实与决策

- 2026-10-18 00:12（北京时间）本机 GPT 会话的 `updates.jsonl` 记录 `serialization error: unknown variant response.metadata`，`events.jsonl` 为 `turn_ended/outcome=error`；插件消息存档已出现正文，随后显示笼统的 `Internal error` 并自动重试。

- 当前正式 `gpt-6.1-sol` 配置仍为 `api_backend=responses`。本次只在确认 Chat Completions 真实调用成功后修正该模型协议，并同步包含该模型的有效档案，保留原配置备份，不更改密钥或其他模型。

- 修复运行器丢弃错误细节的问题；确定性的流协议不兼容不应按中断反复重试。其余错误保持既有重试策略。

## 验收标准

- 重现/断言“正文后 RPC error”仍报告失败，展示明确的协议兼容原因而非 `Internal error`，且不触发无效重试。

- 使用真实 `gpt-6.1-sol` 完成两轮短回复并收到成功 stopReason，正式配置与档案修正一致；不记录凭据。

## 验证计划与影响面

- `src/interactive/grokRunner.ts`、Grok 协议/相关单测与 `src/extensionHost/promptInteractiveRuntime.ts` 的重试分流。

- `media/config/assets/config-app-ui.js` 及已有样式文件、配置页单测。

- 更新功能清单、能力说明、CLI runtime reference、Grok runbook 与 ontology；既有四项单测失败、十五项 ontology 缺失引用按基线分类，不扩大修复。

## 风险与回滚

- 复制模型会复制用户明确要求的凭据参数，仅留在原有配置存储边界，不进入仓库/日志。

- 临时真实验证使用独立 `GROK_HOME` 并清理；正式配置修正前保存仓库外备份，失败可恢复。

- 保留上一任务所有未提交改动及并行 `package.json` 版本变更，不提交、不建分支。

## 进展与验证结果

- 根因复现：以当前正式配置的隔离副本调用真实 Grok，ACP 错误为 `-32603`、`message=Internal error`，`error.data` 明确为不支持 `response.metadata`。真实会话的失败通知也有同样错误，正文分片并不意味着完整成功。

- 运行修复：增加 `buildGrokRequestError` 与失败通知读取；仅对不支持的 Responses 事件生成 `GROK_RESPONSES_STREAM_INCOMPATIBLE`，提示模型名、事件与协议修复方式。宿主停止确定性协议错误的自动重试，runner 失败后不可复用。其他错误沿用原策略，不展示任意 RPC 私有数据、不吞错或伪造成功。

- 本机修复：先以 `chat_completions` 的临时副本验证两轮 `end_turn`，再仅将正式 `gpt-6.1-sol` 的 `api_backend` 改为 `chat_completions`，并同步对应档案 `configContent/content`。配置与档案原文备份在本机 `~/.grok/protocol-backup-2026-10-18/`，目录权限 0700、备份文件 0600。语义比较确认其他模型与所有其他字段不变，凭据未更改、未写入仓库。

- 修正后的实际配置隔离副本再次连续两轮返回 `GROK_FOLLOWUP_ONE_OK`、`GROK_FOLLOWUP_TWO_OK`，两次均为 `end_turn`。临时 `GROK_HOME` 在 CLI 退出后已清理，不触碰用户真实会话。

- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check`：通过。

- 相关测试命令：`node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokReplayStream.test.js dist/test/core/panelDiagnostics.test.js dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js`，84/84 通过。

- `node scripts/run_unit_tests.js`：1573 项，1569 通过、4 项历史失败；仍为上一任务经 HEAD 独立源码复现的 `cliCommandRepair.test.ts` 三项旧 CLI 数量断言和 `grokCliEnum.test.ts` 一项全页 option 数量断言，无新增失败。

- Chromium 使用真实配置页 HTML/资源与无密钥 IPC 夹具：新增、列表选中与参数修改、复制协议/连接/测试凭据/隐藏嵌套字段、设默认、删除确认、重复名称拒绝及保存 TOML 均通过。1440px 与 390px 几何断言和截图复核通过；结构化 smoke 无浏览器、HTTP 或请求错误。Impeccable detector 一次执行结果为 `[]`。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：仍为原有 15 个缺失设计文档引用，无新增问题；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 为 8/9 通过，唯一失败即当前 ontology 完整性断言，根因同上，未扩大修复。

## 证据与收尾

- 本机日志证据：`/tmp/sinitek-grok-followup-responses.log`、`/tmp/sinitek-grok-followup-chat.log`、`/tmp/sinitek-grok-followup-fixed.log`、`/tmp/sinitek-grok-followup-build.log`、`/tmp/sinitek-grok-followup-focused.log`、`/tmp/sinitek-grok-followup-page.log`、`/tmp/sinitek-grok-followup-all-tests.log`、`/tmp/sinitek-grok-followup-ontology.log`、`/tmp/sinitek-grok-followup-ontology-tests.log`。

- 浏览器证据：`/tmp/sinitek-grok-followup-smoke/result.json`、`interaction-result.json` 与桌面/窄屏截图；均仅含本任务夹具，不含用户凭据，不纳入仓库。

- 未提交或创建分支；保留前次任务与并行版本变更。收尾停止预览服务、清理任务脚本与场景，保留无密钥日志和截图以及用户配置备份。

## 追加验收：移除刷新图标并在保存后同步（2026-10-18）

- CodeGraph 定位配置中心 `onConfigChanged` 与面板推送链路，当前文件 stale 后直接核对源码。根因是 `save` 仅保存档案并触发未等待的通知，激活配置随后 `apply` 写盘却未触发通知，模型候选可能仍来自旧文件。

- `ConfigManagerPanel` 的变更回调支持 `void | Promise<void>`，保存、应用及其他既有变更通知均等待完成；成功应用到磁盘后才通知，扩展回调返回 `postPanelState()` 的 Promise。继续保留未激活档案不自动应用、应用失败不伪造更新的语义，不修改用户实际配置。
