# ZCode 一键终端安装修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

ZCode 复用所有 CLI 的缺失检测与安装提示，但安装器将其安装命令特判为空，点击“一键安装”后只打开命令设置。用户已确认 Windows、macOS、Linux 统一使用 `npm install -g zcode-app-cli@latest`，本次恢复既有终端安装流程。

## 范围与非目标

- 在现有 npm 安装命令注册表中接入 ZCode，移除空命令分支。
- 补充跨平台安装命令及扩展宿主安装提示回归测试，同步安装说明和本体。
- 不新增下载页、源码构建或独立安装机制；不修改其他并行任务的工作区改动。
- 本机已经能执行 `zcode --version`，不重复安装、不修改用户配置。

## 验收标准

- Windows、macOS、Linux 的 ZCode 安装命令均为用户确认的命令。
- 缺失时切换到 ZCode，提示“一键安装”；确认后创建并显示 VS Code 终端，发送安装命令、清理检测缓存，不误跳设置。
- 已安装时不提示、不重复安装；取消和打开设置保持原有行为。
- 构建、相关单测及本体校验通过，安装文档不再声明 ZCode 没有安装命令。

## 影响面与风险

- 代码：`src/cli/installer.ts`；复用 `src/extension.ts` 的现有编排，不修改其安装流程。
- 测试：`src/test/cli/installer.test.ts`、`src/test/extensionHost/cliInstallation.test.ts`。
- 文档：ZCode 指南、CLI 运行时参考、功能总表和 CLI 运行时本体。
- 风险：新包分发与网络可用性由 npm 和用户环境决定；沿用可见终端执行，不伪报安装完成。
- 回滚：恢复安装命令注册表及相关测试与文档即可，不涉及持久化迁移。

## 验证计划

- 先只更新回归测试，构建并确认旧实现出现预期失败，再修复安装命令。
- `npm run build`。
- `node --test --test-reporter=spec dist/test/cli/installer.test.js dist/test/extensionHost/cliInstallation.test.js dist/test/cli/codegraphInstaller.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/cli/commandRunnerCoreBranches.test.js`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- 本机只读验证：`zcode --version`；模拟未安装场景，不卸载、不重装真实 CLI。
- 未修改 Webview，无需 Chromium 页面验证；终端调用由实际扩展函数与模拟 VS Code API 验证。

## 测试与清单同步

- 单元测试：覆盖三平台终端安装、已安装、取消及打开设置。
- 修复前验证：构建成功，相关 10 项用例中 5 项预期失败，确认 ZCode 返回空命令、三平台安装动作没有创建终端。
- 环境记录：首次构建因另一个任务同时写入 `dist/`，清理阶段出现 `ENOTEMPTY`；未终止其他进程，重试构建通过，归类为并行构建环境冲突。
- 修复后自测结果：`npm run build` 通过；最终定向测试 45/45 通过；ontology validate 通过，ontology skill 测试 9/9 通过；相关文件空白校验通过。
- 扩展检查：`node --test --test-reporter=spec dist/test/cli/cliCommandRepair.test.js` 为 5/8 通过。三个失败均为既有断言遗漏 `zcode`：命令缺失报告、裸命令启动修复计划、注册表查询失败后继续修复。`git diff --exit-code HEAD -- src/cli/types.ts src/cli/cliCommandRepair.ts src/test/cli/cliCommandRepair.test.ts` 无差异，HEAD 的 CLI_LIST 已包含 ZCode，修复模块不依赖安装命令注册表。归类为历史测试断言过期，本次不修改。
- 功能清单与本体：已同步 ZCode 一键终端安装规则，保留其他任务已有改动。
- 记忆判断：事实收口到安装指南和运行时参考，不重复写入热区记忆。
- 验证边界：三平台安装动作通过真实扩展函数与模拟 VS Code API 验证；未启动真实 Extension Development Host，未执行网络安装或卸载现有 ZCode。

## 当前结论

修复与定向验证完成：ZCode 现在与其他 npm CLI 共用终端一键安装路径，命令为 `npm install -g zcode-app-cli@latest`。已安装、取消和打开设置保持原有行为。本机 `zcode --version` 输出 `0.17.0`，未重复安装。相关文档与本体已同步；范围外旧测试失败已分类并保留证据。
