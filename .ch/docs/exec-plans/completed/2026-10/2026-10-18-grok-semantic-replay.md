# Grok 语义回放与工具气泡收敛

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-18
- claim_ttl：本次任务
- handoff_to：无

## 背景与目标

用户确认前轮日志分析方案：Grok 只记录有语义的执行过程，聊天按工具调用展示摘要，消除空进度、重复快照和工具内部 JSON。回放与聊天分别投影，不改变工具真实执行或用户历史记录。

## 范围与非目标

- 在 Grok 协议适配、回放、runner 和交互宿主中按会话与调用 ID 聚合，规范化已知工具输出。
- 复用现有 traceSegment 同 ID 更新、任务列表和主题；分离运行活动时间与回放条目。
- 补充输出、并发、取消、失败、重试与页面回归，同步功能清单、runbook 和 ontology。
- 不变更依赖、ACP 执行权限、其他 CLI 或历史会话，不引入运行时模型分类。
- 当前工作区已有用户/其他任务未提交改动，包含 Grok 用量和气泡折叠；在当前树保留式修改。不创建分支或 worktree，避免遗漏本轮所需的未提交基线。

## 验收标准

- 普通成功工具调用仅一个聊天摘要；回放通常开始和结束各一条，输出只保留规范化版本。
- 空进度、描述性结果、重复状态与已知目录/用量/后台列表快照不刷气泡或回放。
- 字节数组仅在已知工具字段且可无损解码时转为文本，等价表示去重，差异、错误和截断信息不丢失。
- 回答/思考文本保序；不同工具、会话和重试不误合并；停止/失败排空未完成工具。
- 原生计划更新已有任务列表；过滤事件仍更新活动时间，不误报长时间无输出。
- 构建、最小相关单测、隔离真实 CLI 与 Chromium 页面验证完成。

## 影响面与风险

- 代码：src/interactive/grokToolCallStream.ts、grokReplayStream.ts、grokRunner.ts、promptInteractiveRuntime.ts 和 Webview 活动时间。
- 文档：功能清单、Grok runbook、CLI runtime reference、ontology。
- 风险：累计快照误作 delta、工具 ID 缺失、取消后残留状态；使用明确身份和保守兜底，回归验证。
- 风险：用户日志泄漏；只读分析本机数据，提交测试使用合成夹具，不复制日志或密钥。
- 回滚：逐项撤回本计划的 Grok 语义投影与 runActivity 接入，无数据迁移；不能整文件还原而覆盖工作区其他任务的改动。

## 验证计划

- npm run build。
- node --test dist/test/interactive/grok*.test.js，以及相关宿主/Webview 测试。
- 隔离 Grok + 本地模拟 API 检查真实工具生命周期；生产 Webview HTML + 隔离宿主桥 + Chromium 结构化场景。
- git diff --check，ontology 校验并区分既有失效引用。

## 任务列表

Tasklist:
- [completed] 核对当前实现并建立执行计划
- [completed] 实现工具调用聚合与分层过滤
- [completed] 补充回归测试并验证真实页面
- [completed] 同步功能文档与本体规则

## 调查与决策

- memory-recall focus 为 grok replay trace tool_call 回放 气泡 聚合，anchor 为空；已读取相关 runbook 与前轮用量计划。
- CodeGraph 存在中断和大量待同步文件，结构查询仅辅助定位；当前实现以直接读取磁盘为准，不改写用户索引。
- 已核实 Webview applyTraceSegment 支持按 ID 替换，复用现有路径，不新增工具卡片系统。
- 前轮 decision-model 仅用于抽象事件分流辅助复核；实际过滤使用可验证的确定性规则。
- 用当前 prompt 的 GrokToolCallStream 聚合完整工具快照，回放与聊天分别投影；同 ID 摘要替换保留创建时间与序号，todo 转现有任务列表。
- 已知输出按无损解码与可验证等价关系去重，不删除未知数组、多模态或差异内容。失败摘要保留首尾，完整输出仍按既有回放容量保留。
- 停止只在同步排空窗口允许末尾取消摘要，之后拒绝旧回调；RPC 结果绑定创建请求时的 replay，防止旧结果进入复用 runner 的新回合。
- 复用既有 trace、任务列表、工具标题本地化和主题，不引入新的自然语言用户文案；协议 status/exit_code 字段沿用原格式，无需新增 i18n 键。

## 测试与清单同步

- 单元测试新增/更新：新增 grokToolCallStream.test.ts；更新 grokReplayStream.test.ts、grokRunner.test.ts 和 clipagescriptruntimecoverage.test.ts。覆盖累计快照、并发/会话隔离、UTF-8 与未知数组、等价别名/行号、多模态、计划、失败/取消/迟到结果、稳定气泡 ID 与持久化、正文空白及活动时间不增加记录。
- 构建：npm run build 通过。验证中共享 dist 曾被并发任务清理，使用 `./node_modules/.bin/tsc -p ./ --outDir "$build_root/dist"` 隔离复验通过；临时产物复用仓库 node_modules/media/package.json，不修改生产构建配置。收尾确认无并发构建后，再次在仓库执行 npm run build 通过，更新本地可加载产物。
- 扩展回归：隔离产物运行 `node --test`，包含 Grok 全部测试、promptInteractiveRuntime、Codex 协议与 runner、trace/Webview、Loop 集成和 sessionMessage 测试，288 项通过，0 失败、0 跳过。命令与 TAP 输出分别保留在终端记录及 `/tmp/sinitek-grok-semantic-final.tap`。
- 真实 CLI：官方 Grok 1.0.62，隔离 HOME/GROK_HOME/工作目录，本地模拟 chat_completions API。成功和 exit 3 两条命令共 11 条原生工具事件，投影为 4 条工具回放、4 次摘要更新、2 个工具气泡；工具记录字节 10284 → 5020。错误、最终回答和 end_turn 均保留；无真实密钥、付费模型或用户配置变更。
- Chromium：生产 getWebviewHtml + 隔离宿主桥，使用已安装 Chrome 的 headless Chromium 引擎和结构化 smoke runner。9 个场景通过：成功回放桌面/430px、失败回放、取消回放、仅活动通知、后台 Tab、成功气泡桌面/430px、展开失败气泡。浏览器异常、请求失败与 HTTP 错误均为 0；已查看桌面/窄屏回放及气泡、错误详情截图。产物位于 `/tmp/sinitek-grok-semantic-browser/`，只保留截图/结果，场景文件清理。
- 失败分流：初期共享 dist 丢失为并发环境问题，改用隔离编译；新增空数组断言的 TypeScript 收窄导致编译失败为测试写法问题，改用长度断言；错误详情位于默认折叠区导致 containsText 失败为场景前置条件问题，先展开后验证。不改变范围外折叠策略。
- 设计与结构：本轮 3 个 Webview 文件运行 Impeccable detector，结果为空；git diff --check 通过。
- 功能文档：已同步 FEATURE_INVENTORY.md、sinitek-cli-plugin-capabilities.md、cli-runtime-reference.md、ARCHITECTURE.md 与 grok-model-config.md。
- Ontology：新增 plugin.rule.grok_semantic_replay，当前来源路径和 anchor 均有效。全量 validate 仍报原有 15 个缺失设计文档引用，验证输出与任务前基线完全一致，无新增错误；不修复无关失效引用。
- 记忆判断：稳定规则已沉淀到 Grok runbook 与 ontology；不将自动任务流水写入 ROLLING_SUMMARY.md 或 EVENT_MEMORY.md，无需更新热区记忆。
- 验证边界：真实 CLI 验证 runner/ACP，Chromium 验证生产 Webview 与模拟宿主桥；未运行完整 Extension Development Host 端到端、付费真实模型或 Windows 原生环境。不新增平台命令/路径处理，沿用现有跨平台执行链路。

## 当前结论

实现、相关回归、真实 CLI、页面和文档核对完成。重新加载扩展后对新 Grok 执行生效，不改写用户历史回放，不发布、不提交代码，工作区其他改动保留。
