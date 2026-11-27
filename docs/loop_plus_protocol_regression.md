# Loop+ macOS 协议回归入口

入口脚本是 `scripts/loop_plus_protocol_regression_smoke.cjs`。它用合成决策驱动插件现有的 `runEventDriven` 正常入口，复用 `loopPlusRuntimeFixture`、`waitForLoopPlus`、`withLoopPlusAcceptReviews` 和调度器快照。失败时进程退出码为非 0，标准错误包含 `FAIL scenario=<id> lane=<lane> timeoutMs=<ms>`，可据此定位场景。

先编译当前产品：

```bash
npm run build
node scripts/loop_plus_protocol_regression_smoke.cjs --list
node scripts/loop_plus_protocol_regression_smoke.cjs
```

在 macOS 上，不带参数会先跑确定性夹具，再跑一个真实 Extension Host 场景。其它平台默认只跑夹具。需要显式打开宿主场景时加 `--extension-host`。

## 两条覆盖

确定性夹具在普通 Node 进程中安装与扩展宿主测试相同的 `vscode` 替身，然后调用生产适配器。它覆盖协议状态，但不是 Extension Host 进程。

`success-baseline-extension-host` 复用部门激活烟测的启动方式：隔离的 `HOME`、`user-data` 和 `extensions`，加上 `--extensionDevelopmentPath` 与 `--extensionTestsPath`。测试入口先确认当前产品已由 `onStartupFinished` 激活，再执行与成功基线相同的合成输入。用户数据和本次临时目录都放在 `/tmp` 下的本次私有根。清理只向本次创建的 VS Code 进程组发送信号。进程组退出且没有残留进程时，脚本删除该私有根；仍有残留时保留目录供定位。

最终候选的完整宿主验收不由本入口承担。关页身份由 lp495（`round-495-loopplus-noaccept-tab-identity-20261127`）负责。本入口只记录关页尝试次数，不把关页结果当作失败。

夹具自己的任务目录由 `loopPlusRuntimeFixture` 创建在系统临时目录，场景结束时调用它的 `dispose()` 删除。脚本摘要写到 `.tmp/loop-plus-protocol-regression/latest-report.json`。这个目录已在 `.gitignore` 中。

## 参数

| 参数 | 作用 |
| --- | --- |
| `--list` | 打印每个场景的输入、预期、失败判据和超时，不执行 |
| `--fixture-only` | 只跑确定性夹具 |
| `--extension-host-only` | 只跑 Extension Host 成功基线 |
| `--extension-host` | 在非 macOS 上额外打开 Extension Host 场景 |
| `--scenario=<id>` | 只跑指定场景，可重复 |

`SINITEK_VSCODE_EXE` 可指定 VS Code 可执行文件。`LOOP_PLUS_PROTOCOL_REGRESSION_DIST` 可指定编译产物目录，默认是仓库的 `dist`。

## 场景

每个场景都有有限超时。夹具场景是 15000 毫秒。Extension Host 场景是 180000 毫秒，其中包含隔离应用启动。

### success-baseline

- 覆盖：确定性夹具
- 输入：合成根提示经 `runEventDriven` 进入，fullstack 与子任务模型都设为 `sub-model`。主回复派发一个子任务；子任务以 `end` 交付；验收 `progressPercent=30` 且通过；收口回复 `completed`，并带齐默认验收与 `requirementCoverage`。
- 预期：子任务实际模型是 `sub-model`。同一任务完成，进度 100，恰好一条 `loop-plus-completed`，没有协议拒绝，会话仍是夹具会话。
- 失败判据：超时、任务未完成、进度不是 100、完成消息不是一条、出现协议拒绝、attempt 数不是 1，或会话被替换。

夹具创建的任务记录不持久化显式 `loopSubtaskMode`。此时宿主按已有规则把缺省模式视为全栈，并沿用子任务模型槽。所以这里观察到的模型是 `sub-model`。

### empty-reply-recovery

- 覆盖：确定性夹具
- 输入：第一轮主回复是 `status=end` 的空字符串。自动续跑后的第二轮回复派发子任务 `recovered`。
- 预期：先记录 `format.EmptyResponse` 和 `continuation_requested`，随后 `recovered` 子任务入运行，任务保持 `running`，并记录 protocol recovery 的 `recovered`。
- 失败判据：超时、没有 `EmptyResponse`、空回复后直接暂停、没有派发 `recovered`，或任务不是 `running`。

### multi-failure-line-correlation

- 覆盖：确定性夹具
- 输入：锚点验收后，`left` 与 `right` 组成冻结批次。先两行 `failed` 都不关联；再只关联 `left`；最后两行分别只关联自己的原逻辑 ID，并各派发一项同 ID 返工。
- 预期：前两次拒绝的原因码都是 `validation.accept.failed_repair_missing`，冻结顺序不变，不新增 attempt。第三次后只新增 `left` 与 `right` 的新 attempt。
- 失败判据：超时、任一次部分提交、冻结顺序变化、返工 ID 或 attempt 数不符。

### preflight-rejection

- 覆盖：确定性夹具
- 输入：`done` 已进入首次验收且 `busy` 仍在运行。主回复 `status=dispatch`，`nextStepPlan` 指向原批次，子任务 `overlap` 写入 `src/done.ts`。
- 预期：原因码 `state.dispatch_window.preflight_failed`。`done` 仍是活动验收，`overlap` 未启动，`busy` 仍是原 attempt，任务保持 `running`。
- 失败判据：超时、验收被提交、`overlap` 启动、`busy` 被替换，或原因码不是预检失败。

### accept-committed-partial-dispatch-reject

- 覆盖：确定性夹具
- 输入：`done` 的验收通过，`progressPercent=33`。`fresh` 与仍在运行的 `busy` 都以 `independentSubtaskIds` 在同一决策中派发。
- 预期：`done` 已 `reviewed/passed`，进度 33，`fresh` 已启动，`busy` 仍只有原 attempt，原因码 `state.dispatch.rejected`，任务未完成。
- 失败判据：超时、验收回滚、`fresh` 未启动、`busy` 被重复派发、进度丢失，或没有派发拒绝。

### consecutive-correction-progress

- 覆盖：确定性夹具
- 输入：`alpha` 验收先缺 `progressPercent`，再以 20 通过，并把 `beta` 列为 `independentSubtaskIds` 派发。`beta` 验收再次缺进度，随后以 45 通过。
- 预期：两次无效纠正都不改变已保存进度。有效验收后进度依次为 20 和 45，且都小于 100。
- 失败判据：超时、无效纠正改写进度、有效验收没有前移，或进度变成 100。

### late-event-frozen-batch

- 覆盖：确定性夹具
- 输入：`source` 的验收提示已经发出并保持冻结。此后 `late` 才以 `end` 交付。
- 预期：活动验收仍只有 `source`。`late` 只出现在 `reviewQueue`。已发出的提示编号清单不含 `late`。
- 失败判据：超时、活动验收被替换或清空、`late` 进入原冻结编号，或 `source` 不再是当前验收。

### resume-idempotent

- 覆盖：确定性夹具
- 输入：连续四次空回复使任务进入 `needs-review`。随后对同一任务调用三次 `resumeRequested` 续跑，后两次发生在第一次续跑的主回合仍被挂起时。
- 预期：仍是原任务和原会话。第一次续跑只增加一个主回合。挂起期间的重复续跑不再增加主回合或子任务。
- 失败判据：超时、新建任务、重复主回合、出现子任务，或续跑绑定了另一个会话。

### completion-gate

- 覆盖：确定性夹具
- 输入：`alpha` 已可验收时，`beta` 仍在运行。此时提交带齐通过证据的 `completed`。等 `beta` 交付并单独验收后，再提交 `completed`。
- 预期：过早 `completed` 不完成父任务，`beta` 继续运行，且没有完成消息。合法收口后父任务完成，进度 100，完成消息恰好一条。
- 失败判据：超时、提前完成、丢失 `beta`、合法收口后未完成，或完成消息不是一条。

### success-baseline-extension-host

- 覆盖：真实 Extension Host
- 输入：用隔离 `HOME`、`user-data` 和 `extensions` 启动已安装的 VS Code，`--extensionTestsPath` 指向本次生成的测试入口。入口确认产品由 `onStartupFinished` 激活后，执行与成功基线相同的合成输入。
- 预期：Extension Host 进程退出码 0。激活的是当前产品，`HOME` 被隔离。成功基线断言通过。
- 失败判据：超时、退出码非 0、激活路径或 `HOME` 不符，或宿主内成功基线断言失败。
- 超时：180000 毫秒。

## 未覆盖

本入口不启动真实模型，不操作真实用户配置，也不验证关页身份。全量测试、最终候选的真实宿主验收和 Git 提交都不在这里执行。
