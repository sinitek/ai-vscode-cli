# 群聊崩溃后找回原任务

- 日期：2026-11-28
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

修复群聊冷启动时页面绑定缺失、身份目录事务锁遗留和产研部组长标签缺失的恢复入口。普通 Loop、Loop+ 和部门续接继续使用各自的任务、会话和执行权限校验。

## 验收标准

- [x] 缺少页面绑定时，用户能在原工作区明确选择完整任务。已有绑定时可以按原身份重读。打开群聊后由用户发起执行。
- [x] 仅回收可核实为本机已退出进程的同一代事务锁。旧锁、活进程、不可核验的来源和未提交目录保留保护。
- [x] 缺少组长标签时，根据原任务和已保存的主会话核验归属后重建。
- [x] 首条主模型回复前中断及主标签丢失时，交互式主任务能找回同一个 CLI 会话，原消息可读，重复确认只发送一次。

## 风险与验证

隔离工作树复现了首条助手回复前会话健康检查解绑原生会话的问题。交互式主调用现在取得原生会话 ID 时即保存，续跑时核对主任务消息。旧任务缺少会话字段时，须用最近一次同任务主执行和对应会话消息核对归属。组长重建标签还需核对工作区、角色、标签占用及部门运行权限。

- 主工作区构建与 ontology 校验通过。10 个相关测试文件共 421 项全部通过，覆盖工作区不符、取消、并发回收、持锁进程实际退出、未提交目录和会话冲突。
- 在 macOS arm64 的 VS Code 1.144.0 隔离宿主中，用合成 Loop+ 任务和本地 DSH 替身验证了窗口重载、完整重启、主标签记录丢失和运行中强制退出。四个场景均复用原 CLI 会话，重复确认后各记录一次主任务续跑，插件错误为零。
- 强制退出场景在任务仍为 `running` 时向隔离的 VS Code 进程发送 `SIGKILL`。重启后打开原群聊，手动继续时核对原消息及续跑使用的会话 ID。四份宿主报告位于 `.tmp/loop-plus-protocol-regression/group-continue-*-last.json`。
- 已同步功能清单、群聊状态边界、崩溃恢复设计、排障手册和 ontology。

## 复跑命令

在 macOS 的 zsh 中，从仓库根目录执行。

```sh
npm run build
node --test dist/test/extensionHost/{departmentruntimecomposition,loopCrashRecovery,loopMainDecisionParsing,promptInteractiveRuntime,promptSessionHealth}.test.js \
  dist/test/loop/{loopGroupChatCoordinator,loopTaskIdentityLockRecovery,loopTaskStorePersistence}.test.js \
  dist/test/session/{conversationTabLock,sessionLifecycleCoreCoverage}.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
node scripts/loop_plus_protocol_regression_smoke.cjs \
  --scenario=group-continue-reload --scenario=group-continue-restart \
  --scenario=group-continue-restart-missing-main --scenario=group-continue-crash
```
