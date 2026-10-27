# Kimi 回放精简与可管理多模型

- 日期：2026-10-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-27
- claim_ttl：本次任务
- handoff_to：

## 背景

真实 Kimi 会话把工具标题、完整参数和结果反复写入回放，命令消息未稳定使用 Codex 的 `exec` 标题样式。模型下拉已有配置别名，但复用 ACP runner 时没有每轮应用选择，且面板不能管理配置模型。

## 目标

- 命令只显示 `exec <command>` 标题，普通工具只显示可识别的一句话摘要，去除原始参数 JSON 与结果回放。
- 对话面板复用 Codex 模型管理弹窗，对当前 Kimi 配置档案新增、重命名、删除、排序模型。
- 所有变更保存档案和真实 `config.toml`；运行时每轮通过 ACP `session/set_config_option` 应用所选别名。

## 范围

Kimi 工具事件映射、交互轮次、配置模型变更、模型设置消息、对话面板模型管理及相关测试和文档。

## 非目标

- 不修改 Grok / DSH 的工具展示或模型存储方式。
- 不接受未在 Kimi 配置中声明的任意模型，不增加启动参数或第二套模型来源。
- 不改变现有模型弹窗布局、主题、间距或 Codex 的内存模型管理行为。

## 验收标准

- [x] 命令与工具事件不再重复展示原始参数及大段结果。
- [x] 命令气泡走现有 Codex `exec` 标题展示。
- [x] Kimi 模型管理保存到当前档案和磁盘，保留 provider、凭据与高级字段。
- [x] 重命名默认引用、删除默认回落、排序及选择状态一致；失败不写坏配置。
- [x] ACP 复用会话的下一轮确认所选模型，思考档位按新模型重新应用。
- [x] 配置新增模型后旧 ACP runner 失效，新 runner 恢复原会话并读取新广告。
- [x] 构建、相关单测、配置脚本检查和隔离官方 CLI 验证通过。

## 影响面

- 代码目录：`src/config`、`src/interactive`、`src/extensionHost`、`src/panelMessageHandlers`、`src/sessionMessageHandlers.ts`、`src/webview`。
- 文档目录：`docs`、`.ch/docs/product-specs`、`.ch/docs/references`、`.ch/docs/runbooks`、`.ch/docs/ontology`。
- 配置与脚本：无新增依赖；真实配置验证使用隔离 `KIMI_CODE_HOME`。

## 风险与缓解

- 风险：配置写入竞态、重命名丢失引用、管理只改 UI 不改磁盘。
- 缓解：纯 TOML patch 先完整校验再保存；复用 config apply queue 与原子写；模型策略只认重新读取的配置；异常通过现有中文错误提示返回。

## 验证计划

- 最小相关验证：Kimi 配置、ACP 协议、runner、模型选择、面板消息、Webview 模型管理测试。
- 单元自测命令：`npm run build` 后运行相关 `dist/test` 文件。
- 扩展验证：隔离 `KIMI_CODE_HOME` 与占位凭据，执行 `kimi doctor config` 及 ACP 两别名动态切换；不读取或修改真实密钥。

## 测试与清单同步

- 单元测试新增/更新：精简事件、配置变更、消息保存、每轮模型切换与 Webview 管理入口。
- 单元自测结果：`npm run build` 通过；Kimi 专项 85/85、最小缓存修复相关组 55/55 通过。全量 2123 项中 2104 通过、18 失败、1 跳过；`validate:whitespace`、`git diff --check`、ontology（68 条规则）与三个配置 bundle 的 `node --check` 通过。
- 失败处理记录：全量 18 项均为既有 Grok / DSH 配置夹具失败或共享 Webview 测试桩缺函数，未修改对应实现，不扩大范围修复。新回归最初误把 `KimiProtocolError.code` 写成 `reason`，已修正断言；独立官方探针首次缺 `vscode` mock，复用测试 mock 后通过，均不属于产品实现缺陷。
- 功能清单：补充 Kimi 可管理配置模型和精简回放。
- 相关文档同步：用户指南、运行时参考、官方对照、runbook 与 ontology。

## 任务列表

- [x] 核对真实日志及 Grok / DSH / Codex 模式
- [x] 实现精简事件与模型管理持久化
- [x] 补齐每轮模型切换、配置缓存失效和回归测试
- [x] 同步文档并完成构建与隔离 CLI 验证

## 决策记录

- 2026-10-27：官方 `kimi acp` 子命令无 `--model`，但 ACP 支持模型配置项；选择“配置别名 + 会话内动态切换”，不做任意 wire 模型 ID 透传。
- 2026-10-27：模型管理必须写回档案和磁盘，不能只修改内存列表；UI 复用 Codex 现有弹窗。
- 2026-10-27：ACP 模型广告是进程快照；真实 `config.toml` 原子写成功后按 `KIMI_CODE_HOME` 推进修订号。旧 runner 拒绝复用与直接启动，管理器释放它，新 runner 使用原 ACP ID `session/resume`，保留 UI 会话和历史。

## 当前结论

已完成。官方 `kimi` 2.3.2 隔离 ACP 验证：新增模型后旧 runner 失效，新 runner 恢复原 session ID，新别名进入广告集合且被选中，未发送计费 prompt。真实写文件任务由此前 Kimi 接入验收完成，本轮不重复计费执行；VS Code 图形界面点击级验收未执行，文档已如实记录。
