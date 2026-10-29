# CLI 缺失安装提示直接弹窗

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与历史核对

用户最初反馈 ZCode 未安装时没有一键安装提示，随后确认其他 CLI 也有同样现象。Windows 电脑切换分组后出现上下文确认，安装通知可以在 VS Code 右下角铃铛中找到，命令行确认找不到 ZCode。由此确认问题是安装提示可见性，而非安装检测或命令注册失效。

- `42a3761` 将版本升至 1.4.0，缺失安装提示使用非模态 `showWarningMessage`。
- `4a5190b` 新增分组切换的模态上下文确认；后续安装提示仍是普通通知。
- 当前共享检测与安装入口仍在，七种 CLI 的分组切换和未安装提示均已通过源码回放核对；没有证据表明安装逻辑被某次提交删除。
- 用户确认通知存在于铃铛，并明确要求直接弹窗。不推测具体通知过滤设置，也不把上下文确认提交误记为已证明的检测回归。

## 目标、范围与非目标

共享 `promptInstallMissingCli` 改用 VS Code 模态对话框，覆盖 Codex、Claude、OpenCode、Grok、DSH、KimiCode 和 ZCode。保留现有安装命令、可见终端、取消、设置与安装缓存失效逻辑。不修改检测策略、上下文确认、Codex 图片升级通知或其他并行任务。

## 验收标准

- 缺失 CLI 的安装确认使用 `{ modal: true }`，不再仅依赖铃铛中的普通通知。
- 即使普通通知被隐藏，仍出现包含“一键安装”和“打开设置”的模态安装确认。
- 用户明确选择安装后才显示终端并执行平台对应命令；取消和已安装状态不执行安装。
- Windows、macOS、Linux 均覆盖全部七种 CLI；ZCode 仍使用 `npm install -g zcode-app-cli@latest`。

## 影响面与风险

- 实现：`src/extension.ts`；回归：`src/test/extensionHost/cliInstallation.test.ts`。
- 事实来源：功能清单、CLI 运行时参考和 CLI 运行时本体。
- 模态确认会等待用户选择，用户取消即可继续；不自动安装，不改变安装完成的判定方式。
- 共享文件已有其他任务改动，仅追加本任务相关片段，不重置、不暂存、不提交无关代码。

## 验证计划

- 先补模态回归，确认旧实现无法通过，再增加模态选项。
- `npm run build`。
- `node --test --test-reporter=spec dist/test/extensionHost/cliInstallation.test.js dist/test/cli/installer.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/session/sessionTabCliSwitch.test.js`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- 不卸载或重装本机 CLI；本机不存在命令的只读探测已确认返回 false，现有 `zcode` 返回 true。
- 不改 Webview，浏览器页面冒烟不能验证 VS Code 原生模态框，使用真实扩展函数与模拟 VS Code API 验证；实际 Windows 窗口显示待用户更新插件后确认。

## 测试与清单同步

- 已覆盖全部 CLI 的模态、通知隐藏、安装、已安装、取消、设置回归，共 49 项安装确认测试；三平台均验证各自安装命令。
- 修复前 `npm run build` 通过，安装确认测试 7 项已安装用例通过、42 项模态相关用例按预期失败，错误为缺少 `modal: true`。
- 修复后 `npm run build` 通过，验证计划中的四个相关测试文件合计 88/88 通过。
- 本体完整性校验通过，ontology skill 单测 9/9 通过；相关代码及文档 `git diff --check` 通过。
- 已同步功能清单、运行时参考、ZCode 安装指南及本体的模态提示约定。
- 本机真实只读探测：`isCliCommandAvailable` 对临时不存在的绝对路径和裸命令均返回 false，对现有 `zcode` 返回 true；未更改安装状态或用户配置。
- 验证边界：原生窗口由实际扩展函数与模拟 VS Code API 验证，未启动真实 Extension Development Host，也未在用户的 Windows 电脑执行；未打包 VSIX 或发布。本轮提交与推送由后续 Git 收尾执行。
- 不新增热区事件记忆；诊断结论保留在本计划和运行时参考。

## 当前结论

已确认是普通通知可见性问题；共享安装确认增加模态选项后，所有 CLI 的缺失安装提示直接弹窗，普通通知隐藏场景仍可确认安装。安装命令、检测、上下文确认与取消行为不变。用户的 Windows 电脑需要安装包含本次改动的新插件并重新加载窗口后验证真实显示效果。
