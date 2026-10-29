# ZCode 配置与 Codex 工具气泡对齐

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

ZCode 0.17.0 已按独立 ZCode Protocol 接入。真实本机协议记录表明正文、推理和工具输入通过 `model.streaming` 发送，工具生命周期通过 `tool.updated` 发送；当前 runner 仍主要识别旧 `part.delta` 和简化状态文本，导致工具调用不能形成 Codex 风格的标题、分类、输入和结果气泡。配置页还需统一范例导入和编辑器模式入口；模型执行要求的推理档位必须稳定下发。

## 目标

保持 ZCode 独立 app-server 协议与当前配置结构，完善 reasoning 默认与范例配置，并把真实工具事件映射至既有 Codex trace 展示链路；使用默认本机配置验证冒泡排序文件写入和天气查询。

## 范围

- ZCode 配置可视化/JSON 页面，复用现有 CLI 共享布局、按钮和范例导入行为。
- 模型级 reasoning 配置和会话级 `thoughtLevel` 默认补齐；范例模型使用 `glm-5.3-flash`。
- ZCode `model.streaming` 和 `tool.updated` 解析、工具输入聚合、同一 `toolCallId` 气泡更新。
- ZCode trace 复用现有 `TraceMessageKind` 和 Codex-compatible 文本/元数据，不新增平行 UI 样式。
- 协议、runner、配置与渲染相关回归测试，功能清单和 ontology 同步。

## 非目标

- 不改 Codex trace 渲染组件的公共样式或其它 CLI 的协议行为。
- 不改变 ZCode 协议为 ACP / JSON-RPC，不改变免审批启动参数 `--mode yolo`。
- 不把真实 API key 写入仓库、报告、测试夹具或 UI 默认范例。

## 验收标准

- [x] ZCode 页面布局、范例导入、编辑模式入口与已存在 CLI 页面一致，且上方为公共参数、下方左侧模型列表右侧模型参数.
- [x] 模型 `glm-5.3-flash_sub-coco` 在默认及缺少历史设置时向 ZCode 下发有效 reasoning level；范例默认模型为 `glm-5.3-flash`.
- [x] 真实 ZCode 正文、推理、工具输入、生命周期、结果按既有 trace renderer 形成语义标题气泡；同一调用只更新一个气泡.
- [x] 保持旧 `part.delta` 兼容，不泄漏凭据，不重复应答 app-server server request.
- [x] 相关构建、配置/协议/runner/页面测试通过；全量/页面测试既有失败单独分类.
- [x] 默认本机配置完成临时目录冒泡排序文件写入与天气工具查询，验证结果后清理临时产物.

## 影响面

- 代码目录：`src/config/`、`src/interactive/`、`src/extensionHost/`、`media/config/assets/`、相关 `src/test/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/ontology/`。
- 配置与脚本：不写入用户运行时配置；范例使用占位密钥。

## 风险与缓解

- 风险：工具输入可能以分片形式重复上报或生命周期事件缺少某些字段。
- 缓解：按 `toolCallId` 聚合、对事件做幂等处理、未知结构保守显示，不凭命令文本合并不同调用。
- 风险：运行中历史 Codex trace 可能被跨平台归一化影响。
- 缓解：ZCode 仅生成既有 trace 语法和稳定消息 ID，不改统一渲染组件语义。

## 验证计划

- 最小相关验证：ZCode 配置、协议、runner 与 trace renderer 定向测试。
- 单元自测命令：`npm run build`；`node --test` 执行新增/相关编译测试；`npm run test:page`。
- 扩展验证：Impeccable detector；使用本机 `zcode` 默认配置真实执行冒泡排序文件和天气查询。

## 测试与清单同步

- 单元测试新增/更新：覆盖 reasoning 默认、范例导入、`model.streaming`、工具输入分片、`tool.updated` 去重、旧 `part.delta` 与工具结果气泡分类。
- 单元自测结果：build 通过；ZCode 配置/协议/trace/标题定向 13 项通过；页面测试 292/297 通过。
- 失败处理记录：页面剩余 5 项中，historySessionLoop 两项为历史标签 fixture 的 `formatCliDisplayName` 基线；cliPageStaticRenderCoverage 两项仍断言旧 Grok 静态 option 与 `Sinitek CLI` 文案；clipagescriptruntimecoverage 一项是 Codex tab `errored` 为 `undefined` 的既有基线。均与 ZCode 无关，未扩大修复。
- 功能清单：已同步 `FEATURE_INVENTORY.md` 的 ZCode 行，涵盖 `model.streaming` / `tool.updated` 和单气泡更新。
- 相关文档同步：已更新 `docs/zcode-guide.md`、CLI runtime reference、能力规格及 `plugin.rule.zcode_protocol` ontology 记录与实现路径。

## 任务列表

- [x] 分析真实协议与 Codex trace 展示路径。
- [x] 修复 ZCode 配置页面和 reasoning 默认.
- [x] 解析并映射真实 ZCode trace 事件.
- [x] 运行构建、测试、页面检测与本机任务.
- [x] 更新产品规格、运行参考和 ontology 并归档计划.

## 决策记录

- 2026-10-28：继续复用 Codex trace 分类与 Webview 展示器；ZCode 只负责将 Protocol 1 事件规范化并通过既有宿主 trace API 发送。
- 2026-10-28：本机日志确认 `glm-5.3-flash_sub-coco` 的首次失败原因为必填 reasoning level 缺失；旧配置默认补 `max`，模型规则首选值通过 `model.options.reasoningLevel` 传入。
- 2026-10-28：真实工具结果以 `tool result: <tool>` 开头，需在通用 `tool:` 前识别，避免结果误作调用气泡；更新折叠结果样式的过期测试断言.

## 当前结论

ZCode 配置、协议、工具事件、Codex-compatible trace、文档和 ontology 已同步；build 与 13 项定向测试通过。本机冒泡排序及天气查询均完成。页面测试剩余 5 个与 ZCode 无关的既有基线失败，已在上方分类记录.
