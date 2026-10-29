# ZCode 任务回放事件修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

ZCode 执行任务时聊天正文、思考和工具气泡正常更新，但回放计数始终为 0。核对当前实现发现 ZCode runner 未提供回放事件回调，宿主策略也未发送现有 `rawStreamDelta` 事件。本次补齐当前回合事件到回放及调试日志的链路。

## 范围与非目标

- 范围：ZCode runner 事件输出、宿主回放转发、相关回归测试与事实文档。
- 非目标：不改其他 CLI 的回放策略、ZCode 权限策略、历史存档格式或用户现有未提交改动。

## 验收标准

- 正文、思考、工具和回合终态事件进入当前标签页回放，不再保持 0。
- 其他会话、回合结束后以及停止后的迟到事件不污染当前回放。
- 连续任务回调隔离，聊天气泡与原始事件内容保持原有语义。
- 宿主回放与调试日志消费相同事件，相关测试及 `npm run build` 通过。

## 影响面与风险

- 代码：`src/interactive/zcodeRunner.ts`、`src/extensionHost/interactiveTurnZcode.ts` 及对应测试。
- 文档：ZCode 使用说明、功能清单、相关 ontology 规则（按实际语义变化同步）。
- 风险：事件越过会话或回合边界；通过原有会话过滤、活动回合校验和回归测试约束。
- 回滚：仅撤销本计划对应补丁，保留工作区原有 staged/unstaged 改动。

## 验证计划

- 先新增 runner 与宿主回归用例，确认旧实现无法产生回放事件。
- 执行 `npm run build` 后运行 ZCode runner、协议、trace 与宿主策略最小相关测试。
- 检查本机 ZCode 可用性；如可行，执行无文件写入的最小真实协议验证。
- 更新 ontology 后执行结构校验及其 Python 单测。

## 测试与清单同步

- 单元测试：新增 runner 原生事件完整性、跨会话过滤、连续任务隔离、取消后事件拒收与失败终态回放断言；新增宿主回放／日志同源、过期执行过滤和异常传播前保留失败事件的用例。
- 红灯确认：仅补回调类型和回归测试时，`node --test --test-name-pattern='replay' dist/test/interactive/zcodeRunner.test.js dist/test/extensionHost/interactiveTurnZcode.test.js` 为 1 通过、5 失败，失败均为未收到回放事件，确认复现原始缺陷。
- 构建：`npm run build` 通过。
- 相关单测：`node --test dist/test/interactive/zcodeRunner.test.js dist/test/extensionHost/interactiveTurnZcode.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeTrace.test.js dist/test/config/zcodeConfig.test.js`：57/57 通过。
- Webview 回放链路：`node --test --test-name-pattern='run stream|raw stream|replay|回放' dist/test/webview/clipagescriptruntimecoverage.test.js`：7/7 通过。
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- 失败分类：新增 ontology 规则初次缺少必需 `applies_to`，属于本次文档结构缺陷；补齐后结构校验和全部 ontology 单测重新通过。无遗留测试失败。
- 功能清单：已在 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 增补 ZCode 当前任务事件回放及验收。
- 相关文档：`docs/zcode-guide.md` 新增任务回放契约和排障说明；ontology 增补 `plugin.rule.zcode_task_replay`。未改变架构边界，无需修改 `ARCHITECTURE.md`。
- 记忆维护：本任务执行细节保留于计划，不写入 `ROLLING_SUMMARY.md`。

## 本机真实验证

- 命令：`zcode --version`，输出 `0.17.0`。
- 命令：`node` stdin 脚本加载编译后的 `dist/test/vscodeMock` 和 `dist/interactive/zcodeRunner`，在临时空目录创建真实 ZCode 会话，通过 `runner.prompt()` 发送仅回复 `ZCODE_REPLAY_SMOKE_OK`、不调用工具且不读写文件的提示；设置 60 秒超时并在收尾释放 runner、删除本次临时目录。不读取或输出配置凭据。
- 关键输出：`passed=true`、`replayEvents=11`、`responseMatched=true`；事件为 `session.titleUpdated:1`、`turn.started:1`、`session.updated:4`、`model.streaming:4`、`turn.completed:1`。
- 结论：真实 CLI 的活动回合可产生非零回放事件，正文和成功终态均到达新回调；宿主转发及既有 Webview 回放计数路径由对应单元测试覆盖。
- 未覆盖：未启动真实 Extension Development Host，也未运行浏览器端到端测试；本次无 Webview 页面实现变更，使用现有 Webview 运行时测试验证事件消费与记录行为。

## 当前进展

- 已完成 bounded recall（focus：`zcode 执行任务 回放 replay 计数`，anchor 为空）、ontology 查询和 CodeGraph 定位；当前代码内容以直接读取为准。
- 已补齐 runner 的活动回合事件回调与宿主 `rawStreamDelta` 转发，保留原始协议结构，并同步写入已启用的调试日志。
- 已完成构建、64 项 Node 相关测试、9 项 ontology 测试和本机真实 CLI 验证；原有 staged/unstaged 改动保留，未创建提交或分支。
- 生效方式：更新插件并重新加载扩展宿主后执行新任务；旧版本未采集的历史事件无法补回。
