# Git 同步与全量回归

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

用户要求提交并推送当前工作区、同步远端，合理合并冲突，然后执行全量回归；对失败先分类，修复实现或更新失效夹具，最后再次提交推送。

## 范围与非目标

- 保留当前 `master` 上人工交互、主任务完成桌面提醒及配套测试、文档。
- 合并 `origin/master` 的配置页模型解析导入，保留双方功能和语义规则。
- 覆盖编译、全部编译后 Node 单测、Python 脚本与 ontology 测试、仓库文档与空白校验；页面变更按现有浏览器验证能力补充验证。
- 不升级依赖、不改技术栈、不发布或安装扩展、不强推或重写既有远端历史。
- 不默认执行会调用付费模型的真实 Loop+ 门禁；对真实桌面及异平台验证边界明确记录。

## 验收标准

- 原始本地改动完整进入提交，远端变更完整保留，无遗留冲突标记。
- `npm run build` 和 `npm run test:unit` 通过；全量 Python 测试与相关结构验证完成。
- 测试失败记录分类、根因、修复及最小复测结果，不降低断言或覆盖率阈值换取通过。
- 最终本地 `HEAD` 与 `origin/master` 一致，工作区干净，修复和验证结论已推送。

## 影响面

- 代码：已有桌面提醒、Loop+ 完成回调、远端配置导入实现及失败相关测试。
- 文档：本计划；合并涉及的功能清单与 ontology；仅对可复用结论按需更新 runbook。
- 配置：保持当前 `package.json` 设置及现有测试入口。

## 风险与缓解

- 工作区已有未提交实现：先创建本地提交，再使用普通 merge，禁止 reset、强推或丢弃改动。
- 双方改动功能清单与 ontology：按语义保留双方新增段落并执行 JSON、引用与 ontology 校验。
- 测试依赖本机状态或并发：构建与读取 `dist/` 的测试串行；先确认夹具契约，避免修改生产实现迎合坏夹具。
- 远端继续前进：最终重新 fetch，必要时再次合并、复测后普通 push。

## 验证计划

- 最小验证：`git diff --check`，构建及桌面提醒、Loop+ 与配置导入相关单测。
- 全量单元：`npm run test:unit`；`node scripts/run_unit_tests.js --list` 确认发现范围。
- Python：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`；ontology 与 memory-consolidator 的现有测试。
- 结构：ontology `--validate`、`npm run validate:whitespace`；按实际页面验证条件决定是否补 Chromium 冒烟。
- 覆盖率：检查已有严格门禁与技术债记录，不降低 100% 门槛；若执行失败单独归类。

## 测试与清单同步

- 单元测试新增/更新：补齐两个 Loop+ 测试夹具对真实 `readVisibleConfigSelections` 的抽取；配置夹具增加 revision，并断言派发、排队和队列执行保留捕获时的配置身份。历史弹窗夹具增加宿主桥接，并断言发送 `refreshPromptHistory`。
- 单元自测结果：定向 24/24 通过；完整 Node 单测 2865 通过、3 跳过、0 失败；Python 总计 54 通过、1 跳过。
- 失败处理记录：首轮 23 项失败中，4 项为失效夹具，已修复；其余 19 项为执行中编译文件瞬时缺失，单文件复测 28/28、重建后完整套件通过，归类环境/构建产物干扰，不修改 runner 实现或降低断言。
- 功能清单：保留本地桌面提醒与远端模型导入更新；纯测试修复如不改变行为不另增功能项。
- ontology：已完成状态报告和桌面提醒规则召回，并核对其代码与规格事实来源。
- ontology 收尾：本次额外变更仅为测试夹具、断言和验证文档，不改变概念、状态机或用户可见流程，无需增加规则；合并后的 101 条规则及全部引用校验通过。
- 文档收尾：新增已验证的 Webview 抽取夹具依赖问题到 `PITFALLS.md`；保留并行更新的 README 1.8.0 发布说明。本次不向 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md` 追加流水；已有功能变更自带的记忆条目保持不动。
- 记忆召回：focus 为 `git 同步 全量回归 testing desktop attention`，anchor 为空；命中既有阻塞发布计划与记忆规则，不自动推进无关发布。

## 进展与决策记录

- 2026-11-04：初始分支 `master`，本地 `6e0d2c0`，远端 `cf97b03`，落后一个提交；远端变更主要为配置页模型解析导入。
- 2026-11-04：确认 Node `v22.23.4`、npm `10.9.9`，已有依赖可用；初始 `git diff --check` 通过。
- 2026-11-04：本地功能提交 `4075a54`，使用普通 merge 生成 `824f160`，双方功能清单与 ontology 自动合并成功，无需手工解决冲突，随后普通推送成功。
- 2026-11-04：完成测试夹具修复，最终提交包含三个测试文件、runbook、本计划和用户并行更新的 README 发布说明；不改运行时代码，不发布或安装扩展。

## 验证结果

日志与浏览器截图留在系统临时目录 `/tmp/sinitek-git-regression-20261104.c8QzTK/`，不提交机器本地运行数据。

| 命令或验证 | 结果 |
| --- | --- |
| `npm run build` | 多次通过，TypeScript 无错误 |
| 桌面提醒、Loop+ 完成回调、模型导入相关定向单测 | 179/179 通过 |
| 三个修复后的 Webview 测试文件 | 24/24 通过 |
| `node --test dist/test/interactive/codexRunnerLifecycle.test.js` | 28/28 通过 |
| `npm run test:unit` | 2868 项：2865 通过、3 跳过、0 失败；260 个编译后测试文件 |
| `node scripts/run_unit_tests.js --list` | 所有条目均为 `dist/test/**/*.test.js`，没有误扫 TypeScript |
| `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` | 44 项：43 通过、1 跳过 |
| `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` | 9/9 通过 |
| `python3 -m unittest discover -s .agents/skills/memory-consolidator/tests -p 'test_*.py'` | 2/2 通过 |
| `npm run validate:whitespace`、`git diff --check` | 通过 |
| 两个修改后的配置页 JS 的 `node --check` | 通过 |
| ontology `--validate` | 通过：2 domains、16 concepts、15 relations、101 rules、2 workflows |
| Chromium 1440×1000 模型发现 | 通过，模型列表可见且位于视口内，导入可用，浏览器/HTTP/请求错误均为空 |
| Chromium 1024×800 草稿导入 | 通过，弹窗关闭，成功提示出现，源码模型值变为 `regression-model`，没有保存或激活请求 |

### 严格覆盖率门禁

两个命令均执行，分组行为断言全部通过，但因既有覆盖缺口返回 1。保留 100% 门槛，不把行为回归与覆盖率不足混写，也不扩大到历史覆盖率治理。

| 命令 | 行为用例 | statements / branches / functions / lines |
| --- | --- | --- |
| `npm run test:core-coverage` | 280/280 通过 | 94.77% / 92.72% / 96.68% / 94.77% |
| `npm run test:page-coverage` | 387/387 通过 | 99.32% / 80.41% / 93.87% / 99.32% |

历史证据：`.ch/docs/exec-plans/tech-debt-tracker.md` 已于 2026-10-31 登记，并独立还原 `43b085a` 确认两个 100% 门禁存在同类失败；本次没有修改覆盖率目标模块的运行时代码。

### 浏览器验证边界与夹具分流

- 使用真实 `getConfigViewHtml` 与本地打包资产，隔离宿主桥接只提供合成配置、模型发现和草稿导入结果；不访问真实供应商、不读取用户配置、不保存或激活档案。
- 通过 `.agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <系统临时目录中的场景 JSON>` 执行两种尺寸；结果和截图位于该临时目录下的 `config-model-discovery-desktop/` 与 `config-model-import-compact/`。
- 初轮浏览器夹具缺少 `initDefault`、配置排序桥接，且未处理多个导入入口及 Ant Design 双字按钮自动空格，按真实页面契约补齐夹具和选择器后重跑通过；没有修改生产实现迎合夹具。
- 标准 HTTP 隔离宿主补充 VS Code 主题变量，并仅在测试 HTML 的 CSP 中允许同源 worker 脚本，适配 Monaco 的本机资源加载；不更改仓库生成器，也不声称验证了真实 VS Code Webview CSP 或完整图形宿主。
- 任务临时宿主脚本退出并从 `.tmp/` 清理，副本保留到系统临时证据目录。

### 未执行或跳过的边界

- Node 跳过的 3 项均为显式开关控制的 DSH 实时模型测试：`SINITEK_DSH_LOOP_LIVE` 或 `SINITEK_DSH_LIVE` 及相应本机模型配置未启用。
- Python 跳过的 1 项为仅 Windows 可运行的真实 `cmd.exe` 路径测试，当前机器为 macOS。
- 不执行付费 Loop+ 双模型真实门禁；不重复弹出真实系统通知；Windows/Linux 桌面及完整 Extension Development Host 验证仍不在本机覆盖内。

## 当前结论

已保留双方实现并推送初次合并，完整行为回归及两种尺寸浏览器流程通过；修复仅涉及真实契约下的失效夹具，严格覆盖率的历史门禁缺口仍如实保留。计划归档到 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-git-sync-full-regression.md`；最后使用普通提交和推送，并核对本地远端一致及工作区干净。
