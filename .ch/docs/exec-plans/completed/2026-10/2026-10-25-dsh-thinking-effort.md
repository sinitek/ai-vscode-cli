---
plan_id: 2026-10-25-dsh-thinking-effort
status: completed
created_at: 2026-10-25
---

# DSH 思考力度选项

## 目标

让 AI 对话面板在 DSH 分组显示并下发 DeepSeek 当前适配器支持的思考力度，避免复用 Grok 的扩展档位。

## 背景与范围

- DSH 面板已经消费 ACP 返回的 `reasoningOptions`，但当前运行 patch 没有为手写模型声明 `reasoningEfforts`。
- 已安装 `@deepseek-ai/dsh@0.2.1-rc.2` 的 DeepSeek 适配器支持 `off`、`low`、`high`、`max`；不支持 `medium`、`xhigh`、`ultra`。
- 本次只修改 DSH 配置契约、运行 patch、相关测试和事实文档；不改变 Grok、通用 ThinkingMode 类型或外部服务。

## 验收标准

1. 默认验证模型的 DSH 运行 patch 声明 `off: null`、`low: low`、`high: high`、`max: max`。
2. 面板依据当前模型的 DSH ACP 广告值直接显示原始 value，选择后经 `session/set_config_option` 发送标量并等待 ACP 确认。
3. 其它自定义模型仅在显式声明能力时显示选项；`reasoningEfforts: false` 只显示关闭档。
4. 仅显示 DeepSeek 规范档位；`minimal`→`low`、`medium` / `xhigh`→`high`、`ultra`→`max` 的兼容别名不作为额外选项，旧 DSH `medium` 归一为 `high`，存量 `ultra` 不隐式改写。
5. 旧 DSH profile 缺少能力字段时仍能读取；默认验证模型在规范化保存和运行 patch 时补齐能力声明。

## 风险与验证

- 运行时 DSH 版本或 provider schema 漂移可能改变档位；以仓库记录的已安装版本和当前官方适配器源码为事实来源。
- 先运行 DSH 配置、ACP runner、Extension Host 相关测试，再运行 `npm run build`。
- 若本机真实 DSH 端点可用，补充一次真实 ACP 启动并确认 `reasoningOptions` 为四项。

## 验证记录

- `npm run build`：通过。首次构建发现新增 Extension Host 测试回调参数隐式 `any`，按配置服务函数签名补齐类型后通过。
- DSH 相关配置、模型选择、Extension Host、ACP runner 与 Webview 测试：`node --test dist/test/cli/dshConfigModels.test.js dist/test/config/dshConfig.test.js dist/test/config/dshconfigpage.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/dshInteractiveHostWire.test.js dist/test/extensionHost/dshPluginLiveBoundary.test.js dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/dshRunner.test.js dist/test/webview/openCodeThinkingWebview.test.js`，68 项通过、1 项跳过、0 项失败。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、17 concepts、16 relations、62 rules、2 workflows、3 documents）。
- 未执行真实账号/端点上的新一轮 ACP 验证或 VS Code 图形面板点击；现有运行契约与此前隔离实跑记录继续作为依据。

## 当前阶段

实现、测试、产品文档和 ontology 已同步完成，计划可归档。
