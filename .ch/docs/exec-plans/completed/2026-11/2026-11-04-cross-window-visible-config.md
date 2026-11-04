# 跨窗口配置同步与所见即执行

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

- 用户确认保留五秒跨 VS Code 窗口同步，并要求执行配置严格对应界面所见，禁止静默使用另一档案。
- 上轮只固定窗口内选择，破坏了从共享原生文件识别另一窗口选择的旧同步；执行前修复还可能抢回过时档案。
- 本轮以同一目标 CLI 配置目录为共享归属，显式切换成功才发布版本；心跳跟随该版本，任务提交校验界面版本。

## 范围与非目标

- 七种 CLI 的激活、当前档案保存/删除、五秒刷新、普通/并行/交互任务、历史/Loop/定时入口。
- 使用现有 Node 文件系统与原子写工具，不增加依赖；Linux/macOS/Windows 使用相同协调协议。
- 不修改用户真实配置、不发送供应商请求、不发布或提交；保留工作区原有修改。
- 无法约束旧版本窗口或外部进程直接写文件，不宣称跨任意第三方进程的原子性。

## 验收标准

- 窗口一显式切换后，窗口二五秒轮询只跟随已提交的共享选择，不回写旧配置；不同目标目录互不影响。
- 用户发送时携带所见档案与版本；五秒内或排队期间版本过期则刷新并拒绝启动，不静默采用新/旧档案。
- 显式切换与执行准备跨进程互斥；任务保留执行租约至结束，允许同版本并行任务，禁止期间切换/修改同一目标配置，避免延迟读文件的不确定性。
- 已保存档案、目标原生文件和版本在同一协调边界内校验；失败不启动，部分应用失败标记不可执行，不伪装旧档案仍有效。
- 崩溃进程遗留的协调锁/执行租约可保守恢复，活进程不因租约时间长而被抢占。
- 补充独立 Node 进程并发、失败阻断、版本过期和界面消息回归；构建、相关测试和文档校验通过。

## 影响面与风险

- 配置服务、共享协调器、配置页应用、心跳状态、面板消息/发送、统一执行入口与常驻 runner 身份。
- 风险：长任务阻止切换、旧工作区迁移、状态损坏、跨窗口同时切换、任务启动前异步空档、档案编辑与目标写入分离。
- 缓解：清晰中文拒绝提示、仅按已应用原生内容识别初始状态、损坏时失败阻断、读写在锁内协调、执行租约覆盖完整请求。

## 验证计划

- 最小范围：共享协调器、配置服务、配置心跳、发送协议与任务入口。
- 独立子进程使用临时目录和合成配置，验证互斥、同版本并行、版本过期拒绝及崩溃清理；不依赖真实 CLI。
- 扩展：配置/交互/Loop/会话/执行宿主相关组及必要 Webview 脚本测试；`npm run build`、ontology、空白检查。

## 任务列表

Tasklist:
- [completed] 梳理共享状态与界面执行参数
- [completed] 实现共享版本与跨进程协调
- [completed] 接入所见配置校验和执行租约
- [completed] 完成回归与行为文档同步

## 决策记录

- 执行时发现界面版本过期，一律拒绝本次启动并刷新；不替用户偷偷更换配置。
- 为覆盖所有 CLI 可能延迟读取配置的行为，租约保留到请求结束，而非仅到 spawn；同版本可以并行，不同配置切换在任务期间直接提示失败，避免长时间无反馈等待。
- 共享提交记录只保存档案 ID、随机版本、内容摘要和进程租约，不保存凭据明文。
- 协调目录按目标原生文件路径分组，而非档案存储根目录，覆盖自定义 ZCode 目标路径；旧版本窗口及不遵循协议的外部写入不在保证内。
- 配置卡片及 Kimi 模型管理移除保存后的第二次应用，由服务在同一锁内判断当前档案归属并应用。旧界面保存 A 不得抢回其他窗口已切换的 B。
- 移除 `applyConfigById` 的非激活模式，明确其只用于显式切换；执行准备统一经执行租约服务，不存在该接口名义不激活却更新共享选择的歧义。

## 当前结论

- 共享版本、五秒跟随、面板/排队/Loop+ 版本透传、统一执行校验及完整请求租约已实现并通过相关回归；所见版本过期直接拒绝，不静默采用不同档案。
- 已同步功能清单、能力说明、CLI 参考、Pitfalls 与 ontology；本轮事实沉淀进入这些文档和归档计划，不追加滚动摘要或重复扩写热区。

## 验证过程与失败分流

- 初次聚焦运行 330 项出现 54 项失败：绝大多数为统一入口新增依赖后 VM 夹具缺失，另有配置页 `profileId` 与 ZCode 保存失败时机的旧断言；修正夹具和过期断言，不恢复不安全的旧行为。
- 随后聚焦运行 369 项中 368 项通过：剩余为租约释放新增事件使“最后事件是 dispatch”的旧断言过期，已改为断言派发后释放。
- 首次扩大范围运行 2059 项：2057 通过、2 项失败，分别是 Grok 目录新增协调 sidecar 的旧目录断言、抽取 `dispatchPrompt` 的夹具未装载所见版本辅助函数；均已更新。
- 更新上述夹具后，聚焦 397 项全部通过。
- 补充排查发现保存后二次激活竞争，已移除前端和 Kimi 重复应用；对应 ZCode 真实临时文件夹具改为先显式激活，另补覆盖“切换 B 后旧 A 界面保存”不回切。Grok 保存测试的一次旧二次应用断言同步改为禁止二次应用。
- 新增同档案版本心跳及自定义 ZCode 目标隔离测试时，曾因夹具缺少 `platform` 导致构建失败，以及在安装 VS Code mock 前导入依赖而失败；已补齐类型字段和延迟 require。上述均为新增夹具问题，最终构建及完整相关组通过。

## 最终验收记录

- `npm run build`：通过，TypeScript 无错误。
- 最终聚焦命令（147 项全部通过）：

```bash
node --test dist/test/config/currentConfigOwnership.test.js dist/test/config/configService.test.js dist/test/config/sharedRuntimeConfig.test.js dist/test/config/grokConfigPage.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/extensionHost/promptSessionHealth.test.js
```

- 扩大相关范围（2062 项全部通过，失败/取消/跳过均为 0）：

```bash
node --test --test-concurrency=4 $(rg --files dist/test/config dist/test/interactive dist/test/loop dist/test/extensionHost dist/test/session | rg '\.test\.js$' | rg -v '(Live|liveBoundary|PluginLive|LiveBoundary)') dist/test/webview/clipagescriptruntimecoverage.test.js
```

- `git diff --check`、`npm run validate:whitespace`、`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- 本机证据：独立 Node IPC 子进程使用真实文件系统锁/合成原生文件，覆盖并发提交、同版本并行、运行期拒绝切换、过期版本拒绝、进程退出后的锁/租约恢复；配置服务覆盖当前档案编辑、摘要校验、只读租约期间不能修复、无租约时修复、不同 ZCode 目标独立。
- 本机 ZCode 保存链路通过配置面板 IPC 与临时原生文件，验证等待模型刷新、仅当前档案写原生文件、过期编辑界面不会激活旧档案、损坏原生配置时阻断。
- 日志为本机临时验收文件：`/tmp/cross-window-build-final.log`、`/tmp/cross-window-last-focused.log`、`/tmp/cross-window-broad-final.log`、`/tmp/cross-window-whitespace.log`、`/tmp/cross-window-ontology-tests.log`。

## 适用边界与部署

- 代码与文档交付，未提交、发布或打包；需使用新构建并重载所有相关 VS Code 窗口，旧窗口不参与协议。
- 不修改真实用户 CLI 配置、不调用真实供应商；没有声称完成真实 Extension Development Host 双窗口验收或 Windows/Linux 真机验证。
- 只协调遵循协议的扩展写入；外部工具、旧扩展和原生 CLI 自维护元数据不受约束。锁/状态损坏、极端恢复残留或 PID 重用时保守拒绝，可能需要关闭相关窗口后检查协调目录，不通过超时强抢来提高可用性。
- 本轮不新增热区事件条目或技能：可复用决策和失败原因已进入 CLI 参考、功能规格、Pitfalls、ontology 与本计划，避免重复沉淀。
