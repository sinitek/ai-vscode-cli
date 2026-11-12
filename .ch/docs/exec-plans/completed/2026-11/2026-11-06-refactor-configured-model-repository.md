# 配置模型 Repository 抽取

- 日期：2026-11-06
- 状态：completed
- 类型：refactor
- 负责人 / owner：Loop+ configured-model-repository attempt（fullstack）
- handoff_to：主审独立验收

## 背景与目标

`modelSettings.ts` 同时负责模型选择编排与五类配置读取、解析、缓存和异常降级。抽取小型、显式可注入 Repository，将配置数据访问与已有 CLI 选择策略分开，保持全部行为和公开端口不变。

## 范围与非目标

- 仓储拥有 Codex/Grok/DSH/Kimi Code/ZCode 五类实例级缓存、刷新及运行前新鲜读取。
- 宿主保留 loadedConfigStates、工作区/档案解析、角色、推理力度、Promise.all 顺序与 sync/wrap 编排；编辑路径统一更新仓储。
- 不改 Claude/OpenCode、UI、协议、真实配置、依赖、发布流程或 Loop+ 调度状态；不创建分支/提交。

## 验收标准

- [x] 构造无 I/O；最小读取/错误端口；新模块无 VS Code、宿主或配置服务运行时依赖。
- [x] undefined/null、CLI/档案/实例隔离、字段优先级、失败覆盖旧值、错误形状/事件和非等待日志保持。
- [x] DSH 激活档案在读取前确定；Grok/Kimi/ZCode 运行新鲜读取及缓存写入时点不变。
- [x] 行为单测覆盖仓储并核对宿主活委托、非当前 Grok/DSH 首次跨 CLI 路由预载。
- [x] 构建、相关 dist 单测及 ontology 校验通过；架构文档与运行时设计说明的写作验收由关联 docs 计划负责。

## 影响面与风险

- 代码：`src/config/configuredModelRepository.ts`、`src/extensionHost/modelSettings.ts`、相关配置/宿主单测。
- 独立新增仓储行为测试的历史开发及验证证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-configured-model-repository.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)；`ARCHITECTURE.md`、运行时设计说明及 ontology 来源引用的实际同步由 [docs 计划](2026-11-06-docs-configured-model-repository.md)承接。测试依赖仓储委托契约，文档依赖本计划确认的依赖方向。
- 风险：把缓存快照误接入策略、错误降级字段丢失、运行读取/缓存时序变化。使用活 getter、复用现有解析器与运行 resolve helper，测试成功/失败/时序。
- 回滚：撤销本次有限抽取及其文档/测试；不含持久化迁移。

## 验证计划

- `npm run build`
- `node --test dist/test/config/configuredModelRepository.test.js`
- 指定四组宿主 dist 测试及 Codex/Grok/DSH/Kimi/ZCode 解析器相关回归；按风险扩大宿主/路由验证。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 失败先区分实现、过期源码断言、夹具、历史或环境问题，记录数量和命令。

## 测试与清单同步

- 新增仓储行为测试的历史开发及测试/失败摘要见上述来源审计；完整证据未保留，本计划不认领测试开发。
- FEATURE_INVENTORY 无需变更：不新增或改变用户功能、行为、权限、流程、UI 或消息协议。
- 无 UI 变更，不启动浏览器；未启动 VS Code 或独立产物，不声称运行成功。
- 测试均用临时数据/注入端口，不连接真实 CLI 或外部服务。

## 任务列表

- [x] 按 execution-plan/ontology 规则核对 plugin.config_profile 和跨 CLI 子路由 source_refs；CodeGraph 查询后实际核对宿主/服务/测试引用。
- [x] 实现仓储和宿主委托。
- [x] 实现仓储与宿主委托；历史测试开发按来源审计追溯，文档交付由存活 docs 计划独立记录。
- [x] 记录实现验证并按月份归档。

## 决策记录

- 2026-11-06：采用主审已确认的 Repository 方向，不重复建设已有选择策略，不引入插件框架或通用继承。
- 2026-11-06：attempt 工作目录通过符号链接指向实际仓库；在真实仓库根执行 git/build，避免临时根将链接误报为删除。实际仓库初始 `git status --short` 为空。
- 2026-11-06：CodeGraph 两次查询仅返回符号/关系，未给出源码，且引用不完整；已用当前实际源码与测试核对，未依赖调用图作为完整证据。

## 当前结论

实现和相关验证完成，交主审独立验收；没有发布、提交或启动真实 CLI。宿主从 1879 行降至 1761 行，175 行仓储集中数据访问契约，未保留第二套 Map。

## 最终验证记录

- `npm run build`：通过；最后一次修改之后重新完整构建。
- `node --test dist/test/config/configuredModelRepository.test.js`：21/21 通过。
- `node --test dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/kimiCodeModelSelection.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js`：31/31 通过。
- `node --test dist/test/cli/codexConfigModel.test.js dist/test/cli/grokConfigModels.test.js dist/test/cli/grokmodelselection.test.js dist/test/cli/dshConfigModels.test.js dist/test/config/kimiCodeConfig.test.js dist/test/config/zcodeConfig.test.js`：59/59 通过。
- `node --test dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopModelRouting.test.js dist/test/extensionHost/opencoderolemodelruntime.test.js dist/test/loop/subtaskCliRoute.test.js dist/test/config/dshConfig.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/grokReasoningConfig.test.js`：95/95 通过。
- `node --test dist/test/webview/grokmodelselection.test.js dist/test/config/kimiCodeDocContract.test.js`：18/18 通过，既有源码契约断言未删除/弱化。
- 最后一次构建后将以上 20 个 dist 测试文件合并执行：224/224 通过，0 failed / cancelled / skipped。
- `node node_modules/c8/bin/c8.js --include=dist/config/configuredModelRepository.js --reporter=text --reports-dir=/tmp/configured-model-coverage-final node --test dist/test/config/configuredModelRepository.test.js`：21/21 通过，仓储 statements / branches / functions / lines 全部 100%。未新增依赖，也未修改仓库全局覆盖率门槛。
- 独立 Node 直接加载编译仓储并检查 require.cache：0 个配置服务/宿主/extension/Webview/vscode 运行时依赖；注入计数端口后构造读取次数为 0。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；domains=2、concepts=16、relations=15、rules=106、workflows=2。仅给 plugin.config_profile 和跨 CLI 子路由规则补充新事实来源，业务语义未改。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check` 和限定实际改动文件的 `node scripts/check_trailing_whitespace.js ...`：通过。

## 失败分类及修复

- 首次构建 14 条 TypeScript 诊断：抽取过程中尚未迁完的缓存消费者及其衍生类型错误，属于本次实现缺陷；已将推理力度、面板标签与错误状态统一改为仓储 getter。
- 第二次构建 1 条诊断：测试使用 ES2021 的 replaceAll，不符现有 ES2020 基线；已改 split/join，不改编译目标或依赖。
- 首次仓储测试执行后，shell 包装使用 zsh 只读变量 status，包装命令失败，但日志显示 19/19 测试通过；后续使用 result，最终 21/21 和完整 224/224 均成功退出。
- 无未解决测试失败；未将任何失败归为未经证实的历史问题。

## 边界核对与未验证项

- 安全：仓储只有三类只读能力和原错误端口，不新增路径处理、配置写入、环境凭据读取或配置内容/密钥日志；测试用合成数据与注入/mocked 端口。
- 性能：每次全量刷新仍为五次读取；DSH 有档案用一次档案读取，无档案用一次当前读取。Grok/Kimi/ZCode/DSH 的每个运行解析调用仍只有一次配置读取。无新增定时器、锁、网络或缓存层；保留原五张 Map 的生命周期，不引入淘汰规则。
- UI：无改动，不需浏览器。未启动 VS Code、Extension Development Host、独立打包产物或真实 CLI；未运行完整全仓单测和 Windows/Linux 原生环境验证，不能据此声称真实运行已验收。
- 保留原有重叠刷新/执行的缓存覆盖语义及未设置淘汰的 Map 生命周期；主审应按原契约复核，不在本次扩展并发或缓存策略。
