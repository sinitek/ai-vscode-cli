# Codex 外来线程通知导致 Loop+ 续接误判占用

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

本机日志确认同一 Loop+ 的三个续接子任务在来源任务结束、上下文压缩完成后均立即收到 CODEX_THREAD_BUSY（不能强制交接）。排查通知路由是否把其它 thread 的通知归到唯一活动 listener，形成错误的占用记录；通过回归复现后修复。

## 范围与非目标

只调整 Codex pool 的通知归属及其回归、事实来源。不删除用户会话、修改任务持久化状态、杀外部进程或改变真实同会话操作互斥与交接释放证据。

## 验收标准

- 外来 thread 通知不产生虚假的 owner/loaded 状态，不进入其它会话正文。
- 首次 thread/start 通知、RPC 结果及显式父子线程仍正确绑定和路由。
- 真实活动 thread 仍不可抢占，独立任务保持并行。
- 构建、相关回归及隔离本机真实 Codex 验证通过，记录验收边界。

## 影响面与风险

- 代码：src/interactive/codexAppServerPool.ts、相关 interactive 回归。
- 文档：CLI 运行时参考、功能清单、ontology 及排障记录。
- 风险：冷启动通知可能先于 RPC 回包，需要保留按 thread 缓冲、由已确认绑定重放的机制；显式父子线程不得丢失。
- 缓解：补充通知在 RPC 前到达、外来通知、真实忙碌、父子关系的断言；回滚限定为本次差异。

## 验证计划与测试记录

- 先新增可复现失败的 codexThreadHandoff 回归，再修改实现。
- npm run build；node --test dist/test/interactive/codexThreadHandoff.test.js 及 pool/runner/Loop+ 相关用例。
- 本机隔离真实 CLI 使用临时 HOME 和本机模拟模型，不使用用户会话。
- 修复前：新增三条用例全部失败，其中两条稳定复现日志中的 CODEX_THREAD_BUSY；修复后最小四条（含子线程错误路由夹具）全部通过。
- npm run build：通过。npm run verify:loop-plus：退出 0，900/900 回归通过、零跳过；Windows ARM64、本机 Codex 0.162.1 三轮真实 pool 交接通过（60435 / 60170 / 60189 ms），每轮先复现原生 writer 冲突，再恢复原 thread、保留另一会话并确认进程/stdio/临时目录清理。公共 runner 通过，使用即时卸载且以 thread/closed 确认释放，交接 27 ms。
- 完整验证报告：`%TEMP%/sinitek-loop-plus-6dbdc768-5e0f-4dd5-87f7-b82376dd4dd4.json`；公共 runner 证据为同名前缀 `.runner.json`，日志为同名前缀 `.log`。最终 `loop_plus_fix_checked.passed=true`，`fullyVerified=false` 代表仅验证当前平台源码与隔离运行时，不代表已安装扩展或其它平台已验收。
- ontology 结构校验及九条单测：通过。Windows 默认 GBK 与 PYTHONIOENCODING=utf-8 混用曾导致子进程输出解码失败，分类为环境问题；统一设置 PYTHONUTF8=1、PYTHONIOENCODING=utf-8 后九条全部通过，未修改测试或产品编码规则。
- 相关回归首次 118/119：唯一失败是旧子线程错误夹具没有任何父子关系证据、依赖错误的唯一活动 listener 回退，分类为夹具问题。增加明确 thread/started 父子关系并保留错误隔离断言，最小复验与 900 项回归均通过。
- 功能清单、运行时参考、PITFALLS 与 ontology 已同步。未写入重复热区记忆，长期规避规则以 PITFALLS 与运行时参考为主。

## 当前进展

已确认通知路由中的唯一活动 listener 回退会误建 loaded/owner，从而拦截三个来源会话的续接。实现仅移除这条归属猜测，保留有证据的绑定与通知缓冲。recall focus 为 Loop+ Codex 会话 占用 交接 子任务，anchor 为空，索引仅基线命中，已回到当前代码与运行时参考核实。构建、相关回归、ontology 与本机 Codex 0.162.1 完整隔离验证均通过。源码修复未安装或重载当前 VS Code 扩展；实际使用需安装修复版并重载后显式继续原任务，未改写原任务状态或用户会话。
