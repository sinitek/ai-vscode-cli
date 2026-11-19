# 产研部对话 Tab 悬停摘要

- 日期：2026-11-19
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

现有产研部 Tab 将角色、模块和任务 ID 拼成提示。总监 Tab 需显示 Vibe 同款 AI 摘要，组长和员工 Tab 需复用群聊成员标题。

## 范围与验收

- [x] 新建总监任务在身份绑定后捕获原始需求，复用现有异步摘要生成、持久化及历史展示。用户提交的续接需求在成功保存后更新摘要快照。
- [x] 可信组长和员工 Tab 显示与群聊成员面板相同的完整标题。
- [x] 构建、摘要与角色投影回归、真实 Webview 验证通过。已同步功能清单、设计与本体。

## 影响面与风险

- 对话 Tab 宿主、总监启动、群聊成员标题及隔离宿主验证夹具。
- 摘要沿用现有提交去重及会话归属。成员标题沿用可信记录和执行会话匹配。
- 当前工作区含前序未提交改动，按文件最小增量实施并保留现有改动。

## 验证计划

- `npm run build`，定向运行会话摘要、产研部投影、总监启动和 Webview 浮层测试。
- 使用真实 VS Code Webview 验证历史摘要与成员标题，使用已有摘要队列测试验证生成与持久化。

## 任务列表

- 已完成数据来源核对、摘要捕获、角色投影、回归、浏览器验证及文档同步。

## 测试与清单同步

- `npm run build` 通过。会话、摘要队列、总监启动和续接、成员面板及浮层共 175 项回归通过。初次单测失败归类为缺少 `isTabRunActive` 依赖的测试夹具，补齐后重跑通过。
- `node scripts/department_conversation_tabs_smoke.cjs` 在 1280 和 280 像素视口通过。使用鼠标悬停和键盘聚焦核对三类正文。两种主题均通过，浏览器错误为空。
- 设置现有 `PLAYWRIGHT_MODULE` 后运行 `node scripts/verify_department_conversation_host.js --task-summaries-only`，真实 VS Code 宿主从持久化会话恢复总监摘要与完整成员标题，浏览器错误为空，宿主正常退出。报告路径为 `/tmp/sinitek-dept-conversation-Ru6ICU/report.json`。
- 完整宿主脚本先通过了本次浮层断言，随后在模式选择器断言中返回 `coding`，预期为 `department`。报告路径为 `/tmp/sinitek-dept-conversation-XeOHve/report.json`。本次摘要生成使用已有队列的回归证据，宿主验证使用隔离历史夹具。
