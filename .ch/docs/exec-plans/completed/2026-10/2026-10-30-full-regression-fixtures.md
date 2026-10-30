# 全量回归测试与夹具修复

- 日期：2026-10-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-30
- claim_ttl：本次任务
- handoff_to：

## 背景

用户要求执行仓库全量回归测试并合理修复失败；初步怀疑近期运行时或协议变化导致测试夹具、mock 或断言落后于当前契约。

## 目标

- 识别并执行仓库定义的全量构建、TypeScript 单测和 Python 脚本测试。
- 按实现缺陷、断言过期、夹具问题、环境问题和历史失败分类失败。
- 修复本次可归因且有证据的实现、测试夹具或断言，并补充必要回归覆盖。
- 记录未覆盖风险和最终验证证据。

## 范围

- `npm run build`
- `node scripts/run_unit_tests.js --list`
- `npm run test:unit`
- `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
- 相关测试夹具、mock、断言和最小必要生产代码。

## 非目标

- 不重写测试框架或替换依赖。
- 不修复与本次回归无关的历史失败。
- 不执行真实发布、真实 CLI 破坏性操作或提交代码。

## 验收标准

- [x] 构建通过，编译测试清单只来自 `dist/test/**/*.test.js`。
- [x] 全量 Node 单测通过或每个剩余失败均有分类、证据和后续动作。
- [x] Python 脚本测试通过或每个剩余失败均有分类、证据和后续动作。
- [x] 夹具与当前公开契约一致，避免通过修改生产代码迎合旧夹具。
- [x] 计划记录实际命令、结果、失败处理和未覆盖风险。

## 影响面

- 代码目录：按失败归因涉及的 `src/` 模块。
- 测试目录：`src/test/`、`scripts/tests/`。
- 文档目录：本计划；仅在发现可复用踩坑时同步 runbook 或记忆。
- 配置与脚本：测试入口与夹具脚本，必要时同步测试说明。

## 风险与缓解

- 风险：全量测试耗时较长，失败输出可能被截断。
  - 缓解：先记录基线，再按失败文件或测试名称缩小重跑。
- 风险：测试夹具过度模拟旧协议，修复断言可能掩盖真实回归。
  - 缓解：先核对当前生产实现、协议文档和调用链，再决定更新夹具或修实现。
- 风险：Webview、真实 CLI 或 Extension Host 行为无法由单测完全覆盖。
  - 缓解：按 `.ch/docs/TESTING.md` 记录未覆盖项；若本轮改动触及页面，再补最小浏览器冒烟。

## 验证计划

- 构建：`npm run build`
- 测试发现：`node scripts/run_unit_tests.js --list`
- Node 全量：`npm run test:unit`
- Python 全量：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
- 相关重跑：`node --test dist/test/<相关测试>.js ...`
- 其它：按影响面决定是否运行 `npm run validate:whitespace`、页面冒烟和 Ontology 校验。

## 测试与清单同步

- 单元测试更新：19 个 `src/test/` 夹具、mock、VM 依赖和契约断言；无生产代码改动。
- 单元自测结果：`npm run build` 通过；`npm run test:unit` 最终为 2483 项、2482 通过、0 失败、1 跳过；`node scripts/run_unit_tests.js --list` 发现 251 个合法 `dist/test/**/*.test.js` 文件。
- Python 自测结果：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'` 为 44 项、43 通过、1 个 Windows 专属跳过。
- 失败处理：基线 38 个 Node 失败均核对当前生产实现、规格和历史变更后归类为旧断言、旧夹具或测试沙箱依赖；未修改生产逻辑。新增 DSH 占位密钥优先级说明，并修正 Grok TOML 表路径夹具。
- 功能清单：本轮未改变用户可见行为、权限或流程；仅同步 DSH 既有占位密钥事实到功能清单和自定义 provider 契约文档。
- 其它校验：Ontology 测试 9 项通过、memory-consolidator 测试 2 项通过、Ontology validate 通过、`npm run validate:whitespace` 通过、`git diff --check` 通过。
- 覆盖率门禁：`npm run test:core-coverage` 与 `npm run test:page-coverage` 的用例分别 269/269、340/340 通过，但仓库既有 100% 门禁未达标（核心 97.05%/95.73%/97.10%/97.05%，页面 99.51%/88.06%/97.89%/99.51%）；未降低阈值或排除代码。
- 功能清单和运行时实现未因测试失败而扩张；浏览器真实冒烟、真实 CLI、Extension Development Host 和 Windows 真机未在本轮执行。

## 任务列表

- [x] 读取规则并确认测试入口
- [x] 执行构建与全量测试
- [x] 分类失败并核对当前契约
- [x] 修复实现、断言或测试夹具
- [x] 重跑回归并记录结论

## 决策记录

- 2026-10-30：先执行全量基线，再根据证据区分旧夹具与实现缺陷。
- 2026-10-30：保留 Kimi 的旧自定义 `subcoco` provider/alias 兼容性夹具，修复半迁移表键，不把所有夹具改成当前默认 provider。
- 2026-10-30：Grok 含点别名必须使用 `[model."grok-4.7"]`；增加解析后的完整模型表键断言，防止文本断言掩盖嵌套表路径错误。
- 2026-10-30：覆盖率专用入口的既有 100% 门禁未满足；本轮不降低阈值、不添加忽略、不扩大为无关源码覆盖率改造。

## 验证证据

初始基线为 `97763b3`。原始 Node 结果 2483 项、2444 通过、38 失败、1 跳过；最终正式入口 2483 项、2482 通过、0 失败、1 跳过。以下日志位于本机忽略目录 `.tmp/full-regression-2026-10-30/`，不纳入版本库。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm run test:unit`，含 clean/build | 退出 0；2482 通过、0 失败、1 跳过 | `node-final-verified.log` |
| `node scripts/run_unit_tests.js --list` | 251 个编译后测试文件；无非法路径 | `test-list-final.txt` |
| `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` | 44 项，43 通过、1 跳过 | `python-baseline.log` |
| `npm run test:core-coverage` | 用例 269/269 通过；覆盖率门禁退出 1 | `core-coverage.log` |
| `npm run test:page-coverage` | 用例 340/340 通过；覆盖率门禁退出 1 | `page-coverage.log` |
| `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` | 退出 0 | `ontology-validation-final.log` |
| `npm run validate:whitespace` | 退出 0 | `whitespace-final.log` |
| `git diff --check` | 退出 0 | `diff-check-final.log` |

覆盖率四项顺序为 statements / branches / functions / lines。未覆盖代码仍来自已有生产源码，例如 `promptRuntime.ts:75-76` 来自 `376ea108`，`webview/viewProvider.ts:60-65` 来自 `f2d2176f`；本轮未修改生产源码。后续应单独为核心状态分支与 Webview provider/config/panel 分支补覆盖，不能据此宣称覆盖率门禁通过。

## 未覆盖项与收尾判断

- Node 唯一跳过是 DSH loopback 真实模型集成测试，要求显式设置 `SINITEK_DSH_LIVE=1`、loopback `SINITEK_DSH_BASE_URL` 和 `SINITEK_DSH_API_KEY`；未擅自启用真实凭据或远程请求。
- Python 唯一跳过是 `test_windows_cmd_paths_and_arguments_with_spaces`，仅在真实 Windows `cmd.exe` 环境执行。本次 macOS 结果不能替代 Windows 真机验证。
- 本轮没有生产 UI、CLI 或 Extension Host 实现变更，因此未额外启动浏览器、真实 CLI 或 Extension Development Host；现有 VM/宿主 mock 用例不能替代真实端到端验证。
- DSH 文档仅同步既有占位值和密钥优先级；业务概念、状态机、权限和 `source_refs` 路径均未变化，无需修改 Ontology 数据或架构。Ontology validate 已通过。
- 已检查记忆与 PITFALLS 中现有契约测试适配规则；过程证据保留在本计划，不重复扩写热区记忆，不写入 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。
- 未提交代码；工作区只包含 19 个测试文件、2 个契约说明文档和本归档计划。

## 当前结论

本次回归完成。失败集中在新增 `zcode` 后仍按六个 CLI 编写的枚举/存储夹具、Grok 显示名和 TOML 表键旧断言、DSH 无前缀模型 ID、Kimi provider 别名半迁移、VM 沙箱遗漏真实 UI 工具、Webview 抽取函数依赖以及环境变量测试未清空直配密钥。修复后正式 `npm run test:unit` 零失败；Python 测试仅保留平台限定的 Windows 跳过。覆盖率专用脚本的测试用例本身全通过，但既有全局 100% 门禁仍失败，作为未覆盖风险记录。
