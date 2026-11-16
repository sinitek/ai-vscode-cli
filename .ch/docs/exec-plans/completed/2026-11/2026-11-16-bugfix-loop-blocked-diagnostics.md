# Loop / Loop+ 受阻诊断与恢复引导

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

现有 blocked 只约束提示词，宿主接受缺失或一句话 finalSummary。用户无法知道卡点、原因和最佳处理方式。修复为可校验的诊断契约，并在诊断不足时主动补问主模型。

## 范围与非目标

- 共用结构化 blocker：可恢复/无法完成、原因、受影响要求、证据、已尝试动作、按推荐顺序的责任方/动作/验证方式、恢复条件或替代方案。
- Loop 缺失诊断时至多补充一次主模型决策；Loop+ 复用已有剩余工作复核及有界协议纠错。
- 汇总复用既有聊天、群聊、沟通文件的 Markdown 展示，不新增 UI 或自动安装机制。
- 保留完成、权限、验收与调度门禁；不把模型自报证据当作宿主验证，不自动安装软件，不无限重试。

## 验收标准

- 受阻不标记完成；安全自主修复、独立剩余工作优先继续。
- 不接受一句话作为最终完整诊断；给出具体缺项并自动请求补齐，耗尽后诚实保留模型原说明及诊断不足。
- 环境依赖说明具体软件/版本/运行环境、可执行安装或配置步骤、验证命令及何时继续；权限、资料、外部依赖与不可完成场景同样覆盖。
- 旧任务可读、状态与未确认事件不丢失；构建及相关回归通过。

## 影响面与风险

- `src/loopBlockedSummary.ts`、两类决策解析与编排、提示词及相关测试。
- 增加模型协议字段可能被旧模型忽略：限制纠错次数，原文与缺项保留；持久化仍使用 finalSummary，旧记录兼容。
- 验证为核心协议/运行时测试和源码构建；没有 UI 结构变化，无需浏览器布局验收。

## 验证计划与清单同步

- `npm run build`，构建后运行受阻说明、决策解析、经典编排、Loop+ 编排、状态机与交接/完成门禁测试。
- 更新 FEATURE_INVENTORY、能力规格、受阻排障手册及 ontology，并运行 ontology 校验/单测。
- 若测试失败，区分新契约导致的断言/夹具过期与实现缺陷；记录命令及最终结果。

## 当前进展

- 已通过 ontology、CodeGraph 和当前源码确认：已有可读性提示与 Loop+ 一次剩余工作复核，但没有诊断质量门禁。
- memory-recall focus 为 Loop / Loop+ blocked 受阻恢复，anchor 为空；热区无专题 observation，按召回展开受阻 runbook 与调度设计。
- 已实现共享 `LoopBlocker` 校验与中文摘要生成，解析器保留旧摘要及诊断缺项；完整对象覆盖模型自由摘要。
- 经典 Loop 缺诊断自动补充一次，可转继续/澄清；补充前移除旧协议气泡，补充仍缺失或 JSON 非法时保留原说明并暂停。Loop+ 在已有剩余工作复核后复用协议纠错上限，不确认或清空事件。
- 已同步能力规格、功能清单、调度设计、受阻 runbook 和 ontology。稳定结论已有设计/runbook 承接，不重复扩写记忆热区或自动写 ROLLING_SUMMARY。

## 验证记录

- `npm run build`：通过。
- `node --test --test-reporter=spec dist/test/loop/loopBlocker.test.js dist/test/loop/loopBlockedSummary.test.js dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`：312/312 通过，日志 `/tmp/sinitek-loop-blocked-tests.log`。
- 首轮新测试因模拟依赖缺失在预期的非法 JSON 路径调用不存在的 logError；分类为夹具问题，补齐模拟依赖后通过。新增诊断字段引起的旧调度夹具/摘要断言按新契约更新，漏报诊断仍使用显式原始 JSON 覆盖。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；ontology skill 单测 9/9 通过。
- `python3 -m unittest discover -s scripts/tests -p 'test_verify_loop_plus.py'`：13/13 通过。
- `git diff --check` 与改动文件的 `scripts/check_trailing_whitespace.js`：通过。
- 第一轮 `python3 verify_mac.py --report /tmp/sinitek-loop-blocked-20261116-verification.json`：构建通过，75 个必要回归文件 1296/1296，零失败/取消/跳过/TODO。默认 PATH Codex 0.167.2，macOS arm64 / Node v24.22.2，三轮专属连接交接 52/49/48ms，公共 runner 53ms；原进程退出、其它会话保留、stdio/进程/临时目录清理均通过。
- 最终源码核验：`python3 verify_mac.py --report /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-loop-blocked-final-uqjknkfu/verification.json` 退出 0，入口自行构建，75 文件 1296/1296，默认三轮专属交接 48/42/52ms，公共 runner 50ms，资源清理全部通过。开始/结束 701 个源码、测试和脚本文件 SHA-256 完全一致；指纹记录在同目录 `fingerprints.before.json` / `fingerprints.after.json`，完整输出 `native.log`。没有单独预热构建。
- 无 Webview 布局、交互控件或样式修改，复用既有 Markdown 展示及面板/暂停回归，不另跑浏览器布局检查。Windows 原生、已安装扩展图形界面、真实模型完整任务、其它 CLI 和全仓单测未执行，不能从本机隔离验证推定覆盖。

## 收尾结论

受阻现在是保留未完成目标、带明确诊断与恢复条件的暂停；诊断不足会主动补齐，仍失败时诚实留存缺项和原说明。可自行处理或安全独立工作优先推进，权限、验收和完成门禁不变。源码、构建、必要回归与本机隔离原生验证已完成；需要运行加载本次构建的扩展才能使用新行为。

## 同日追加：熔断文案

- 按用户追加要求，业务 blocked 气泡和生成的诊断统一称“熔断”，说明子任务多次尝试仍无法解决问题、整体任务尚未完成；继续展示原因、证据、已尝试动作、推荐解决步骤和恢复条件或替代方案。诊断补充提示和缺项说明同步采用“熔断”。
- 主模型调用失败和协议错误保留真实原因；群聊通用待复核标题仍适用于拒绝澄清等情况，不统一归因为子任务失败。历史模型原文保留，不新增失败计数、重试阈值或状态迁移。纯文案不新增独立测试文件，更新既有断言并补充错误归因检查。
- 已同步功能清单、能力规格、调度设计、排障手册及 ontology；ontology 校验通过，skill 单测 9/9，改动文件空白检查和 `git diff --check` 通过。无需新增热区记忆或重复事件记录。
- 最终源码验证：`python3 verify_mac.py --report /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-loop-fuse-final-3a242bha/verification.json` 退出 0，入口执行 `npm run build` 通过；75 个回归文件 1296/1296，零失败/取消/跳过/TODO，包含本轮说明、暂停记录、解析和编排测试。macOS arm64 / Node v24.22.2 / 默认 PATH Codex 0.167.2；默认三轮专属交接 42/42/68ms，公共 runner 47ms，进程退出、stdio 和临时目录清理全部通过。
- 最终验证前后 701 个源码、测试与脚本文件 SHA-256 一致；同目录保留 `fingerprints.before.json`、`fingerprints.after.json`、`native.log`。此前文案验证目录 `sinitek-loop-fuse-copy-t2zf0o1o` 对应中间源码，以本段最终报告为准。
- 无新增布局、样式或交互控件，未运行浏览器布局检查；Windows 原生、已安装扩展界面、真实模型完整任务、其它 CLI 与全仓单测仍未覆盖。本轮只要求文案统一，既有诊断与恢复行为保持。
