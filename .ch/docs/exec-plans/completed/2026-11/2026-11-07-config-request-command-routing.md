# 配置中心请求命令路由重构执行计划

- 日期：2026-11-07
- 状态：completed（领域与面板接线、构建/回归、文档及 ontology 校验全部完成）
- 负责人：Loop+ 协作；第 3 轮交付领域模块/设计，第 4 轮单一 coding attempt 负责中央接线及收口
- handoff_to：主任务最终复核；当前无接口竞争或待确认问题
- 设计契约：[配置中心请求命令分发设计](../../../design-docs/config-center-request-commands.md)。

## 背景

`src/webview/configPanel.ts` 的 `handleRequest` 混合 24 动作分发、配置读写、Skills 选择、导出 IO、模型导入和统一异常响应。`src/test/config/cliPageConfigCoverage.test.ts` 对 switch case 文本的断言限制了行为保持拆分。既有 CLI 参数、模型选择、配置运行时和模型导入策略不需要重做；暂不扩大到风险更高的 `src/extension.ts` 跨域重构。

## 目标

以局部静态 Command 表和显式注入隔离配置/Skills 请求处理，保持全部可观察行为。第 3 轮建立契约和两张独立领域表；第 4 轮完成生产 registry、局部 typed router、面板接线、回归及文档收口，不改协议或服务规则。

## 范围

- 第 4 轮修改：`src/webview/configPanel.ts`、新增 `src/webview/configRequestRouter.ts` 和 `src/test/config/configRequestRouter.test.ts`，扩展 `src/test/config/cliPageConfigCoverage.test.ts`；同步设计、架构导航、本计划和必要 ontology 来源。
- 已验收且本轮未修改：`src/webview/configRequestHandlers/profiles.ts` 的 12 个处理器与 `src/webview/configRequestHandlers/skills.ts` 的 7 个处理器及各自独立测试。
- 面板将两张表与导出、CLI enabled、三个模型导入动作合成 24 键实例 registry；局部 typed router 提供穷尽类型、自有键和字符串保护；结构测试检查真实生产表而非 switch 文本。
- 接口、服务参数、每项 data、通知顺序与错误契约统一以设计文档为准，不另造不同端口；Skills 交互仅 `pickLocalSkillZip` 与 `pickSkillPlatforms`，profiles host 仅可选 `onConfigChanged` 与 `getActiveConfigId`。

## 非目标

- 不创建通用命令框架、DI 容器或新协议；不每次请求重建表，不新增重复 IO。
- 不改配置服务、持久化、业务校验、网络或路径安全策略。
- 不改 HTML/CSS/主题/文案/交互；构建与测试按验证记录串行执行，不运行发布脚本。
- 不操作调度状态、active ids、任务记录、Loop+ snapshot、兄弟报告或代码；不写热区记忆、`ROLLING_SUMMARY.md`，全部验收后才归档。

## 验收标准

- [x] 核对局部文档规则、execution-plan/ontology skill、计划 README/TEMPLATE、架构、产品事实、协议与当前分发实现。
- [x] 记录 12 + 7 + 5 的独立交付边界与行为不变量，明确设计/并行交付不等于已集成。
- [x] 配置模块独立测试覆盖 12 动作、窄服务参数、六种写动作服务→data→await 通知、服务失败、通知失败保留 data、缺省 host、归一平台 active id 与错误传播。
- [x] Skills 模块独立测试覆盖 7 动作、ZIP 先文件后平台、两级取消/空数组无安装、正常安装与选择器/服务异常；无需真实 VS Code、网络或用户文件。
- [x] 面板实际使用完整生产 registry，24 自有键与 `CONFIG_ACTIONS` 完全一致，类型层穷尽且动作消息为对应 `Extract`，实例级复用而非每请求重建。
- [x] 未知动作与 `toString`、`constructor`、`__proto__` 等原型继承键不执行；错误应答沿用原未知请求契约，非字符串 action 不强制转换。
- [x] 用生产 registry 与 `CONFIG_ACTIONS` 对照替换 case 正则，保留 bridge/协议一致性断言与现有行为测试。
- [x] 集成回归覆盖原 requestId/响应结构/data/异常详情、apply 专用提示、通知等待、导出清理与回退/UTF-8/日志、CLI enabled 请求时读取与 panel 缺失。
- [x] 最终串行完整 build、两个领域模块测试、配置页相关回归与模型导入回归通过；失败按测试规则分类处理并记录。
- [x] 最终接线后复核架构与 ontology 实际来源路径，必要时更新；完成全部验收后才标记 completed 并归档。

## 影响面

- 代码目录：仅中央路由、面板和对应测试；不修改已验收领域模块。
- 文档目录：`.ch/docs/design-docs/config-center-request-commands.md`、`ARCHITECTURE.md`、本计划及 `.ch/docs/ontology/domains/cli-plugin-runtime.json` 的 source_refs。
- 配置与脚本：不修改依赖、构建配置、发布脚本、用户配置或存储格式。
- 外部报告：第 4 轮仅更新指定 `round-4-config-command-integration.md`，不修改第 3 轮报告。

## 风险与缓解

- 通知未 await、提前通知或 catch 删除 data：逐项测试六种写动作，保留统一异常边界；不将写成功与通知成功混淆。
- getCurrent 误从文本推断激活身份：先读服务，后调用归一平台 host，缺省 `null`，不缓存身份。
- ZIP 抽取改变取消/参数或平台顺序：交互端口只回传路径与平台数组，宿主保留原 UI 文案、筛选、顺序。
- registry 漏键或继承键可执行：编译期映射穷尽检查 + 生产自有键对照 + 运行时异常键回归三重约束。
- 原结构测试误报：只在面板接线阶段迁移 case 断言，不能现在删掉现有护栏或仅改为另一份手写清单。
- 并行模块与面板契约漂移：集成前检查最新文件，按既定导出/端口局部协调；同符号竞争交回主模型，保留他人修改。
- 回滚：仅撤回相关接线、抽取与测试迁移，恢复原 switch；无数据迁移，不回滚用户文件或其它任务变更。

## 验证计划

### 第 3 轮文档验证（历史记录，非接线验证）

- ontology status/关键词查询与 `plugin.config_profile` 的 21 个 `source_refs` 路径核对；相关两个锚点检查。
- `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/.agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 16 concepts / 15 relations / 108 rules / 2 workflows。
- `node scripts/check_trailing_whitespace.js .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：通过，退出码 0，无尾随空白。
- 使用本地 `markdown-it` 的 Node stdin 只读校验：通过两文档的单一 H1、标题层级、换行与表格检查；2 个相对链接及 27 处现有来源路径有效，12 + 7 + 5 表格与 24 个 `CONFIG_ACTIONS` 无重复且集合相等；计划保持进行中、集成门槛未勾选。拟建模块按设计态排除，不冒充已存在来源。
- `git -C /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli diff --check -- .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：退出码 0；两文件是新增未跟踪文档，实际内容由上述空白与 Markdown 检查覆盖。

### 第 4 轮实际代码验收（2026-11-07，按以下顺序串行运行）

1. `npm run build`：退出码 0，完整 clean + TypeScript 编译通过；日志 `/tmp/sinitek-command-integration.kJfNDh/build.log`。
2. `node --test dist/test/config/configRequestRouter.test.js dist/test/config/configProfileRequestHandlers.test.js dist/test/config/configSkillRequestHandlers.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/modelimport.test.js dist/test/config/modelimportplatformstrategies.test.js`：退出码 0，213/213 通过，0 fail/skip/cancel；日志 `/tmp/sinitek-command-integration.kJfNDh/related-tests.log`。
3. `npm run test:page`：在前述测试完成后运行，入口先再次 build；退出码 0，433/433 通过，0 fail/skip/cancel；日志 `/tmp/sinitek-command-integration.kJfNDh/page-tests.log`。
4. 运行过程中没有构建与读取 dist 的测试并行，没有任何测试失败或降低阈值。临时日志仅作本机本轮证据，不能作为长期源码事实来源。

### 未运行项与理由

- 未运行 `test:page-coverage`、`test:core-coverage` 或全量 test:unit：本次定向领域/面板/模型导入回归及完整 test:page 已覆盖风险范围；没有声称达到严格 100% 覆盖率，未修改任何覆盖率门禁。
- 未运行浏览器 smoke、真实 CLI 或真实用户配置操作：未改 UI/浏览器资产或 CLI 服务，导出使用内存 IO stub 与系统临时目录；面板通过现有 VS Code mock 验证。
- 未运行发布脚本、未提交或建分支。

### 第 4 轮类型与文档校验

- `node /tmp/sinitek-command-integration.kJfNDh/type-probe.cjs`：退出码 0。通过 TypeScript Compiler API 只读虚拟源码验证，合法 save 请求可编译，缺 getList 的表必须产生 TS2741，save 接收 getList 请求必须产生 TS2322；未修改协议、未落盘虚拟源文件、未 emit。日志 `type-probe.log`。
- `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/.agents/skills/ontology/scripts/search_ontology.py --validate`：退出码 0，2 domains / 16 concepts / 15 relations / 108 rules / 2 workflows，新增五处实际 source_refs 不改变语义。日志 `ontology.log`。
- `node /tmp/sinitek-command-integration.kJfNDh/check-docs.cjs .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md`：归档前退出码 0；两文档 H1/标题层级/末尾换行、2 个相对链接、24 个无重复动作与 CONFIG_ACTIONS 一致、26 个配置档案 source_refs 及锚点全部有效。日志 `docs.log`。归档后以 completed 路径再次校验链接。
- `node scripts/check_trailing_whitespace.js src/webview/configPanel.ts src/webview/configRequestRouter.ts src/test/config/configRequestRouter.test.ts src/test/config/cliPageConfigCoverage.test.ts ARCHITECTURE.md .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/active/2026-11-07-config-request-command-routing.md .ch/docs/ontology/domains/cli-plugin-runtime.json`：退出码 0。
- `git -C /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli diff --check -- <上述改动路径>`：退出码 0；新增未跟踪文件还由实际编译/测试/空白脚本检查，不以 diff --check 替代内容验证。
- 归档后实际运行 `node /tmp/sinitek-command-integration.kJfNDh/check-docs.cjs .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md`：退出码 0，2 个相对链接、24 个动作和 26 个 source_refs 再次通过；日志 `docs-archived.log`。以 completed 路径再次执行上述空白检查和 diff --check，均为 0；设计/架构/ontology 中已无指向旧 active 计划的引用。

## 测试与清单同步

- 单元测试新增/更新：router 新增全 24 动作路由、等待/并发隔离、同步/异步错误、未知/非字符串/原型键测试；面板新增六写动作通知等待和失败保留 data、apply 专用提示、服务拒绝、动态设置读取、三模型导入入口、ZIP 全阶段取消/顺序、导出分支与 panel 缺失回归。原桥接/API/主题/行为断言均保留。
- 本机基线（非本次执行）：主模型在干净工作树运行 `npm run build` 成功，`node --test dist/test/config/cliPageConfigCoverage.test.js` 为 39/39 通过。本次只读取 `/tmp/sinitek-config-review-baseline.r0ziZL/build.log` 与 `/tmp/sinitek-config-review-baseline.r0ziZL/config-tests.log` 核对；没有重跑。临时日志仅为本机历史证据，不作为长期事实来源或新增模块/集成通过的证据。
- 单元自测结果：本轮接线后实际完整 build、213 个相关测试和 433 个页面测试均通过，不用历史基线替代。
- 失败处理记录：第 4 轮构建与测试首轮通过，无失败需要分流，无无关修复。
- 功能清单：`FEATURE_INVENTORY.md` 无需改动，本次是内部行为保持重构，不改变用户功能、权限、流程或承诺。
- 相关文档同步：更新设计为实际生产依赖与新增动作流程，ARCHITECTURE 增加导航；ontology 仅为 `plugin.config_profile` 增加五个实际来源，不改业务概念、关系、规则或状态。不制造热区记忆或自动摘要。

## 任务列表

- [x] 恢复配置档案语义，核对现有源码、事实来源与基线日志。
- [x] 写明已确定的两模块接口、24 键组成与行为保持契约。
- [x] 领域模块独立交付及测试，由对应任务确认实际路径和结果，本轮再次运行。
- [x] 完成面板接线、局部 typed router 和生产 registry 测试迁移。
- [x] 串行执行构建与回归，核对架构/ontology 后收口。

## 决策记录

- 2026-11-07：沿用主模型已选方案，局部 Command 表 + 显式注入；不是新的候选方案评选，本次不需要额外结构化决策或决策模型调用。
- 2026-11-07：profiles 的两个 host 回调可选，Skills 的两个 picker 必需；使用既有类型的窄 Pick，无运行时配置服务/VS Code 依赖，不复制业务校验。
- 2026-11-07：保持 requestId、返回 data、服务参数、异常详情和六种写动作通知时序；导出和 apply 专用提示留在宿主边界。
- 2026-11-07（第 3 轮）：仅完成设计与计划，领域模块并行交付；未提前宣称集成完成或归档。
- 2026-11-07（第 4 轮）：复用已验收的两领域模块，由同一 attempt 完成中央生产表与面板接线；无领域兼容修改、无新协议或依赖。字符串检查和自有键保护集中在分发边界。

## 当前结论

领域模块、24 键生产表和面板已接线，接线后完整构建、213 个相关测试及 433 个页面测试通过；类型负向探针、文档及 ontology 校验通过。全部验收项已完成，计划归档到 completed/2026-11，设计链接同步更新。仅更新本执行计划和指定 attempt 报告，不修改 Loop 调度或任务状态；主任务可基于实际源码和日志复核。
