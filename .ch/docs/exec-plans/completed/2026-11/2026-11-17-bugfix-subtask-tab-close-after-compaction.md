# 子任务压缩完成后标签遗留排查

- 日期：2026-11-17
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-14-bugfix-loop-subtask-completion-cleanup.md`、`.ch/docs/exec-plans/completed/2026-11/2026-11-15-bugfix-subtask-completion-tab-cleanup.md`（复核已有收尾与关页边界）。

## 背景与目标

用户反馈子任务最后显示“子任务执行结束，用时 11:00，等待主任务验收”及 Codex 当前线程压缩完成，但标签没有关闭；无法确认实例是否运行最新版本。核对当前源码与最小本机只读证据，复现仍存在的成功收尾遗漏并修复。

## 范围与非目标

覆盖经典 Loop、Loop+ 成功回报、后台压缩和安全关页入口及相关回归。保留工作区原有未提交改动；当前工作区包含待排查版本的相关修改，在原处验证。不得修改用户运行记录、发布扩展、调用付费模型或改变 CLI/框架版本。

## 验收标准

- 成功回报后的压缩成功、失败、跳过均能关闭符合身份条件的原子任务标签。
- 新 attempt、换绑、替代、其它任务、工作区及真实运行中的标签仍受保护。
- 复现用例在修复前失败、修复后通过；相关构建、回归及本机隔离 CLI 检测通过。
- 功能清单、设计与 ontology 按实际行为变化同步；明确源码与已安装扩展的验证边界。

## 影响面、风险与缓解

实际修改：`src/extensionHost/loopSubtaskTabs.ts`、`src/extensionHost/sessionTabs.ts`、`src/extension.ts` 及 `src/test/session/sessionTabCliSwitch.test.ts`；复用现有会话控制器，不改调度或验收协议。异步关页的主要风险是误伤新调用；保留标签对象、CLI/session、attempt 与工作区校验，不能强制关闭活动标签。回滚只撤回本计划新增差异。

## 验证计划

- `npm run build` 后执行标签清理、子任务 lifecycle/压缩、Loop+ adapter/orchestration 相关编译后测试。
- 本机最小真实验证：只读核对指定会话终态；使用隔离 HOME 和本机模拟模型的 `python3 verify_mac.py --report <全新临时目录>/verification.json` 验证当前源码，不使用真实用户会话。
- 文档与本体变化后运行 ontology 校验及相关 Python 单测、`git diff --check`。

## 测试与清单同步

- 新增六条宿主回归：旧标签关闭抛错、移除后的界面刷新抛错、关闭未生效，最后一个成功标签替换为空白对话，活动运行/关闭锁/手动关页保护，以及配置恢复失败前已发布空白标签。
- 修复前 `npm run build` 成功；最小相关复现 5 条中 4 条失败、1 条保护用例通过，失败均为实现缺陷：旧标签异常中断后续清理、最后一个标签被保留规则阻止。
- 首次修复后 `npm run build` 与六个相关测试文件共 261/261 通过。第一次原生检测退出 0、75 文件 1365/1365，通过三轮 pool 和公共 runner 交接；此证据保留，但后续界面补丁以最终报告为准，不与最终统计相加。
- 最终审查发现 Webview 的单纯关闭回执无法引入新建空白标签，配置恢复若抛错会阻断全量状态发布。补一条回归，补丁前失败，补丁后在配置恢复前发布完整标签状态，并在异步发布后核对当前选择。
- 最终从实际仓库执行 `python3 verify_mac.py --report <全新临时目录>/verification.json`，入口自行标准 build，未预热构建、减少轮数或更换 CLI。退出 0，75 文件 1366/1366，失败、取消、跳过及 TODO 均为 0；包含本次新增回归、五项存储/交接/完成门禁、生命周期、压缩、运行所有权及 Webview 关闭回执回归。
- 最终三轮 pool 原会话交接 42/41/43ms，公共 runner 44ms；原进程退出、stdio 关闭、临时目录清理及监督收尾全部确认。macOS arm64、Node 24.22.2、默认 PATH Codex 0.167.2、源码版本 1.9.11。隔离 HOME 与本机模拟模型，无真实模型费用。
- 最终证据目录：系统临时目录中的 `sinitek-subtask-tab-close-final-w8nulhe4/`，包含 `verification.json`、`verification.log`、`verification.runner.json`、`source-before.json` 与 `source-after.json`；阶段输出另存 `/tmp/subtask-tab-close-final-native-verification.log`。703 个源码、测试、脚本和配置文件的开始/结束指纹一致。
- ontology 完整性校验通过，ontology 技能单测 9/9 通过，`git diff --check` 通过。
- 功能清单、Loop 调度/会话复用设计、停止诊断 runbook 和对应 ontology 规则已同步；稳定根因与规避方式进入这些事实来源，无需重复写入占位热区、滚动摘要、事件记忆或新增 skill。
- 未验证物理 Windows/Linux、真实模型完整任务或图形 Extension Development Host；不涉及 Webview 样式改动，宿主状态发布与现有 Webview 协议由 Node 回归覆盖，未执行浏览器点击。`fullyVerified=false`，不宣称已安装或正在运行的扩展已更新。

## 任务列表

- [completed] 核对当前调用链与指定会话，复现遗漏路径。
- [completed] 完成最小修复与回归测试。
- [completed] 验证、同步事实来源并归档。

## 当前结论

指定会话持久化记录与用户提供的两条系统提示匹配；真实子任务调用为成功，压缩提示约一分钟后出现。当前相关日志没有该会话/attempt 的完整记录，不足以据此判定旧实例的确切根因或正在运行的扩展版本。CodeGraph 调用链与直接文件核对确认了现有关页入口，回归复现并修复两处当前仍存在的遗漏边界，补齐最后一个标签的界面同步与部分失败后的 runner 释放复核。所有最终约定检测通过，计划归档；没有改写用户会话或运行 JSON，没有发布或安装扩展。

memory-recall focus 为“Loop 子任务 完成 tab 自动关闭 验收 上下文压缩”，anchor 为空；热区为占位，采用当前源码、设计和归档计划核对。
