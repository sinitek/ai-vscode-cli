# 产研部角色模型表单修复

- 日期：2026-11-17
- 类型：bugfix
- 状态：completed（产品修复及主干合并已主审接受；本次收尾文档的独立接受仍由主审决定，未发布）
- 负责人：UI、host、文档三个独立交付所有者；最终接受由主审负责
- 基线：`d136369fbd16f11eeb70b9d928b3efc7ccc5656f`
- 来源：父任务 `msg_1794877550276_7f2f5581bc0798` 的 `main-task.md` 原始目标与 2026-11-17 首轮共享实现约定
- 关联计划：[已归档原 feature](2026-11-13-feature-department-mode.md)，仅作为既有能力与证据来源，不重开、不重写。
- handoff_to：主审独立复核本次最终记录与归档引用；本文件不宣称父任务已由宿主完成。

## 背景与目标

用户指出总监模型/思考力度只能看摘要，组长和员工又多了独立档案选择。修复后的操作应与 Loop+ 子模型一致：总监可操作当前 CLI 的模型/力度，组长、员工各只操作 CLI、模型、力度；档案是宿主确认的内部绑定身份。总监界面所选必须与实际启动读取一致。

基线来源定位：`src/webview/viewContentHtml.ts` 的总监摘要、`src/webview/viewContentScript/departmentConfiguration.ts` 的主模型行隐藏及角色档案前置，宿主的候选 reader、保存和新根解析边界。本文不把定位结论或契约当作已完成实现。

## 范围与共享合同

现行合同详见[角色与模型配置](../../../design-docs/department-mode.md#角色与模型配置)，本计划只保留验收要点：

- 保留顶部当前 CLI/档案/模式栏。总监复用当前分组主模型/力度处理；组长、员工各仅 CLI/模型/力度三个控件；OpenCode variant/effort 共占力度槽，不能多出第四控件。
- 内部精确 `configId` 继续保存/冻结，消息形状不变。同 CLI 沿总监当前档案，跨 CLI 沿目标 CLI 已确认激活档案；面板已有 `activeConfigIdByCli`/共享 helper 传明确身份，宿主复核。缺失/加载中/失效拒绝，不选首档、不激活、不启动 CLI 取候选，不把旧显式异档案偏好当作隐藏选择或后台回写。
- 候选/保存/新根在相关 await 前后核对当前绑定、作用域和配置/选择修订；候选/保存核对 scope/requestId，ABA 不复用令牌。工作区、模式、CLI、总监档案或目标激活档案切换撤销旧候选及回执。偏好仍按工作区/总监档案隔离，保存成功才发布内存，同角色防重入，失败保留其它角色草稿。
- 通用精确档案 reader 继续读取调用者指定 `configId`，不全局改义。当前绑定约束位于表单/保存/新根入口；新根不就绪拒绝，已有任务补充、恢复、默认模型解析和原 Owner 合同沿冻结快照，旧根不热迁移。

## UI 设计边界

仅 UI 所有者实施：保留原纵向角色组、中文标签、28px 原生 select、6px 间距、已有主题变量与 wrap。总监标签后模型/力度，组长、员工标签后 CLI/模型/力度对齐；280px 下收缩折行、长模型名不溢出，title/aria 可读。default/hover/focus 沿原样式。加载只禁用依赖候选的模型/力度，保存期间禁用同角色；空配置/模型提供既有配置入口指引，错误就地中文与重试，显式默认与未选择区分。文档所有者不实现或重设计界面。

## 非目标

- 不重做 2026-11-13 feature、布局/色彩/交互体系、配置管理器、消息协议或调度器。
- 不移除内部 configId，不激活/迁移用户档案，不改变旧根、运行/恢复、Owner 及容量证明合同。
- 不为本次文档另建 docs/test 计划；不重跑旧全量、Owner 清理、混合冷恢复、平台/付费模型矩阵来替代本次新交互验证。
- 不提交共享 Git index、不切分支，不触碰调度状态、任务记录、其它 attempt 报告、私有备份或运行数据。

## 分工与影响面

| 所有者 | 主交付范围 | 本计划记录的当前状态 |
| --- | --- | --- |
| `department-form-webview-controls` | HTML/脚本/必要样式、主选择复用、自动身份、回执隔离、Webview 定向回归及浏览器场景 | 首轮 lp1 未接受；lp8 后继修复及浏览器交付已接受 |
| `department-form-host-binding` | 表单边界当前绑定、保存、新根、异步漂移回归；保留通用 reader | 首轮 lp2 未接受；lp5 revision/ABA 后继已接受 |
| `department-form-contract-records` | 本计划、设计、功能清单及最贴近 ontology 规则 | lp3 首轮存在链接大小写遗漏，lp4 定点修复已接受；本轮只记录收尾 |
| 主审 | 比对 UI 发出与 host 实际读取的同一选择、报告范围及最终组合 | lp5/lp7/lp8 已完成消息、存储与实际主选择组合审查；lp9 合并接受 |

文档路径：[设计](../../../design-docs/department-mode.md)、[功能清单](../../../product-specs/FEATURE_INVENTORY.md)、[运行时 ontology](../../../ontology/domains/cli-plugin-runtime.json)。仅维护现有 `plugin.rule.department_role_model_authority` 与 `plugin.rule.department_configuration_scope` 描述/来源并保留稳定 ID；现有跨域执行/恢复 workflow 未改变，无需修改。

## 验收标准（产品事实已接受）

- [x] 总监模型与力度均可操作；普通主选择和实际启动读取同一当前 CLI/configId/模型/力度或 OpenCode 主角色 variant。
- [x] 组长、员工各仅三控件，无档案下拉；OpenCode 只有一个力度槽；同 CLI/跨 CLI 绑定分别符合当前总监/目标已确认激活身份。
- [x] 空、加载中、非法/失效目标给出明确中文拒绝；无首档回退、自动激活、隐藏旧异档案或静默后台迁移。
- [x] 候选、保存、新根成功及并发漂移/ABA/迟到回执有定向证据；scope/requestId/修订隔离、保存成功才发布内存及工作区/总监档案隔离成立。
- [x] 原主题与顶部栏保持；生成真实 Webview 脚本的深浅主题/宽窄（含 280px）场景验证操作、禁用/加载/错误/空状态、title/aria 和无溢出。
- [x] 对应所有者提供本次标准 build、相关回归的命令、输入及结果，保留失败与未覆盖范围；主审独立核对跨边界一致性。
- [x] 已按 2026-11 迁移本计划并维护现行引用；旧接受/失败证据保持。归档后的限定校验记入本轮报告；本轮文档独立验收不预先勾选或宣称通过。

## 风险与缓解

| 风险 | 缓解及主审入口 |
| --- | --- |
| 隐藏旧独立档案后仍沿用异档案，或跨 CLI 身份过期 | 明确当前绑定、缺失拒绝；候选/保存/新根前后复核，报告成功与漂移用例 |
| 总监仅变显示或写错主/子模型、OpenCode variant | 对照实际主选择处理、宿主读取、启动冻结快照；主审贯通同一选择 |
| 全局修改精确 reader 破坏其它调用者 | 当前绑定门禁限定入口；检查通用 reader 及原调用者语义 |
| 保存失败/迟到结果污染内存或新工作区，旧根随界面变化 | 保留保存屏障、作用域/requestId/修订和原冻结合同 |
| 并行覆盖文档或共享 dist 导致伪证据 | 写前重读局部合并；产品所有者用唯一临时完整副本独占 dist；文档交付不构建 |
| 旧全量/冷链被误用为本次通过 | 历史证据留在[原收尾覆盖](../../../runbooks/department-acceptance-coverage.md)，本次验收只消费对应报告与主审 |

回退/缓解只限本次具体改动，由主审按实际差异评估；不以回退历史接受范围、重写根快照或丢弃其它所有者工作解决问题。

## 真实验收与证据入口

父任务 `msg_1794877550276_7f2f5581bc0798/main-task.md` 的 lp4、lp5、lp8、lp9 主审记录分别接受大小写修正、宿主修订防护、最终 UI、最新主干合并。报告目录为 `/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794877550276_7f2f5581bc0798/subtasks/`，实际来源文件如下（lp 是执行 ID，文件轮次不同，不据编号猜测来源）：

| 接受事件 | communicationFile | 已接受范围 |
| --- | --- | --- |
| lp4 | `round-4-department-form-doc-link-case-fix.md` | 功能清单链接准确为 `FEATURE_INVENTORY.md`，按 Git 记录逐字核对；先前 macOS 路径存在检查不覆盖大小写敏感系统 |
| lp5 | `round-6-department-form-host-revision-guards.md` | 总监及目标共享绑定的 ready/configId/revision、独立选择上下文、候选/保存/新根前后复核；成功保存才发布内存，精确 reader 与旧根冻结保持 |
| lp7 中有效结果、lp8 最终接受 | `round-7-department-form-ui-local-mode-and-smoke.md`、`round-8-department-form-ui-mode-selector-regression.md` | 同 panel 先应用模型状态，四原节点恢复；目标修订/迟到回执隔离；本地模式先撤销令牌再完整同步模型控件；有效生产候选、实际载荷经生产 validator 与隔离 WorkspaceSettings 持久化核对 |
| lp9 | `round-9-department-form-sync-master.md` | 实际分支同步最新 fetch 主干，保留原未提交内容/权限；冲突局部合并及一行 DOM-ready 夹具修复，最终组合证据见下文 |

主审已对照 UI 主选择消息、panel 投影、普通模型/力度及 OpenCode main 模型/variant 存储与 host getDirector/启动读取，确认同一选择；角色候选/保存的精确 configId 和存储映射也已组合审查。此结论结合代码审查、宿主定向回归和生成 Webview 桥接结果成立，不扩称真实 Extension Host/CLI 全链运行。

## 验证命令与复用结果

以下为真实报告的既有执行事实，本次文档交付不重跑。各物理副本独占 dist，未用共享原 dist 并发构建。

| 范围/输入 | 实际命令或动作 | 结果与边界 |
| --- | --- | --- |
| lp5 宿主，`/tmp/department-revision-check.voeXz4` | `npm run build`；`node --test dist/test/core/departmentconfiguration.test.js dist/test/session/sessionmessageactions.test.js dist/test/extensionHost/departmentconfigurationhost.test.js dist/test/extensionHost/departmentopencodedefaultmodel.test.js` | 最终 build exit 0；89/89、无失败/跳过。稳定成功、非 OpenCode ABA、同 ID 修订、缺失/未 ready、上下文变化、不落盘/不发布、保存重试、默认/variant/冻结根均在报告范围 |
| lp8 UI，`/tmp/department-form-round8-idkNCF` | `npm run build` | exit 0；之后仅修正 smoke 的 parent 断言，没有产品 TypeScript 变化 |
| lp8 DOM | `./node_modules/.bin/tsc src/test/webview/departmentconfigurationwebview.test.ts src/test/webview/departmentmodelselectors.test.ts --outDir /tmp/department-form-round8-idkNCF/test-dist --target es2022 --module commonjs --moduleResolution node --strict --skipLibCheck --esModuleInterop --types node`，随后 `node --test /tmp/department-form-round8-idkNCF/test-dist/test/webview/departmentconfigurationwebview.test.js /tmp/department-form-round8-idkNCF/test-dist/test/webview/departmentmodelselectors.test.js` | 11/11；DOM 节点身份/次序、同父焦点和无 panel 本地 ABA；实际 mode select handler 由浏览器覆盖 |
| lp8 最终浏览器 | `PLAYWRIGHT_MODULE=/tmp/department-role-form-playwright/node_modules/playwright DEPARTMENT_ROLE_FORM_DIST=/tmp/department-form-round8-idkNCF/dist DEPARTMENT_ROLE_FORM_EVIDENCE=/tmp/department-form-round8-final-evidence node /tmp/department-form-round8-idkNCF/scripts/department_role_model_form_smoke.cjs` | exit 0，`result.json` passed=true，严格 pageerror/console/requestfailed/HTTP>=400 为 []；1280 深色、280 浅色截图已由执行者及主审查看。含无 panel 的 Codex coding/Loop/Loop+、OpenCode coding/Loop、Claude coding/Loop+ 实际显隐/disabled，原有候选/保存、空/错误/重试、键盘焦点、长模型 title/无溢出、精确主选择及隔离存储路径均保留。生成生产 Webview + 消息桥 fixture，不是 EH/CLI |
| lp9 合并后，独立 worktree `department-form-sync-lp9-20261117` | 首次与夹具修复后各一次 `npm run build` | 两次 exit 0；最终为 `build-final.log`。第二次因测试源码新增 await 需要重编译，没有为文档 hash 重建 |
| lp9 首次七文件组合 | `node --test dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopSubtaskTabs.test.js dist/test/loop/loopGroupChatAcceptance.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/departmentGroupChatHost.test.js dist/test/loop/departmentGroupChatPanel.test.js` | 293 项：292 pass / 1 fail；群聊 host 夹具握手失败保留，不能记为首次全通过 |
| lp9 修复后最小追加 | `node --test dist/test/loop/departmentGroupChatHost.test.js` | 最终 37/37；其余未变六文件首轮 256 项继续有效。去重覆盖 293 项，**没有最终重新全跑 293 项** |
| lp9 ontology/链接 | `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`；ID 集合比较；按真实目录项检查改变的 Markdown 链接 | validate exit 0：2 domains / 27 concepts / 24 relations / 160 rules / 4 workflows；189 旧 concept/relation/rule ID 保留并新增主干 running-member 规则。83 条大小写敏感路径通过，不含远端 URL/标题 anchor。归档改变的来源路径须由本轮另做 validate |
| 既有文档工具 | lp3 ontology 工具 `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` | 9/9，沿未变工具实现复用，不因归档重跑。lp4 精确大小写及 lp9 未变链接结果按其范围复用 |

lp9 证据目录：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-form-sync-lp9-20261117-evidence`；含 `build-final.log`、`regression.log`、`regression-host-final.log`、`links-validation.json`、`final-verification.json`、`restored-filesystem-modes.json` 和原补丁/清单。浏览器最终产物为 `/tmp/department-form-round8-final-evidence/result.json`、`department-form-desktop-dark.png`、`department-form-280-light.png`；不复制私有运行数据入仓库。

## 失败与后继修复（保留真实时点）

- lp3：macOS exists 检查漏掉新增链接大小写，文档事件未接受；lp4 按 Git 字符串改为大写并接受。辅助 no-index diff 的 exit 1 无空白诊断，包装器错误要求 exit 0 已分类，不改写成成功命令。
- lp1/lp2 首轮：84/25 项和 build 各按其输入有效，但跨 CLI 非 OpenCode ABA 仅比较 ID、同 panel 状态顺序、非当前 CLI 节点恢复、保存/模式迟到令牌及缺浏览器证据导致主审未接受。lp5 增加 ready/configId/revision 与独立上下文，最终接受；UI 后继按下列实际缺口递进修复。
- lp5 早期：contextRevision 作用域编译错误为实现问题；临时副本扁平复制为验证环境问题；缺 ready fixture、旧错误文案及 ABA 同步点为夹具/时序问题。最终完整同步副本 build 和 89 项通过；中间挂起进程被中断不算成功。
- lp6：四节点/同 panel 修复、10 项及基本 smoke 有效；真实本地 change 在无 panel 窗口仍可接受旧回执，且桥 fixture 缺 configs/有效默认、规定交互边界不全，事件未接受。lp7 以本地 modeGeneration 先失效、有效候选、生产 validator/隔离存储补齐。lp7 首次窄屏误等前一 Claude 空列表为脚本错误，修正后 smoke 通过。
- lp7：11 项和扩充 smoke 的有效结果保持，但新 helper 分支丢失完整 syncModelSelectorByInteractiveMode，主审新增只读检查发现 Codex 部门→Loop 无 panel 时仍显示普通单模型、Loop 组禁用；不是把已通过场景改判失败。lp8 在即时失效之后恢复完整同步，并新增实际显隐/disabled 断言、修正就绪文案后接受。lp8 首次 smoke 误认原 parent 名称，改用原 parent 对象身份后最终通过，非产品失败。
- lp9：首次七文件 1 fail、单点 1/1 pass、整文件 36/37 fail 均保留；旧三模块源码 hook 和诊断 hook 各 37/37 但不是完整旧树，不能归类已证历史失败。根因为夹具只等 setImmediate，而 DOM-ready 由 setTimeout(0)握手；增加已有 `await h.domReady` 后重建、整文件 37/37。没有弱化权限断言或改产品逻辑。链接扫描首次误读 inline code 图片示例、恢复时权限被 Git 改为 0644 和全树权限校验过严均为检查/恢复假设问题，已按原 manifest 修正并通过最终核验。

## 最新主干合并与保全结论

lp9 已主审接受，实际分支 `codex/department-mainline-integration-round676-20261116`，最终 HEAD `1e1c0d3e18003c5e0578f87eb61e90286698718d`，父提交为基线 `d136369fbd16f11eeb70b9d928b3efc7ccc5656f` 和实际 fetch 主干 `61b00091dbd363a66640561b40f6f9822fca4c17`。祖先检查 exit 0，合并后分叉计数 66/0；不是用落后本地 master 替代主干。三处群聊冲突局部保留部门额度/授权/模态/主题并加入普通成员导航，主干 Loop+ FIFO 最多三项冻结与预算预检保持其原合同。

原 18 项未暂存、3 项未跟踪及精确权限恢复，stash/逐文件备份/独立 worktree 保留；最终 1,552 文件内容及执行位与物理构建副本匹配。表单产品字节及 lp8 三项 hash 保持，既有宿主/UI 接受与运行结果因此继续有效；本轮不重做合并、不清理这些保全物、不动共享 index，不推送或发布。

## 覆盖限制、记忆判断与本轮归档

本次未新增真实 VS Code/EH/CLI 全链、原生 Windows/Linux、付费模型、任意崩溃/外部 writer、Owner 清理或冷恢复证明。旧 5469 全量与旧冷链仍是原 feature 的限定证据，不能证明本次新操作。主干新增能力保留其独立计划，不重构 Loop/Loop+ 现有封装，也不借用户提问改变架构。

按 MEMORY 规则，现有子模型快照加载条目已覆盖空身份不回退；新增的本地模式即时失效后必须继续完整同步，以及夹具应等待真实 DOM-ready，沉淀为[最小避坑条目](../../../runbooks/PITFALLS.md#角色表单模式切换须先失效再完整同步)。不重复扩张其它 memory/runbook，不写自动任务 ROLLING_SUMMARY。

本轮只同步已接受事实并将原计划移至 `completed/2026-11/`，修复全部相对链接与现行引用。归档后必要 ontology validate、改变链接的大小写/结构与差异卫生结果由 `round-10-department-form-final-records.md` 记录；本轮文档独立接受仍留主审，不据计划 completed 宣称整个父任务已由宿主完成或已发布。

## 完成项与独立文档主审入口

- [x] 读取父任务首轮来源、UI 设计及共享绑定合同。
- [x] 核对现行规则与来源，明确替代独立档案选择要求，保留旧 feature 与失败历史。
- [x] ontology validate 与工具 9 项已通过；文档链接/卫生及独立报告由本次文档 attempt 留最终结果。
- [x] lp5/lp7/lp8 汇合原始报告并完成实际选择/绑定一致性及相关回归边界主审。
- [x] lp9 合并已接受；按真实结果将本计划标记 completed，按 2026-11 归档并维护引用。

当前结论：原产品修复及新增主干合并均已主审接受，本计划按实际约定范围完成并归档。剩余入口仅为本轮最终记录/路径维护的独立文档主审；不在本文件提前宣布该事件或父任务宿主状态完成。
