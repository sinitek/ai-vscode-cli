# 测试基线

这个仓库是 VS Code Extension / Node.js / TypeScript 项目。测试基线以 `npm run build` 产出的 `dist/` 为执行对象，单元测试优先使用 Node 内置 `node:test`。

## 当前定位

- 统一构建命令：`npm run build`。
- 全量单元入口：`npm run test:unit`，会先构建，再通过 `scripts/run_unit_tests.js` 枚举 `dist/test/**/*.test.js` 的编译后 JavaScript 清单并交给 Node 原生 `node --test` 执行；该入口不得退回裸 `node --test` 自动扫描仓库。
- 单测发现范围核对：`node scripts/run_unit_tests.js --list` 只应输出 `dist/test/**/*.test.js`，不应包含 `src/test/**/*.ts`。
- 最小相关单测：先 `npm run build`，再运行 `node --test dist/test/<相关测试>.js ...`。
- 产研部 Windows/Linux 实际主机验证入口、`owner-core` 与 `public-codex` 的证据边界见[产研部平台验证手册](runbooks/department-platform-verification.md)。入口自身行为回归：`node --test scripts/verify_department_platform.test.js`；该测试只使用临时子程序，不能作为部门生产套件或跨平台通过证据。
- Loop+/Codex 跨平台修复检测：macOS / Windows 均执行 `npm run verify:loop-plus`，或双击 `scripts/verify_loop_plus_fix.command` / `scripts/verify_loop_plus_fix.cmd`。自动构建、执行所有权/完成状态/Tab/交接回归、默认三轮真实 pool 交接和一次公共 runner 交接；仅使用临时 HOME 与本机模拟模型，不使用用户会话或产生真实模型费用。参数、报告与验收边界见[本地开发手册](runbooks/local-development.md#loopcodex-一键修复检测macos--windows)。单测跳过、缺证据、异常退出或资源清理未确认均失败；退出 0 仅表示当前平台源码与隔离运行时通过，不表示已安装扩展或其它平台完全修复。
- 共享 `dist/` 在每个验证阶段由单一执行者负责构建；其它执行者不得同时清理、构建或运行依赖该输出的测试。入口自身回归可使用唯一临时副本，须保留 `scripts/` 与 `dist/test/` 相对结构。最终源码原生验证必须从实际仓库串行运行默认三轮 `python3 verify_mac.py`，由入口完成一次构建及必要回归，不另加预热 build；开始/结束记录源码、测试和脚本指纹，相关改动须按影响判定旧证据是否失效。Windows 必须在 Windows 本机对同一源码运行 `python verify_win.py` 并保留报告，macOS 或入口单测结果不能替代。
- 构建会先清理 `dist/`；不要将构建（包括自带构建的测试命令）与读取 `dist/` 的测试并行执行，以免出现模块暂时缺失的 `ENOENT` 或 `MODULE_NOT_FOUND`。多个含构建的入口应串行执行。
- 常用分组：`npm run test:core` 覆盖核心运行时，`npm run test:page` 覆盖 Webview / 配置页相关测试。
- 严格覆盖率入口：`npm run test:core-coverage`、`npm run test:page-coverage` 对 statements、branches、functions、lines 均要求 100%；即使用例全部通过，覆盖率不足仍会返回失败。已确认的历史覆盖缺口见[技术债跟踪](exec-plans/tech-debt-tracker.md)，不得降低门槛或把覆盖率失败混写为行为回归。
- 静态空白校验：`npm run validate:whitespace`，也可在必要时用脚本参数限制到本次改动范围。
- Python 开发、导出与发布脚本：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`（Windows 可用 `python`），覆盖依赖布局、失败中止、macOS 路径选择、Windows `.cmd` 参数传递、发布鉴权与 VSIX ZIP 审计。
- 根目录检测入口：macOS 用 `python3 verify_mac.py`，Windows 用 `python verify_win.py`；均转发到同一 Loop+/Codex 验收脚本。入口最小回归：`python3 -m unittest discover -s scripts/tests -p 'test_verify_loop_plus.py'`，覆盖含空格路径、参数/退出码透传、缺工具、人工中断，以及从其它目录调用两个入口的帮助、非法参数和真实缺 Node 检查；这些检查不运行真实检测。Node 检测器自身回归另验证真实缺 npm 时构建阶段失败、保存失败报告且不启动 Codex。
- 统一入口的必要回归还覆盖主子模型路由与切换续跑、验收协议及其修复提示、验收方案与反馈、FIFO 批次提交和最终完成门禁、运行时停止接线、宿主崩溃恢复和子任务完成关页。存储及交接/完成门禁显式必跑 `loopTaskStore.test`、`loopTaskStoreCoreCoverage.test`、`loopTaskStorePersistence.test`、`loopPlusHandoffContracts.test` 和 `loopPlusAcceptanceCompletionGate.test` 的编译后 `.js` 文件；任一缺失立即失败，不得改成可选。报告 `checks[name=regression].evidence.files` 记录实际执行的相对路径清单；这些是自动化回归证据，不能代替真实模型验收。
- 暂停/旧 CLI 回归已纳入上述统一入口：不可重试会话错误一次暂停、普通错误五次门槛、旧记录原因重建及事件驱动轮次展示；确认支持即时卸载时验证共享池，否则验证专属 owner 隔离及原进程实际退出。不得用终端另一 Codex 版本的通过结果覆盖插件默认路径失败。临时 HOME 的多个 app-server 依次完成首次初始化，避免 SQLite 初始化竞争被误认为产品交接缺陷。
- 依赖真实 CLI、用户配置、日志、Webview 或 Extension Development Host 状态的问题，单元测试之外还要补充最小本机真实验证，并记录命令、关键输出和结论。
- Loop+ 双模型真实门禁：`npm run build && node scripts/verify_loop_model_routing.js --live`。该命令使用真实 Codex runner 调用 `gpt-6.1-sol` / high 与 `gpt-6.1-terra` / low，会产生模型费用，使用系统临时工作区和隔离任务存储；只有完整派发、子任务执行、验收收口、session 参数及产物都通过才成功。429 等上游错误必须保持失败，不能用参数正确替代完整真实验收；此脚本不发布扩展。

## 最近一次 Loop+/Codex 原生源码验证

2026-11-16 Round 10：在实际共享仓库运行 `python3 verify_mac.py --report <全新临时路径>/verification.json`，默认三轮，退出 0。macOS arm64 / Node v24.22.2 / 默认 PATH Codex 0.167.2；源码 1.9.9、commit `c9c135fe935d6a016cb2b28ac4b31c827ab4e990`、dirty=true。71 个必要回归文件共 1209/1209，无失败/取消/跳过/TODO，包含五项存储/交接/完成门禁文件。三轮专属进程原会话交接 44/49/42ms，公共 runner 46ms，均确认真实 `process/exit` 后恢复及其它会话保留；四组退出/stdio/临时目录清理通过，20 个自有诊断 PID 已不存在。检测前后 693 个源码/测试/脚本指纹一致。三份报告及完整边界见[本地开发手册](runbooks/local-development.md#loopcodex-一键修复检测macos--windows)。`fullyVerified=false`；主审已接受本次源码修复、公共契约及上述 macOS 约定范围，收口见[已归档修复计划](exec-plans/completed/2026-11/2026-11-16-bugfix-loop-handoff-contracts.md)。Windows 原生仍由用户另机验证；真实模型、已安装扩展/图形宿主端到端、其它平台/CLI 及全仓单测未执行，属于覆盖限制，不表示本次约定修复尚未完成。

## 什么情况下默认要补单元测试

- 新增或修改稳定业务逻辑、领域规则、状态转换、计算逻辑。
- 新增或修改输入边界校验、权限判断、序列化/反序列化、适配器逻辑。
- 修复明确可复现的 bug，且该 bug 可以通过小范围自动化断言稳定复现。
- 抽取共享工具、SDK、公共组件行为或错误模型。

## 最低覆盖要求

- 至少覆盖一个成功路径。
- 至少覆盖一个边界条件或空值场景。
- 至少覆盖一个失败路径、拒绝路径或异常路径。
- 对已知回归问题，至少补一条能防止再次出现的回归用例。

## 任务后自动单元自测

有一定复杂度的功能、非平凡 bug 修复、稳定逻辑调整、共享工具抽取完成后，代理必须主动执行单元自测，而不是只说明“建议测试”。

执行顺序按项目实际情况选择，优先级从高到低：

1. 本次新增或修改测试的最小相关命令。
2. 被改模块、包、应用或业务域的单元测试命令。
3. 项目文档、局部 `AGENTS.md`、CI 配置或脚本中声明的统一单元测试命令。
4. 如果没有现成命令，至少说明已检查哪些入口、为什么无法稳定执行，以及后续最小补齐动作。

自测记录至少写清：

- 实际运行的命令。
- 结果是通过、失败、无法运行还是部分运行。
- 失败时的关键错误摘要。
- 未覆盖的风险和后续动作。

## 单测失败后的处理策略

单测失败不能直接归因为“测试坏了”，也不能为了绿灯改无关代码。先按下面类型判断：

- **实现缺陷**：新代码行为不符合需求、规格或既有契约。修实现，重跑相关单测。
- **测试断言过期**：需求或公开契约已经明确变化，旧断言不再成立。更新测试表达的新行为，保留必要的回归用例，重跑相关单测。
- **夹具或测试数据问题**：测试准备数据、mock、fixture、时钟、随机性、隔离性不符合当前契约。优先修夹具，不把业务代码改成迎合坏夹具。
- **环境或依赖问题**：缺少服务、依赖未安装、权限、网络、平台差异、缓存污染导致无法稳定执行。记录证据、影响范围和最小恢复动作；能局部绕开时只运行不依赖该环境的最小相关单测。
- **历史失败或范围外失败**：失败与本次改动无关且可由已有记录、基线或对比命令证明。记录证据，不在本次任务里扩大修复范围；如果风险高，写入执行计划或技术债跟踪。

每次修复后都要重新执行最小相关单测。若连续修复仍失败，应缩小到单个用例、读取失败上下文，再决定继续修复、记录阻塞或请求人工确认。

## 可以暂不补的情况

- 纯文案改动、纯静态排版调整、无行为变化的结构整理。
- 当前仓库还没有对应测试基建，且本次任务范围也不适合顺手引入整套框架。
- 依赖外部系统、真实环境或高成本夹具，短期内无法稳定自动化。

以上情况也不能直接跳过，必须在执行计划、任务收尾或相关规格里写清：

- 为什么本次没补
- 风险是什么
- 后续最小补齐动作是什么

## 目录与命名建议

- 优先让测试与被测代码在目录结构上可映射，避免散乱堆放。
- 如果技术栈支持 colocate，则测试文件应尽量贴近被测模块。
- 如果技术栈偏向集中式测试目录，则 `tests/` 应镜像业务域或模块边界。
- 测试名称要表达行为，而不是只写实现细节。

## 与计划和收尾的联动

- 执行计划必须记录：本次改动涉及哪些单元测试、已经验证了什么、还没验证什么。
- 有一定复杂度的功能完成后，执行计划或收尾说明必须记录单元自测命令和结果。
- 如果单测失败后自动修复，记录失败类型、修复动作和最终重跑结果。
- 功能或行为变更若会影响用户可见能力，应同时同步功能清单，避免“有测试没清单”或“有清单没测试”。
- 收尾时至少说明：运行了哪些测试命令、没运行哪些、原因是什么。

## 明确禁止

- 不要用手工点点点代替本可自动化的单元测试。
- 不要把端到端测试当作所有逻辑问题的唯一护栏。
- 不要把生产数据、密钥、客户真实数据当作测试夹具。

## 当前仍需持续补齐的内容

- 新增稳定能力时保持测试文件与被测模块可映射。
- 对依赖真实 CLI / Webview 状态的历史问题，优先补可自动化的回归测试，再用本机真实验证覆盖环境差异。
- 若新增 CI 或测试分组，必须同步本文件、相关局部 `AGENTS.md` 或运行手册。
