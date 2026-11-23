# 产研部冷启动中止与续接修复

- 日期：2026-11-22
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-22-bugfix-department-cold-display.md`（复用其只读冷启动投影；本计划补齐显式冷态中止与容量对账）
- 状态：completed
- 负责人：Codex

## 背景

产研部冷启动后，严格 `recoverRoot` 可能因没有可验证的组长聊天标签拒绝恢复。显式中止目前仍先写入总监 stopped 状态，但随后 `ensure(root)` 失败，导致组长 Loop+ 父调度未停止、员工 attempt 继续留在部门容量快照中，显式续接也被未确认清理门禁阻断。

## 目标

让 Loop+ 模式的产研部在冷宿主可基于可信持久任务身份执行显式中止，不要求恢复聊天标签；只有组长调度与所有占用 attempt 均确认停止后才归还容量并开放显式续接。普通恢复仍必须满足完整身份、标签和执行观察门禁。

## 范围

- 为无内存组织的 Loop+ 产研部增加只用于中止的持久快照核验和清理路径。
- 冷宿主显式停止 Loop+ 父任务时，将无本宿主执行句柄的遗留 running attempt 按现有丢失执行语义记录为 stopped，不合成成功结果。
- 清理完成后将部门成员代次与容量一致持久化；任何任务身份漂移、无效快照、取消失败或持久化失败均保留容量并拒绝续接。
- 增加隔离合成任务回归，覆盖冷启动、显式中止、重复中止、迟到结果、未知清理及中止后显式续接。
- 核对冷启动群聊投影是否始终依据当前宿主执行登记，而不误显示历史 running。

## 非目标

- 不恢复或重派任何实际用户任务，不编辑 `~/.sinitek_cli/` 下的任务、调度、通信或容量记录。
- 不放宽 `recoverRoot` 的标签/身份验证，不从缺少标签或历史状态推断 Owner 清理完成。
- 不自动续跑，不改变非 Loop+ / Owner 管理的产研部停止合同。
- 不触碰工作区已有的 Loop+ 协议重试未提交改动。

## 验收标准

- [x] 冷宿主停止使用经过根、工作区、模块、计划和 Loop+ 快照核验的任务 ID。
- [x] 所有受管 Loop+ 父任务显式停止且 active attempt 记录为 stopped 后，才清除对应部门容量。任何拒绝或失败保留占用。
- [x] 冷停止后等待用户显式续接，容量与停止回执确认后进入既有身份与会话恢复门禁。
- [x] 普通 `recoverRoot` 对缺标签、身份漂移、无效计划和跨 workspace 仍保持拒绝。
- [x] 冷启动群聊显示本宿主已中断，原持久状态由用户后续操作对账。

## 影响面

- 代码：`src/extensionHost/departmentruntimecomposition.ts`、`src/extensionHost/departmentorchestration.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`
- 测试：部门运行时组合、部门编排、Loop+ 运行时集成和群聊状态投影
- 文档：产研部功能清单、部门群聊交互契约、冷启动验证 runbook、相关 ontology 规则

## 风险与缓解

- 风险：按 task ID 中止可能误触身份变化后的任务，或把未清理的执行错误归还容量。
- 缓解：中止前后逐项重读可信根/组长/工作区/模块/计划与快照；Loop+ 父任务和 attempt 必须呈现 stopped 且无 running；写入失败、未知成员或残留 attempt 时保留容量；不调用普通恢复的 target 伪造路径。

## 验证计划

- 最小相关验证：部门冷中止与 Loop+ 无运行时中止回归；群聊冷启动投影回归。
- 单元自测命令：按 `.ch/docs/TESTING.md` 运行相关 `node --test` 测试文件。
- 扩展验证：`npm run test:unit`、Ontology 校验及测试、`npm run build`；复用有效的既有 Extension Host 冷启动证据，不对用户任务做实机中止或自动续跑。

## 测试与清单同步

- 已新增冷中止、会话晋升、显式续接和员工标签关闭相关回归。
- 已同步功能清单、Ontology 和运行手册。各阶段验证见本计划记录。

## 任务列表

- [x] 实现 Loop+ 冷态任务级停止及安全容量对账。
- [x] 补充冷启动、中止失败及中止后原组长续接回归。
- [x] 同步功能清单、runbook 和 Ontology，并通过结构校验。
- [x] 确认真实安装版 Extension Host 可续接原组长。
- [x] 修复全量回归发现的 Owner 测试夹具竞态及通知解析超时并通过回归。

## 决策记录

- 2026-11-22：冷态中止与完整恢复分离；停止可只用可信持久任务 ID，但不能据此推断 Owner 清理或自动恢复。

## 当前结论

确认的续接故障是：普通 `recoverRoot` 因 `unverified-leader-session-or-plan` 设置进程内失败栅栏；冷态中止即使已验证组长停止并成功保存空容量，也没有清除此特定栅栏。同一个扩展宿主随后的显式续接仍被拒绝。此前回归还在续接前销毁并重建宿主，因此漏掉同宿主路径；另因测试在组合创建后才替换依赖，测试实际没有触发预期核验拒绝。

现在分别跟踪恢复核验失败与其它失败：只有 Loop+ 冷态停止完成身份、调度和容量核对，并将停止快照及空容量写入后读回一致时，才清除恢复核验栅栏；持久化、额度、身份和总监暂停错误仍然封闭执行。普通恢复的组长会话门禁保持不变。合成回归在同一宿主中先复现恢复核验失败，再执行冷中止并显式继续；同时保留新的宿主重建、过期停止标记及失败清理边界测试。真实任务文件仅只读取证，没有修改。

冷态专项验证：`npm run build` 通过；`node --test dist/test/extensionHost/departmentruntimecomposition.test.js` 74 项全部通过。完整单测、Ontology 校验和全项目回归仍待执行。

## 2026-11-23 复核与修正

只读核对受影响的部门快照，确认根任务已 `stopped`，唯一模块仍持久化为 `running`，部门快照 `stopping=true`、组长 `paused`、容量为空，组长任务为 `stopped`。修复通过显式停止对账完成。

定向重试发现两个缺口：根/模块停止状态写入未确认时可能仍进入组长清理；总监取消 promise 被 `allSettled` 后未检查拒绝，可能已清空容量并报告停止成功。现在先验证总监取消及根/模块状态读回，再清理组长。任一失败都保留容量与停止栅栏。显式继续复用已核验的原组长 task/session，不为同一模块新建组长；冷恢复中的已完成组长仍核对唯一任务、模块、会话与完成快照，但不再要求旧聊天标签。

隔离回归构造实际 `root=stopped + module=running + runtime.stopping=true + leader=paused + empty capacity` 快照，并包含另一已完成且无旧标签的组长；覆盖根写入失败、总监取消失败、重试确认、显式恢复原组长/原 session、再次中止和不重复创建。定向命令 `npm run build && node --test --test-name-pattern='cold Loop\\+ stop' dist/test/extensionHost/departmentruntimecomposition.test.js`：3/3 通过。真实任务记录未改写。已安装 `~/.vscode/extensions/sinitek.sinitek-cli-tools-1.9.13` 未包含冷态停止实现；全量回归及当前工作区源码进入实际 VS Code Extension Host 的验证仍待完成。

本轮其余验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过，`git diff --check` 通过。相关六文件并行单测共 213 项通过、1 项失败；失败为 `continued leader owns preparation and coordination until its real stopped generation retires`，处于 Owner 原生代次清理路径，状态为 `blocked` 且保留组长容量。项目正式 `npm run test:unit` 的 build 阶段通过、全量 runner 退出码 1；输出至少还显示 `production Codex employee and two-round leader release original resources with complete original Owner receipts` 在资源释放断言 `1 !== 0` 失败。未将这些失败归因到冷 Loop+ 修复，也未修改 Owner 清理路径。由于正式 runner 输出量过大被终端截断，未记录全套失败总数。真实安装版验证未运行：已安装 1.9.13 的 `dist/extensionHost/departmentruntimecomposition.js` 没有本次新增的 `stopColdLoopPlusMembers`，而直接覆盖安装会把工作区其它未提交改动一并打包，故没有擅自改写用户扩展安装目录。

## 旧组长会话绑定修复

组长主会话首次晋升时，聊天标签和转录进入了原生会话，部门任务仍引用旧本地 ID。续接计算出了正确标签，但目标校验比对旧绑定后拒绝。现在会话晋升核对组长转录并同步更新部门仓储。旧记录在显式续接时必须同时通过最近组长主回合、原生转录、当前工作区、固化角色及空闲目标校验。仓储提交和读回通过后，续接重新读取原组长身份。目标占用冲突或读回失败时保持中止。

验证包括源码构建、179 项相关单测、Ontology 校验、隔离 VS Code 激活以及本机模拟模型服务上的公开群聊建任务、执行、验收和容量归还。定向回归覆盖旧绑定、目标占用、仓储写失败、重试续接、再次中止和避免重复建组长。旧任务的隔离副本使用部门仓储重绑并读回，原任务 ID、物理记录、调度快照和已完成子任务全部保留。

从已安装版对应基线单独构建 macOS ARM64 修复包。包内定向 5 项通过，本机 `code --install-extension` 成功，安装入口和会话晋升模块逐字节核对一致。真实任务保持中止，重载 VS Code 后由用户显式继续。已备份旧插件以便回退。

## 本机续接复验

2026-11-23，本机实际部门任务已从中止状态恢复执行。只读核对确认组长记录绑定原生会话，原根任务与组长任务均为运行中，已完成的子任务保留。部门停止标记已清除，运行时记录有实际组长与员工占用，原组长 Codex 进程存活且原生转录在续接后持续收到工具结果。

本次实机复验覆盖安装版的实际续接。再次中止与容量归还仍采用隔离回归证据，避免打断已恢复的任务。

## 自动关页与回归缺口

对照近期的冷启动投影、整组中止、原 Owner 回执、免验收收口和 Loop+ 交接变更，发现普通产研部 Loop+ 员工仍被排除在执行标签绑定和恢复关页之外。现在建立执行绑定和校验持久化关页证据共用同一模式判断。完成交接后关闭对应员工标签，独立 Owner 按原执行回执处理。

全量回归暴露过长期未换行的原生通知被逐块重新扫描，导致组长拒绝超限回调之前就触发测试超时。NDJSON 读取器只搜索新解码的文本并在换行或 EOF 时拼接完整行。保留 UTF-8 跨块、CRLF、空行、尾行及自然排空契约。新回归覆盖分块传输的大段多语言文本和跨块 CRLF，原超限回归通过，原上限与脱敏阶段保持有效。

另外修正了日志夹具等待写队列的方式、提供真实验收事件的 fixture、容量归还的持久化等待，以及隔离模型服务的合法续接摘要预算。热续接曾在所有业务检查通过后触发隔离 VS Code 主进程退出超时，验收保留独立宿主复验作为退出与业务证据。

## 最终验证

- `npm run build` 和 `node scripts/run_unit_tests.js` 通过。414 个编译后的测试文件共 6038 通过、0 失败、0 取消，3 项需 DSH 实机配置的用例跳过。原 Owner 回执和资源释放断言均通过。
- 宿主驱动与场景夹具 81 项通过。真实 VS Code Extension Host 和 Codex CLI 0.167.2 使用本机确定性模型响应执行 `loop-plus`、`loop-plus-stop-continue`、`loop-plus-cold-recovery`。每个场景从持久标签列表验证两个已完成员工标签消失、总监标签保留。热、冷续接均核对原任务、原生会话、停止记录、验收和容量归还。所有隔离宿主正常退出。报告位于 `.tmp/department-regression/` 下的 `loop-plus-delivery.json`、`loop-plus-stop-continue-serial-final.json` 和 `loop-plus-cold-recovery-serial-final.json`。
- `python3 verify_mac.py --report .tmp/department-regression/native.tRiBug/verification.json` 退出 0。78 个必要回归文件共 1644 项通过，默认三轮及公共 runner 的原会话交接、原进程退出、stdio 和临时目录清理通过。Windows 原生、外部模型的业务判断及正式扩展安装发布属于独立验证范围。
- 日志专项覆盖关闭调试时的固定事件、内容过滤、轮转与按当前「历史保留天数」清理。Ontology 结构校验、静态空白检查及 Git 差异检查通过。
