# VS Code 配置页 Zen Mode 全屏承载

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex 当前任务
- claimed_at：2026-07-31
- claim_ttl：当前任务完成前
- handoff_to：
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-31-docs-vscode-config-zen-mode-popup.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

当前配置中心虽然已经使用编辑器主区域的 `WebviewPanel`，但用户仍能看到它作为普通编辑器内容区打开。用户期望打开后尽量像 VS Code 内的全屏弹窗，减少侧栏、底部面板和其他工作台区域的干扰。

VS Code 扩展公开 API 不提供可承载任意 Webview 的原生模态全屏窗口。当前可支持的最接近行为是配置面板显示后执行 VS Code 内置 `workbench.action.toggleZenMode`，由 VS Code 隐藏工作台外围；面板销毁时恢复 Zen Mode。

## 目标

1. 配置面板新建或重复打开时进入 VS Code Zen Mode，并确保面板获得焦点。
2. 配置面板关闭后恢复打开前由本插件进入的 Zen Mode 状态。
3. 内置命令不可用或执行失败时保留普通 WebviewPanel 功能，不阻断配置中心。
4. 为进入、复用、销毁恢复和失败回退提供可验证接口；独立测试开发不归本记录（原test计划已删除），用户文档仍归关联docs。

## 范围

- `src/webview/configPanel.ts` 的全屏宿主生命周期。
- 本记录仅负责宿主生命周期；独立命令调用测试不归本记录（原test计划已删除），设计/能力规格/兼容入口写作仍归关联docs。

## 非目标

- 不实现 Electron/OS 原生独立窗口或外部浏览器页面。
- 不改动配置 Webview 的业务协议、数据服务、静态资源和现有主题样式。
- 不强制修改用户的持久化 VS Code 工作台布局。

## 验收标准

- [x] 配置页首次打开后执行一次 Zen Mode 并聚焦配置 Webview。
- [x] 重复打开只复用面板，不重复切换 Zen Mode。
- [x] 配置页销毁后恢复本插件进入的 Zen Mode；命令失败时不影响面板。
- [x] 相关测试、TypeScript build 和差异检查通过。
- [x] 实现仅为VS Code Zen Mode全屏近似，未引入原生模态窗口；用户说明由关联docs验收。

## 影响面

- 代码目录：`src/webview/`
- 文档影响及写作责任：见关联docs。
- 配置与脚本：不新增依赖和配置

## 风险与缓解

- 风险：`workbench.action.toggleZenMode` 属于 VS Code 工作台命令，未来版本或 Web 环境可能不可用。
- 缓解：统一捕获命令错误并记录日志，配置面板仍按普通编辑器面板继续工作。
- 风险：关闭面板期间用户手动改变 Zen Mode，自动恢复可能与用户操作竞争。
- 缓解：只在本插件成功进入 Zen Mode 后记录一次恢复责任，重复打开不重复切换。

## 验证计划

- 最小相关验证：配置面板生命周期测试。
- 单元自测命令：`npm run build`；`node --test dist/test/cliPageConfigCoverage.test.js`。
- 扩展验证：`git diff --check`；在 Extension Development Host 中确认打开、关闭和普通回退行为。

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-31-docs-vscode-config-zen-mode-popup.md#范围与非目标)，不属于本实现范围。

## 任务列表

- [x] 修改配置面板的 Zen Mode 生命周期和失败回退。
- [x] 实现接口的历史验证证据留存删除审计（不接回测试开发），API边界说明由关联docs编写。
- [x] 执行 build、相关测试和差异检查并归档计划。

## 决策记录

- 2026-07-31：采用 VS Code Zen Mode 作为最接近“全屏弹窗”的宿主行为；不引入外部浏览器或未授权的 Electron 窗口技术。

## 当前结论

已完成。配置页打开时前台聚焦并尝试进入 Zen Mode，重复打开不重复切换，关闭后恢复；命令不可用时回退为普通编辑器 Webview。真正的 VS Code 原生模态 Webview 弹窗不在扩展公开 API 能力范围内。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
