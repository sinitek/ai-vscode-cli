# Panel Diagnostics 职责拆分与兼容 Facade

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex（Loop+ 独立执行尝试）
- owner：round-1-refactor-panel-diagnostics-facade
- claimed_at：2026-11-05
- claim_ttl：本次执行
- handoff_to：主审

## 背景

`panelDiagnostics.ts` 混合错误/重试、Loop 消息策略、模型诊断和群聊协调四类职责，导致运行时辅助调用方依赖宿主面板实现。主审已选择 diagnostics_facade（decision-model confidence=0.95），本次不重新选型。索引有滞后，已先用 CodeGraph 定位，再核对磁盘源码。

## 目标

逐函数搬迁实现，让内部调用方直达所属模块，同时保持旧入口运行时导出身份、类型签名与全部行为。

## 范围

- 新建 `promptRetry.ts`、`loopTaskMessagePolicy.ts` 和 `extensionHost/loopGroupChatPanelCoordinator.ts`。
- `panelDiagnostics.ts` 保留模型管理诊断，显式命名转导出旧 API。
- 更新内部依赖、边界测试、架构及 ontology 实现证据位置。

## 非目标

不改重试算法、Loop/Loop+ 恢复规则、模型路由、依赖注入工厂、持久化和消息顺序；不改 Webview、用户文案、CLI/依赖版本；不启动真实 CLI、不发布、不提交、不建分支、不刷新全仓索引、不重建缺失历史设计文档、不修改调度状态。

## 验收标准

- [x] 旧入口与新模块的全部运行时导出为同一对象，类型兼容，无 `export *`、包装函数和反向依赖。
- [x] 原函数实现保持不变，新增测试覆盖独立加载、重试/trace、Loop 消息/session、协调器关键拒绝边界。
- [x] 串行构建及指定测试通过，全量单测已执行，失败按实际证据分类。
- [x] `git diff --check`、ontology 校验及 ontology Python 单测完成，计划归档；执行报告写入宿主指定的本次 attempt 文件。

## 影响面

- 代码目录：`src/` 相关运行时模块及 `src/test/`。
- 文档目录：`ARCHITECTURE.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、本计划。
- 配置与脚本：不修改。

## 风险与缓解

- 模块路径与循环依赖：独立加载测试、构建检查及内部 import 审查。
- 搬迁语义漂移：原始实现分段对比，保留旧入口测试，并补关键边界。
- 隔离工作区顶层是符号链接，当前目录 git 会误报删除：在实际仓库根目录执行 git/编辑/验证，不更改链接或基线文件。
- 测试不得污染用户任务：仅用既有 mock、内存夹具和系统临时目录，无真实长等待。

## 验证计划

- 改前证据（主审提供，非本次改后验收）：build 成功，panelDiagnostics/hiddenRetry/loopGroupChatCoordinator 共 30 项通过。
- 先 `npm run build`；完成后 `node --test` 执行新增测试以及 panelDiagnostics、hiddenRetry、loopGroupChatCoordinator、promptOneShotRuntime、promptInteractiveRuntime、promptParallelRuntime。
- 再 `node scripts/run_unit_tests.js`，保存结果并分类失败。
- `git diff --check`；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- 无 UI 外观/交互变更，不运行浏览器或 Extension Development Host；不运行真实 CLI。

## 测试与清单同步

- 单元测试新增/更新：新增 Facade 身份/独立加载 2 项、promptRetry 5 项、Loop 消息策略 6 项；保留原入口测试，并扩充协调器原配置恢复失败及缺失目标 Tab 的拒绝断言，不启动 CLI。
- 单元自测结果：最终 `npm run build` 成功；下列最小相关命令 87/87 通过；全量 `node scripts/run_unit_tests.js` 共 3046 项，3043 通过、0 失败、3 个真实 DSH 用例按原条件跳过（39.65 秒）。
- 失败处理记录：首轮 build 因新增测试使用 ES2022 `Object.hasOwn` 而失败，改用项目 ES2020 支持的 `Object.prototype.hasOwnProperty.call`，未更换依赖/编译配置。首轮相关测试 86/87，通过之外的 1 项是新增 trace 夹具遗漏既有 `appendMessageToStore` 注入的 `sequence: 0`；补充精确预期，不删除或放宽断言。最终构建/相关/全量均无失败，无需声称历史问题。
- 功能清单：`FEATURE_INVENTORY.md` 无需更新；本次仅实现位置与依赖边界变化，无用户可见行为、权限、流程或验收变化。
- 相关文档同步：架构导航和 ontology source_refs 随代码迁移，不改变业务规则含义。

## 任务列表

- [x] 约束、图定位、磁盘源码和 ontology 核对。
- [x] 原样搬迁与 Facade/内部依赖整理。
- [x] 兼容性及边界回归测试。
- [x] 文档、串行验证、归档及报告。

## 决策记录

- 2026-11-05：沿用主审已完成的 diagnostics_facade 决策；不新增类、容器或策略层。

## 当前结论

已完成。原模块 1628 行拆为 Facade/模型诊断 236 行、promptRetry 241 行、消息策略 230 行、群聊协调器 966 行（合计 1673 行；增加部分为显式导入/转导出，不把行数作为架构长期指标）。内部调用方仅诊断继续使用旧入口。

结构核对：使用 TypeScript AST 比较改前快照与四个模块，60 个顶层函数/类型/常量逐字一致，仅协调器的 i18n 类型相对路径变化；29 个运行时导出名称与改前编译产物完全一致，28 个迁移导出由测试逐项 strictEqual。ontology 仅 source_refs 变化，业务语义深比较一致。

### 实际验证命令与结果

1. `npm run build`：最终退出 0；与读取 dist 的测试严格串行。
2. `node --test dist/test/core/panelDiagnosticsFacade.test.js dist/test/core/promptRetry.test.js dist/test/loop/loopTaskMessagePolicy.test.js dist/test/core/panelDiagnostics.test.js dist/test/core/hiddenRetry.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js`：87/87，退出 0。
3. `node scripts/run_unit_tests.js`：3046 项，3043 通过、3 跳过、0 失败/取消，退出 0；跳过项为 DSH 真实 cwd/session 恢复、DSH 真实 Loop+ 恢复、DSH loopback 宿主联调；未开启真实验证开关。
4. `node /tmp/verify-panel-diagnostics-facade.cjs`：60 个声明原样搬迁、29 导出名称保持、ontology 业务语义保持，全部通过。
5. `git diff --check`：退出 0。
6. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、16 concepts、15 relations、105 rules、2 workflows、3 documents）。
7. `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9，通过。

### 审查与未验证事项

维护性：职责内聚，公开兼容面固定，原依赖注入工厂和回调结构保留；未引入继承、容器、新模式、包装或循环依赖。安全：预览允许根目录与路径校验原样保留，无新增运行时网络、进程、敏感日志和用户配置写入。性能：算法、重试序列和最多 500ms 的活动检查不变，无新增阻塞；未做性能基准，不宣称性能提升。UI：未修改 Webview HTML/CSS/DOM、布局、主题、文案或交互，因此未运行浏览器与 Extension Development Host；真实 CLI/实际调度未运行且不得以 mock 测试冒充真实验证。没有提交、建分支、发布或修改调度状态。

归档路径：`.ch/docs/exec-plans/completed/2026-11/2026-11-05-panel-diagnostics-facade.md`。
