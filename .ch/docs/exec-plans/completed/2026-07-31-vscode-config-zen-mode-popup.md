# VS Code 配置页 Zen Mode 全屏承载

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex 当前任务
- claimed_at：2026-07-31
- claim_ttl：当前任务完成前
- handoff_to：

## 背景

当前配置中心虽然已经使用编辑器主区域的 `WebviewPanel`，但用户仍能看到它作为普通编辑器内容区打开。用户期望打开后尽量像 VS Code 内的全屏弹窗，减少侧栏、底部面板和其他工作台区域的干扰。

VS Code 扩展公开 API 不提供可承载任意 Webview 的原生模态全屏窗口。当前可支持的最接近行为是配置面板显示后执行 VS Code 内置 `workbench.action.toggleZenMode`，由 VS Code 隐藏工作台外围；面板销毁时恢复 Zen Mode。

## 目标

1. 配置面板新建或重复打开时进入 VS Code Zen Mode，并确保面板获得焦点。
2. 配置面板关闭后恢复打开前由本插件进入的 Zen Mode 状态。
3. 内置命令不可用或执行失败时保留普通 WebviewPanel 功能，不阻断配置中心。
4. 用测试覆盖进入、复用、销毁恢复和失败回退，并同步用户可见能力文档。

## 范围

- `src/webview/configPanel.ts` 的全屏宿主生命周期。
- `src/test/cliPageConfigCoverage.test.ts` 的命令调用断言。
- `.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与兼容入口文档。

## 非目标

- 不实现 Electron/OS 原生独立窗口或外部浏览器页面。
- 不改动配置 Webview 的业务协议、数据服务、静态资源和现有主题样式。
- 不强制修改用户的持久化 VS Code 工作台布局。

## 验收标准

- [x] 配置页首次打开后执行一次 Zen Mode 并聚焦配置 Webview。
- [x] 重复打开只复用面板，不重复切换 Zen Mode。
- [x] 配置页销毁后恢复本插件进入的 Zen Mode；命令失败时不影响面板。
- [x] 相关测试、TypeScript build 和差异检查通过。
- [x] 文档明确说明这是 VS Code 内 Zen Mode 全屏近似，不是原生模态弹窗。

## 影响面

- 代码目录：`src/webview/`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`docs/`
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

- 单元测试新增/更新：更新 `cliPageConfigCoverage.test.ts`，覆盖 Zen Mode 进入、复用和销毁恢复。
- 单元自测结果：`npm run build` 通过；配置相关 `node --test dist/test/cliPageConfigCoverage.test.js dist/test/cliPageStaticRenderCoverage.test.js dist/test/configappcompactcontrols.test.js dist/test/configappcompactlayoutstyles.test.js` 通过，32/32；`node --check media/config/assets/config-app-ui.js` 通过；`git diff --check` 通过。
- 失败处理记录：本轮没有失败；未启动 Extension Development Host，因为当前环境没有可用的 `code` CLI，人工视觉验收未执行。
- 功能清单：同步配置中心打开行为和 VS Code API 限制。
- 相关文档同步：同步运行时设计说明及兼容入口。

## 任务列表

- [x] 修改配置面板的 Zen Mode 生命周期和失败回退。
- [x] 补充配置面板行为测试。
- [x] 同步事实来源和兼容入口文档。
- [x] 执行 build、相关测试和差异检查并归档计划。

## 决策记录

- 2026-07-31：采用 VS Code Zen Mode 作为最接近“全屏弹窗”的宿主行为；不引入外部浏览器或未授权的 Electron 窗口技术。

## 当前结论

已完成。配置页打开时前台聚焦并尝试进入 Zen Mode，重复打开不重复切换，关闭后恢复；命令不可用时回退为普通编辑器 Webview。真正的 VS Code 原生模态 Webview 弹窗不在扩展公开 API 能力范围内。
