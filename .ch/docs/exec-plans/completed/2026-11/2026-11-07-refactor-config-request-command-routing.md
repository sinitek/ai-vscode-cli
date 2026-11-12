# 配置中心请求命令路由重构执行计划

- 日期：2026-11-07
- 状态：completed（领域与面板接线、构建/回归、文档及 ontology 校验全部完成）
- 类型：refactor
- 负责人：Loop+ 协作；第 3 轮交付领域模块/设计，第 4 轮单一 coding attempt 负责中央接线及收口
- handoff_to：主任务最终复核；当前无接口竞争或待确认问题
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md`

## 目标与范围

行为保持的24动作静态registry、typed router与配置面板接线。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- [2026-11-07-docs-config-request-command-routing.md](2026-11-07-docs-config-request-command-routing.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 行为保持的24动作静态registry、typed router与配置面板接线；原可观察契约、非目标和限制以以下分配的原文为准。
- 原第3轮仅设计、第4轮才完成接线；保留扩展原状态、39/39复用基线、213与433历史结果及类型负向探针。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文或关联 docs 计划；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed（领域与面板接线、构建/回归、文档及 ontology 校验全部完成）。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景

`src/webview/configPanel.ts` 的 `handleRequest` 混合 24 动作分发、配置读写、Skills 选择、导出 IO、模型导入和统一异常响应。`src/test/config/cliPageConfigCoverage.test.ts` 对 switch case 文本的断言限制了行为保持拆分。既有 CLI 参数、模型选择、配置运行时和模型导入策略不需要重做；暂不扩大到风险更高的 `src/extension.ts` 跨域重构。

### 目标

以局部静态 Command 表和显式注入隔离配置/Skills 请求处理，保持全部可观察行为。第3轮建立两张独立领域表契约，第4轮完成生产registry、typed router和面板接线；测试与文档收口由关联计划承接，不改协议或服务规则。

### 范围

- 已验收且本轮未修改：`src/webview/configRequestHandlers/profiles.ts` 的 12 个处理器与 `src/webview/configRequestHandlers/skills.ts` 的 7 个处理器及各自独立测试。
- 面板将两张表与导出、CLI enabled、三个模型导入动作合成 24 键实例 registry；局部 typed router 提供穷尽类型、自有键和字符串保护；结构测试检查真实生产表而非 switch 文本。
- 接口、服务参数、每项 data、通知顺序与错误契约统一以设计文档为准，不另造不同端口；Skills 交互仅 `pickLocalSkillZip` 与 `pickSkillPlatforms`，profiles host 仅可选 `onConfigChanged` 与 `getActiveConfigId`。

### 非目标

- 不创建通用命令框架、DI 容器或新协议；不每次请求重建表，不新增重复 IO。
- 不改配置服务、持久化、业务校验、网络或路径安全策略。
- 不改 HTML/CSS/主题/文案/交互；构建与测试按验证记录串行执行，不运行发布脚本。
- 不操作调度状态、active ids、任务记录、Loop+ snapshot、兄弟报告或代码；不写热区记忆、`ROLLING_SUMMARY.md`，全部验收后才归档。

### 验收标准

- [x] 面板实际使用完整生产 registry，24 自有键与 `CONFIG_ACTIONS` 完全一致，类型层穷尽且动作消息为对应 `Extract`，实例级复用而非每请求重建。
- [x] 未知动作与 `toString`、`constructor`、`__proto__` 等原型继承键不执行；错误应答沿用原未知请求契约，非字符串 action 不强制转换。

### 影响面

- 代码目录：仅中央路由和面板；不修改已验收领域模块。对应测试路径与断言开发见已移除 test 类型计划的历史审计摘要[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md）。
- 配置与脚本：不修改依赖、构建配置、发布脚本、用户配置或存储格式。

### 风险与缓解

- 通知未 await、提前通知或 catch 删除 data：逐项测试六种写动作，保留统一异常边界；不将写成功与通知成功混淆。
- getCurrent 误从文本推断激活身份：先读服务，后调用归一平台 host，缺省 `null`，不缓存身份。
- ZIP 抽取改变取消/参数或平台顺序：交互端口只回传路径与平台数组，宿主保留原 UI 文案、筛选、顺序。
- registry 漏键或继承键可执行：编译期映射穷尽检查 + 生产自有键对照 + 运行时异常键回归三重约束。
- 并行模块与面板契约漂移：集成前检查最新文件，按既定导出/端口局部协调；同符号竞争交回主模型，保留他人修改。
- 回滚：仅撤回相关接线、抽取与测试迁移，恢复原 switch；无数据迁移，不回滚用户文件或其它任务变更。

### 第 4 轮实际代码验收（2026-11-07，按以下顺序串行运行）

3. `npm run test:page`：在前述测试完成后运行，入口先再次 build；退出码 0，433/433 通过，0 fail/skip/cancel；日志 `/tmp/sinitek-command-integration.kJfNDh/page-tests.log`。
4. 运行过程中没有构建与读取 dist 的测试并行，没有任何测试失败或降低阈值。临时日志仅作本机本轮证据，不能作为长期源码事实来源。

### 未运行项与理由

- 未运行 `test:page-coverage`、`test:core-coverage` 或全量 test:unit：本次定向领域/面板/模型导入回归及完整 test:page 已覆盖风险范围；没有声称达到严格 100% 覆盖率，未修改任何覆盖率门禁。
- 未运行浏览器 smoke、真实 CLI 或真实用户配置操作：未改 UI/浏览器资产或 CLI 服务，导出使用内存 IO stub 与系统临时目录；面板通过现有 VS Code mock 验证。
- 未运行发布脚本、未提交或建分支。

### 第 4 轮类型与文档校验

- `node /tmp/sinitek-command-integration.kJfNDh/type-probe.cjs`：退出码 0。通过 TypeScript Compiler API 只读虚拟源码验证，合法 save 请求可编译，缺 getList 的表必须产生 TS2741，save 接收 getList 请求必须产生 TS2322；未修改协议、未落盘虚拟源文件、未 emit。日志 `type-probe.log`。

### 任务列表

- [x] 恢复配置档案语义，核对现有源码、事实来源与基线日志。

### 决策记录

- 2026-11-07：沿用主模型已选方案，局部 Command 表 + 显式注入；不是新的候选方案评选，本次不需要额外结构化决策或决策模型调用。
- 2026-11-07：profiles 的两个 host 回调可选，Skills 的两个 picker 必需；使用既有类型的窄 Pick，无运行时配置服务/VS Code 依赖，不复制业务校验。
- 2026-11-07：保持 requestId、返回 data、服务参数、异常详情和六种写动作通知时序；导出和 apply 专用提示留在宿主边界。
- 2026-11-07（第 4 轮）：复用已验收的两领域模块，由同一 attempt 完成中央生产表与面板接线；无领域兼容修改、无新协议或依赖。字符串检查和自有键保护集中在分发边界。

### 当前结论

领域模块、24 键生产表和面板已接线，接线后完整构建、213 个相关测试及 433 个页面测试通过；类型负向探针、文档及 ontology 校验通过。全部验收项已完成，计划归档到 completed/2026-11，设计链接同步更新。仅更新本执行计划和指定 attempt 报告，不修改 Loop 调度或任务状态；主任务可基于实际源码和日志复核。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。原第3轮仅设计、第4轮才完成接线；保留扩展原状态、39/39复用基线、213与433历史结果及类型负向探针。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
