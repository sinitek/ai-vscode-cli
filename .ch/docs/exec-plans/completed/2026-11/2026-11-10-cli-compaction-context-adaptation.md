# CLI 原生压缩与上下文用量适配

- 日期：2026-11-10
- 状态：completed
- 完成日期：2026-11-10
- 负责人：Loop+ 四个交付边界协作
- owner：各实现边界独立交付；主审已完成 Kimi 修复后的串行构建与相关复验，文档边界归档仓库实施计划；宿主父任务最终状态仍由主模型验收决定

## 背景与目标

依据 `../../../references/cli-context-compaction-audit.md` 的隔离 ACP 实测，Kimi 2.5.2 支持经 `session/prompt` 发送 `/compact`，但没有 `session/compact` RPC。把已有原生能力接入插件，同时补齐 CLI 已提供的上下文用量和窗口真值。

## 四个交付边界与验收标准

- [x] Kimi 后台修复后复验：收尾用量核对真实标签、当前 CLI/UI 会话、持久运行代际、原生映射及 manager 中的 runner 身份；同标签换绑或新运行接管拒绝旧用量，另一标签开始运行仍允许原标签合法迟到用量。隔离压缩保留显式 tabId，新增反馈使用中文；修复定向169项通过，主审当前产物冷热压缩回放通过。同会话、当前操作真实完成才成功，失败隔离、冷恢复不新建、配置凭据隔离与自动压缩条件不变。
- [x] Claude 普通提示用量链路：最近主请求口径及精确响应模型窗口已验收，69项和两种本机 CLI/SDK 模拟协议回放通过；不是付费模型计数验收。
- [x] OpenCode 普通提示用量链路：最新主步骤口径、冻结模型元数据及宿主接线已验收，59项及真实 models --verbose 探针通过；真实 run 未产出步骤，不算端到端成功。
- [x] Webview 既有入口与用量呈现：专项183项通过，12张 Chromium 生成页面/模拟 VS Code 桥截图；不代表真实 Extension Development Host 点击。
- [x] Kimi 修复后的仓库验收：Node v24.22.2 / npm11.19.1 标准构建 exit 0，当前产物两组相关测试448项和61项，共509通过、0失败、0跳过；ontology、引用及差异检查通过。未验证真实环境边界明确保留，不将仓库计划归档等同宿主父任务状态变更。

## 范围与非目标

范围为 runner、压缩策略与扩展接线、回归测试及资料同步。不修改 Loop 调度状态、任务记录、active ids 或通信主文件；不发布，不升级 SDK 或项目依赖；不用摘要换新会话冒充原生压缩。原实现边界不接管 Node 环境升级；本机 Node24 由独立任务交付，见 `../../../references/node24-local-runtime-upgrade.md`，本计划只登记其验证范围。

## 风险与缓解

- ACP 完成信号是官方文本而非带操作 ID 的结构化事件：要求同会话、操作已开始、RPC 正常结束以及真实完成信号；失败或取消后淘汰进程，避免迟到通知污染后续操作。
- 保留普通回合结束后的 usage_update；压缩文本不作为最终答案；停止后禁止策略继续写会话状态。
- 共享工作区保留并发改动；子任务禁止执行清理 dist 的 `npm run build`，定向编译到独立临时输出；标准构建由父任务串行执行。

## 验证计划

- Kimi runner / protocol / contextCompactionRunner / 文档契约定向测试。
- `tsc -p tsconfig.json --outDir <独立临时目录>`，再 `node --test <临时目录>/test/...`；不使用用户模型服务。
- ontology JSON 验证、修改文件 whitespace 检查。常规 build 和 Extension Development Host 点击由父任务串行验收。

## 任务与当前结论

- [x] 读取审计、execution-plan / ontology / CodeGraph 规则及当前接线。
- [x] Kimi 初版实现与历史定向验证（不等于当前最终验收）。
- [x] Claude / OpenCode 普通提示与 Webview 局部证据由父任务核验。
- [x] 公共功能条目、CLI 契约、参考导航及 ontology 来源登记。
- [x] Kimi 收尾身份防护及中文提示修复后的主审复验、公共状态同步与仓库实施计划归档。

仓库实施计划已完成并归档；此前481项是历史阶段证据，当前主审相关回归为509项。这不是全部仓库测试或真实付费模型端到端验收，也不修改宿主父任务状态。收尾任务不改写 central runner。

## 最终主审复验与能力边界（2026-11-10）

- 证据目录：`/tmp/loopplus-final-review.ENB7ol`。`runtime.log` 确认 Node v24.22.2 / npm11.19.1；主审 `npm run build` exit 0，见 `build.log`。构建仍有既有 npm 配置警告（sass_binary_site、always-auth），不称无警告。
- 当前构建产物 `related-tests.log` 为448通过，`additional-tests.log` 为61通过，合计509通过、0失败、0跳过。Kimi 修复独立定向169项通过；新代际和换绑拒绝旧用量、跨标签合法迟到用量及中文提示均已纳入复验。
- 当前产物实际运行 `/tmp/kimi-native-compaction-live.cjs`，`kimi-live.log` 确认真实 Kimi2.5.2 热压缩和冷恢复压缩成功且同会话。三个请求均到隔离 loopback 模型 offline-test，实际 usage 为2205/32768，未调用用户付费模型。
- `ontology-validate.log`、`ontology-tests.log`、`doc-reference-check.log`、`git-diff-check.log` 分别记录 validate、9项 Python 单测、前轮52处精确大小写引用及差异检查通过。前轮引用检查日志的“仍待 Kimi/最终复验”是当时文档断言，现由本节更新，并不篡改原日志。
- Claude 两种本机模拟协议回放不是付费模型计数验收；OpenCode models 元数据探针通过，但两次真实 run 停顿且无真实步骤，不称真实回合端到端成功。Chromium 生成页面与模拟 VS Code 桥不是实际 Extension Development Host 点击。Windows 实跑、真实模型摘要质量和 token 降幅均未验证。
- OpenCode 当前能力边界：普通主回合用量已接通；摘要生成步骤的账单不等于压缩后占用，没有可信新测量时等待下一主回合是既定契约。即时刷新未实现；后续增强须先取得可归属压缩后主会话的可靠新测量，不能伪造0、复用旧步骤或推测接线。当前证据未显示 CLI 已提供被遗漏的可靠压缩后测量。
- Node 仅新登录 shell 默认切换，旧进程与 VS Code 内嵌 Node 不即时改变；十个全局工具精确版本保留。无私有备份内容进入公共文档。
- 文档/ontology 已承接可复用契约，历史过程留在本归档；按 MEMORY 规则无需再扩写热区或新增重复记忆。真实环境验证及压缩后可信测量属于明确后续增强/验收条件，不包装为本轮已覆盖。

## 收尾文档验证与清单同步（2026-11-10）

- 影响面：本轮仅归档本计划，更新公共功能清单、CLI/独立参考、用户 Kimi 指引、导航和 ontology；无实现、测试、依赖、环境或调度状态改动。Claude 独立参考因旧具体归档路径及过期状态做最小同步。
- 单元测试变化：文档收尾未新增或修改测试；复用现有 ontology 单测及当前 dist 文档契约产物，不执行构建、不清理共享 dist。
- 实际命令：`python3 .agents/skills/ontology/scripts/search_ontology.py --status-report`、关键词 search、Kimi 稳定 ID 查询及 `--validate` 均通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9项通过；`NODE_PATH="$PWD/node_modules" node --test dist/test/config/kimiCodeDocContract.test.js` 11项通过。
- 独立临时检查脚本 `/tmp/cli-context-closeout.sMWMaW/check_docs.py` 检查10份目标文档、43处精确大小写引用、Markdown 围栏/链接/功能表格、尾随空白、稳定 ID、历史失败保留和旧具体路径清零，结果通过；`git diff --check` 通过。本轮日志位于 `/tmp/cli-context-closeout.sMWMaW/`，不是再次运行509项或真实 CLI 的证据。
- 功能清单、能力分册与 ontology 当前状态已从“待修复/复验”更新为主审已复验；原审计不改，历史阶段失败留档。无新增可复用知识需要扩写 memory 热区，稳定契约继续以独立参考及 ontology 为准。

## 文档收尾状态一致性修订（2026-11-10）

- 修正 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 的“CLI 当前上下文与压缩入口”：删除仍将 Kimi 身份防护、中文提示修复及最终复验记为待完成的过期当前结论，改为已归档计划与已复验状态；481项及当时待修复/复验结论仅作为下方明确标记的历史阶段证据保留。
- 当前依据仍为主审 `/tmp/loopplus-final-review.ENB7ol` 的标准构建及448+61共509项相关回归，不冒称本次重跑，也不等同全仓测试、付费模型或真实宿主端到端验收。统一消息、用量口径、窗口来源、隔离行为及原始审计不变。
- 明确保留 OpenCode 无可信压缩后新测量时等待下一主回合、即时刷新未实现等限制。真实 run 探针未产出步骤、模拟桥非真实宿主点击、Windows及真实模型摘要质量未验证，Node仅新登录 shell 默认切换等既有边界不变。本次仅修订仓库文档，不改变宿主父任务状态。
- 新增临时只读语义断言提取目标章节至下一同级标题，修改前准确检出过期 Kimi/最终复验结论，修改后通过；3个过期状态拒绝样例、2个合法历史/限制样例通过，避免把 OpenCode 即时刷新未实现等真实限制误判为过期状态。
- 本次实际验证：ontology status/search/稳定ID查询与 validate 通过，既有本体单测9项、当前 dist 文档契约11项通过；两份修订文档的 Markdown/表格/空白、42处精确大小写引用、历史证据原样保留、Node边界及统一消息检查通过，`git diff --check` 通过。日志及只读脚本位于 `/tmp/cli-context-consistency.1zOYyF/`；未构建、未清理共享 dist、未重跑509项或真实 CLI。

## 主审批次历史证据与当时剩余边界（2026-11-10）

以下保留前轮原始阶段结论；其中“待修复/复验”是当时状态，当前结论以最终主审复验节为准。

- 父任务在 Node24 完成标准构建及当前481项相关测试（481通过、0失败）：`/tmp/loopplus-batch-review.gg8wAs/build.log`、`/tmp/loopplus-batch-review.gg8wAs/related-tests.log`。本轮公共文档检查不冒充重跑构建或全量验收。
- Claude 69项及两种已安装 CLI/SDK 的本机模拟协议回放通过；OpenCode 59项及真实 models --verbose 通过，但两次真实 run 在 bootstrap init 后停顿，未产生模型请求或真实步骤。口径及限制见 `../../../references/claude-context-usage.md`、`../../../references/opencode-context-usage.md`。
- Webview 专项183项及12张 Chromium 截图来自真实生成页面、模拟 VS Code 桥，不是真实 Extension Development Host 点击。广域7项失败已由主审在修改前快照复现为基线，不在本轮扩大修复。
- Kimi 隔离冷热压缩回放见 `/tmp/loopplus-batch-review.gg8wAs/kimi-live.log`：2.5.2、同会话、三个 loopback 请求、usage 2205/32768；不代表当前收尾身份防护与中文提示验收通过，两项问题交由独立修复任务，父任务需在合入后复验。
- Node 独立交付为新登录 shell 默认 v24.22.2 / npm11.19.1，十个全局工具精确版本保留；已启动进程及 VS Code 内嵌 Node 不会即时切换。这里只导航独立参考，不改环境或公开私有备份。
- 压缩摘要生成步骤账单不等于压缩后占用；无可信新测量则等下一主回合。压缩后立即刷新仍未完成，不用本轮公共登记替代后续可信测量接线。真实模型计数/摘要质量、Windows 实跑和真实宿主点击仍无本轮完成证据。

## 公共契约登记验证（2026-11-10，历史阶段证据）

- 本轮只编辑公共文档、独立参考和 ontology，不修改运行时、UI、依赖或系统环境。新增 Claude / OpenCode / 面板契约三条规则并保留已有稳定 ID（包括 Kimi 历史 ID）。
- ontology status/search（含新规则 ID 查询）可用，validate 通过，既有 Python 单元测试9项通过；现有 `dist/test/config/kimiCodeDocContract.test.js` 文档契约11项通过，没有重新构建或清理共享 dist。
- 8个目标文件的 Markdown 基础结构、新表格与尾随空白检查通过；52个新增或变更行中的仓库引用及新 source_refs 通过精确大小写存在性检查；共享仓库 `git diff --check` 通过。预扫描中的历史删除路径、原有大小写引用及图片语法示例不作为新增坏链修复。
- 本轮验证日志与检查脚本：`/tmp/cli-context-public-check.siCRz2/`。这是文档/登记的局部检查，不追加声称运行时全量验收或压缩后刷新完成；Kimi 修复和父任务最终复验仍待处理。

## Kimi 初版后台验证记录（2026-11-10，历史阶段证据）

以下保留原交付记录，不覆盖历史审计结论；其中局部通过及当时未验证项不替代上述当前主审结论。

- `node node_modules/typescript/bin/tsc -p tsconfig.json --outDir /tmp/kimi-compaction-check.7B2KXW --sourceMap false --pretty false`：最终 exit 0，不清理共享 dist。
- `NODE_PATH="$PWD/node_modules" node --test /tmp/kimi-compaction-check.7B2KXW/test/{interactive/kimiRunner,interactive/kimiAppServerProtocol,core/contextCompactionRunner,config/kimiCodeDocContract,interactive/manager,extensionHost/kimiInteractiveLaunch,extensionHost/kimiInteractiveHostWire,extensionHost/kimiCodeModelSelection,loop/loopMainAutoCompact}.test.js`：145 通过、0 失败。
- 隔离真实 CLI：`KIMI_TEST_OUTPUT=/tmp/kimi-compaction-check.7B2KXW KIMI_TEST_COMMAND="$(command -v kimi)" NODE_PATH="$PWD/node_modules" node /tmp/kimi-native-compaction-live.cjs`：2.5.2 热压缩、释放后冷恢复压缩均成功且 session id 不变；三个模型请求均为本机 loopback，未调用用户模型服务；实际收到 usage 2205 / 32768。
- ontology validate、改动文件 trailing-whitespace 与 canonical 仓库 `git diff --check` 通过。
- 中间失败分为旧“不支持压缩”文档断言、already-running 错误文案断言过窄，均更新为当前契约后通过。曾观察到其他并发任务编辑中的 PromptRunInput 夹具类型错误，未修改该文件，最终完整类型检查已通过。
- 未验证：真实模型摘要质量及 token 降幅、Windows 实跑、真实 VS Code 点击、Claude/OpenCode/Webview 边界集成；常规 build 由父任务串行执行。

## 关键接线与兼容性

- 不发送 `session/compact`；不通过摘要换新会话。没有命令广告时等待广告或超时，不把 `/compact` 当普通模型 prompt 试探支持。
- 完成依据是串行同会话的官方开始/完成文本及正常 RPC 结果，不是带操作 ID 的结构化事件。失败、停止、取消或超时后关闭 runner，避免迟到终态污染新操作；正常结束后仍接收真实 usage_update。
- 复用现有 manager 与 `prepareKimiInteractiveLaunch`，无需改写其实现；热 runner 在压缩前重新确认当前模型、模式和思考快照。
- ontology 的历史稳定 ID `plugin.rule.kimi_no_native_compaction` 保留，名称与规则正文已改为原生命令压缩；历史审计文件原样保留。
