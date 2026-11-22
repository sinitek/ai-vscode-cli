# 产研部冷启动只读观察验证

本 runbook 记录真实 VS Code Extension Host 重启后的冷观察验证入口。它不新增跨宿主接管协议，也不修改部门 producer、task source 或容量状态。员工 binding 的冷观察只允许经原 Owner endpoint；running leader 缺少原 producer generation provenance 和完整聚合 Owner 时仍应 `live-leader-unverifiable` 并保留容量。只读观察不是 start、handoff、cleanup 或容量释放授权。

## 覆盖范围

`scripts/verify_department_full_eh_integration.js --scenario cold-start` 复用已有公开设置/发送入口、真实安装 CLI、隔离免费 loopback Responses provider 和 production EH task/runtime store。当前只允许 Codex director、leader、employee 组合。脚本等真实 employee attempt 完成持久 binding 和 grant 后，将它的免费 provider 响应保持 pending；第一宿主通过 extension test runner 正常退出。宿主退出只触发新宿主读取，不能作为 Owner drain 或清理证据。

第二宿主复用相同隔离 `HOME`、`USERPROFILE`、`CODEX_HOME`、XDG、VS Code `user-data`、extensions 和 workspace。EH fixture 对权威 task store 与 runtime snapshot 作只读读取，核对 task/root/workspace/module/leader/generation/attempt、当前 scheduler running entry、CLI/session binding、固化 role selection 和对应容量仍一致，再用精确持久 `ownerId` 通过 `DepartmentExecutionOwnerClient.observeExecution` 向原 endpoint 发只读请求。此只读请求只是独立 Owner 事实，不代表生产恢复接线已执行。

随后 fixture 通过公开 `sinitek-cli-tools.openLoopGroupChat` 打开原部门，并由隔离 VS Code Chromium 检查真实群聊投影后点击“中止”。定位依据是完整 iframe 扩展身份 `sinitek.sinitek-cli-tools`、`purpose=webviewPanel`，且 `#panelSubtitle` 的 `title` 必须与预期 root ID 完全相同。UI 断言要求总监和组长都显示“本宿主执行已中断”，组长汇总的“运行中”为 0，冷启动遗留员工 attempt 不计入运行数；组长页员工明细另由单测核对。随后动作仍经过既有 `departmentOrganizationControl.stop` 与 production composition 的 `ensure(root) -> host.recoverRoot(...)`。本组合预期收到精确 `live-leader-unverifiable` 警告：新 EH 没有原组长 producer 与完整 aggregate Owner，恢复必须 fail closed。点击信号只证明公开动作已发起；fixture 以有界等待观察宿主实际 warning 后才读取最终 task/runtime/capacity 快照，并在 `finally` 恢复 passive warning observer。缺信号、缺 warning、其它拒绝原因、身份冲突或未执行的断言都使 harness 失败，不再泛化为 source/extension 安全拒绝。

driver 对照第一 EH binding、正常退出后的权威 runtime binding、第二 EH activation 前冷读与公开控制后的快照：完整 identity、CLI selection、cleanup requirements 和保留 capacity 必须逐项相等；原 Owner observation 必须携带相同 ownerId 与完整 identity，`live`、`finalizing`、`unknown`、`conflict` 作为实际观测状态记录，`unknown`/`conflict` 仍表示责任未获证明。报告分开记录实际执行 driver 的 `__filename` realpath/hash 与产品副本内 source hash，不能用产品副本旧脚本的 hash 冒充工作区实际执行入口。

操作没有越过组长恢复门禁，所以 `DepartmentExecutionRecovery.observeAttempt` / `waitForCleanup` 的聚合消费路径仍未触达。场景不启动任务、不发起 handoff、不消费 binding、不改变来源 marker 或容量，也不从 PID、磁盘 receipt、completed/idle 或空容量授予权限。Provider request 总数、task 与 runtime 快照须在第二宿主拒绝前后保持不变。

结果区分原 endpoint 返回 `live` 的只读可达证据与生产 `recoverRoot` 明确拒绝的 `live-leader-unverifiable` 边界。任意 extension activation 异常、source lock 无法到达、身份不匹配、缺少原 endpoint 观察或未到达生产恢复控制都属于失败，报告必须保留准确阶段与错误。任何分类都不表示完整 root 恢复或自动派发通过。当前场景未调用生产 `DepartmentExecutionRecovery.observeAttempt` 的员工清理等待路径，也不把 `recoverRoot` 的组长拒绝改成成功；原子 owner 接管协议、可恢复的完整 producer aggregate 与冷启动后继续派发仍是独立门禁。

## 执行

round-393 更新期限与对照合同：driver 创建一个绝对 deadline plan 并传入第二 EH。激活、原 Owner 只读观察、公开控制、CDP 连接与点击、结果写盘及第二宿主退出使用同一计划的阶段截止和剩余预算。warning 在公开动作后拥有短的有界观察窗，窗口早于证据写盘与宿主退出截止；窗口内逐次校验精确文案、目标 root 和 stop 序号，并在窗口结束再次确认动作仍唯一。缺 warning、混合或重复 warning、重复 stop 和超时都失败，passive observer 仍在 `finally` 恢复。

round-397 将 driver 内部 OOPIF CDP 连接也纳入 action deadline：浏览器 CDP session、target 发现与 attach、目标消息发送和响应、执行上下文、locator 查询/点击与证据等待不再各自重置预算。动作完成后的自有 CDP session/target detach 和 browser connection close 使用同一 host 截止余量；未确认的清理会输出诊断并使 driver 失败。截止后迟到的 attach 只触发其自有 session 的有界 detach，不会继续查询或派发公开操作。短预算行为测试覆盖跨阶段延迟、挂起发送、无响应、缺少证据及 detach 不返回，并验证正常公开动作可以在证据截止前完成。

跨宿主投影以第一 EH 退出前的 root/module/leader/generation 为边界，逐项比对组长与员工 binding、完整责任集合和条目、selection、cleanup requirements、任务 session/CLI/config、相关 scheduler attempt、固化 routes 和容量，并比较首 EH 退出后的持久状态、次 EH activation 与公开控制前后快照。任务和容量投影只包含目标责任范围，避免把 `moduleId` 当作员工 subtask id 或纳入无关历史条目。本轮只做定向行为测试，未重启真实 EH。

本轮合同补充（round-389）：公开控件对唯一可见、未禁用目标派发 DOM click；HTML 走原生 click，SVG 走冒泡 `MouseEvent`，有行为测试覆盖。公开 stop 后只接受逐字匹配 production `live-leader-unverifiable` 文案、且对应唯一目标 root 和唯一 stop 消息的警告；缺失、近似、混合、重复与超时均失败。跨宿主核对覆盖第一 EH 退出前任务/runtime/binding、退出后持久状态、第二 EH activation 后和公开控制前后四阶段身份、selection、requirements、routes、scheduler attempt 与容量；binding 与原 Owner 身份使用生产 validator/`sameExecution`。本轮真实场景结果和 driver/产品哈希见 round-389 attempt 报告。

必须先用固定源码快照生成实体产品副本，运行标准 `npm run build`，并确认产品的 `dist` 是物理目录，不是共享 symlink。既有 verifier 会拒绝共享 `dist`。使用新报告路径；不要清理共享构建产物。

```bash
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node scripts/verify_department_full_eh_integration.js \
  --product /absolute/path/to/physical-built-product \
  --report /tmp/department-cold-start-report.json \
  --scenario cold-start
```

测试要求 macOS/Linux/Windows 对应的已安装 VS Code、`codex` CLI 与 Playwright 1.61.1。优先使用项目已有模块；如果不可用，本轮授权允许只在仓库外全新临时目录安装固定版本，不执行浏览器下载或安装脚本，不修改仓库依赖或共享 `node_modules`：

```bash
npm install --prefix /private/tmp/department-cold-playwright --ignore-scripts --no-save --no-package-lock playwright@1.61.1
PLAYWRIGHT_MODULE=/private/tmp/department-cold-playwright/node_modules/playwright
```

VS Code 自带 Chromium 通过 CDP 驱动，不下载浏览器。VS Code 本身以真实生产入口启动；CLI provider 只监听 loopback，不复制用户 token 或私有配置。失败保留 JSON 报告、两次 EH 日志及本次隔离 HOME 以便检查。正常宿主退出后新宿主才启动。超时后的强制回收必须记录为失败，不能当作 Owner 清理、容量返还或成功重启证据。

## 证据限制

- 当前报告中的 Codex 受控场景不证明真实 Codex 模型调用或语义判断；Responses provider 是本机确定性 fixture。
- 没有覆盖 OpenCode/其它 CLI、冷启动后自动 root reconciliation、完整生产组长观察、自动派发、Owner 接管、tab/UI 复原、冷恢复清理或容量释放。
- 若首 EH 正常 deactivation 释放 source owner marker，第二 EH 读取的是当时实际留下的 marker 状态；不得删除 stale marker 或伪造旧 owner 存活以绕过 source lock。
- 第二 EH 只读 endpoint 结果可能是 `unknown`，特别是原 Owner 随第一宿主退出后不可达时；保留容量是预期 fail-closed 结果。
- 尚需确认 VS Code/EH 的真实跨进程生命周期及各平台行为。单一 macOS 受控组合不能作为 Windows/Linux 或完整生产验收。

## 本轮执行记录

round-389 的公开 click signal 仅证明 CDP 已触发 DOM 事件；fixture 另以有界等待确认 Webview stop 消息确实到达该 root 的宿主 listener，才开始等待对应的 production warning。两个阶段均单独报告，任一缺失或超时都失败。

round-389 实际运行由真实公开设置/发送创建 root 与 leader，但首个组长 Codex 调用以 `DEPARTMENT_NATIVE_UNKNOWN: leader-owner-channel-or-delivery-unknown` 结束，未产生 employee binding 或 pending provider 请求。宿主正常失败收尾，未启动第二 EH；所以本轮没有冷恢复 pass/fail 或 `live-leader-unverifiable` 观察。精确阶段、请求数、driver/product 哈希和隔离现场以 round-389 attempt 报告及其 `/private/tmp/round389-live-report-1.json` 为准。

2026-11-15 macOS arm64 / Node v24.22.2 / Codex CLI 0.167.2：上一轮实体 build 与旧版 JS 12/12、EH fixture 4/4 仍是各自源码版本的有效证据；旧真实场景只启动第一 EH，因 Playwright 缺失在发送前失败，不能作为冷恢复结果。本轮在 `/private/tmp/round384-cold-product` 从固定物理源码闭包构建，Playwright 1.61.1 安装在仓库外 `/private/tmp/round384-playwright`，未运行浏览器下载脚本或修改仓库依赖。新增行为测试覆盖任意 activation 异常必失败；第二 EH 生产控制路径和 identity 校验的定向验证结果写入本轮 attempt 报告。真实场景的最终状态、是否到达 production `live-leader-unverifiable`、两个宿主的 marker/Owner/容量/请求计数及回收情况，以同目录的 round-384 attempt 报告为准；不能沿用上一轮“发送前阻断”作为本轮结论。

2026-11-15 round-386 修复了真实 Webview iframe 扩展身份 selector，并在公开中止前要求 subtitle 精确对应 expected root；第二 EH 现在等待生产 warning 的实际到达后再快照。跨宿主断言对比 first-host 原 binding、退出后 runtime、second-host 冷读和控制后 capacity/identity，并记录 driver 实际入口 hash 与产品 source hash。观察到 VS Code 将 Webview 暴露为独立 OOPIF target 后，driver 增加仅针对精确 extension ID/purpose 的 CDP target adapter，避免调用 renderer 内部消息或生产方法。真实场景仍在公开设置前失败：OOPIF target 虽可附加，但通过 Runtime.evaluate 对公开按钮调用 DOM `.click()` 报 `TypeError: e.click is not a function`；无任务、binding、grant、Owner 或第二宿主恢复。该失败是 harness/UI 自动化边界，不是生产冷恢复结果。具体报告、isolated path 和各命令结果见 round-386 attempt 报告。

2026-11-15 round-397：统一 CDP 绝对预算后，实体产品中的真实 Codex EH 场景成功启动第一宿主并通过公开设置/发送创建 root 与 leader，但停在 `firstHostActiveBinding`：公开创建的员工没有抵达 held loopback provider 请求。隔离 task store 中可见 leader `needs-review`、root `running`；provider 记录 5 个请求且无 protocol failure，Owner 协议只到 leader `invoke` 与两条 callback 事件，没有员工 binding/grant。第一宿主以 exit code 0 正常退出，没有强制回收；未创建第二 EH，也没有观察冷恢复拒绝或通过。driver 不再重复运行，不能把这次前置失败归类为冷恢复失败/成功。宿主退出后发现的自有插件 worker PID 60567 以 `SIGTERM` 做场景外卫生回收，此动作不是 Owner 清理或容量结算证据。机器报告 `/private/tmp/round397-live-report-2.json`；隔离现场 `/tmp/s-dept-eh-0h6rvx`。本次实际执行与产品内 driver SHA-256 相同，均为 `c761238c79785d2edc3bc0495f6dc3494316e129c770904709c335f754b5714b`；构建副本 `/private/tmp/round397-cold-product` 的冷 fixture 源码 SHA-256 为 `8e1f74d96a104a1826e0ec0a7a67c5c3a1e640a81e30ab4dd8468e9de0d1de78`，生成 JS 为 `21c0760c4252c9701ec4bc692d9afeeca26b07f32ab7a68f8018584ece3dff9e`。

2026-11-16 round-400 修复 full-EH 被动协议观察器：`callbackSequence` ACK 是 Codex 普通通知回执，不再触发授权前快照读取；`grant`、与原 `grant-request` 序号对应的成功 ACK 与 `launch` 才触发只读读回。若 runtime 尚无 `executionBindings`，观察记录为空集合，不推断或补造授权。观察器记录或读回失败写入 `original-owner-observation-errors.ndjson` 的固定阶段诊断，仍将原 `child.send` 参数、receiver、返回值和 callback 仅转发一次；主 verifier 检查该错误文件并拒绝结果。真实生产 ACK/授权逻辑未改。Codex session 日志仅保留 thread/connection 标识，不复制 observation token；两个宿主对观察失败另保留内存标志，诊断文件写入失败也使 harness 拒绝。

round-400 使用 `/private/tmp/round397-cold-product` 中 SHA-256 为 `c761238c79785d2edc3bc0495f6dc3494316e129c770904709c335f754b5714b` 的固定 driver，产品构建在 `/private/tmp/round400-cold-product`，隔离 HOME 为 `/tmp/s-dept-eh-CyE6GM`。公开设置和发送成功，首 EH 创建 root/leader/employee；employee binding 与容量持久化，原 Owner 在退出前为 `live`，loopback provider 有 6 个请求。首 EH 正常退出（exit 0），退出后 binding 和容量仍在。第二 EH 已启动并写出 ready 标记，但固定 driver 在 CDP Webview target discovery 阶段耗尽绝对期限；driver 以失败路径强制终止第二 EH（SIGKILL）。没有完成公开 stop，没有观察到生产 warning 或 `live-leader-unverifiable`，也没有第二 EH 控制前后的快照。因此本次只关闭“早期 ACK 观察器阻断原始 ACK”缺陷；冷恢复场景仍未通过也未判为生产恢复失败。机器报告 `/private/tmp/round400-live-report-1.json`；隔离现场 `/tmp/s-dept-eh-CyE6GM`。该 CDP target discovery 超时需由 driver/CDP 所有者单独诊断，本轮未改该并行写域，也未重跑场景。


## round-403：root-scoped 冷面板接线与一次真实验证

冷 driver 现在向同一 `createDepartmentWebviewAdapter` 传入精确 rootId、固定 actionDeadline/host cleanupDeadline。复用 round-400 的 root-scoped OOPIF 能力：完整扩展 ID `sinitek.sinitek-cli-tools`、唯一目标、公开字幕完整 root 后缀、总监正文和 root 必须同时成立，允许真实 panel URL 缺 purpose。重复、外来扩展、错误 root 继续拒绝；不复制定位器，不访问私有 renderer 消息。冷调用接线回归同时核对 root/deadline 传递和清理失败使真实调用拒绝。

自有 Webview/target/browser session、discovery session、候选和连接的释放失败全部保存诊断并拒绝；原业务错误保持为主错误。已截止或迟到获取的释放只用原清理余量，不重置相对超时。最终 report 对未确认清理另加 cdpCleanup 失败。连续 UI 使用同一合同，详见续接 runbook；这些资源释放仍不是部门 Owner 清理、receipt 或容量结算。

2026-11-16 round-403 唯一实际命令及白名单环境保存在 `/tmp/round403-cold-command.json`，入口为新物理产品 `/tmp/round403-cold-product-czwx04lf/scripts/verify_department_full_eh_integration.js --product /tmp/round403-cold-product-czwx04lf --report /tmp/round403-cold-real-report.json --scenario cold-start`。安装版 Codex CLI 0.167.2、VS Code 1.144.0，既有 Playwright 1.61.1，只用免费 127.0.0.1 Responses provider，预算 180000ms/32请求；HOME/USERPROFILE/CODEX_HOME/XDG/VS Code profile/workspace 全新。未安装依赖、访问用户凭据或付费模型。TS 闭包未变，实体复制已接受的 round-400 最终 build；两个 fixture source hash 精确为 full-EH `d63ee5a890bab16b70a4d37087aa47acf8f6b8d5dd3af02163886653f8b7fd61`、cold `950895cc44fc50c67f5b611e6dda29a16930fd2f03760a2eb01a6e60c879c219`。不清共享 dist，不为刷新证据重建或重跑旧组合。

实际 UTC 2026-11-15T17:05:45.478Z→17:08:47.856Z，隔离现场 `/tmp/s-dept-eh-WY6BdL`：公开创建 root/leader/员工，员工绑定和容量已持久化，原 endpoint 在首 EH 退出前为 live，6 个 provider 请求（员工响应被有界保持 pending）。首 EH 正常 exit 0，退出后完整 binding/责任集合/容量保持。次 EH ready 后，驱动已选中精确 root 总监面板并写出 `cold-recovery-check.signal`，故旧 target discovery 阻断已越过。

**本次 result=failed，不是冷恢复通过或生产恢复失败。** 第二 EH 原日志的最先具体阻断是 `public stop click signal was not followed by a delivered Webview stop action before its deadline`；因此未取得宿主 stop 送达、精确 live-leader-unverifiable warning 或控制后快照。第二 EH 自行 exit 1，driver 随后以 `cold recovery evidence exceeded its absolute deadline` 结束，原 activePhase 仍为 firstHostActiveBinding，不能用该粗阶段掩盖实际已到公开点击后的边界。宿主退出后的 target/session detach 返回 closed，cleanup confirmed=false，最终失败数组包含 cdpCleanup；业务超时未被清理错误覆盖。forcedTeardown=false，无 SIGKILL 补结果。

`/tmp/round403-partial-audit.json` 只读核对首宿主退出前后以及最终仍保留的完整 executionBindings、leaderExecutionSets、capacity 相等，provider 6→6→6，清理 incomplete。没有将这些局部事实冒充四阶段完整跨宿主投影；第二 EH before/after control 证据未落盘，完整 assertColdRestartIdentity 未执行。原始协议事件全部早于第二 EH 的 deadline plan 起点，未见第二 EH 新 grant，但仍缺 fixture 的完整跨宿主责任核验。没有原 required receipt/容量释放或冷接管授权。失败后未发现仍按该产品路径运行的 Owner worker；进程无残留仅为卫生事实。

日志 `/tmp/round403-cold-real.log`、`/tmp/s-dept-eh-WY6BdL/vscode.log`、`vscode-second.log` 和清单 `/tmp/round403-source-dist-manifest.json` 均保留。运行后产品 2495 文件无漂移；工作区仅后补 test 与冻结产品不同，运行 driver/UI/TS 匹配。先前 `/private/tmp/round400-live-report-1.json` 的 target discovery 失败历史未改写。后续需定位宿主 stop 消息观察边界，不能凭 DOM click 信号宣布成功，也不盲重跑或擅改生产调度/Owner。跨宿主完整恢复、必要平台实机、Git 整合及合并后全量回归继续开放。

## round-405：生产 API 观察与停止送达

旧 round-403 的 failed 报告保留。其测试 entry 在产品路径外 `require('vscode')`，修改的不是生产扩展缓存的 API 对象；旧观察器还在 activate 后才安装，并将同 viewType 的 stop 直接标为 expected root。新 cold fixture 在 activate 前通过 `createRequire(product/package.json)('vscode')` 取得生产 API，同时核对 dist/extension.js 所属 API 相同。对实际创建的公开 Webview 安装独立消息订阅，读取公开 HTML/实际 contentPatch 的完整字幕 root 与总监 heading 后关联；不调用 renderer 内部通道、不改消息及生产回调。原参数、receiver、返回 Promise 和生产行为保持。复用面板同样受观察；外来、无身份、重复或缺失送达仍失败，观察表有明确上限并在 finally 释放自有订阅。

新 fixture 失败时写 `cold-second-host-failure.json` 的阶段、原错、API 对应和有界消息/warning 摘要；driver 消费这份原错，不用通用 evidence 超时覆盖它。第二 EH 写出结果后等待 `cold-cdp-cleanup.json` confirmed=true，再结束测试入口，避免正常结果先退出 EH 导致 target detach 只返回 closed。既有所有清理失败门禁保持。closed 不是清理确认；CDP 清理也不是 Owner receipt 或容量结算。

唯一真实补验是 `/tmp/round405-cold-product-vt4sn970`，物理 src/scripts/dist 标准 `npm run build` 通过；命令及白名单环境 `/tmp/round405-cold-command.json`，固定2495文件清单 `/tmp/round405-source-dist-manifest.json`。安装 Codex CLI 0.167.2、VS Code 1.144.0、既有 Playwright 1.61.1，免费 loopback provider、新 HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace。UTC 2026-11-15T17:40:22.987Z→17:40:32.392Z，现场 `/tmp/s-dept-eh-m4urez`，机器报告 `/tmp/round405-cold-real-report.json`，日志 `/tmp/round405-cold-real.log`。未重跑连续 EH。

**本次 result=failed，公开 stop 送达已被真实证明，但精确 warning 与完整四阶段验收仍未通过。** 员工原 binding 与 pending 请求、原 endpoint live、首 EH 正常 exit0 成立；请求6→6→最终6。第二 EH 安装时 production extension 尚未 active，生产路径 API 相同、外部 entry API 不同。实际记录一个总监 panel 的 domReady 和一次精确 root stop，root=`msg_1794764426675_24fdf953cc411`；生产返回的实际消息是 `部门恢复核验阻塞：invalid-recovery。保留原占用，不能重新派发。`。未将它放宽为所需 `live-leader-unverifiable`。driver 保留该第一错误，CDP diagnostics=[]、confirmed=true。

源码最小因果边界：`departmentruntimecomposition.stop` 直接 `ensure(root)`；`recoverRoot` 的 rootContract 依赖 `validateDepartmentRoutes`，而 extension.ts 的该函数要求本进程 `departmentValidatedRoutes` 缓存命中。该缓存由可信异步 `prepareDepartmentRoutes` 填充；新建/继续有准备路径，冷停止没有。实际保存的 runtime 通过生产 validator、startingModules 为空，任务/容量/binding 无漂移；provider 请求仍为6。原始协议文件80项均早于第二 EH；失败诊断未保存第二 EH 的内存协议表，不能据此宣称第二 EH 的无新 grant/request 全部合同已通过。此为静态调用链与现场相符的根因定位，没有在真实 EH 注入函数局部值，也没有改生产恢复/Owner 门禁。后续最小生产修复域是冷停止的可信路由准备与恢复前置，必须保持配置/工作区/取消核验及冷宿主只读边界，不能直接预填缓存或伪造 live 观察。

本次失败暴露出另一收尾时序：driver 保存 confirmed CDP 释放后立即走总 finally，尚未等测试入口正常失败退出就 SIGKILL 第二 EH，原报告 forcedTeardown=true、secondHostForcedCleanup=true。它仅是失败卫生回收，不是 Owner 清理或容量证明。执行后交付的 driver 增加 `settleColdPublicControl`，在原 hostDeadline 内等待第二 EH 自行结束，再重新抛出原业务错误；受控时钟回归1/1。该后补分支及细分 activePhase **未再次真实执行**，没有修改原 failed 报告或冻结产品。产品与交付仅 driver/driver test 两路径不同，详见 `/tmp/round405-post-execution-correspondence.json`。

定向检查：fixture 7/7（含真实生产面板类的创建/DOM ready/复用及原消息交付）、最终 entry 受影响3项通过（不重复累计）、driver cold分支3/3、后补退出时序1/1，共11个不同用例。未变的 full-EH observer10项、原 Owner/连续EH/清理门禁结果按原范围复用。`/tmp/round405-partial-audit.json` 只证明首退出前/后/最终持久 binding、责任集合与容量保留、生产 validator、一次 stop/实际错误 warning、请求数，以及原始日志80项都早于第二EH；没有 `cold-second-host.json`，完整跨宿主四阶段断言未执行。真实冷拒绝的精确 warning、完整冷观察、可恢复冷接管、必要平台实机、Git合理合并与合并树全量回归继续开放。

## round-408：冷 stop 的可信路由准备与下一拒绝边界

冷停止仅在当前 composition 没有内存组织时先调用原 `prepareRoutes`；继续使用 extension 原有候选/共享档案/工作区核验及严格 `validateRoutes`，没有直接填缓存、切换档案或改变校验结果。准备前同步撤销旧 continuation，独立 cold-stop token 拒绝并发 continue/重复 stop；dispose 撤销 token。准备返回后重新读取并核对 root、CLI/session、workspace、固化 department/routes、计划、modelRouting、status/subTasks/currentRound 和请求身份，过期请求不能进入 ensure。失败只释放请求 token，不收养 Owner、不调用 prompt、不归还未知容量。暖组织停止不增加 await 或路由准备，仍在第一个 await 前调用原 stopRoot 封闭准入，沿用原停止代次、director finalizer 和清理合同。

新物理产品 `/tmp/round408-cold-product-srnvyv3w` 执行标准 `npm run build` 通过；src/scripts/dist 共2495文件固定于 `/tmp/round408-source-dist-manifest.json`。新增14项、直接受影响19项，共33个不同 composition 用例通过：冷缓存准备、缺可信leader来源的精确拒绝、异步身份/配置/状态/工作区漂移与dispose、并发停止/继续、失败后显式重试，以及暖停止同步封闭和原continuation/ownership/finalizer隔离。最初两条新增回归在原生产实现上均复现 invalid-recovery；最终源码和执行产品无漂移。源及命令详见 round-408 attempt 报告。不重跑未变观察器/清理门禁、round-400连续EH或其离线审计。

本轮仅一次真实全Codex冷执行，机器报告 `/tmp/round408-cold-real-report.json` **result=failed**，日志 `/tmp/round408-cold-real.log`，现场 `/tmp/s-dept-eh-42XZ7A`。UTC 2026-11-15T18:12:14.100Z→18:12:23.289Z；安装Codex0.167.2、VS Code1.144.0、既有Playwright1.61.1，全新HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace及免费loopback provider。首宿主员工真实binding、原endpoint live、pending provider及正常exit0成立；请求6→6→最终6。第二宿主公开stop实际送达精确root，原invalid-recovery已越过；生产实际warning为：

`部门恢复核验阻塞：unverified-leader-session-or-plan。保留原占用，不能重新派发。`

没有把该消息放宽成要求的live-leader-unverifiable。失败阶段准确为coldSecondHostPublicControl / awaiting-production-warning。CDP diagnostics=[]、confirmed=true；第二EH经原settleColdPublicControl等待自行失败退出（exit1/signal=null），forcedTeardown=false，没有强制回收。该执行实际覆盖round-405后补的失败等待分支，但不代表冷恢复通过或Owner清理完成。

只读局部审计 `/tmp/round408-partial-audit.json` 核对生产validator、首退出前/退出后/最终完整binding/selection/requirements、leaderExecutionSets和容量不变。真实warning及生产源码表明新的最先阻断在inspectLeaderSession：extension仍要求当前宿主能找到组长task.sessionId对应tab及main-task上下文。现场组长task.sessionId为local transcript键，另有executionSession原生ID；不能把二者混为一谈。用保存的真实任务/计划调用未改生产recoverRoot的纯只读诊断，确认上游leaderTask/计划验证已通过并确实进入inspect；返回null得到unverified-leader-session-or-plan，仅提供诊断target但live=null则到达live-leader-unverifiable。诊断未执行生产、创建tab、授予Owner能力或写入文件，不作为真实EH通过证据。真实EH没有记录私有tab集合内容，因此下一步仍需审查该只读身份核验与冷tab关联边界，不能凭诊断target收养旧Owner、替换原session或放宽验证。

`cold-second-host.json`仍缺失，完整afterControl/四阶段assertColdRestartIdentity与第二EH noNewGrant/责任对照未完成。原始协议80条均早于第二EH，但失败时未保存其内存协议表，不能据此声称第二EH无新grant；仅无新provider请求及现存持久责任不变得到局部证明。未发现匹配本轮路径的残留进程仅是卫生观察。产品与宿主src/scripts哈希一致，driver为round-405最终5c2c31fa…，cold fixture为4e7c9415…，full-EH fixture与Owner worker保持已接受d63ee5a8…/b233eb20…；本轮运行后未改执行源码。round-405及所有旧failed报告不变。精确warning/完整冷观察、可恢复冷接管、必要平台、Git合理合并及合并树全量回归仍开放。

## round-410：持久组长身份与执行能力分界（冷拒绝验证通过）

`verifyStoredLeaderIdentity` 是独立只读端口：生产使用 `createDepartmentStoredLeaderIdentityReader`，沿原 `loadSessionMessages` 与 `resolveLoopConversationTabContextFromMessages` 验证 task.sessionId 对应的 main-task transcript，再冷读原 `DepartmentRuntimeStore`。原 store/binding validator 核验完整 identity、selection 指纹与 requirements；精确匹配 workspace/root/module/leader/generation、CLI、固化配置/模型/思考/variant，以及 task.executionSession 与原 bound native session/config。recoverRoot 仍先经过原 rootContract、leaderTask 与 schedulerSnapshot 的归属、固化 routes/档案/方案核验。task.sessionId 是本地 transcript 键，不能替换成独立的 native session。

持久身份成立、组长仍 running，但没有真实 tab/live 观察时，只返回 `live-leader-unverifiable`；此返回发生在创建成员、恢复容量或持久写入之前。只读 reader 不返回 tabId/target/live，也不创建 tab、补写 transcript、收养 Owner 或颁发继续能力。真实 target 可用时仍须原 inspect 合同和完整 live 观察；非 running 的恢复与暖继续仍要求真实 target，原 producer/退休 provenance、required receipt、CLOSED 和容量规则不变。round-408 的可信路由准备、coldStops、跨 await 重读和暖停止同步封闭保持。

新实体 `/tmp/round410-cold-product-39c2n95o` 标准 `npm run build` 通过，完整 src/scripts/dist 清单 `/tmp/round410-source-dist-manifest.json`（2498文件）。13项新增回归通过，使用真实 store、binding validator、transcript parser，覆盖本地/原生会话分离、无 tab 的精确冷拒绝、root/workspace/配置/model/方案/本地与原生session/transcript/generation/指纹/缺binding拒绝，以及无真实tab的暖继续拒绝。另5项直接受影响恢复/继续和3项冷准备/暖停止接线通过，共21个不同用例。没有重跑此前33项全批、观察器、Owner、连续EH或旧组合来刷新可信结果。初次构建的两处测试类型错误、一次复制脚本路径错误及copy-to-self错误保留于round-410报告，不作通过证据。

唯一真实补验 UTC 2026-11-15T18:32:32.821Z→18:32:44.513Z，机器报告 `/tmp/round410-cold-real-report.json` **result=passed**，日志 `/tmp/round410-cold-real.log`，现场 `/tmp/s-dept-eh-ST9HfJ`。使用安装版Codex0.167.2、VS Code1.144.0和既有Playwright1.61.1，全新HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace、免费loopback provider；180000ms/32请求预算，无用户凭据、依赖安装或付费模型。首EH取得真实员工binding、原endpoint live及pending provider后自然exit0；次EH通过既有公开root面板stop，原观察器记录一次精确stop和生产warning：

`部门恢复核验阻塞：live-leader-unverifiable。保留原占用，不能重新派发。`

本次写出完整 `cold-second-host.json`。原 `assertColdRestartIdentity` 完成beforeActivation/afterActivation/beforeControl/afterControl四阶段：leader/employee完整binding、selection、八项requirements、任务本地及原生session、当前attempt、固化routes、原完整责任集合与保留容量均对应。第二EH protocolEvents=[]，provider6→6→6，无新grant/责任或prompt replay。CDP diagnostics=[]、confirmed=true，第二EH自然exit0/signal=null；forcedTeardown=false，原settle helper成功等待路径真实执行。无匹配残留进程只是卫生观察。

这是**冷宿主只读、安全拒绝**通过，不是Owner清理、容量归还或恢复接管通过：原组长endpoint观察为unknown/owner-unreachable，原员工endpoint为live；cleanupEvidence.complete=false，原占用必须保留。本场景不要求完成员工验收、总监最终汇报或原receipt集合，不用这些未执行阶段替代本轮拒绝验收。round-405/408 failed报告与其各自执行源码对应保留，408的只读诊断不能倒填成当时的真实通过。必要平台实机、跨宿主可恢复接管、Git合理整合及合并树全量回归仍开放；中央事实同步由主任务负责。

## round-420：可恢复冷接管的生产原语缺口

round-420 从 round-419 接受基线 `c76b5132d6c0430dfb03f150fb8220010265e32f` 检视了真实生产恢复链。该轮没有实现或运行冷接管；此结论不能登记为能力通过。代码与类型证据如下：

- `createDepartmentExecutionProducer` 的 generation、`pending` 准入、`sealNative`、原始 client、retired provenance 和 grant fence 都保存在该 Extension Host 进程的内存中。`closeAdmissionsAndDrain` 先同步 seal 当前 producer，再等待原 native owner 与全部 pending work；冷宿主没有可恢复的原 producer 实例。
- 持久 `leaderExecutionSets` 记录 `producerId`、责任全集和 closure/admissionFence，但这些值只证明原 producer 曾经登记并完成持久关闭。它们不是可调用的 coordinator endpoint，也不能让新 producer 接管仍 open/running 的 generation。
- `DepartmentExecutionOwnerClient` 可由受信 owner 目录及持久 `ownerId` 派生 endpoint，并严格核验单个 execution receipt；`handoffExecution` 只针对该 execution 的当前 `claimGeneration`。该 IPC 没有关闭原 leader scheduler、封锁整代迟到 grant、排空原 producer 的准备责任或转移原 scheduler claim 的操作。
- 生产组级清理目前需要原 producer 的 `observationSnapshot` 和 `originalClient(binding)`。以持久 binding 重建新 client 只能观察 Owner，不能证明原 producer 已停止 pump，也不能建立新的、与旧 host 互斥的调度权限。

因此，本轮未添加“从持久记录收养 producer”、合成 terminal/receipt、通过 Owner host exit/PID 缺席推断旧 grant 已排空、直接释放容量或回放 prompt 的路径。冷启动遇到缺少原 producer capability、endpoint 不可达、claim 或 selection 冲突、责任不全时，原有拒绝与占用保留必须继续生效。

后续可恢复冷接管需在首次 generation 登记前引入原生命周期持有的、能被新宿主认证并原子 fencing 的持久协调能力；它必须覆盖真实 scheduler 的所有 admission/grant 和在途准备，具有明确旧记录兼容/拒绝规则，并与现有 producer closure、原 Owner 完整 required receipt、整组容量移除形成一个受控交接。只有该能力成功交接后，新宿主才可恢复同一根身份并由现有公开继续显式触发后继。单独增加 owner-client 重建、tab target 查找、持久布尔标记或 per-execution handoff 都不满足该合同。

本轮实际检查仅包括：父记录指定的 round-410/419/平台增量报告读取；ontology 状态与部门恢复查询；CodeGraph 查询后直接读取未索引的新部门符号；以及新隔离 worktree 基线/来源核验。无 TypeScript 或 driver 变更，未运行 build、单测或 EH。round-410 冷安全拒绝与 round-419 同宿主连续续接仍按各自报告范围复用，不能作为冷接管证据。

## round-422：跨进程 generation authority 前置原语

在原 round-420 worktree 上增加 `DepartmentGenerationAuthority` 独立 IPC worker/client，并在真实新建及同宿主续接 producer 建立 generation 时、`ledger.open` 前启动。scope 绑定 root/workspace/leader/module/generation/producerId；快照与 ticket 使用严格版本化 schema（round-424 起当前协议为 version 2），expected-claim 更新由单一服务端串行处理。原 producer proof 是内存能力，不从持久数据恢复；seal 不可逆，未 released ticket 阻止 claim。`extension.ts` 将受信 authority 根目录设置在应用数据目录。

round-424 在此基础上实现同宿主生产准入及 Owner grant 接线：Ledger 在准备前向原 authority 登记完整责任；员工/组长绑定后由最终 Owner grant 入口原子消费 ticket/expected claim。authority-backed producer 缺少 register/bind/consume hook 会拒绝准入，不回退为本地 `canLaunch` 授权。本轮实际尝试 OpenCode 组长生产 Owner 子进程/IPC 回归，但以 `department-leader-opencode-terminal-unknown` 失败（当时未记录 binding 事件；round-426 核对源码后修正“binding 前”的推断，该错误实际位于 invoke 之后）；没有取得 grant、required receipt、ticket release 或 worker retire 的成功证据。这里也不表示员工 Codex/OpenCode 两种生产组合都已通过，或冷宿主能重建可执行 target、取得原 claim、聚合原整组责任或恢复容量。冷启动仍按此前 fail-closed 规则拒绝；未知、无端点、缺失旧记录或未排空责任必须保留占用。

**生产 fencing 线性化点**：`DepartmentLeaderExecutionLedger.admit` 先持久化原 authority ticket，再写本地 ledger 和进入 preparation；最终启动授权由各固定 Owner bootstrap 的 `authorizeStart` 调用 Ledger 回调，IPC `consume` 的 authority 服务端串行提交是 grant 线性化点，成功后才向 Owner worker 发送 grant。seal 先关闭 authority 后，未消费的旧 claim 会被拒绝；已消费的责任继续留在 producer pending 集合及原 native Owner drain 中。ticket `released` 只由原 producer 在原 `DepartmentExecutionOwnerClient.waitForCleanup` 验证精确 binding 的全部 required receipts 后写入。worker 只在整组 ticket released、Ledger closure 与持久容量移除之后由 `retire` 受控关闭。authority ticket、seal 或 claim 本身均不是清理/容量证明。

验证边界：round-424 的标准 build 与 authority 原语 IPC 3/3 通过；新增的 authority-enabled OpenCode leader production case 实际失败在 `department-leader-opencode-terminal-unknown`，当时事件仅见责任登记、native session 创建和 task session 持久化，未取得后续成功证据；日志缺少 binding 事件不能单独证明持久 binding 不存在。因此 round-424 没有实证最终 grant、原 Owner required receipt、ticket release 或 worker retire 的成功链；production wiring 子集也有 3 个 fixture timeout。员工 Codex/OpenCode authority-backed 完整路径、冷宿主 target/claim 接管、第二 EH 和冷容量恢复继续开放。round-410/419 历史证据按各自原源码快照保留。


## round-426：逐次生产准入与失败收尾修复

OpenCode 首次 `port.invoke` 现在位于同一次 `Ledger.admit` 内；后续每轮均重新准入并绑定原不可变 responsibility/binding，只在本次 invoke 期间安装 `authorizeStart`。Codex 后续轮次也在 verify 后重新 bind，保留同一原 native session 和执行身份，不缓存一次授权供未来使用。Ledger 在取消/terminal 先返回时保留未完成授权 IPC，最终 expected-claim consume 仍由原 authority 串行提交。另一客户端先 seal 时拒绝迟到 consume；已经 consume 的启动仍是原责任，不能因取消或 Promise 返回而消失。

关闭先按精确原本地 scope/producer 同步封闭准入，再同时尝试 authority seal 与原 native seal/drain，最后等待全部保留 pending。authority 读取、claim、断连或持久化错误不再跳过原 native 收尾；失败仍不生成 closure 或归还容量。`identity=null` 的合法 preparing/unknown ticket 必须保持 nativeSessionId=null，并继续校验 target、selection 白名单、requirements 和 scope；unknown 不能 release 或构成 closure。readiness 是非阻塞异步屏障，必须等待 authority 和 ledger.open 后才允许首次 pump。

本轮标准 build 及 46 个不同定向用例通过：production wiring 13、leader production host 11、真实 authority IPC/Ledger 18、异步调用方 4。覆盖两 CLI 员工、两种组长多轮绑定/grant、封闭前后 consume 竞争、准备取消留责、不可达/持久化失败仍执行原 native 收尾、无身份 unknown 可读、原 required receipts 后 release 与正常 worker 退出。普通 OpenCode 双轮事件列表曾失败，补入每轮幂等 responsibility/binding 事件后仅最小复测通过；原失败输出保留。测试使用免费确定性 Node CLI 与实际生产 Ledger/Owner 子进程及 IPC，不是本机安装版 OpenCode/Codex、真实 EH 或冷接管验证。

成功收尾测试逐项核对原 client required receipts、Ledger closure、持久容量移除，再等待 authority 自然 exit0/signal=null 及自有 endpoint/lock 删除。ledger.open 失败的空 authority 也在任何 pump 前正常退出。负例的进程终止仅是故障注入或有界测试卫生，不能作为 receipt、drain、Owner 清理或正常退役证明。round-424 及更早 failed 报告保持原状；round-410 安全拒绝、round-419 同宿主 EH 与未变 483 项证据继续按原快照复用。本轮不运行旧 EH。完整冷 target、跨宿主接管、第二 EH 成功、必要平台、最终 Git 合理整合及真实合并树全量回归继续开放。


## round-428：原代服务冷控制与受支持恢复接线

本轮接入生产 `DepartmentColdGenerationRecovery`：公开冷 stop 在可信 routes 准备后、ensure/recoverRoot 前执行预检；`inspectLeaderSession` 只返回该模块验证后由现有 session/tab 管理器关联的真实 target。未经验证仍为原 `live=null` 拒绝路径，不以布尔持久身份生成执行权。task.sessionId 是本地 transcript，executionSession 是原 native session，分别校验。recoverRoot 在原代收尾前保持原 generation，后继仍由既有显式 continue 创建。

原 producer 在 ledger.open/pump 前登记受信 Owner 目录和原 drain 端口。冷方认证精确原 endpoint/scope/producer/expected claim；独占 controlId 先持久 seal，阻止旧 claim 后续 consume，并保留所有已消费和未绑定准备责任。仍连接的原宿主通过继承 IPC 调用原 Ledger/native/pending 收尾；断连时独立服务仅控制精确原 Owner。原 client 在端点退役前等待 witness：原 authority 自己经原 Owner IPC 核验完整 required receipt 并私有保留，冷方不能提交 receipt 或取得 producerProof。控制权不产生新 grant 权，unknown 不可 closure/release。

恢复方核对全体候选的 root/workspace/module/leader/generation、原任务/attempt、角色路由和完整 selection、配置修订、requirements、责任与 binding 全集及原 authority tickets；异步后重读原快照和当前 stop 有效性。共享绝对截止包含配置和 IPC 等待。只有原服务完整收尾证明才能持久 CLOSED、重建原本地会话 target，再沿原组织 stop 移除容量。持久容量移除后才退役原 authority，并用不可由冷读取伪造的 retirement capability 建立新 producer 继续来源；原服务 endpoint/lock 的释放需要确认，不以 ACK、进程结束或卫生强杀代替。

限定组件证据：使用真实 Owner/authority 子进程、生产仓储/Ledger/聚合器和新恢复方 producer，验证原完整凭证、互斥控制、原服务断开宿主通道后公开组织 stop、CLOSED、容量归还、显式继续的新 Owner/原 native session 及正常 authority 退役。准备遗漏、endpoint 丢失、配置/session/代次冲突、异步任务变化和容量写失败保留责任；未完成准备改为合法无身份 unknown。两 CLI 原客户端 witness 均有生产组件覆盖。详细实际命令、初始失败和最小复测见 round-428 attempt report；不是一次 EH 运行或跨平台证明。

**支持边界**：冷继续目前仅 Codex；OpenCode 原 canonical directory 的退役来源尚不能交接，继续准确拒绝。原宿主消失后，缺少完整原 receipt 的 tab/consumer/root/准备责任仍 unknown；本轮成功路径先由原生命周期取得完整凭证，不宣称任意 EH 崩溃可恢复。测试 tab 管理是受控组件端口，尚未验证真实安装版 VS Code 的 target 恢复。完整第二 EH 公开成功留待生产能力审查后的独立验收，不改 round-410 安全拒绝用例，不重跑同宿主 EH 刷新结果。旧失败、未确认归属 worker、必要平台、最终 Git 合理合并及最终树全量回归继续保留。

本轮收尾另修正旧 readiness 文件包含 producerProof 的路径：文件只记录公开状态，原 proof 仅由继承 IPC 传给原宿主。相应真实 IPC 回归改为从原通道取得 proof，并断言 readiness/authority 持久文件均不包含它；不从磁盘恢复或向冷方披露原 proof。


## round-436：OpenCode 来源交接与收尾竞态

round-428 的 Codex-only 限制保留为历史快照。本轮支持原生命周期预登记的 OpenCode 冷继续：原 binding 后、首次 consume 前，向原 authority 登记仍存在的精确 canonical execution root；原完整 required receipts 经原服务 witness 保留后，原 stopped 握手与实际目录退役再由私有 producer proof 确认。冷方只能取得原服务 closed 响应中的精确来源，不能提交 receipt、任意目录、producerProof 或自行补来源。version 2 的新增严格响应要求 nativeSources；不含该能力的旧服务继续拒绝。

顺序仍为：原服务 seal/完整准备与 native 收尾 → 全部原 required receipts 与目录退役 → 原 producer closure/持久 CLOSED → 持久容量移除 → 确认原 authority 端点/锁退役 → 私有一次性交接 → 公开显式 continue 启动新 Owner/execution/generation/root，保持原 native session；本地 transcript session 单独核验。继续复用 assertRetiredOpenCodeSession、selection/attempt 与一次性 move 约束。

round-428 同宿主失败日志只有通用 stop 拒绝，不能反推出具体缺少哪项资源。新增可控真实 socket 回归证明并修复原 client 多等待者竞态：一个已取得完整凭证并退役端点后，迟到请求复核同一原 client 私有完成记录；新 client、错误 requirements 和取消仍拒绝。原服务并发 witness 也合并为每 ticket 一次实际观察，不以 seal ACK、宿主退出或强杀证明完成。

冷恢复缓存不再保存完整 task/root；重复 prepare 合并，未知控制及未决准备各限 64，失败留精确重试身份，成功退役交接后删除对应 generation 引用。失败或迟到回调不能删除后继状态。新增组件覆盖 OpenCode 原目录能力的独立恢复方、重复准备/提前退役重试/成功回收与过期回调；未知准备及持久容量失败仍拒绝。具体命令、失败分类和最终产物见 round-436 attempt report，不将早期失败输出改写。

本轮不运行旧 EH 或旧冷拒绝刷新证据。OpenCode 正例由原生命周期先完成完整收尾，再断开原宿主通道，使用免费确定性 CLI、真实 authority/Owner 子进程及受控 tab 管理；不是安装版 CLI 或完整第二 EH。未知 tab/consumer/root/准备、旧记录缺来源、原端点丢失、身份漂移和写失败仍保留占用。真实第二 EH、必要平台、最终 Git 合理整合及最终树全量回归继续开放。

最终组件检查另暴露了新夹具的前置条件竞态：原组观察被关闭、员工完成后仍返回 wait，正常原宿主投影会进入 blocked；冷 stop 正确拒绝。夹具已改为启用真实组观察，并仅将原宿主观察返回暂停在确定的断连边界；屏障不提交凭证、不返回清理成功。冷方仍须验证真实原 Owner/服务及持久仓储。本轮保留这次失败和诊断日志，未放宽生产 blocked 或持久化失败规则。最终自有标准 build 与 27 个不同受影响 TypeScript 用例、ontology 校验和 9 个技能测试通过（分批命令，非一次全量）；未变 Codex 冷正例、58 项及历史 EH 不为刷新重跑。

## lp716：最终存储输入的混合冷恢复补验

本次唯一源码输入为已接受 `0817f4519f3d5aa481af9ea64e848019da480b0e` / tree `b4d9054ad26fe49cd0d3c495c7fdb89463ebd850`。它是官方构建/全量测试输入 `c66439cbf5c5f2dc12a84c40f9fb8a7f29af2e3b` 的文档后继；其后仅有五份交接文档变化，因此复用标准 build 和官方入口 5469 passed、3 skipped、0 failed、0 cancelled 的既有证据。本轮没有重建或重跑全量。

从该提交建立独立 worktree，并物理复制 `src`、`scripts`、与整合树一致的既有 `dist` 和已安装 `node_modules` 到独立产品。源码、脚本和 `dist` 的逐文件比较一致，副本均与来源为不同实体路径；没有安装或升级依赖。执行只运行一次既有混合 `cold-recovery` 场景：

```sh
PLAYWRIGHT_MODULE=/tmp/round384-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node /tmp/department-final-store-cold-composition-round718-product/scripts/verify_department_full_eh_integration.js \
  --product /tmp/department-final-store-cold-composition-round718-product \
  --report /tmp/round718-mixed-cold-recovery-report.json \
  --scenario cold-recovery --leader-cli opencode --leader-model default
```

这次执行在 extension host ready 前失败，driver exit 1：`prerequisites` 和 `emptyStore` 已通过，`extensionHost` 仍 pending，`publicUi`、任务创建、执行、receipt/CLOSED、容量归还和 authority 退役均未到达或确认。隔离报告的首错是 `Extension Host did not become ready: {"exitCode":1,"signal":null}`。隔离 VS Code renderer 随后记录 `production extension is missing`；核查发现本轮物理产品目录缺少 Extension Development Path 所需的 `package.json`。因此失败责任属于本轮产品装配不完整，不是生产冷恢复合同的结果。场景未重试，也未修补产品或共享 harness 后重跑。

报告记载 `forcedTeardown=false`、host exit code 1/signal null、worker exit events/errors 为空；这些事实不证明所有后代进程都已退出，也不构成 Owner 清理。没有建立部门 root 或后继，原 binding、requirements、native session、transcript、required receipts、精确 CLOSED、持久容量移除、原 authority 退役、OpenCode move/readback 和真实 worker 退出组合均未验证。此前 lp698、lp702 的旧输入通过结果仍按其各自快照保留，不能替代本轮最终输入检查。Windows/Linux、任意崩溃及根任务整体完成也不在本次证据范围内。

本次产品目录、隔离报告与 EH 日志留在本机 `/tmp` 供复核；文档不包含凭据或私有运行数据。lp716 没有产品源码、UI、脚本或测试改动，只有本段文档追加；下一次有效混合验证需由唯一所有者先完整装配产品闭包，再基于获准的新 attempt 决定是否重新执行。


## lp719：完整产品闭包下的最终存储混合冷恢复

本轮续接 lp716 的装配失败，保留其原 21 行记录和失败产品/报告。唯一执行输入为 `6313d889450cb4e6f802acd86ef07137fff40b53` / tree `542799c4a3587f02de489da2ae87e7a99c78747d`；该提交相对已接受生产输入 `0817f4519f3d5aa481af9ea64e848019da480b0e` / tree `b4d9054ad26fe49cd0d3c495c7fdb89463ebd850` 只有文档变化，运行时源码仍对应该接受输入。

新物理产品 `/tmp/department-cold-product-closure-lp719` 由固定输入的完整 tracked archive（1540 个 tracked 文件，不含 `.git`）装配，再加入与既有接受 build 匹配、来源与副本身份均已确认的物理 `dist` 和已安装 `node_modules`。未拷贝用户配置、凭据或其它 worktree 内容；未安装/升级依赖，未共享可变 `dist`。启动 EH 前静态预检通过：`package.json` 的 publisher/name 与 `sinitek.sinitek-cli-tools` fixture 目标一致，`main` 指向存在的 `dist/extension.js`；包声明资源及 `media` 存在；本场景所需 driver、scripts、fixtures 和三个编译 EH fixture（production host、cold recovery EH host、cold start production host）齐全。检查确认实际运行 driver 与产品内 driver 相同，源码/脚本和编译产物对应固定输入。预检没有启动额外 EH，也没有通过普通 Node 加载 VS Code 扩展入口来替代静态闭包检查。

唯一新增场景命令如下；使用既有安装版 VS Code、Codex、OpenCode、Playwright、隔离用户目录与免费 loopback provider，保持 180 秒预算、真实 loadingReady/DOM-ready，不读取用户凭据或调用付费模型：

```sh
PLAYWRIGHT_MODULE=/tmp/round384-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node /tmp/department-cold-product-closure-lp719/scripts/verify_department_full_eh_integration.js \
  --product /tmp/department-cold-product-closure-lp719 \
  --report /tmp/round719-mixed-cold-recovery-report.json \
  --scenario cold-recovery --leader-cli opencode --leader-model default
```

driver exit 0，报告 `result=passed`、`failures=[]`；extensionHost、publicUi、required Owner receipts 和 capacity return 均通过，`forcedTeardown=false`，宿主自然 exit 0，worker observation errors 为空。原 task/attempt、完整 binding/selection/requirements、本地 transcript 与 OpenCode 原 native session 在冷链快照中精确关联；第二 EH 激活未重放 prompt，公开 stop 已送达。原组完整 required receipts 与精确 CLOSED 通过后，持久容量移除，原 authority 退役并自然 exit 0。只有显式公开 continue 创建唯一后继 generation/Owner/execution；OpenCode 保留原 native session，并完成 move/readback。后继公开 stop 的完整收尾与真实 Owner receipts 通过。worker 退出观察仅适用于报告直接观察到的进程，不外推所有后代；ACK、宿主退出、PID 缺席和端点删除均未作为凭证或容量归还替代物。报告 SHA-256 为 `148be0d3ee6723420e9fcd17e4fc17941213281f1639e378b6cdd29bd4e02c`，执行日志 SHA-256 为 `5da026174a416c02c0263d340cebc9352c2ba8b12452f6fefe951d9b5184774d`。

复用 lp715 对该生产输入的标准 build 与官方 397 文件、5472 项结果（5469 passed、3 skipped、0 failed/cancelled、自然退出），以及 lp707 的 110 项和各历史真实场景原有范围；没有重跑 build、单测或官方全量。lp716 的 EH 未注册失败继续作为装配失败历史，不覆盖或改写。本轮没有生产代码、脚本、测试或 UI 变化，只有本文档追加。未覆盖 Windows/Linux、任意 EH 崩溃、全部后代进程外推或根任务整体接受；主任务仍需独立审查执行证据与最终整合结果。
