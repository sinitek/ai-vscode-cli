---
name: local-real-testing
description: Use when a VS Code extension bug or CLI integration issue needs verification against the current machine's real local CLIs, user config, logs, Webview state, or Extension Development Host behavior after unit tests are insufficient. Do not use for ordinary pure unit-test-only changes or when real local state would require mutating user data without approval.
---

# Local Real Testing

目标：在单元测试无法覆盖真实 CLI、用户配置、VS Code 扩展宿主或 Webview 运行状态时，用最小、安全、可复现的本机真实测试补齐验证。

## 什么时候用

- 用户反馈“本机还是不行”“看日志”“真实跑一下”“配置确实存在但 UI 没展示”等环境相关问题。
- Bug 依赖本机 CLI、`~/.sinitek_cli/`、`~/.opencode/`、VS Code Extension Development Host、Webview DOM 或真实日志。
- 单元测试已经通过，但仍需要确认构建产物、面板状态、真实配置解析或真实 CLI 行为。
- 修复结果需要给出“真实运行命令 + 关键输出 + 结论”的证据。

## 什么时候不用

- 纯函数、解析器、样式快照或小范围逻辑能被单元测试完整覆盖。
- 需要改写用户真实配置、删除缓存、登录外部服务或执行破坏性命令，而用户没有明确批准。
- 只是泛化测试策略，不需要依赖当前机器状态。

## 工作流

1. 先明确真实假设：当前失败点、期望现象、单元测试覆盖不到的本机因素。
2. 先读后动：优先读取版本、日志、配置路径、构建产物状态；不要完整打印密钥、令牌、生产地址或客户数据。
3. 先构建再验证：Node 代码变更后运行 `npm run build`，再运行最小相关 `node --test dist/test/...`。
4. 真实探测优先只读：例如 `opencode --version`、解析真实配置、调用已导出的 resolver、检查面板状态生成结果。
5. 需要用户数据时默认只读；如果必须写入 `~/.sinitek_cli/`、`~/.opencode/` 或 VS Code 用户目录，先说明范围，备份并在同一流程恢复。
6. Webview/下拉/面板问题按边界分层验证：后端 state 是否有数据、Webview 是否收到 state、DOM/组件是否渲染选项。
7. 发现根因后补单元回归测试；如果是高复发踩坑，同步写入 `.ch/docs/runbooks/PITFALLS.md` 或对应事实来源文档。

## 常用命令形态

- 构建：`npm run build`
- 相关测试：`node --test dist/test/<target>.test.js`
- 真实 CLI 探测：`<cli> --version`、`<cli> <read-only command>`
- 真实配置验证：用 `node` 调用构建后的 resolver 或 host 流程，输入真实配置路径，输出脱敏后的关键 state。
- Extension Host 验证：确认加载的是最新 `dist`；必要时重启 Extension Development Host 或 reload window 后再复测。

## 交付记录

- 记录运行命令、环境来源、关键输出和实际结论。
- 明确哪些是单元测试覆盖，哪些是本机真实测试覆盖。
- 如果真实测试仍失败，保留下一步分界点：后端 state、消息传递、Webview 渲染、组件交互或缓存加载。
