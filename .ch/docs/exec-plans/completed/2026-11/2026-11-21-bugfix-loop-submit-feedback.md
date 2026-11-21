# Loop / Loop+ 提交等待反馈

- 日期：2026-11-21
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop / Loop+ 群聊的继续执行和主模型提问都经过宿主异步准备。让提交等待状态在点击时立即可见，并与宿主实际状态衔接。

## 范围与验收

- 继续提交后，群聊按钮有等待动画且禁用，任务启动或请求失败时清理等待状态。
- 主模型提问立即显示用户气泡和等待提示，宿主回传后按请求 ID 合并，连续发送、异常和中止均可收尾。
- 复用群聊现有主题、排队和回复等待表现，支持减少动态效果。

## 验证计划

- 运行 `npm run build`、群聊宿主和 Webview 相关单测、ontology 校验。
- 使用 Chromium 延迟回传，检查继续按钮和提问弹窗的等待与收尾。

## 任务列表

- [completed] 核对继续执行与主模型提问的状态和界面
- [completed] 补齐提交动画、按钮禁用和聊天等待反馈
- [completed] 验证延迟与失败场景并同步文档

## 验证结果

- `npm run build` 通过。群聊宿主、Webview、提问记录和部门群聊共运行 204 项单测，203 项通过。`loopPlusGroupChatPanel.test.ts` 的依赖标签测试在载入 `HEAD` 版群聊 Webview 时同样失败，失败发生在调度器的 `promotePending` 断言。
- Headless Chromium 加载实际生成的群聊 Webview，在经典 Loop 1050px 和 Loop+ 420px 下模拟延迟宿主消息。验证了按钮禁用和启动、失败后的动画清理，提问即时反馈、按 ID 合并、排队、回复、失败回填，以及减少动态效果下的静态指示。浏览器无脚本或网络错误。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 通过。已更新功能清单、产品规格及提问本体规则。
