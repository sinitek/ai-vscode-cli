# Loop+ 交接契约与公共事实来源修复

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Loop+ 并行实现 owners；主任务已接受约定范围
- owner：loop-final-evidence-closeout
- handoff_to：主任务收取归档文档交付
- 完成日期：2026-11-16
- 归档位置：`completed/2026-11/2026-11-16-bugfix-loop-handoff-contracts.md`

## 最终结论与交付边界

主任务已接受本 bugfix 的全部实现、公共存储契约及最终 macOS 约定范围证据；本轮收口测试说明、功能清单与历史记录并归档既有计划。本计划的 `completed` 表示约定修复交付完成，不表示宿主父任务调度状态已完成，也不改任何任务记录、活动 ID 或调度快照。

最终源码版本 1.9.9，基线 `c9c135fe935d6a016cb2b28ac4b31c827ab4e990`、dirty=true；Round 10 执行前后及主审复核的 693 个源码/测试/脚本指纹一致。主审记录已确认三个说明文档与报告版本一致，本轮仅修改文档和归档路径，不改变受测源码或执行证据。

## 最终需求覆盖与已接受证据

| 约定交付 | 最终接受结论与证据范围 |
| --- | --- |
| 存储提交、迁移与读取边界 | 正常返回即提交；I/O 原错误传播、缺失更新 null；路径身份保护、严格读取、同时间戳目标优先三项后续修复已接受。最终独立全工程编译及存储/legacy 71/71。 |
| 编排交接、拒绝纠错与显式恢复 | 真实提交与展示隔离；部分接受保留事实、有界纠错；普通暂停及停止父任务恢复提交失败回退已接受。标准 build、最终 tsc、新增磁盘 6/6、受影响交接 6/6 与恢复 19/19 按各自范围复用。 |
| 附加完成门禁 | 所选附加项全部 passed 才可 completed，accept 可携失败证据修复；parser 及当前宿主组合已接受，并纳入最终平台必要回归。 |
| pending 回填 | pending 不预留写入范围，running/本轮新启动项仍保护准入；独立全工程编译及 scheduler 39/39 已接受。 |
| 严格检测入口及编码边界 | 五项存储/交接/门禁文件必跑；Node 53/53、Python 13/13、继承 GBK 原场景 1/1、进程助手 4/4 已接受；缺工具、中文诊断、失败不启动检测/不覆盖报告等契约保留。 |
| 最终 macOS 集成 | 实际共享仓库默认三轮 `python3 verify_mac.py` 单次入口退出 0：标准 build、71 文件 **1209/1209**（fail/cancelled/skipped/todo 均 0）、三轮真实 pool、公共 runner 及四组清理均通过。默认 PATH Codex 0.167.2 固定不换；主审已接受。 |
| 公共契约与交付说明 | 恢复/调度设计、FEATURE_INVENTORY、ontology 和 PITFALLS 的稳定契约已接受；本轮更新 TESTING/local-development/功能清单当前结论并归档，保留原行为契约和 Windows 操作要求。 |

上述测试数来自不同执行范围，不相加为单次验收；**1209/1209 就是 Round 10 一次入口实际统计**。准确命令、CLI 路径、平台、指纹、JSON/log/runner.json 位置及 Windows 命令/成功标准见[本地开发手册](../../../runbooks/local-development.md#loopcodex-一键修复检测macos--windows)，统一规则见[测试基线](../../../TESTING.md#最近一次-loopcodex-原生源码验证)。本轮没有重复构建、业务单测、平台入口或 PID 探测。

## 最终验收标准

- [x] 提交失败不通知完成、不释放控制器、不压缩关页；缺失更新拒绝交接；展示刷新异常不撤销真实提交。
- [x] 存储路径别名、不可读/损坏来源或目标、legacy 同毫秒/时钟回退边界已修复并接受；只读容错与提交严格读取明确区分。
- [x] 派发拒绝有界纠错，部分接受保留事实；pending 回填保留 FIFO、DSH、attempt 和活动任务边界。
- [x] 显式恢复提升提交失败回退本次内存转换，原 pending attempt 可重试；真实临时磁盘 write/rename/null 回归已接受。
- [x] 所选附加项全部通过才可完成，当前宿主组合及五项显式必跑回归纳入最终入口。
- [x] 入口编码修复、默认三轮 macOS/真实进程/本机模拟模型、公共 runner 与四组退出/stdio/临时目录清理已接受。
- [x] 公共契约及功能清单同步，最终说明和归档引用收口；本轮仅执行限定文档结构、链接与空白检查。

## 覆盖限制与后续操作

`passed=true`、`fullyVerified=false` 保持不变。已验收的是所列最终源码在 macOS arm64 / Node v24.22.2 / Codex 0.167.2 下的必要回归和隔离运行时；Windows 原生由用户在另一台机器对同一源码运行 `python verify_win.py`（默认三轮），保留全新报告的 `.json`、`.log` 和 `.runner.json` 并按手册检查成功标准。未执行 Windows 原生、真实外部模型完整任务、已安装扩展/VS Code 图形宿主端到端、其它平台/CLI 或全仓单测。这些是覆盖限制及外部后续验证，不表示本 bugfix 约定交付仍未完成。

仍不承诺持续磁盘故障后的内存事件耐久、跨进程合并、多文件事务、外部换链或 fsync 保障。共享 `dist/` 的构建/验证阶段保持单一责任，源码改变须按影响重新判断既有证据有效性。本轮未改产品实现、公共恢复/调度设计或 ontology，其相关有效校验直接复用。

## 历史 failed 与后续修复链

| 历史失败（原结论保留） | 后续修复及已接受结论 |
| --- | --- |
| 验证入口事件 failed：继承 GBK 时两个真实 Python 入口 subTest 均 UTF-8 解码失败，定向检查退出 1。 | Round 6 `loop-verification-encoding-repair` 显式约定子 Python 输出 UTF-8，保留严格解码和中文断言；正常 13/13、原继承 GBK 单例 1/1 已接受。不是 Windows 原生实测。 |
| 存储事件 failed：同文件别名清理误删；目标 EACCES 被当空集合丢失兄弟；legacy 相等时间戳覆盖 completed/摘要，三项定向检查退出 1。 | `loop-storage-migration-boundaries` 按文件身份避免误清源、提交严格读取并保留已提交目标优先；最终编译及 71/71 已接受，公共契约同步已接受。原 61/61 只保留其当时范围。 |
| 运行时事件 failed：显式继续先提升内存再提交，ENOSPC 后下次继续把未启动 B 当 lost-process；停止父任务恢复有同类窗口，定向检查退出 1。 | Round 8 `loop-runtime-resume-commit-repair` 两处分支复用提交失败回退；新增磁盘 6/6 与受影响 25/25 已接受。未用 finished 或吞错替代失败。 |
| 早期构建类型错误、五文件 214 pass / 1 fail / 1 timeout，以及 Round 8 首轮新增测试 0/6。 | void/返回类型及 optional 字段夹具修正，过期静态断言和故障注入/状态位置预期修正后，对应 build/tsc、228/228、13/13、2/2、Round 8 最终 6/6 按历史记录覆盖；均保留原失败，不改产品门槛避错。 |

主审的各次 failed/passed 决策及准确证据已在父沟通最新验收记录保留，本计划只记录修复链，不改写其它 attempt 报告。

## 文档与记忆收尾判断

稳定契约和经验已由恢复/调度设计、ontology、PITFALLS 与本地开发手册承接，本轮无需重复复制到热区记忆或新增 skill，不写自动 ROLLING_SUMMARY。FEATURE_INVENTORY 保持功能 `active`，仅将待验收阶段改为已接受的源码及 macOS 范围。归档不改变其它并行工作（包括工作区派发上限）的文档或实现。

## 历史阶段记录

以下完整保留实施当时的状态表、待办和执行记录；其中“当前”“待主任务”“in-progress / active”“未执行 macOS”等均为当时交接状态，以前述最终结论为准。历史复选框不代表现在仍有开放验收项，各次通过数不得累计成一次运行。

### 背景与目标

`/tmp/loop-review-report.md` 确认存储失败吞错、附加验收失败仍完成、派发拒绝丢失纠错和 pending 回填冲突。基线 c9c135fe。本轮恢复已有契约，统一交接事实来源。

### 范围与非目标

修复既有 store/编排/parser/scheduler/验证入口边界并补回归；不改真实任务记录、发布、提交或推送，不重写调度架构，不新增定时补偿器。保留 attemptId、冻结 FIFO 批次、独立事件推进、同会话串行及崩溃恢复。

### 历史五项交付与当时状态

| owner | 交付 | 状态 |
| --- | --- | --- |
| loop-storage-commit-contract | 正常返回即提交；I/O 抛错；缺失更新 null | 已交付；owner 最终独立编译及 61/61 存储/迁移/原子写/恢复通过，非整体验收 |
| loop-additional-acceptance-gate | 已选附加项全部通过才可 completed | 已交付；owner 定向编译及 34/34 通过；当时全项目 TS 冲突已由本 owner 修正并构建通过 |
| loop-pending-backfill | pending 不预留写入范围；保留 DSH 边界 | 已交付；owner 独立全项目编译、39/39 scheduler 通过 |
| loop-runtime-handoff-contracts | 真实提交/展示隔离、拒绝纠错、磁盘集成与公共文档 | 已交付；标准 build 通过，最新全项目 tsc 通过；六文件 228/228、最终磁盘交接 13/13 和定向编排 2/2 通过；ontology 校验及 9/9 通过 |
| loop-strict-verification-entry | 严格验证脚本与 TESTING/local-development | 已交付；owner 隔离 Node 53/53、Python 12/12、进程助手 4/4 通过；最终默认三轮入口待主任务 |

### 历史验收标准

- [x] 真正提交失败不通知完成、不释放控制器、不压缩关页；恢复不重复验收/启动/完成。
- [x] null 更新失败；展示刷新失败不撤销真实提交。
- [x] 派发拒绝自动 protocolMiss 纠错，部分接受保留事实，重试有界。
- [x] 启动及控制交接先提交；用户停止先取消。
- [x] 真实临时磁盘模拟底层写/rename 失败并覆盖实际编排接线。
- [x] 公共文档、功能清单、ontology 同步且校验通过。
- [ ] 五个 owner 事实整合，主任务严格入口与整体验收完成后再归档。

### 影响面与风险

代码涉及 extensionHost 编排/策略/runtime 接线；文档涉及 scheduling、crash-recovery、FEATURE_INVENTORY、PITFALLS 与 cli-plugin-runtime ontology。共享源码通过符号链接并发编辑，写前重读，避免触碰其它 owner 主文件。只有本 owner 操作共享 dist。

### 验证计划与记录

最小范围：npm run build；相关 Node 编排/策略/runtime/新增真实磁盘交接测试；ontology --validate 及其 Python 单测。最终 python3 verify_mac.py 由后续主任务协调，本 attempt 不执行。兄弟结果只按收到的具体证据登记，不推定通过。

### 决策记录

- 2026-11-16：存储契约固定为正常返回成功、I/O 异常传播，缺失任务 null；编排统一检查 null，展示刷新独立处理。
- 2026-11-16：派发复用 scheduler 拒绝类型与已有 protocolRepair；部分接受后只纠正剩余派发，不重验已确认事件。

### 当时结论

本 owner 的实现、测试和公共文档交付完成，四份兄弟报告已整合。计划保持 active，最终严格入口与整体验收由主任务收口。

### 本 owner 已执行验证

- `npm run build > /tmp/loop-handoff-build-final.log 2>&1`：退出 0。较早构建的 void 夹具/测试类型错误已修正；早期失败不是当前通过证据。
- `node --test --test-timeout=20000 dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopCrashRecovery.test.js > /tmp/loop-handoff-tests-final.log 2>&1`：228/228 通过，失败/取消/跳过均 0。包含完成 gate 不预先转换的生产改动；随后仅把验收方案更新的不可达 null 分支改成既有中文失败返回，追加测试和文档。该最终局部 API 改动由最新全项目 tsc、磁盘交接 13/13 和定向编排 2/2 覆盖，其它仍有效结果直接复用。
- 第一次五文件执行为 214 pass / 1 fail / 1 timeout：类型导入静态断言过期，以及新测试未涵盖立即提升到 currentReview 的事件、故障注入未命中。修正后上述六文件结果覆盖并取代失败结论，不通过改动业务行为规避失败。
- `python3 /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli_2/.agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 17 concepts / 16 relations / 140 rules / 2 workflows / 3 documents。
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli_2/.agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。

### 兄弟证据及剩余收口

各 owner 的完整执行命令、范围、源码 hash 和限制在本轮四份 round-5 attempt 报告。仅复用其真实范围，不将测试数相加当作一套去重验收。storage owner 的 crash recovery 受本轮随后编排改动影响，本 owner 已在 228 项中重新覆盖该十项；parser owner 的宿主 gate 测试早于最后完成 gate 改动，主任务严格入口会覆盖最终版本。

公共事实来源已同步 scheduling/crash-recovery、FEATURE_INVENTORY、PITFALLS 和四条既有 ontology 规则。纠正旧 scheduling 文档对 blockedBy 日志字段的过度描述：实际宿主仅记录 started/pending ID 列表与 rejected 详情，细分冲突来自 scheduler 返回值。

最终 `python3 verify_mac.py` 默认三轮、Windows 原生、真实模型/VS Code 图形宿主/已安装扩展验证均未执行；不是已完成的验收。持续磁盘故障后崩溃仍只能依最后成功快照恢复，不承诺内存事件耐久、跨进程合并或 fsync。计划保持 in-progress / active，交主任务收口，不归档。

### 最终补充验证及交接

- `node node_modules/typescript/bin/tsc -p . > /tmp/loop-handoff-tsc-final.log 2>&1`：最终全项目编译退出 0。追加测试曾有一个 optional reviewEventIds 的类型错误，已用空数组回退修正；本结果为修正后源码。标准 npm build 较早已成功执行，不为刷新时间再次清理共享 dist。
- `node --test --test-timeout=20000 dist/test/extensionHost/loopPlusHandoffContracts.test.js > /tmp/loop-handoff-contracts-final.log 2>&1`：最终 13/13 通过，无失败/取消/跳过，包含新增真实验收提交失败回退、null 验收方案错误返回。
- `node --test --test-timeout=20000 --test-name-pattern='keeps the running task meta|a group-chat acceptance plan change' dist/test/extensionHost/loopPlusOrchestration.test.js > /tmp/loop-handoff-meta-final.log 2>&1`：最终 2/2 通过，无失败/取消/跳过；覆盖新纠错断言与验收方案局部接口收敛，未重跑不受影响的全文件。
- 精确路径的 `node scripts/check_trailing_whitespace.js ...` 与正式仓库 `git diff --check -- ...` 均退出 0；收尾检查路径及详情见本 attempt 报告。
- 实际改动遵守并行边界：未编辑 storage/parser/scheduler 或验证脚本及 TESTING/local-development；额外仅编辑 `src/test/extensionHost/loopPlusRuntimeWiring.test.ts`，将过期的 null=成功断言改为不刷新并抛错。没有同符号竞争，写前重读并保留兄弟变更。

### Round 8：显式恢复提升的未提交预留

主审确认遗漏：普通暂停后的 `promotePending` 和停止父任务后的 `resumeParent` 都在持久化前修改内存；写失败后未启动的 B 留在 running，下次继续被误判为 `stopped / lost-process`。此前 228/228 等结果仍是其各自范围的有效事实，但未覆盖这个窗口，不能据此宣称恢复边界已完整验收。

- [x] 两处转换共用 `persistResumeTransition`；仅回退本次转换前的 scheduler 快照。快照在失联核对后捕获，保留此前已提交事件、冻结批次、用户消息和活动兄弟；停止标记在恢复提交成功后才解除。
- [x] 失败保留控制器、暂停并结算恢复生命周期、原样抛错；不启动、不关页、不发恢复成功消息，不消耗原 pending attempt。保留 completionPatch、真实中断的开放预留和原协议/并发边界。
- [x] 新增六项真实临时磁盘回归：普通暂停/停止父任务 × 底层 ENOSPC write、EACCES rename、真实 updater 缺失任务 null；每项连续失败两次后恢复，再次继续不重复启动。验证 A 事件、未确认用户消息和活动兄弟，B 保留原 attemptId，无虚假完成、验收或成功收尾。
- [x] 本轮标准构建及最终 TypeScript 编译通过；新增 6/6、受影响交接 6/6、编排恢复与冷恢复 19/19 通过（命令与日志见本轮 attempt 报告）。未重跑未改变的其它既有结果。
- [ ] 最终 `python3 verify_mac.py` 默认三轮和整体验收仍由主任务协调；本计划保持 in-progress / active，不归档。存储迁移并行 owner 的最终版本整合不由本轮测试推定通过。

本轮命令/证据：

- `npm run build > /tmp/loop-resume-round8-build.log 2>&1`：退出 0；输出在本轮宿主 cwd 的 `dist`。随后仅修正新增测试两处状态/事件位置预期，生产源码未再改变。
- `node node_modules/typescript/bin/tsc -p . > /tmp/loop-resume-round8-tsc.log 2>&1`：修正后完整编译退出 0，覆盖最终源码和测试。
- 新增测试定向执行日志 `/tmp/loop-resume-round8-new-tests-final.log`：6/6；交接回归 `/tmp/loop-resume-round8-handoff-regression.log`：6/6；恢复回归 `/tmp/loop-resume-round8-recovery-regression.log`：19/19（18 项编排、1 项冷恢复），均无失败、取消或跳过。首轮新增测试 0/6：测试误把停止父任务的 FIFO 队列事件当作 currentReview、把成功提升后的 B 仍当 pending；按既有契约修正断言后通过，未以业务吞错或标 finished 规避。

公共事实来源评估：本轮恢复既有“成功提交后启动、提交失败恢复本次内存转换”契约，不改存储签名、记录结构、协议、用户流程或恢复模型；scheduling/crash-recovery、FEATURE_INVENTORY、PITFALLS 与 ontology 无需新增概念或改约束。既有 ontology 校验及 9/9 证据未因本轮代码修复失效，直接复用；本轮 status-report 为 ready。仅修改编排、其磁盘交接回归及此 active 计划，保留并发存储文档改动。

### Round 10：最终 macOS 源码隔离运行时验证

本节更新前述“最终 macOS 待执行”的历史交接状态，保留历史失败及修正记录；计划仍为 **in-progress / active**，主任务尚有开放审查，不归档或宣布整轮完成。

已接受且仍有效的前序结果按各自范围保留：存储迁移最终独立全工程编译及 71/71、scheduler 39/39、附加完成门禁及当前宿主组合、入口 Node 53/53、Python 13/13、继承 GBK 1/1、进程助手 4/4；运行时两处恢复提交回退的标准 build、最终 tsc、新增磁盘 6/6 及受影响 25/25 均已由主任务接受。这些不相加作为本次单次统计，也未为刷新证据分别重跑。早期表格的 61/61、Python 12/12 等保留为当时历史范围，当前修正以本段和对应 owner 报告为准。

- [x] 从实际共享仓库 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli_2` 执行 `python3 verify_mac.py --report /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/loop-final-macos-round10-cpaevitv/verification.json`，默认三轮，不指定另一 CLI，不添加预热 build；入口标准 build 及全部阶段退出 0。
- [x] 71 个必要回归文件 **1209/1209**，fail/cancelled/skipped/todo 全为 0；实际执行参数与报告 `evidence.files` 一致，含 loopTaskStore、loopTaskStoreCoreCoverage、loopTaskStorePersistence、loopPlusHandoffContracts、loopPlusAcceptanceCompletionGate 五项。
- [x] macOS arm64 / Node v24.22.2 / 源码 1.9.9 / commit `c9c135fe935d6a016cb2b28ac4b31c827ab4e990` / dirty=true；默认 PATH CLI `/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/codex`，版本 0.167.2。未知能力使用专属进程，三轮交接 44/49/42ms，公共 runner 46ms，真实 process/exit 先于恢复且另一会话保留。
- [x] 四组进程退出、stdio 关闭及临时目录删除证据完整，4 个自有验证进程无强制终止，16 个 Codex 子进程与 4 个验证进程 PID 已不存在；JSON、log、runner.json 及审计记录保存在上述目录。
- [x] 检测开始/结束 693 个源码、测试及检测脚本指纹一致。主审指定的 orchestration `5757f2eba80b10b1bbb3fe82c660794b4325428892b476a83b14aafc38e3e005`、handoff test `c5db8737150d0e338bf0cbc57cb3a00711b0974505827badc741c4cc449a5ada`、store `6c5f7cb20a30fac6929075adb9cfb89666f2a12921eeef43cbc4609d71a776af` 均匹配。随后仅修改 TESTING/local-development/本计划说明，不影响运行结果。
- [ ] 主任务剩余审查及文档批次复核仍开放；Windows 原生、真实模型完整任务、已安装扩展/VS Code 图形宿主端到端均未执行。`fullyVerified=false`，不承诺整轮已完成。

共享 dist 的责任按验证阶段指定单一执行者；本轮已获父任务授权负责实际共享构建，未使用旧 attempt 的临时 dist。TESTING/local-development 已改为稳定构建责任与最终源码指纹规则，并提供 Windows 同源码 `python verify_win.py` 默认三轮、可选加引号实际 CLI 路径、三报告位置与成功标准。未竞争编辑存储恢复/调度设计、FEATURE_INVENTORY 或 ontology；公共存储文档批次仍待主审，不阻止本轮平台检测。
