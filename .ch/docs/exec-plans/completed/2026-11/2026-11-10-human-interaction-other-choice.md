# 人机交互表单其它回答

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 背景与目标

人机交互选择题不能限制用户只能接受模型给出的候选；每道选择题必须提供“其它”和自由输入框。

## 范围与非目标

- 覆盖 Vibe 人工交互与 Loop/Loop+ 主任务澄清的单选、多选、下拉、多选下拉。
- 复用现有主题样式；原本可自由输入的字段和布尔确认框保持不变。
- 不改 CLI 协议、全局配置、超时策略或通知流程。

## 验收标准

- 每道选择题都有“其它”，已有同义选项不重复添加；选择后显示输入框，取消选择后不提交残留文本。
- 选择其它但未填写时就地报错，保留表单已填写内容；提交的是实际文本，不是内部标记。
- 多选保留预设选项与自定义文本；Codex、Grok 和主任务澄清均能接收答案。
- 相关回归测试、构建和 Chromium 真实 DOM 验证通过。

## 影响面、风险与回滚

- 代码：共用 Webview 其它回答绑定逻辑、两处表单入口、Grok 回答映射和主任务提交校验。
- 文档：功能清单、能力规格、业务 ontology。
- 风险：内部占位值泄漏、重复其它选项、非法非文本值、校验重绘丢失输入；以共用收集逻辑和回归测试覆盖。
- 回滚：整体撤销本次相关变更，不迁移用户数据。

## 验证计划

- `npm run build` 后执行人机交互、主任务澄清、Grok 和相关 Webview 单测。
- 使用本机 headless Chromium 验证选择、输入、校验、切换和消息载荷，不调用真实付费模型。
- ontology 校验与 `git diff --check`。

## 测试与清单同步

- 单元测试：新增共用其它选项的四类选择、已有同义选项复用、嵌套说明保留、重复绑定、占位值冲突、空白拦截、取消后的残留隔离和无关字段不变回归；主任务允许自定义文本并拒绝非文本选择值；Grok 兼容旧版其它字段并接受新版直接文本。
- 构建：`npm run build` 通过；仅有本机既有 npm 配置 `sass_binary_site` / `always-auth` 警告。
- 单元自测：以下 11 个编译后测试文件共 347 项全部通过：

  ```bash
  node --test dist/test/webview/humanInteractionOtherChoice.test.js dist/test/core/humanInteraction.test.js dist/test/core/orchestratorClarification.test.js dist/test/interactive/grokUserQuestion.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/core/humanInteractionHistory.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/grokCliHostWire.test.js
  ```

- 浏览器：使用缓存 Playwright 和本机 Chrome headless，运行 `node .tmp/human-interaction-other-smoke.cjs`；真实表单渲染函数与脚本的隔离 DOM 夹具分别覆盖 Vibe / 主任务澄清、1100 / 390 像素两档宽度，共四种组合通过。验证可选题的空其它也阻止提交、保留填写内容、四类选择、已有其它复用、取消后的清理、实际消息载荷、无横向溢出和无浏览器错误；截图已人工检查。结果和截图在 `/tmp/sinitek-human-interaction-other-smoke/`，一次性仓库内脚本已清理。
- 静态校验：Impeccable detector 对三个改动的 Webview 实现返回空问题列表；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 通过。
- 失败分类：首轮单测发现非文本选择值先被判为空，已调整类型检查顺序；等待器测试仍将未知文本视作非法选项，属于契约更新后的旧断言，已改为非文本非法值。浏览器首次因缓存缺少 headless shell 而失败，改用已安装 Chrome；全量设置脚本依赖完整宿主初始化，夹具改为加载原样的人机交互函数及共用脚本，未改生产行为。
- 未执行：完整单测全集、真实 CLI / Extension Development Host 端到端联调；本次验证聚焦相关模块与真实浏览器 DOM，不调用付费模型。
- 功能清单、能力规格和 ontology：已同步其它选项、实际文本回传及输入保留规则。
- 记忆判断：稳定规则进入产品规格及 ontology，不更新热区和事件记忆。

## 当前结论

两处表单共用其它选项绑定、校验与答案收集逻辑；Grok 去掉重复文本字段并兼容旧版回传，主任务宿主接收自定义文本。多选下拉将其它计入可见行数；已有其它选项的说明不被删除。构建、相关 347 项单测、四种浏览器组合及结构校验通过，无剩余任务。
