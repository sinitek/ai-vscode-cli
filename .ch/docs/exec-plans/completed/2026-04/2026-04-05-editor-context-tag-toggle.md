# 执行计划：AI 对话编辑器上下文标签开关

- 日期：2026-04-05
- 状态：completed
- 负责人：Codex CLI

## 目标

为 AI 对话面板中“选中文件/选区自动写入输入框上下文标签”能力增加一个可配置开关，入口放在“工具设置”，默认关闭。

## 背景

当前面板会在编辑器选中文件或选区后，自动在输入框上方显示上下文标签，并在发送时注入当前文件/选区引用。用户希望保留该能力，但默认不启用，并且可以在面板的“工具设置”中显式开启/关闭。

## 范围

- VS Code 配置项新增布尔开关，默认值为 `false`
- Webview“工具设置”新增开关 UI，支持中英文
- 面板状态增加该配置项并同步到前端
- 输入框上下文标签渲染与发送时上下文注入受该开关控制
- 同步更新功能事实来源文档

## 非目标

- 不调整现有上下文标签文案格式
- 不改动 `@` 路径插入逻辑
- 不改动附件上传、会话管理、CLI 执行链路

## 影响面

- `package.json`
- `package.nls.json`
- `package.nls.zh-cn.json`
- `src/cli/config.ts`
- `src/webview/types.ts`
- `src/webview/viewContent.ts`
- `src/extension.ts`
- `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`

## 验收标准

1. 新安装/默认配置下，编辑器切换文件或选区时，不会自动显示输入框上下文标签。
2. 在“工具设置”打开开关后，当前文件/选区标签会按原逻辑展示，并在发送时注入上下文引用。
3. 再次关闭开关后，标签立即隐藏，后续发送不再注入当前文件/选区上下文。
4. 设置持久化后，重开面板仍保持上次选择。
5. 中英文文案完整，项目可通过 `npm run build`。

## 风险与注意事项

- 需避免仅隐藏 UI 但仍继续把上下文注入 prompt。
- 需避免关闭开关后遗留 dismissed / armed 状态，导致再次开启时行为异常。
- 配置变更后要确保前后端状态同步，避免 UI 与真实配置不一致。

## 验证计划

- 静态检查改动链路：配置 -> panel state -> webview settings -> prompt build
- 执行 `npm run build`

## 当前阶段

1. 定位现有实现与设置入口 ✅
2. 实现配置开关与状态同步 ✅
3. 更新文档并执行构建验证 ✅

## 验证结果

- 已完成配置项、Webview 工具设置开关、PanelState 同步与 prompt 注入双重开关控制。
- 已同步更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 已执行 `npm run build`，通过。
