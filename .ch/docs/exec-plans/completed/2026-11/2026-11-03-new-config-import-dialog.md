# 新增配置直接打开一键导入弹窗

- 日期：2026-11-03
- 状态：completed
- 负责人：Codex

## 背景与目标

配置目录的“添加”目前只输入名称并复制静态范例。改为直接复用对应 CLI 的一键导入弹窗，填写名称、地址、密钥和模型后生成并保存档案。

## 范围与非目标

- 覆盖 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode 的新增入口和共享导入弹窗。
- 保留已有范例导入仅修改草稿的行为、范例内容和配置持久化接口；不自动激活新档案。
- 不修改用户已有工作区改动、CLI 执行逻辑、依赖和主题。

## 验收标准

- 点击“添加”直接显示对应 CLI 导入弹窗，并允许编辑配置名称。
- 必填校验通过后，按对应范例替换地址、密钥及模型引用，再保存和选中新档案。
- Codex 两个文件及其他 CLI 的内容镜像保持一致。
- 取消或校验失败不创建档案；保存失败保留输入并可重试；保存中防止重复提交。
- 现有范例导入仍只改草稿，不自动保存或激活。

## 影响面与风险

- 实现：`media/config/assets/config-app-ui.js`。
- 回归：`src/test/config/newConfigFromExample.test.ts`、`src/test/config/cliExampleImport.test.ts`。
- 文档：功能清单、配置中心能力规格和 CLI 业务本体。
- 风险：共享弹窗异步提交改变旧测试时序；统一等待提交并覆盖保存失败与重复提交。

## 验证计划

- 执行 `npm run build`，然后运行新增配置、范例导入及关联配置页测试。
- 使用隔离配置数据进行 headless Chromium 点击新增、填写、取消和确认验证，不改真实用户配置。
- 执行 ontology 校验、界面机械检查和 `git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：新增入口覆盖七类 CLI 的生成、保存、选中与内容镜像，以及校验/存储失败；共享弹窗覆盖名称、取消、输入重置、异步失败重试和重复提交保护。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/*.test.js` 共 357 项通过、0 失败。最小相关五个测试文件此前亦为 42 项通过。
- 浏览器验证：1440×1000 桌面环境完成七类 CLI 的真实页面新增操作，校验失败与取消不保存、确认后内容正确且不自动激活；390×844 窄屏验证四项输入、密钥遮蔽、视口与无重叠，并 hover 确认按钮检查实际可交互。浏览器错误、失败请求与 HTTP 错误均为 0。
- 浏览器边界：使用 `getConfigViewHtml` 的实际页面与全部静态资源，扩展宿主消息桥由内存配置夹具替代，不触碰本机 CLI 配置；未启动真实 VS Code Extension Development Host 或 Windows 系统。
- 浏览器证据：`.tmp/playwright-smoke/new-config-import-desktop/result.json`、`.tmp/playwright-smoke/new-config-import-mobile/result.json` 和窄屏 `success.png`；任务临时脚本和场景已清理，证据仅留在忽略目录。
- 失败处理记录：浏览器首次发现窄屏目录层级 1001 高于默认弹窗 1000，属于实现缺陷，已将共享导入弹窗统一提升至命名常量 1100，并通过窄屏实际指针交互确认。测试环境缺少对应 Playwright 默认浏览器，改用现有 Chromium 缓存；选择器兼容按钮中文空格；HTTP 夹具为本地 Monaco worker 放行仅本机来源，未修改产品 CSP 或放宽错误检查。
- 结构验证：ontology `--validate`、界面机械检测与 `git diff --check` 均通过。
- 功能清单及相关文档：已同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md` 和 `plugin.rule.cli_example_import_inputs`，明确区分新增直接保存与范例抽屉只更新草稿。
- 记忆维护：本次局部行为变更优先保留在能力规格和本计划，不自动写入热区记忆。

## 任务列表

- 已完成：定位配置新增与一键导入流程。
- 已完成：复用导入弹窗并补充回归测试。
- 已完成：构建、浏览器验证、文档同步与计划归档。

## 当前结论

复用 `CliExampleImportModal`、`buildCliExampleImport` 和现有档案工厂；仅校验通过并确认后调用既有新增存储接口，保存失败保留输入，成功后选中但不激活。构建、357 项配置测试及桌面/窄屏 Chromium 验证全部通过，无待办。
