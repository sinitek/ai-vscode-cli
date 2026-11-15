# 历史会话用户提示词与派生任务标记

- 日期：2026-11-13
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop+ 主模型内部协议被保存到会话 firstPrompt，历史列表直接展示英文协议开头。历史主任务应展示用户原始需求，子任务按归属显示 🌛，不因使用主模型而成为主任务。

## 范围与验收标准

- 历史会话投影从有效首条用户消息或任务 rootPrompt 恢复标题，兼容已有协议 firstPrompt；不改写原始消息和模型协议。
- 关联 loopSubtaskId 或子任务 executionSession 的派生会话显示 🌛；主会话保持 ☀️，后续普通 Vibe 消息仍取消角色标记。
- 用户自定义标签及正常首条提示词保持原值；任务记录缺失时安全回退，不展示内部协议。
- 同步功能清单与 ontology，并覆盖主任务、主模型执行的子任务、旧记录及边界。

## 影响面与风险

- 代码：历史会话摘要、任务角色解析、sessionTabs 宿主。
- 风险：错误覆盖正常用户需求或自定义标签；通过仅识别既有内部协议前缀及回归测试约束。
- 回滚：撤回投影修复；保留模型执行协议与原始会话消息。

## 验证计划

- `npm run build`；历史摘要、任务角色、历史列表及 sessionTabs 相关单测。
- 本机只读汇总验证已有会话，不输出用户正文、不修改运行数据。
- 未改变 Webview DOM/CSS，优先使用现有列表渲染回归验证。

## 当前进展

- 已通过 CodeGraph 和当前源码确认：Loop+ buildMainRequest 的 prompt/modelPrompt 相同；历史列表优先展示 record.firstPrompt。
- 本机只读汇总发现 113 条协议 firstPrompt，关联的 2126 条协议用户消息均为 taskRole=main 且无 loopSubtaskId。
- 历史列表对旧 reviewer 协议提示词优先显示绑定任务的 rootPrompt / 子任务 prompt；没有映射时不展示内部协议。
- 子任务 executionSession 绑定作为角色信息补充；最新普通 Vibe 用户消息仍会移除角色图标。角色缓存区分主/子任务绑定。
- 已新增会话投影和角色回归测试；产品能力清单与 ontology 已同步。

## 测试与清单同步

- `npm run build`：通过。
- `node --test dist/test/session/historySessionProjection.test.js dist/test/session/historySessionTaskRole.test.js dist/test/session/historySessionLoop.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js`：52 项通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；ontology 单测 9 项通过。
- `node scripts/check_trailing_whitespace.js <本次改动文件>` 与 `git diff --check`：通过。
- 本机只读数据汇总：发现 113 条协议 firstPrompt；30 条存在父任务映射。运行时数据未改写。
- Chromium 验证未运行：没有改变 Webview DOM、样式或交互实现，宿主摘要行为由单测覆盖。
