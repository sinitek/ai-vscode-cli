# Codex 跨平台会话释放状态修复

- 日期：2026-11-12
- 类型：bugfix
- 关联计划：[配置指纹](2026-11-12-bugfix-codex-runtime-fingerprint.md)、[卸载策略](2026-11-12-bugfix-codex-unload-policy.md)，本轮统一复验收尾。
- 状态：completed
- 负责人：Codex

## 2026-11-13 重新验收

Tasklist:
- [completed] 对照 2026-11-13 提交检查连接池、宿主所有权与命令启动影响
- [completed] 执行当前源码构建、受影响回归、默认三轮真实交接和公共 runner 验证
- [completed] 记录平台边界并与关联计划同步归档

本次按用户要求复核昨日修复，基线提交 `a589f3c9`，当前提交 `a4f4a269`。使用 `npm run verify:loop-plus -- --report "$env:TEMP\codex-reacceptance-20261113-1305.json"`；本机 Windows 原生、临时 HOME/工作区和本地模拟模型，不将结果扩大为其它原生平台、真实 VS Code 多窗口或未知外部 writer 的验收。

首轮 build 与 768/768 回归通过，三轮交接均完成（60133 / 60188 / 60151 ms）；第三轮仅删除临时目录报 EPERM，该轮报告保留 failed、公共 runner 未执行。所有已跟踪进程 exit/close、stdio close 均确认；稍后校验同一自有临时目录绝对路径后直接删除成功。分类为验收清理对短暂文件占用不耐受，修复仅在 Windows 且关闭证据齐备后对 EPERM/EBUSY/ENOTEMPTY 最多重试删除 5 次；按用户要求，macOS/Linux 保持一次删除行为。原 10 秒清理期限与 75 秒交接期限不变；持久错误、超时和未关闭资源仍失败。

重新执行 `npm run verify:loop-plus -- --report "$env:TEMP\codex-reacceptance-20261113-final.json"` 退出 0：build、773/773 回归、默认三轮（60222 / 60146 / 60153 ms）与公共 runner（35 ms）全部通过，原 thread、另一会话和严格清理均确认。随后限定 Windows 分支，重新 `npm run build` 及清理/验收最小回归 68/68 通过；新增的 6 项 macOS/Linux mock 回归确认三类占用错误均只删除一次，Windows 分支仍受次数和期限约束。最终公共 runner live 再验通过（38 ms），报告 `codex-reacceptance-20261113-win32-only.runner.json`；Windows 分支行为未变，复用上述三轮有效证据，不改写旧报告。

本次评审未发现今日变更使昨日修复回归；源码修复与本机 Windows 隔离集成验收完成，按用户要求归档。完整命令和失败分类见 [Windows 验证记录](../../../references/codex-thread-handoff-windows-validation.md#2026-11-13-今日变更复验)。原生 macOS/Linux、已安装扩展与真实 VS Code 多窗口、其它 CLI、真实模型和未知外部 writer 未验收，继续由 [技术债跟踪](../../tech-debt-tracker.md) 保留；报告 `fullyVerified=false`，归档不表示全平台验收通过。本轮只改验收脚本、测试与文档，无产品语义变化，FEATURE_INVENTORY 和 ontology 无需更新；清理踩坑已写入 PITFALLS。

## 背景与目标

macOS 也报告旧连接未确认释放。此前 Windows 交付仅修复隔离夹具的 Git 孤儿与清理边界，不能证明产品释放完成。核对公共 app-server 释放协议及其它 CLI 生命周期，修复有证据的缺陷，保持同 HOME/thread 完整操作互斥和不同会话并发。

## 范围与非目标

公共 Codex pool、runner、manager/生命周期策略、相关回归、产品规格和 ontology；不修改并行 acceptance.js/core 测试。不更换 thread、不删锁、不终止共享会话、不隐藏重试、不延长 75 秒期限。不声明解决未知外部 writer 协调。

## 验收标准

- [x] 协议源码/本机 schema 核对；无效、查询失败、迟到加载、取消均安全处理，不使用任何分页列表缺失作为释放证明。
- [x] 原有 thread/closed、notLoaded、实际退出证据保留；实际退出后的 stdout 尾部回归通过。
- [x] 普通对话、Loop/Loop+、配置迁移、停止恢复和压缩公共入口源码核对；其它 CLI 分别按原生协议审查，原生实机验证缺口保留。
- [x] 本轮隔离编译、最小相关回归、无写入类型检查与 ontology 校验通过；不替代并行汇合后的门槛。
- [x] round 11 完成共享 build、331/331 受影响回归和默认三轮 live；公共 runner 独立实测确认即时策略，详见 Windows 验证记录。

## 影响面与风险

- 代码：src/interactive 与相关测试；必要脚本仅单轮 verifier。
- 文档：runtime reference、Windows 验证事实、FEATURE_INVENTORY、cli-plugin-runtime ontology。
- 最大风险：将用户交互等待带入共享读取循环会阻塞其它会话释放；取消和迟到回答必须绑定原操作。服务端列表缺失不等于 writer 释放，协议未知保持拒绝。
- 已有修改保留，包括版本 1.9.2 和 Windows fixture 修复。fake PID 必须拦截终止调用。

## 验证计划

- 复用旧相关 236/236、清理边界 25/25、旧 build 和默认单轮 live，范围仅原覆盖。
- 新分支先补正反向回归；TypeScript 编译到独立临时目录，node --test 使用该目录；另跑 tsc --noEmit。
- 必要真实检查仅临时 HOME/workspace、本地模型、自有进程；原生 macOS/Linux 待补。
- 完成后记录精确命令、结果和失败分类。

## 任务列表

- [x] 核对协议与各 CLI 调用链，定位共享读取阻塞及 ZCode dispose 缺陷。
- [x] 实施异步交互请求、操作身份/取消隔离与交接诊断，保留 notLoaded 补充确认及 ZCode 修复。
- [x] 隔离验证并同步规格、本体和本轮沟通文件。
- [x] 汇合有效配置指纹、立即卸载能力及 acceptance 交付，round 11 完成 build/受影响回归/默认三轮。

## 决策记录与当前结论

- 2026-11-12：受控协议及源码确认 readLoop → dispatch → listener.handleServerRequest 的 await 链阻塞共享 RPC/closed。仅原生交互请求异步等待，生命周期消息保持顺序；请求绑定原始 ID/连接/thread/listener/操作身份，所有失效边界使用原生取消响应、最多一次回复，取消释放等待闭包。
- 本机 0.162.1 临时 HOME 生成协议确认 serverRequest/resolved 的 threadId+RequestId（string|number）及旧版 conversationId；既有上游 thread_state.rs 在 notSubscribed 时提前返回，不重置卸载计时。保留 notLoaded 补充确认与迟到加载代次；不使用 loaded/list 缺失、不延长 75 秒。
- 交接诊断区分 waiting_load/requesting_unload/waiting_close/waiting_exit 与明确协议不支持、请求失败、无效状态、超时；取消语义不变。不记录原始敏感错误和回答。
- manager/各 CLI 审查及入口边界记录在 runtime reference：普通对话、Loop/Loop+ 经公共 runner，配置迁移/停止恢复与 compact 保留保护；ZCode 的 session/close 被 closed 挡住及强杀定时器提前完成已修复，不将其它 CLI 的原生取消误作 Codex 释放证明。
- round 7 时有效配置指纹模块与调用入口、立即卸载能力模块及 codexRunnerRuntime、acceptance/core 测试由并行任务持有；round 9 续接修复探测收尾并接入公共 runner，其它交付的最终汇合及跨平台验收仍由主任务执行。
- 最终集成门槛由主任务在两项交付汇合后执行，计划当时在该门槛前保持 active；当前收尾见 2026-11-13 重新验收。

## 本轮验证（round 7）

- 新临时目录隔离 tsc 编译及 `tsc --noEmit` 通过，不构建/读取共享 dist。并行 commandResolution 曾短暂 TS2554，拥有者更新后编译通过，本轮未修改该文件。
- 最终 `node --test --test-concurrency=1`：codexThreadHandoff、codexRunnerReuse、codexRunnerLifecycle 共 86/86，skipped=0。包含 B 未回答时 A 完成交接、B 正常回答、各取消/归属/代次/退出边界、迟到拒绝、旧 turn 新请求、原生取消形状及七类交接诊断。
- 扩展相关首次 123/127；4 项均在仅等固定 setImmediate 次数后得到启动/turn 数量 0。夹具改为有界 2 秒条件等待（不改产品期限和原断言），最终 lifecycle 全部通过。其余 98 项未受随后改动影响，保留有效结果，不为刷新证据重跑。
- ontology validate、其 9 项 Python 测试、相关 diff --check 通过。旧 236/236、清理 25/25、新 acceptance 26/26及默认单轮 live 仅复用原覆盖；本轮未新增原生 live，主任务须在能力/指纹汇合后统一 build、受影响回归与默认三轮，macOS/Linux 原生与其它 CLI 实机验证仍缺。

## 续接修复与启动接入（round 9）

- [x] 超时/错误/输出超量仅返回保守能力并请求终止自有子进程；临时 HOME 和并发名额保留到 close，终止请求失败或仅 exit 不提前清理。3 秒结果上限、环境隔离、输出限额和有界缓存保留。
- [x] 公共 runner 对已解析且身份可确认的插件自启目标接入能力策略，只有 supported + supported 原因才加入零延迟参数；最终 args 参与连接 key，shell 未知身份走兼容路径。能力 await 后复核原操作、停止代次和释放状态，覆盖 turn/compact。
- [x] 定向清理/启动回归 14/14，附带 RPC 夹具隔离验证 2/2；临时目录隔离编译、无写入类型检查及 ontology validate / 9 项测试通过。旧能力 24/24、runtime 24/24 仅复用原覆盖，不重跑刷新证据。
- 首次编译发现 beforeEach 上下文为 TestContext | SuiteContext，增加 mock 存在断言后通过；提取的 ontology 测试首次因临时目录层级失败，用仅临时测试入口绑定真实仓库 root / 临时 SCRIPT 后 9/9。未恢复已删除的 skills/AGENTS 文件。
- 命令与覆盖范围详见宿主指定 `round-9-repair-and-integrate-codex-unload-policy.md`。产物在本轮新建 `sinitek-round9-uyq5wo93/compiled`，未使用旧轮次产物。两个额外改动仅在 codexRunnerReuse / codexAppServerNdjson 测试中 mock 保守能力，避免新探测被假 RPC 服务误计为 app-server；所有原 fake PID 拦截和既存 diff 保留。
- [x] round 9 未执行的正式 build、受影响回归、默认三轮 live 已在 round 11 完成；原生 macOS/Linux 仍缺。

## 汇合验证（round 11）

- 默认 `node scripts/verify_codex_thread_handoff_acceptance.js --live --report "$env:TEMP\codex-handoff-round11-final-default-20261112.json"` 退出 0：共享构建成功、331/331、3/3，兼容交接 60145 / 60175 / 60103 ms，严格清理均确认。
- 新独立脚本经过真实公共 runner，在 0.162.1 确认能力与最终零延迟 args、原 thread 迁移、真实 thread/closed、另一 thread 旧进程继续运行，最终 37 ms、清理成功。新增断言与超时回归最终 8/8，隔离编译通过；修复仅涉及新增验证代码，不使先前综合门禁失效。
- 失败观察器复验与一次临时目录删除被自动审批拒绝均保留真实记录，详见 [Windows 验证记录](../../../references/codex-thread-handoff-windows-validation.md)。不将失败轮次追认为清理成功。
- round 11 当时保持 active：原生 macOS/Linux、真实 VS Code 多窗口、其它 CLI、未知外部 writer 与主任务接受审查尚未完成；当轮仅 Windows 隔离集成门槛通过。当前复验与归档边界见顶部。
