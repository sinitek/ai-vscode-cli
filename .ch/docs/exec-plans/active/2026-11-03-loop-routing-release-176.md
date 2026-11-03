# Loop 全 CLI 参数核查、真实验证与 1.7.6 发布

- 日期：2026-11-03
- 状态：blocked
- 负责人：Codex

## 背景与目标

承接同 CLI 子模型修复；用户要求 Loop / Loop+ 全 CLI 模型、思考力度正确路由，并用 gpt-6.1-sol 主模型与 gpt-6.1-terra 子模型真实执行 Loop+，成功后发布 1.7.6，提交并推送。

## 范围与非目标

覆盖七种 CLI 的共用路由与最终参数适配、相关回归、隔离工作区真实模型调用、发布脚本与 git 推送。不调整用户配置或真实业务任务，不修复无关历史测试。

## 验收标准

- Loop / Loop+ 同 CLI、跨 CLI、新会话及续接保留各角色模型和思考力度；不支持的能力按 CLI 契约处理。
- 真实 Loop+ 主模型派发、子模型执行、主模型收口，启动参数及 session 元数据证明两个模型及不同思考档位正确。
- 相关单测、build 和发布脚本校验通过；全量历史失败单独分类。
- 通过 scripts/publish_vscode_extension.py 发布 1.7.6；只提交任务相关文件并正常推送，不强推。

## 风险与缓解

- 真实调用有费用与写盘风险：使用临时目录、简单单子任务、限定时间与调用次数。
- 发布不可覆盖：先验证版本与鉴权；验证成功后才执行发布。
- 私有数据：仅记录去敏模型、思考档位、调用结果，不提交凭据、用户 prompt 或运行配置。

## 验证计划

- npm run build；相关 node --test；node scripts/run_unit_tests.js。
- 七种 CLI 路由及 runner 参数相关测试；真实 Codex Loop+ 使用生产 adapter 与 runner。
- Python 发布脚本测试、ontology validate、git diff --check。

## 当前结论

代码修复与自动验证完成；发布被真实 terra 上游 429 阻塞，不能归档为 completed。用户通过结构化输入明确选择保留真实验收门禁，不按仅参数与单测证据发布。用户已授权提交与推送修复代码；本轮不运行发布脚本。

## 实施与验证记录

- 共用编排修复沿用上一计划；补齐 Grok / DSH / Kimi Code / ZCode 的发送快照，ZCode 的宿主角色模型与思考档解析。
- OpenCode 子任务在水合时保留已绑定执行模型；显式角色思考档传到实际 variant，未指定时不覆盖原角色 variant。归一化保留 OpenCode 高档与 DSH medium。补齐 OpenCode / Claude 主布局的全栈、前端思考事件。
- `loopModelRouting.test.ts` 覆盖七种 CLI、同/跨 CLI、全栈/拆分；经典 Loop 覆盖七种 CLI 同/跨 CLI 与新建/连续会话。相关 11 个测试文件共 204 条通过。
- `npm run build` 通过；最终全量 `node scripts/run_unit_tests.js` 2684 条：2680 通过、1 失败、3 跳过。唯一稳定失败为未修改的 `runPromptHistoryWebview.test.ts` 中 `openHistory` 的 `new Function` 夹具缺少 vscode，独立重跑 11 条中 10 通过、1 失败，属于范围外历史夹具问题。早先高负载并行验证曾触发 Codex runner 生命周期时序用例失败，停止真实 CLI 负载后两次全量重跑均不再出现，不修改其断言。
- Chromium 对真实生成的 Webview HTML 检查七种主 CLI 布局的全栈/前端角色：14 个场景通过，真实 DOM 修改思考档并核对提交快照，OpenCode 全栈模型选择也验证；桥接为模拟宿主，不冒充 Extension Development Host 或真实模型验证。结果保存在本机 `.tmp/loop-176-ui-smoke/result.json`，页面、控制台、请求、HTTP 错误均为零。
- Python 发布脚本测试 44 条执行、1 条跳过，无失败；ontology validate 与 9 条 ontology Python 测试通过；`git diff --check` 通过。

## 真实 Loop+ 调用与发布门禁

- 新增可复跑命令：`npm run build && node scripts/verify_loop_model_routing.js --live`。使用生产 Loop+ adapter / orchestration 与真实 CodexInteractiveRunner，存储和 Tab 由测试夹具隔离，工作目录为系统临时目录；不是人工分别调用两个模型，不修改用户真实任务。
- 主角色 `gpt-6.1-sol` / `high` 真正完成派发；子角色 `gpt-6.1-terra` / `low` 真正启动。读取本机 Codex session 的 `turn_context` 独立确认两个模型名与 effort 均正确。
- 三次真实调用中 terra 均未能返回有效结果，后两次明确捕获 `exceeded retry limit, last status: 429 Too Many Requests`。没有产物、没有成功验收收口，因此完整真实测试失败，不能记作通过。
- 去敏日志：`/tmp/sinitek-loop-176-live3.log`；失败运行证据位于系统临时目录的 `sinitek-loop-model-live-YEHnb3/failure.json`。不把 session 日志、完整配置、私有 prompt 或凭据写入仓库。
- 用户选择“保留真实验收门禁（推荐）”。不运行 `scripts/publish_vscode_extension.py`，不宣称已发布或 Extension Host 已升级。

## 恢复步骤

1. terra 服务恢复后重跑真实验证命令，要求任务 completed、主/子调用齐全、session 模型与 effort 正确、result.txt 内容正确。
2. 只有上述完整验收通过才执行 `python3 scripts/publish_vscode_extension.py`，确认发布的是 1.7.6，不能重复覆盖已存在版本。
3. 记录最终真实成功与发布证据，计划改为 completed 后移入 completed/2026-11/。
