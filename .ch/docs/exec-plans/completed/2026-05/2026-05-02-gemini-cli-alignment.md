# Gemini CLI 对齐与升级

- 日期：2026-05-02
- 状态：completed
- 负责人：Codex

## 背景

仓库需要同时保证三件事成立：本机 Gemini CLI 版本为最新、插件内对 Gemini CLI 的推荐配置符合官方当前建议、插件实际调用 Gemini CLI 的方式与官方当前 headless 用法一致。

## 目标

完成 Gemini CLI 本机升级，核对并修正仓库中的 Gemini 安装建议、配置示例、命令拼装和事实来源文档。

## 范围

- 本机 `@google/gemini-cli` 安装与版本确认
- 仓库内 Gemini 相关配置和调用实现核查
- 相关事实来源文档与功能清单同步

## 非目标

- 不引入新的 CLI 平台
- 不做与 Gemini 无关的 UI 或架构重构
- 不在未证实必要前调整现有技术栈

## 验收标准

- [x] 本机 `gemini --version` 已升级到官方 npm 最新版
- [x] 仓库中 Gemini 推荐安装/配置/调用方式与官方当前文档一致
- [x] 若存在偏差，代码或文档已修正，并完成最小相关验证

## 影响面

- 代码目录：`src/cli/`、`src/webview/`、`src/config/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`docs/`
- 配置与脚本：`package.json`、可能涉及 Gemini 校验脚本

## 风险与缓解

- 风险：Gemini CLI 最新版参数语义与仓库当前实现不完全兼容
- 缓解：以官方文档、`npm view`、`gemini --help`、最小真实调用结果交叉验证

## 验证计划

- 最小相关验证：`gemini --version`、`gemini --help`、插件内 Gemini 参数拼装相关单测或脚本
- 扩展验证：`npm run build`，必要时补充 Gemini 相关脚本验证

## 测试与清单同步

- 单元测试：优先覆盖 `src/cli/geminiStreamJson.ts`、`src/cli/geminiThinking.ts`
- 功能清单：如用户可见配置建议或行为有变化，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：同步 `.ch/docs/references/cli-runtime-reference.md` 与必要入口文档

## 任务列表

- [x] 梳理仓库内 Gemini 相关实现与推荐文案
- [x] 升级本机 Gemini CLI 到最新版并确认版本
- [x] 对照官方文档核查推荐配置和调用方式
- [x] 修正实现或文档偏差
- [x] 运行验证并更新结论

## 决策记录

- 2026-05-02：先以仓库事实来源和当前代码定位 Gemini 行为，再以官方文档和 CLI help 做对齐判断。
- 2026-05-02：Gemini 默认权限模式改为 `--approval-mode auto_edit`，不再继续推荐旧的 `-y`/YOLO 作为默认参数。
- 2026-05-02：macOS 命令解析增加用户级 npm/pnpm bin 优先级，并在可解析时直接启动 CLI，避免登录 shell 中旧 Homebrew `gemini` 抢占。

## 当前结论

已完成 Gemini CLI 对齐与升级。

验证结果：

- `npm view @google/gemini-cli version` 为 `0.40.1`，本机 `~/.npm-global/bin/gemini --version` 也为 `0.40.1`
- 已取消链接旧的 Homebrew `gemini-cli 0.27.0`，当前登录 shell 与扩展内都会优先落到 `~/.npm-global/bin/gemini 0.40.1`
- `npm run build` 通过
- `node --test dist/test/commandResolution.test.js` 通过
- `node --test dist/test/geminiThinking.test.js` 通过
- `node scripts/validate_gemini_stream_json.js` 通过

文档同步：

- 已更新 `.ch/docs/references/cli-runtime-reference.md`
- 已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
- 已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
