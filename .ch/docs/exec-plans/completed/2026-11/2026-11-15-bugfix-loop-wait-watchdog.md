# Loop / Loop+ 等待巡检恢复

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

子任务失联或完成回调丢失可能让经典 Loop 批次 Promise 或 Loop+ 调度预留永久等待。宿主每 5 分钟检查两条路径，在没有真实活动子任务时唤醒主任务检查结果。

## 范围与验收

- 经典 Loop 同时覆盖未结束的批次调用及中断后等待；Loop+ 核对实际调用与调度预留。
- 准备启动、会话锁、压缩、重试等待、真实执行中的子任务均阻止误恢复。
- 失联以异常而非成功交给主任务；经典模式继续协调，Loop+ 保留验收与修复门禁。
- 已停止、暂停、完成、等待澄清及主模型失败限制不得复活；迟到回调不得覆盖新状态。
- 不变更技术栈、不发布扩展、不增加界面配置，不自动恢复已关闭宿主的任务。

## 影响与风险

- 代码：共享巡检时钟、经典编排、Loop+ 编排/适配器、扩展宿主接线及测试。
- 文档：功能清单、调度/恢复设计、ontology。
- 主要风险是把准备阶段误认为失联；仅已开始调用且无真实执行所有权时判失联，准备/收尾仍算活动。恢复前检查父任务状态及其它活动子任务。
- 回滚：撤销巡检接线及相关 host 变更，恢复原回调驱动等待。

## 验证计划

- `npm run build`，相关 Node 单测覆盖 5 分钟时钟、经典失联与正常等待、Loop+ 唤醒去重和拒绝恢复。
- 本机隔离运行验证实际定时器与进程退出后的恢复，不调用付费模型或用户配置。
- ontology 校验及 skill 自测；`git diff --check`。

## 进展

- 已确认原有回调驱动路径、真实 Tab 执行所有权与显式恢复门禁。
- 已实现共享 5 分钟巡检时钟并接入两种 host；扩展释放时清理时钟。
- 经典 Loop 保存批次等待上下文，失联后解除本批活动 ID、保留 blocked 结果并交回原主编排；手动续跑和切模型后全部完成时立即交回原控制器，避免重复启动。
- Loop+ 将失联 attempt 以 failed 进入原验收流程，同轮多个失联回报合并唤醒；取消失联等待会释放会话锁、完成订阅和执行根。
- 已覆盖准备、启动交接、压缩、重试、活动兄弟及手动续跑保护；停止、暂停、澄清、完成和主模型失败上限不自动复活，迟到回调不覆盖结果。
- 已将改动合回原工作区；共享 ontology 和功能清单采用三方合并，并核对并发会话后续变化，仅交付本任务差异。

## 测试与清单同步

- 最终工作区 `npm run build` 通过，日志 `/tmp/loop-watchdog-workspace-build.log`。
- 相关回归 843/843 通过，无跳过，日志 `/tmp/loop-watchdog-workspace-tests.log`。选择范围为 `dist/test/loop/*.test.js`（排除 `loopPlusGroupChatPanel.test.js`）、`dist/test/extensionHost/loop*.test.js`（排除 `looppluscodexrepairintegration.test.js`），另加 `subtaskCliExecution.test.js` 和 `extensionHostExtractionContracts.test.js`。实际执行命令如下：

  ```sh
  node <<'JS'
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const files = [
    ...fs.readdirSync('dist/test/loop').filter(name => name.endsWith('.test.js') && name !== 'loopPlusGroupChatPanel.test.js').map(name => 'dist/test/loop/' + name),
    ...fs.readdirSync('dist/test/extensionHost').filter(name => /^loop.*\.test\.js$/.test(name) && name !== 'looppluscodexrepairintegration.test.js').map(name => 'dist/test/extensionHost/' + name),
    'dist/test/extensionHost/subtaskCliExecution.test.js',
    'dist/test/extensionHost/extensionHostExtractionContracts.test.js',
  ];
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
  JS
  ```

- 本机隔离集成验证：启动真实 Node 子进程以状态 9 退出，同时保持调用 Promise 悬挂；推进受控时钟后确认失败验收、沟通文件、会话锁/订阅/执行根释放和迟到结果保护。5 分钟边界由受控时钟推进，无真实模型调用。
- 扩大回归时 861 项中 851 通过、10 项失败，日志 `/tmp/loop-watchdog-final-tests.log`。失败分类为历史失败：压缩/修复集成 5 项等待 `review dispatched B while compact is pending` 超时，群聊面板 5 项旧界面断言失败。
- 严格基线证据：从 `5aad2303151d77965272505c49d53db08956f0bd` 用 `git archive` 导出不含工作区修改的源码，独立构建后执行 `node --test dist/test/extensionHost/looppluscodexrepairintegration.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`，20 项中 10 通过、相同 10 项失败，无跳过。日志 `/tmp/loop-watchdog-clean-baseline-build.log`、`/tmp/loop-watchdog-clean-baseline-tests.log`；因此本任务未扩大到修复压缩夹具或旧 UI 断言。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 的 9 项自测通过；`git diff --check` 通过。
- 功能清单、能力清单、架构、恢复/调度设计和 ontology 已同步。
- 验证边界：macOS 本机源码与隔离运行时通过；未运行真实 VS Code 图形宿主、付费模型、Windows/Linux 或已安装扩展验证，不表示这些环境已验收，也未发布扩展。
- 热区记忆：稳定行为进入设计文档，不新增重复热区记录。
