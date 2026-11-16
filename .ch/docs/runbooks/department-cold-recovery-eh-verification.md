# 第二 Extension Host 冷恢复正例验证（round437）

本 runbook 描述独立 `cold-recovery` 场景。当前两个组合的真实执行均为 **failed**，不能登记冷恢复正例通过。已有 `cold-start` 安全拒绝场景及其期望未改变。

## 产品及隔离

- 冻结生产来源：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-cold-recovery-round420-20261116`，round436 最终清单 `/tmp/round436-final-manifest.json`（SHA256 `6333f4924bbe78588dd0f86a46872a9ff6831058eabaebd95b941b1907b61dd4`）。复制前逐项核对 sources/dist/inputs。
- 本轮物理产品：`/tmp/department-cold-recovery-eh-round437-product`。仅共享现有 node_modules，不安装依赖；标准 build 只清除此产品 dist。来源树、共享 HEAD/index 及其他任务产品未修改。
- macOS；Node `v24.22.2`；安装版 VS Code `1.144.0`；Codex `0.167.2`；OpenCode `1.19.5`。Playwright 使用既有 `/tmp/round384-playwright/node_modules/playwright`。
- 每次运行由原 driver 创建全新 HOME、USERPROFILE、CODEX_HOME、XDG、OpenCode 配置、VS Code user-data/profile 和 workspace。只配置免费 loopback provider；不复制用户配置/凭据。外部模型流量没有授权。
- 原源码及产物哈希、实际 driver SHA 和原始报告分别冻结在执行清单；后改 harness 不代表历史执行使用了后改版本。

## 入口与预期边界

在物理产品执行 `npm run build` 后，通过原 driver 启动，不直接调用 composition/recoverRoot，也不修改任务、容量、receipt、CLOSED 或 authority 文件。

```sh
PLAYWRIGHT_MODULE=/tmp/round384-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node scripts/verify_department_full_eh_integration.js \
  --product /tmp/department-cold-recovery-eh-round437-product \
  --report /tmp/round437-codex-real-report-3.json --scenario cold-recovery

PLAYWRIGHT_MODULE=/tmp/round384-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node scripts/verify_department_full_eh_integration.js \
  --product /tmp/department-cold-recovery-eh-round437-product \
  --report /tmp/round437-mixed-real-report.json --scenario cold-recovery \
  --leader-cli opencode --leader-model default
```

这些是执行入口说明；实际启动使用最小环境 allowlist，完整 argv/env 见 `/tmp/round437-codex-command-3.json`、`/tmp/round437-mixed-command.json`。不要直接覆盖这些已存在的原始报告或盲目重跑。

首 EH 从公开设置/发送创建部门并实际执行组长及员工。fixture 调用原 group.observe，保留 receiver/参数和原拒绝，仅在其 **真实成功之后** 延迟宿主消费。它不生成凭证或提前 resolve。driver 要求原 leader/employee required receipts、完整两项责任集合 CLOSED、保留 leader 容量及可验证原 authority；OpenCode 另核对原服务来源和 native DB 原 canonical directory、实际 stop 与目录移除。首 EH 正常退出后启动第二 EH，生产 session manager 关联原本地 transcript 和真实 Tab。

第二 EH 由精确 root 群聊按钮公开 stop，然后公开 continue 对话框提交；被动观察消息实际到达宿主。一个绝对 deadline 为 180 秒，保留 10 秒清理预算。stop 前后不允许新增 provider 请求或 Owner 协议授权。原完整清理、持久容量移除和原 endpoint/lock 退役必须先于显式继续。成功门禁还要求唯一新 producer/Owner/execution/generation、保持本地和 native 两种 session、实际新 provider 请求、OpenCode 一次 move-session/readback、新 canonical root、最后公开 stop 的完整清理、worker 正常退出、CDP 释放及第二 EH 自然退出。

## 实际结果及失败分类

| 执行 | 原始机器报告 | 结果与版本边界 |
| --- | --- | --- |
| Codex 1 | `/tmp/round437-codex-real-report.json` | harness bootstrap 失败：CommonJS require 接收了 vscode 的 data: ESM identifier；未到生产冷恢复。已改为既有 createRequire 入口并加回归。 |
| Codex 2 | `/tmp/round437-codex-real-report-2.json` | harness JSON 原地写入读到半帧；另定位 adapter 调用错误，未发送公开 stop。已改原子发布和 shared adapter.click，并加回归。 |
| Codex 3 | `/tmp/round437-codex-real-report-3.json` | 真实生产失败。公开 stop/continue 已送达，原容量归还；后继卡在实际 native 请求前，机器首错保留为 successorRealNativeRequest deadline。只读诊断定位 `department-tab-not-owned-or-consumer-capacity`。失败收尾强制回收第二 EH，不能算自然退出。 |
| Codex/OpenCode/Codex | `/tmp/round437-mixed-real-report.json` | 只运行一次。直接保留生产首错 `cold successor production rejection: department-tab-not-owned-or-consumer-capacity`。首 EH 与第二 EH exit0、forcedTeardown=false；自有 CDP 清理诊断为空。仍为 failed。 |

Codex 3 后仅修复 harness 的具体错误捕获、失败快照和失败路径等待第二 EH 退出，混合组合实际覆盖这些修改。没有重跑 Codex 生产失败，没有改写旧报告。

冻结生产调用链：`extension.ts` 的 cold `restoreTarget` 调用 `resolveLoopMainPromptTarget(..., {createIfMissing:true})` 并核对本地 transcript/context，但没有登记 DepartmentExecutionResources 所有权。普通 `createLeaderTarget` 会调用 `recordCreated`。两 CLI 后继都会调用 `beginConsumer`，而 `departmentexecutionresources.ts` 要求原宿主私有登记，因此拒绝。round436 受控 fixture 登记了恢复 tab；真实接线没有该步骤。应由生产审查设计可信恢复资源能力，不能由本 harness 补登记或放宽检查。

两次生产失败均已取得原 receipts、四阶段及 afterControl 身份/容量快照；混合组合还取得原 OpenCode native stop/目录退役事实。后继 generation3 blocked，原 generation1 CLOSED 保留，新代 open 集合为空、leader 容量保留。新代 authority 已启动但没有 Owner fork/grant。后继 native 执行、OpenCode 移动/读回、后继最终清理及 authority 自行退役 **未取得**。EH 退出不证明这些资源完成；不猜测或终止未知 worker。

## 最小检查与证据

- 标准 `npm run build` 最终 exit0：`/tmp/round437-build-final.log`。
- 新 fixture 三项、新 scenario 四项、受影响原 driver 四项，共 11 个不同用例通过；运行命令和覆盖版本见本轮沟通报告。`node --check scripts/verify_department_full_eh_integration.js` 通过。
- 最终运行冻结清单：`/tmp/round437-execution-manifest-final.json`；交付审计：`/tmp/round437-delivery-manifest.json`。Codex 生产诊断：`/tmp/round437-codex-production-diagnostic.json`。所有原始失败及其执行清单保留。
- 不运行已审组件、同宿主 EH、旧 cold-start 或全量回归刷新证据。本任务仅新增 harness/runbook，中央功能清单、ontology 与 active 计划留待整合。

生产所有权缺口修复审查后，仍须取得两个组合独立的完整真实第二 EH 正例；最终额度组合、必要平台实机、Git 合理合并及最终合并树全量回归仍开放。


## Round-440：可信 Tab 接线及执行快照

产品 `/tmp/department-cold-recovery-tab-round440-product` 从 round437 最终实体副本逐项核验后物理复制，来源清单 `/tmp/round437-execution-manifest-final.json`、交付清单 `/tmp/round437-delivery-manifest.json`。不从共享 HEAD 或其它任务导入字节。源码/产物对应以本轮各执行 manifest 为准。

生产恢复协调器完成原 authority 完整集合、真实 required receipts、身份与精确 CLOSED 核验后，关联实际 Tab，并向资源管理器交付一次性内存能力。能力不能结构伪造、离开同步回调后重放或重复消费。登记绑定实际对象/workspace/CLI/本地 transcript；原容量持久归还、authority retirement 及原 retirement 能力交接前不能开始消费者。显式 continue 仍经原新代准入；不以登记授权 grant。

命令使用 round437 相同的安装版 VS Code 1.144.0、Codex 0.167.2、OpenCode 1.19.5、Node v24.22.2，现有 Playwright 模块和免费 loopback provider。完整隔离 argv/env 分别保存于 `/tmp/round440-*-command*.json`；每次由 driver 新建 HOME、USERPROFILE、CODEX_HOME、XDG、profile 和 workspace。

```sh
node /tmp/department-cold-recovery-tab-round440-product/scripts/verify_department_full_eh_integration.js --product /tmp/department-cold-recovery-tab-round440-product --report /tmp/round440-codex-real-report-3.json --scenario cold-recovery
node /tmp/department-cold-recovery-tab-round440-product/scripts/verify_department_full_eh_integration.js --product /tmp/department-cold-recovery-tab-round440-product --report /tmp/round440-mixed-real-report-2.json --scenario cold-recovery --leader-cli opencode --leader-model default
```

全 Codex 最终原始机器报告 passed/driver exit0，清单 `/tmp/round440-execution-manifest-3.json`：真实第二 EH stop/continue，原两项 receipt/CLOSED、持久容量移除和原服务 retirement，新代唯一 producer/Owner/execution、原 native session 与独立本地 session、实际后继请求、最终公开 stop、三项完整 receipt、两代 CLOSED、容量空、新 authority exit0，两 EH exit0、无强制回收、CDP 诊断空。原服务退役来自认证 retire 后 endpoint/lock 的自行移除；不声称直接观察了跨 EH 原进程 exit 事件。后继 Owner-close 独立事件未出现在最终 observer 快照，不能从 receipt 或 authority exit 外推该 worker exit。

历史失败全部保留：Codex 第一次最终清理等待超时，实际 successor 只有组长一项，原通用检查要求每代至少两项；改为只在冷后继最终检查精确比对已观察的 scope/producer/责任 entries，仍要求所有 CLOSED、全部 required receipts 和容量空。第二次为该 harness 修改误引用未初始化的 next；新增门禁回归后第三次通过。原报告 `/tmp/round440-codex-real-report.json`、`-2.json` 不改写。

混合第一次 `/tmp/round440-mixed-real-report.json` 已真实继续后发起 OpenCode 请求，但错误地从 Owner IPC 读取并不存在的 retired 字段而 failed/afterContinue；两 EH exit0，不视为最终清理通过。源码确认真实 move-session/readback 在 EH 的 session-preparation API。新增被动成功观察仅记录该原 API 返回的原来源、目标目录和 session，保持原 Promise/receiver/参数/错误，不记录私有 launch 内容。

混合修正后唯一运行 `/tmp/round440-mixed-real-report-2.json` failed/originalFullReceiptBoundary，原首 EH 后续组长生产调用报 `department-leader-opencode-busy-or-conflict`，未进入第二 EH。已有协议时序表明原首轮 settled 后再入被拒绝；复合条件中的具体分支未捕获，不能宣称已定位为 busy 或 launchKey 漂移。只读诊断 `/tmp/round440-mixed-first-host-diagnostic.json`。未盲目重跑、未放宽生产检查或据此登记混合通过；新 move 观察器有定向回归但尚无真实成功覆盖。失败后的未知服务/占用不猜 PID 强杀，不宣称清理。

最小检查：最终标准 `npm run build` exit0；既有 Tab 资源10项、受影响冷恢复正例2项、新真实 IPC 能力负例1项、普通生产两CLI接线2项、新 driver 集合/时序2项、新 native observer/入口2项通过（19个不同定向用例）；ontology validate 与9项工具单测通过。首次新增能力负例夹具在 native Owner 就绪前停止导致失败，修正为先等真实 execution binding 后通过；该次测试卫生终止不计正常退出。有效旧结果继续按原范围复用。

最终 mixed 清单 `/tmp/round440-execution-manifest-final.json` 相对 Codex passed 清单只改变 OpenCode 被动观察 fixture/test及该分支 driver；生产 src/dist 字节不变。Codex 已通过范围复用，不为刷新重复运行。执行后仅追加文档与交付材料。两组合完整关闭尚未成立：混合正例、OpenCode move一次/新root最终实际成功、原/后继 worker独立退出观察、额度最终组合、必要平台、Git合理合并及最终树全量回归继续开放。

## Round-674（续接 round443 未结束执行）：混合修复与独立退出证据

此节是后继执行事实，不改写 round437/440 的失败和有效范围。生产来源仍为 round440 最终物理产品及 `/tmp/round440-delivery-manifest.json`、`/tmp/round440-execution-manifest-final.json`。修复首先在 `/tmp/department-cold-mixed-round443-product` 完成标准build与定向检查；中断后所有src/scripts/dist逐项确认匹配混合执行清单，物理复制到本轮 `/tmp/department-cold-mixed-round674-product`。没有从共享HEAD、额度/UI树或其它未审增量重建。两副本生产源码及编译产物相同，执行清单分别 `/tmp/round443-execution-manifest-1.json` 与 `/tmp/round674-execution-manifest.json`。

生产根因机制：原代码每轮复制整个EH环境并纳入不可变launchKey。旧运行日志在原轮次间出现EH延迟加入的本地化元数据；原生首轮 settled 不能防止此类输入漂移。逐项源码复核保留busy、重复invocation、selection、128轮上限、launch及native session检查，新增安全拒绝类别。可控真实生产Ledger/Owner回归在添加迟到宿主元数据后精确得到`:launch`，而采用原generation首次继承环境快照后两轮使用同一原Owner/session成功，显式变化和重复调用仍拒绝。旧运行没有具体分支事件，故不把机制回归称作旧guard分支的直接捕获；新混合运行没有生产拒绝。

退出观察缺口先用旧输出确认：round440 Codex observer没有跨EH原authority及后继Owner的独立退出事件。新增harness独立Python kqueue观察进程，通过fixture原fork/初始化的身份与PID登记，不接触业务IPC或发信号；要求真实NOTE_EXITSTATUS的code0、signal=null。fixture保留原fork/send返回、参数、Promise和错误，诊断异常不能影响原结果。辅助进程有64注册、帧/输出预算和正常finish退出；不支持的平台明确拒绝观察，不能用PID缺席替代。观察器自身不是receipt或控制能力。

最小执行入口（使用既有免费loopback provider、安装版VS Code1.144.0/Codex0.167.2/OpenCode1.19.5、Node24.22.2，180秒绝对deadline/10秒清理预算；每次新建HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace）：

```sh
node /tmp/department-cold-mixed-round443-product/scripts/verify_department_full_eh_integration.js --product /tmp/department-cold-mixed-round443-product --report /tmp/round443-mixed-real-report-1.json --scenario cold-recovery --leader-cli opencode --leader-model default
node /tmp/department-cold-mixed-round674-product/scripts/verify_department_full_eh_integration.js --product /tmp/department-cold-mixed-round674-product --report /tmp/round674-codex-lifecycle-report.json --scenario cold-recovery
```

混合仅执行一次，machine passed/driver0。原完整2项receipt、原CLOSED及持久容量移除，原authority认证retirement后真实内核退出；第二EH公开继续后唯一新producer/Owner/execution/generation3，原native session与独立本地transcript保持，OpenCode真实move/readback一次、新canonical root、后继实际请求。最终公开stop取得3份完整receipt、两组精确CLOSED（2项+1项）、空容量。原authority PID54845、后继Owner PID56576、后继authority PID56529均code0且无signal；原组长和员工也观察到内核code0。两个EH exit0，无强杀，CDP诊断空。原始报告、命令及清单保持round443文件名，不改成新的执行。

Codex只为旧输出确实缺失的两项退出事实补一次跨EH场景，machine passed/driver0。原authority PID67666、后继Owner PID68360和authority PID68183均有真实内核code0/signal=null；原authority退出先于新代初始化。两EH exit0，forcedTeardown=false，CDP诊断空，完整3receipt、两CLOSED、最终容量空。旧round440业务结果仍按原范围复用，新观察不回写旧机器报告。原始命令 `/tmp/round674-codex-lifecycle-command.json`，独立数据根 `/tmp/s-dept-eh-svqEYL`；混合根 `/tmp/s-dept-eh-XxoYOw`。

最小回归共7个不同用例：真实生产环境迟到变更1、受影响OpenCode原绑定多轮1、生成入口和被动worker观察3、内核跨父进程状态与严格退出门禁2。标准build最终exit0；首次build仅因新测试ProcessEnv类型缺PATH失败，已修正，未进入真实EH。完整命令/日志和产物哈希见round674报告。未重跑旧19项、483项、旧冷安全拒绝或同宿主EH刷新证据。ontology数据新增两条精确规则，按现有工具校验。

这些是两个限定macOS/free-loopback快照的增量结果。中央功能清单文案交主任务整合：原代环境首次固化、跨EH真实worker退出单独核验、限定混合冷恢复正例通过。最终额度组合、其它平台、远端Git合理合并及最终合并树全量回归仍开放；不宣称最终统一产品通过，不猜测或处理旧未知worker。
