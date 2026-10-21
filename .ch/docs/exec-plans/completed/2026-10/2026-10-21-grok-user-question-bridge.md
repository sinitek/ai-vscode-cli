# Grok 结构化提问桥接与错误详情修复

- 日期：2026-10-21
- 状态：completed
- 负责人：Codex
- owner：已释放
- claimed_at：2026-10-21
- claim_ttl：本次会话
- handoff_to：无

## 背景

Grok 的 `ask_user_question` 向 ACP 客户端发送 `_x.ai/ask_user_question`，插件未实现该请求，返回方法不存在。工具摘要又只保留 `tool_execution_failed`，掩盖了具体错误。

## 目标与范围

- 将 Grok 原生提问桥接到已有人工交互表单，支持按问题顺序返回单选、多选和补充回答。
- 复用 Vibe 人工交互开关、超时和拒绝/停止生命周期，禁止给 Loop/Graph 子流程额外打开表单。
- 错误摘要保留错误码和具体消息，补充适配器、runner、宿主回归测试。
- 同步功能清单、运行时参考、踩坑和 ontology。

## 非目标

不更换 CLI、模型、依赖或 UI 组件；不修改用户配置、已有会话或版本号。保留工作区原有 `package.json` 改动；本次是定点修复，无需创建分支或隔离工作树。

## 验收标准

- 合法 Grok 提问不再返回方法不存在，回答符合原生 `{ outcome: "accepted", answers: { [question]: string[] } }` / `{ outcome: "cancelled" }` 契约。
- 单选、多选、自定义回答、超时、关闭交互、拒绝、停止和非法/跨会话请求均有明确行为和回归覆盖。
- 错误气泡显示原始具体原因；原有错误、终端和 Codex 交互行为不回归。
- `npm run build`、最小相关单测、ontology 校验通过；完成最小本机真实 Grok 协议验证。

## 影响面与风险

- 代码：`src/interactive/`、`src/extensionHost/`、对应测试。
- 文档：功能清单、运行时参考、PITFALLS、ontology。
- 主要风险：原生协议字段差异、停止后迟到回答污染下个回合；通过官方协议事实、会话校验、回合绑定和回归测试缓解。

## 验证计划

- `npm run build`
- `node --test dist/test/interactive/grokUserQuestion.test.js dist/test/interactive/grokAcpClient.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokToolCallStream.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/core/humanInteraction.test.js`
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`
- 本机 Grok ACP 真实提问与回答验证，不将用户配置或会话写回仓库。

## 任务列表

Tasklist:
- [completed] 核对交互协议与现有弹窗
- [completed] 实现提问桥接与错误保真
- [completed] 补充回归测试与事实文档
- [completed] 构建并验证真实协议链路

## 决策记录

- 2026-10-21：复用现有人工交互表单与超时，不新增第二套弹窗；核对官方 `crates/codegen/xai-grok-test-support/src/acp_ask_user_question.rs`，Grok 按问题原文关联字符串数组答案，不套用 Codex 的按 ID 答案协议。

## 测试与清单同步

- 初始基线：Grok ACP client / 工具流现有 19 项测试通过，最小复现确认缺少方法与详情被遮蔽。
- `npm run build`：通过，沿用项目现有 TypeScript target 和依赖。
- 最小相关集合：132 项中 131 项通过，1 项历史失败；新增的适配器、ACP、runner、宿主及错误摘要回归均通过。
- 扩大到全部 `grok*.test.js`、宿主桥接/策略、共享人工交互、Codex prompt runtime：`node --test --test-skip-pattern='^Grok session updates enter the existing assistant, thinking, and tool channels$' dist/test/interactive/grok*.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/core/humanInteraction.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js`，176 项通过、0 失败；明确排除下述历史断言。
- 历史失败分类：`Grok session updates enter the existing assistant, thinking, and tool channels` 期望 `Hello world`，实际为保留尾部空格的 `Hello world   `。通过内存加载 `git show HEAD` 的原始 Grok/Codex turn strategy 和 prompt runtime，同一测试仍失败；未修改该无关断言或既有空白保留行为。证据位于本机 `/tmp/sinitek-grok-head-baseline.log`。
- 实施中发现的测试环境兼容问题：测试首次使用 `Object.hasOwn` 超出现有 TS target，已改为既有兼容写法，未升级基础设施；错误摘要合并时的空字符串回退回归已修复，长日志首尾测试恢复通过。
- 本机真实 Grok：在临时私有 `GROK_HOME` 和临时工作区中启动真实 `grok agent stdio`，用户原配置只复制、不修改；收到 `_x.ai/ask_user_question`，通过新增适配器返回 Linux 答案，CLI 回传 `AskUserQuestion.UserAnswered`，明确包含 Linux，并将工具标记为 `completed`。验证后清理进程和临时目录，未将配置或会话写入仓库。
- 真实验证边界：首轮等待完整模型回合在 120 秒后超时；后续将验收收窄为原生提问/回答/工具完成链路并成功，不据此声称后续模型完整答复或 VS Code 内人工点击已经验证。没有修改 Webview 代码，沿用已有表单渲染与主题，本轮未启动浏览器。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，52 条规则；ontology 单测 9 项通过。
- `git diff --check` 和本次改动文件的 trailing whitespace 校验：通过。
- 功能总表、能力规格、Grok 运行时参考、PITFALLS 与 ontology 均已同步。未改变架构层次，无需改 ARCHITECTURE；可复用根因已沉淀至 PITFALLS，不重复写热区或 EVENT_MEMORY。

## 当前结论

提问桥接、错误详情和回归验证已完成。保留用户原有 `package.json` 改动；没有提交、创建分支或安装扩展。修复在源码与本地构建产物中，已安装发行版需重新打包安装后生效。
