# Grok 恢复会话模型切换修复

- 日期：2026-10-20
- 状态：completed
- 负责人：Codex
- owner：grok-resumed-session-model-switch
- claimed_at：2026-10-20
- claim_ttl：本轮修复与验证
- handoff_to：无

## 背景

切换 Grok 模型后，扩展会以新模型启动 runner，但续聊时继续 `session/load` 原 ACP 会话。进程级 `--model` 不能保证覆盖已恢复会话的模型选择；当前运行时没有在恢复后发送会话级模型切换请求。

## 目标

恢复已有 Grok ACP 会话后，在发送用户提示词前应用本轮解析出的模型；若模型切换请求失败，不继续向可能仍使用旧模型的会话发送提示词。

## 范围

- Grok ACP 模型切换参数构造与恢复握手。
- Grok runner 协议回归测试。
- Grok 运行契约、功能清单与会话 ontology 同步。

## 非目标

- 不更改 Grok 模型选择界面、会话历史或 CLI 配置格式。
- 不把旧会话改为新会话，也不重放或复制历史对话。
- 不修改工作区内与本问题无关的现有未提交改动。

## 验收标准

- [x] `session/load` 成功后、首个 `session/prompt` 前，以 `{ sessionId, modelId }` 发送 `session/set_model`。
- [x] `session/new` 不额外发送会话级模型切换请求，仍使用启动时的 `--model`。
- [x] 模型切换 RPC 失败时 runner 启动失败，不发送提示词。
- [x] 覆盖参数构造、成功恢复、失败阻断与现有 Grok runner 回归。
- [x] 同步运行事实、功能清单和会话 ontology。

## 影响面

- 代码目录：`src/interactive/`、`src/test/interactive/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：无

## 风险与缓解

- 风险：不支持 `session/set_model` 的 Grok CLI 无法在恢复会话中切换模型。
- 缓解：RPC 失败时不继续发送用户提示词，避免静默使用旧模型；在运行契约中记录此行为。
- 工作区：存在与本任务无关的未提交内容；继续在当前工作区，仅修改本计划列出的目标文件，不创建分支或覆盖现有改动。

## 验证计划

- 最小相关验证：Grok ACP 参数与 runner 单元测试。
- 单元自测命令：`npm run build`；`node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/extensionHost/grokCliHostWire.test.js`
- 扩展验证：运行 ontology 校验；若最小测试通过且构建无关失败，再评估完整 `npm test`。

## 测试与清单同步

- 单元测试新增/更新：`src/test/interactive/grokAppServerProtocol.test.ts`、`src/test/interactive/grokRunner.test.ts`
- 单元自测结果：`npm run build` 通过；Grok 协议与 runner 专项测试 60 项通过；ontology validation 通过，ontology Python 单测 9 项通过；`git diff --check` 通过。未执行真实 Grok 会话切换：端到端验证会创建或改变带用户凭据的会话，避免产生未经确认的外部/用户数据写入。
- 失败处理记录：额外运行 `grokCliHostWire.test.ts` 时，未修改的 `Grok session updates enter the existing assistant, thinking, and tool channels` 失败：实际正文保留 fixture 中的三个空格，断言期望去掉空格。该测试覆盖空白分片过滤，与本次 session/set_model 握手无关；未修改回放逻辑或该测试。
- 功能清单：更新 Grok 会话恢复的模型切换行为。
- 相关文档同步：`.ch/docs/references/cli-runtime-reference.md` 与 `plugin.cli_session` ontology。

## 任务列表

- [x] 核对会话恢复与 runner 重建链路
- [x] 增加会话级模型设置及失败保护
- [x] 补回归测试并同步事实文档
- [x] 执行构建、专项测试和 ontology 校验

## 决策记录

- 2026-10-20：恢复会话后显式调用 Grok ACP `session/set_model`；如果 RPC 失败则终止本轮启动，避免表面切换成功但实际仍以旧模型运行。
- 2026-10-20：保留当前工作区，因其包含其它未提交工作且本次目标 Grok 源文件未修改；不创建新分支。

## 当前结论

已修复恢复会话不应用新模型的问题：恢复后显式发送 `session/set_model`，请求失败则不继续发提示词。构建、60 项 Grok 专项测试和 ontology 检查通过。没有运行真实 Grok CLI；不支持 `session/set_model` 的版本会明确失败并阻止本轮，而不是静默使用旧模型。另有一项未修改的 host-wire 空白分片断言失败，需单独处理。
