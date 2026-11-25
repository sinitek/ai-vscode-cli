# Webview 弹窗关闭入口统一

- 日期：2026-11-25
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 范围与验收

聊天面板、Loop / Loop+ 群聊、产研部及 CLI 配置管理的弹窗在右上角提供可访问的 SVG 关闭控件。沟通文件等弹窗的页脚只保留实际操作。保留关闭后的焦点还原、取消处理和正在提交时的限制。VS Code 原生弹窗由宿主控制。

## 实现与影响

Webview 共享标题栏要求传入关闭配置，配置管理通过 Ant Design 共用 SVG 路径和确认弹窗入口。复用各页面已有的点击和取消处理。同步功能清单、运行时设计和产研部 UI 契约。关闭入口迁移保持业务概念、权限和状态转换，现有 ontology 来源仍有效。

## 验证

- 隔离工作树 `npm run build` 成功。`node --test` 执行 `dist/test/webview`、`dist/test/config` 和三个群聊 Webview 测试文件，共 1614 个通过。首次执行发现 VM 夹具缺少共享关闭配置和 Ant Design 模拟，补齐后通过。
- Chromium 显示夹具验证普通群聊在 1440 px 和 320 px 的沟通文件预览。标题栏有唯一 SVG 关闭控件，Enter 和 Escape 退出后焦点回到打开入口。产研部现有焦点冒烟脚本覆盖嵌套预览点击关闭和 Escape。
- Chromium 使用本地桥接夹具验证 CLI 配置导出、导入、删除确认、配置范例抽屉和保存错误。关闭删除确认未发送删除请求。配置夹具允许本机同源脚本以加载 Monaco Worker。本次浏览器验证覆盖生成的 Webview 与模拟宿主交互。
- 共享工作区 1.10.4 执行 `npm run build` 通过。`node --test --test-reporter=tap dist/test/webview/*.test.js dist/test/config/*.test.js dist/test/loop/{loopGroupChatPanel,departmentGroupChatPanel,departmentGroupChatHost}.test.js` 共 1614 个通过。两份 JavaScript 文件语法检查、补丁检查和 ontology 校验通过。
