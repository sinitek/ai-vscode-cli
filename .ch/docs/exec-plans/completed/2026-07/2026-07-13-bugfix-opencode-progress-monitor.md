# OpenCode 子代理进度监控修复

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：1 day
- handoff_to：已由 2026-07-13 原计划拆分归档

## 背景与目标

原计划记录“已交付的 OpenCode 子代理气泡”使用 `opencode run --port`，但 OpenCode 1.17.18 虽接受参数却未监听该端口，持续触发 `ECONNREFUSED`。目标是修复现有监控能力的数据源，同时在监控不可用时安全降级。来源没有给出对应发行版本号；本记录不补造具体 release/version 声明。

## 范围与非目标

- 采用健康检查通过的受管 `opencode serve`，通过 `run --attach` 读取 HTTP/SSE 事件；服务按运行尝试管理并清理。
- 监控不可用时展示一次低噪音降级反馈；SSE 重连指数退避最长 60 秒。
- 不改 Loop 子任务父 tab 进度桥接（见 [feature 计划](2026-07-13-feature-loop-opencode-progress-monitor-repair.md)），不把 OpenCode 子任务伪装为 Codex App Server child session。
- 文档同步独立记录在 [docs 计划](2026-07-13-docs-progress-monitor-references.md)。

## 验收与实际结果

- [x] 停止依赖未监听端口的 `run --port`，改用受管 `serve + /global/health + run --attach`。
- [x] attach 传输使用 JSONL/SSE；健康检查失败时降级，不阻断父任务。
- [x] 失败重试采用最长 60 秒指数退避，服务生命周期退出时清理。
- [x] 原计划报告 build 通过、10 个相关测试文件共 100/100 通过。此为原任务对 Loop/OpenCode 多域共同运行的结果，未提供逐文件结果，不声称是本拆分计划独享计数。
- 原计划记录首轮测试回调变量被 TS 推断为 `never`，归类测试夹具问题，改用回调数组后重跑通过。
- 原计划真实 CLI 冒烟确认 `/global/health` 和 `run --attach` JSONL 传输可用；手工服务未注入插件私有配置，模型请求返回 `UnknownError`，来源明确没有将其误判为 attach 失败。此未决限制保留。

## 风险、验证与结论

- 若服务未就绪或端口冲突，监控降级而主任务继续；额外服务必须在成功、失败、中断路径 dispose。
- 历史验证入口：OpenCode monitor/command runner 相关 Node tests、`npm run build`、attach 数据传输冒烟和差异检查；来源报告以上测试/build/diff 通过，但缺少具体命令和退出码。
- 该交付修复了原文明确称为“已交付”的现有能力，因此归类 `bugfix`；原文未指定发行版本，本计划不声称哪个版本已发布或修复。
- 状态沿用原计划 `completed`；这里仅拆出 OpenCode 监控交付及它对应的历史结果、失败线索和风险。
