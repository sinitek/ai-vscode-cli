# 修复产研部组长会话继续

- 日期：2026-11-21
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景和目标

本机首轮执行记录及群聊提问历史与普通历史会话拒绝日志对应。组长任务保存了原生会话，组长回合后的通用自动压缩及群聊提问却要求独立的普通会话映射。让组长继续复用原执行会话和权限。

## 范围和验收

- 组长回合结束时跳过通用自动压缩。群聊提问复用原 Owner 和现有队列，保持串行和取消语义。
- 组长续接遵守产研部调度和组织恢复门禁，普通临时会话仍按原有规则处理。
- 补充定向回归，验证构建、组织运行路径及 ontology，更新对应用途说明。

## 风险和回滚

组长提问必须与调度回合共用同一队列，避免同一会话并发执行。保留任务、Tab、代次和原生会话核验。回滚范围为本计划的代码、测试和文档改动。

## 验证与进展

- 本机只读排查确认报错组长的调度模式为 `event_driven`，任务保留 `executionSession`。首条报错出现在组长首轮结束后，后续报错与组长群聊提问历史一致。
- `npm run build` 通过。`node --test dist/test/extensionHost/{loopPlusEntryRouting,promptInteractiveRuntime}.test.js dist/test/loop/departmentGroupChatHost.test.js` 共 125/125 通过，覆盖本地键与原生会话分离、复用原 Owner、队列和取消、缺会话拒绝及弹窗归属失效。
- `node --test dist/test/extensionHost/department{runtimecomposition,runtimeintegration,interactiveruntime}.test.js dist/test/runtime/departmentleadercodexowner.test.js dist/test/extensionHost/{extensionHostExtractionContracts,loopPlusRuntimeIntegration}.test.js` 共 275/276 通过。普通 Loop+ 配置锁续跑用例仍匹配旧按钮 HTML，当前渲染已有加载动画 `span`，属于本次修改范围外的旧断言。
- `node scripts/verify_department_full_eh_integration.js --scenario stop-continue --product <实体隔离产品> --report <全新报告>` 通过。首跑缺少隔离 `src` 导致夹具启动失败，复制源码后通过。macOS 上使用已安装 VS Code 及 Codex CLI，19 次本机确定性 Responses 请求无协议错误，公开停止与继续保留组长任务及原生会话，后继验收、总监汇报、回执与容量归还均通过。群聊提问路由由定向回归验证，其它平台和远程模型未运行。
- 已同步功能清单、群聊设计、踩坑手册及 ontology。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。
