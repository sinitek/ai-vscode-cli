# Loop+ DSH 验收修复会话续接

- 日期：2026-11-02
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-02
- claim_ttl：本轮任务
- handoff_to：无

## 背景

DSH 在普通 Vibe 中关闭并重开 Tab 后可继续，但作为 Loop+ 子模型时，验收失败后的修复任务复用原会话无法执行。优先核对当前代码、脱敏本机日志及已安装 DSH 的 ACP 恢复协议，不将展示 Tab、CLI 会话和临时执行目录混为一谈。

## 目标与范围

定位并修复 Loop+ 验收修复续接 DSH 会话的根因，补充回归测试，并使用本机真实 DSH 验证首次执行、关闭、重派、恢复及修复结果。

## 非目标

不改变普通 Vibe 行为、其他 CLI 协议、Loop+ 验收标准和项目规则隔离要求；不修改用户已有会话或配置，不升级依赖。

## 验收标准

- [x] 有当前代码和真实 DSH 协议支持的根因证据。
- [x] 验收失败后修复任务保留正确上下文并能执行，原项目规则仍隔离。
- [x] 回归覆盖成功、边界及失败路径，构建通过。
- [x] 真实 DSH 完成首次子任务和修复续接，记录命令与脱敏关键结果。
- [x] 同步设计、功能清单、本体及必要排障知识。

## 影响面与风险

- 代码：DSH 启动、会话恢复与 Loop+ 子任务执行边界；最终范围随证据收敛。
- 文档：子任务会话复用设计、功能清单、本体及排障手册。
- 风险：DSH 恢复可能同时依赖 DSH_HOME 与 canonical workspace；不能仅保留 session ID，也不能静默新建会话伪装恢复成功。
- 缓解：使用隔离测试目录与真实 DSH，用户配置仅在内存读取，日志不输出凭据和业务提示词。

## 验证计划

- 最小单元：构建后运行 DSH host、runner 及 Loop+ runtime 相关测试。
- 构建：`npm run build`。
- 扩展验证：在临时工作区使用已安装 DSH，复现每次 attempt 切换执行目录后的恢复行为，再验证修复链路。
- 文档：本体校验、`git diff --check`。

## 任务列表

- [x] 召回会话复用设计与业务本体。
- [x] 确认问题只在 Loop+ 子模型验收修复链路出现。
- [x] 核实真实失败根因。
- [x] 实现最小修复及回归测试。
- [x] 真实验证。
- [x] 完成最终复核并归档结论。

## 当前证据

- 当前代码按 ACP session ID 找回同一个隔离 DSH_HOME；本机两次子模型启动日志也指向同一 patch 目录。
- 两次启动使用不同的 `sinitek-loop-subtask-*` 临时 cwd；普通 Vibe 保持真实工作区 cwd。
- 已安装 DSH 为 `0.2.1-rc.2`；本机 ACP 实现恢复前通过 `sameDirectory` 检查持久化会话的 canonical cwd。真实协议对照证实：相同 HOME/session、不同 cwd 报 `Invalid params: session cwd does not match`，原 cwd 严格恢复成功。

## 最终实现与边界

- DSH 隔离执行策略用会话 HOME 下的 `loop-workspace` 作为稳定真实 cwd；每轮仍以外层临时隔离根为输入重新建立工作区链接，保持原规则隐藏策略。
- 将真实工作区 cwd 传到执行策略；Windows 跨盘时用真实工作区 `.sinitek-loop-tmp` 下按隔离 HOME 名字生成的稳定目录，避免跨盘硬链接依赖。
- 成功、runner 创建/启动/模型执行/结算失败均清理本轮链接，仅保留稳定空目录，不递归删除。非空、符号链接或身份变化保留现场，不覆盖未知产物。
- 普通 Vibe 继续用原工作区 cwd，不修改其他 CLI；增加 `dsh-loop-execution-root` 日志区分最终 cwd 和外层 attemptCwd。
- 旧版已绑定随机 cwd 的 DSH Loop+ 会话不修改或自动迁移。协议拒绝时明确提示重新派发不复用旧会话的新子任务，不静默新建会话伪装恢复成功。

## 实测失败分类

- 新增单测最初缺少 port 的 `isCurrentRunActive`，属于夹具缺失，补全后相关用例通过。
- 真实测试夹具最初遗漏跨 CLI 的 `loopSubtaskConfigId`，在启动前被既有配置校验阻止；补齐测试绑定，不绕过生产检查。
- 真实模型不广告 `off`，首个真实启动按协议拒绝该测试值；用广告中支持的 `low` 重测，不修改现有模型能力约束。
- 现有 Loop+ 夹具把所有运行记录写成主 CLI，改为记录实际目标 CLI/session，并允许注入生产执行根，以真实覆盖 DSH 续接；全量回归验证兼容。
- 一轮重复实测的两个 DSH 子任务均执行完成，但最终主验收未通过；旧夹具将原始断言异常覆盖为后续 `unexpected Loop+ main call`，且原产物已按策略清理，因此无法还原具体字节或时序差异。该轮明确记为失败，不当作成功；补充保留主验收原始异常后重测，保留严格文件断言，不通过放宽验收掩盖问题。此后完整两项真实测试再次通过，并追加连续三轮文件修复复测，最终结果见收尾结论。

## 测试与清单同步

- 构建：多次 `npm run build`，以及最终 `npm run test:unit` 内置构建，均通过。
- 最小相关：`node --test dist/test/loop/loopSubtaskExecutionRoot.test.js dist/test/extensionHost/dshLoopSessionResume.test.js` 初批 30 项通过；随后补 Windows 嵌套 junction/hardlink 重建和清理覆盖。
- 扩大相关：`node --test dist/test/loop/*.test.js dist/test/extensionHost/loop*.test.js dist/test/extensionHost/dsh*.test.js dist/test/extensionHost/promptInteractive*.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/interactive/dsh*.test.js dist/test/interactive/runnerLifecycle*.test.js`：593 通过、3 个显式真实测试默认跳过、0 失败（之后新增 Windows 用例由全量覆盖）。
- 最终全量：`npm run test:unit`：2552 通过、3 跳过、0 失败，总计 2555 项；跳过的是需要显式配置的真实测试。
- 真实验证：`SINITEK_DSH_LOOP_LIVE=1 node --test dist/test/extensionHost/dshLoopSessionResumeLive.test.js`：两项通过。使用本机真实 DSH、当前模型配置和独立临时 HOME/workspace，凭据只读并仅进入子进程环境；不写用户配置或操作用户会话。
  - 协议对照：`changedCwdRejected=true`、`originalCwdResumed=true`、`sameSession=true`。
  - 生产 Loop+ 适配器、真实 DSH 执行策略和 runner：脚本主模型验收失败 → 原 Tab 关闭 → 原 runner dispose → 新 Tab 继承原 session → 新进程 resume → 通过上一轮只在会话上下文提供、未写入文件的随机校验码修复 `src/value.txt`。`sameSession/sameHome/sameCwd/originalProcessDisposed/newTab/failedAcceptanceRepaired/contextNonceRecovered/workspaceUpdated` 全部为 true。
  - 同一真实文件修复链路已重复通过；主模型回复为脚本，不宣称验证了主模型推理质量或图形 Extension Development Host 点击。
- 文档/本体：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9 项通过；`git diff --check` 通过。
- 同步子任务会话设计、运行时参考、功能清单、本地验证 runbook、已有 DSH 避坑条目、本体稳定规则和简短事件记忆；不写滚动摘要、不新增依赖、不修改根级规则。
- 未覆盖：Windows/Linux 原生真实 CLI、图形 VS Code 点击；Windows 链接与跨盘路径仅以现有平台模拟夹具验证。旧随机 cwd 会话需新建不复用子任务，目录异常保留现场后人工处理。

## 收尾结论

- 原因已通过真实 ACP 对照确认：Loop+ 每轮随机 cwd 与 DSH 持久化 cwd 不一致，不是 Tab 关闭或 ACP session ID 本身失效。
- 最终构建及全量回归通过；在最终构建产物上再次执行 `node scripts/run_unit_tests.js`，仍为 2552 通过、3 跳过、0 失败。
- 最终完整真实测试 2/2 通过；之后以 `SINITEK_DSH_LOOP_LIVE=1 node --test --test-name-pattern='real DSH Loop\+' dist/test/extensionHost/dshLoopSessionResumeLive.test.js` 连续执行三轮，均严格通过上下文与文件断言，耗时约 43.6 / 45.6 / 38.2 秒，不再出现恢复或最终验收错误。
- 已记录中途夹具及无法还原的单次验收失败，不以最终绿灯抹去测试历史。最终证据支持会话续接修复，不保证模型内容生成永不出错；无图形点击和 Windows/Linux 原生真实验证结论。
- 无新增依赖、版本升级、commit 或分支；用户已有会话与配置未改动。当前扩展需重新加载，旧随机 cwd 会话请重新派发不复用会话的新子任务。
