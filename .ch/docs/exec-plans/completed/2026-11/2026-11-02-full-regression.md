# 全量回归与失败分类修复

- 日期：2026-11-02
- 状态：completed
- 负责人：Codex

## 背景与目标

用户要求执行全量回归，并区分实现缺陷、过期断言、夹具问题和环境问题后修复。起始工作区干净，现有依赖已安装；在当前工作区实施，不创建分支或 worktree。

## 范围与非目标

- 覆盖 TypeScript 构建、全部编译后 Node 单测、现有核心/页面覆盖率入口、Python 脚本与技能测试、五个独立验证脚本、ontology 和静态空白校验。
- 只修复由失败证据确认的问题，复用现有框架，不升级依赖或变更基础设施。
- 如涉及真实 CLI 或 Webview 行为，再补最小真实验证；不使用私有运行数据，不发布扩展。

## 验收标准

- 全量单测和 Python 测试已执行，记录实际通过、失败、跳过数量及命令。
- 对所有失败记录分类依据；修复后先重跑最小范围，再复跑全量。
- 构建通过；覆盖率门槛和静态校验已验证，未解决限制有明确证据。
- 根据改动判断功能清单、ontology 和 runbook 是否需要同步，并记录理由。

## 影响面

- 代码目录：待基线失败定位，不预设业务代码需要修改。
- 测试目录：`src/test/`、`scripts/tests/`、`.agents/skills/*/tests/`。
- 文档目录：本计划；必要时更新测试事实来源或排障说明。

## 风险与缓解

- 旧断言可能落后于当前明确契约：核对规格、当前代码和历史，不为绿灯回退正确实现。
- 构建会清理 `dist/`：串行执行包含构建的入口，避免相互干扰。
- VS Code 宿主和外部 CLI 可能不可用：先完成独立自动化，真实验证按实际条件记录，不能把缺失验证写成通过。

## 验证计划

- 基线与最终全量：`npm run test:unit`。
- 最小范围：`npm run build` 后运行相关 `node --test dist/test/...`。
- 覆盖率：`npm run test:core-coverage`、`npm run test:page-coverage`。
- 独立脚本：逐个执行 `node scripts/validate_*.js`，不调用真实 CLI 或网络服务。
- Python：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`，以及各现有 skill 测试目录。
- 结构：`node scripts/run_unit_tests.js --list`、`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`npm run validate:whitespace`、`git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：更新 `loopPlusAcceptancePlan`、`loopPlusOrchestration`、`loopPlusGroupChatPanel`、`chatMarkdown`、`loopPlusModeEntry` 五个测试文件的旧断言；保留完整性、50 字边界、语言保留、缺失拒绝及竖线转义覆盖，并加强两个模式选择器各自的提示文案校验。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/webview/chatMarkdown.test.js dist/test/webview/loopPlusModeEntry.test.js` 为 113/113 通过。
- 失败处理记录：见下方分类；未修改业务实现或降低验收门槛。
- 功能清单：同步既有 ✅/❌ 展示契约，不引入新功能。ontology 的概念、关系、状态、权限和来源路径均未变化，无需更新数据。
- 测试文档：补充构建会清理 `dist/`、含构建入口不得与读取编译产物的测试并行运行的约束，并说明严格覆盖率与行为测试的结果区别，链接已有技术债。
- 记忆召回：focus 为“全量回归 测试 夹具 regression testing fixtures”，无 anchor；只命中治理入口，无相关活动计划，不扩展扫描历史。

## 任务列表

Tasklist:
- [completed] 确认测试规范、上下文、工具和工作区基线
- [completed] 全量回归，保留失败日志并分类
- [completed] 修复过期测试断言，完成最小验证
- [completed] 复跑全量、同步结论并归档计划

## 失败分类与基线证据

| 类型 | 数量 | 依据与处理 |
| --- | --- | --- |
| 测试断言过期：验收结果展示 | 8 | 2026-11-01 的 `15ea795` 明确将“通过/未通过。原因：”改为 ✅/❌，当前实现符合该改动；更新单测、编排集成、群聊和 Markdown 的预期及原因提取规则。 |
| 测试断言过期：Loop+ 提示 | 1 | 当前提示为“单个子任务执行结束后立即验收，其它完成进入队列。”，测试同时保留已移除的“可见队列”断言；移除旧检查并校验两个选择器各自的完整提示。 |
| 环境/编译产物暂时缺失 | 18 | 首轮生命周期测试读取 `dist/interactive/codexRunner.js` 遇到 `ENOENT`，之后该文件重新出现且修改时间晚于首轮测试结束；单独复测 25/25 通过，未改编译产物的串行全量复测也不再出现。未据此改动 runner，避免把临时环境干扰当作实现缺陷。 |
| 历史覆盖率缺口 | 2 个入口 | 核心 267/267、页面 368/368 用例通过，但各自 100% 全局覆盖率门槛未达标；与 [2026-10-31 已登记技术债](../../tech-debt-tracker.md) 一致，该记录已有独立还原 `43b085a` 的失败证据。本轮未改业务运行时代码或覆盖率分组，不降低门槛，也不为补齐全仓防御分支扩大修复范围。 |

- 首轮 `npm run test:unit`：2490 项，2462 通过、27 失败、1 跳过。
- 原编译产物 `node scripts/run_unit_tests.js` 串行复测：2490 项，2480 通过、9 失败、1 跳过；失败均为上述旧断言。
- Python：脚本测试 44 项（43 通过、1 跳过），ontology 9/9，memory-consolidator 2/2。
- 结构基线：ontology 校验、全仓静态空白和 `git diff --check` 通过。
- 测试发现：245 个 `src/test/**/*.test.ts` 对应 245 个编译后测试文件，`--list` 全部限定在 `dist/test/**/*.test.js`。
- 核心覆盖率：statements/lines 94.76%、branches 92.74%、functions 96.68%，入口退出码 1（仅门槛失败）。
- 页面覆盖率：statements/lines 99.30%、branches 79.95%、functions 93.87%，入口退出码 1（仅门槛失败）。
- 跳过边界：Node 的 DSH 实连测试需要显式本机服务地址和密钥；Python 真实 Windows `cmd.exe` 测试在 macOS 跳过，均不伪造通过。

## 决策记录

- 2026-11-02：使用仓库已有编译后测试发现入口，不使用裸 `node --test` 扫描源码或依赖目录；保留当前框架与版本。
- 2026-11-02：严格覆盖率失败属于既有技术债，保留原门槛、分组和有效断言；最终报告分别列行为测试结果与未清零的覆盖率门槛。

## 当前结论

已完成全量回归和过期断言修复，最终 `npm run test:unit` 为 2490 项：2489 通过、0 失败、1 跳过。首轮 18 个编译文件暂失失败未在后续隔离与全量复测中重现。五个独立校验脚本均通过。

| 验证入口 | 最终结果 |
| --- | --- |
| `npm run build` 与五个修改测试文件的最小集 | 构建成功，113/113 通过 |
| `npm run test:unit` | 构建成功，2489 通过、0 失败、1 跳过 |
| `npm run test:core-coverage` | 267/267 用例通过；100% 覆盖率门槛因既有缺口失败 |
| `npm run test:page-coverage` | 368/368 用例通过；100% 覆盖率门槛因既有缺口失败 |
| `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` | 43 通过、1 跳过 |
| `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` | 9/9 通过 |
| `python3 -m unittest discover -s .agents/skills/memory-consolidator/tests -p 'test_*.py'` | 2/2 通过 |
| `node scripts/validate_codex_collab_timeout.js` | 通过 |
| `node scripts/validate_codex_item_trace_candidates.js` | 通过 |
| `node scripts/validate_codex_web_search_trace.js` | 通过 |
| `node scripts/validate_gemini_stream_json.js` | 通过 |
| `node scripts/validate_history_session_fix.js` | 通过 |
| `node scripts/run_unit_tests.js --list` | 245 个编译后文件，与源码测试文件数一致 |
| `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` | 通过 |
| `npm run validate:whitespace`、`git diff --check` | 通过 |

未改业务运行时代码，无需启动真实 CLI 或浏览器验证；DSH 实连缺少显式测试服务与密钥，Windows 原生 `cmd.exe` 不能在当前 macOS 运行，均按原测试条件跳过。覆盖率遗留缺口保留在已有技术债中，不把用例通过表述为所有质量门槛通过。

长期维护判断：契约澄清进入功能清单，编译产物并行清理风险和覆盖率解释进入测试指南；现有技术债继续承接覆盖缺口。概念、关系、状态和来源路径未变，无需改 ontology，也不重复写入记忆热区、事件记忆或 runbook。未创建分支、提交或发布。
