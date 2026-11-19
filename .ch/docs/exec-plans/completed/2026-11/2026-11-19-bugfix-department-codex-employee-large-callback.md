# 产研部 Codex 员工大回调传输修复

- 日期：2026-11-19
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/active/2026-11-18-bugfix-department-codex-large-callback.md`（复用组长已有分帧与重组协议，不改变该计划的验收状态）
- 状态：completed
- 负责人：Codex

## 背景与目标

本地主干合并 `29ed50c6` 后只读核对 2026-11-19 产研部失败记录。五个 Codex 员工的原 Owner 均已从未绑定更新为绑定，原生会话有 `task_started`。多次宿主通道错误紧邻工具完成事件：约 50 KiB 原始 `aggregatedOutput` 经兼容映射产生同值 `aggregated_output`，转发事件超过员工 Owner 的 64 KiB 单帧上限，发送失败断开通道。目标是让合法大回调完整、有界地送达，不增加执行授权或降低清理门禁。

## 范围与非目标

- 员工 Worker 到扩展宿主的私有 Codex 回调分帧、重组、ACK 与读取背压。
- 不改公共 Owner 消息、既有配置或历史任务记录；不重试原执行，不绕过凭证释放旧容量。
- 不改变组长、普通 Codex 或其它 CLI 的现有协议行为。

## 验收标准

- 小于 64 KiB 的原生工具完成事件经兼容转换超过 64 KiB 时，员工宿主完整、按序且只消费一次，两种输出字段保持一致。
- 多字节工具输出以 UTF-8 字节计量；未完成回调不允许确认终态；仍只发一次 `turn/start`。
- 继续校验原 token、identity、序号与当前阶段，有界条件或消费者失败时不得当作清理成功。

## 影响面、风险与缓解

- `src/runtime/departmentcodexownerworker.ts`、`src/extensionHost/departmentcodexbootstrap.ts` 和相关测试，复用组长的回调协议实现。
- 分帧可能造成重组内存增长或确认乱序；沿用既有逐帧限制、总字节预算、完整性校验与单 ACK，不扩展请求权限。
- 同步生产启动设计、功能清单与 ontology 观测规则，无配置迁移或发布步骤。

## 验证与结论

- 未修复版本运行 `node --test --test-name-pattern='employee delivers large' dist/test/runtime/departmentcodexbootstrap.test.js`，复现 `department-codex-owner-channel-unobservable`；修复后同一用例通过。用例验证 51 KiB 兼容事件、多字节大输出、异步消费前不读终态、输出完整有序和唯一 `turn/start`。
- 扩大回归第一轮的旧断言要求员工在接收回调 ACK 前先读到下游终态。加入读取背压后该顺序不再成立，更新断言，仍验证未消费不能确认完成。最终 `npm run build` 及下列组合通过，369/369 项，零跳过。

```sh
node --test --test-concurrency=1 --test-reporter=spec \
  dist/test/runtime/departmentcodexbootstrap.test.js \
  dist/test/runtime/departmentcodexexecutionlauncher.test.js \
  dist/test/runtime/departmentcodexresourcerelease.test.js \
  dist/test/runtime/departmentleadercallbackprotocol.test.js \
  dist/test/runtime/departmentleadercodexowner.test.js \
  dist/test/runtime/departmentexecutionowner.test.js \
  dist/test/runtime/departmentexecutionownerclient.test.js \
  dist/test/interactive/codexAppServerProtocol.test.js \
  dist/test/extensionHost/departmentcodextabrelease.test.js \
  dist/test/extensionHost/departmentgroupcapacity.test.js \
  dist/test/extensionHost/departmentproductioncomposition.test.js \
  dist/test/extensionHost/departmentruntimecomposition.test.js \
  dist/test/extensionHost/loopPlusRuntimeIntegration.test.js
```

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`（9/9）及 `git diff --check` 通过。
- 验证使用本机真实 Worker 子进程与模拟原生 Codex 协议，没有重放旧任务、运行真实模型或验证已安装 VS Code 插件；旧 Owner 的未知清理和保留容量不由本补丁改写。
