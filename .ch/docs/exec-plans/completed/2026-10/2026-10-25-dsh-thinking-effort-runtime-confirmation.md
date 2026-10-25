# DSH 思考力度运行时确认与档位修正

- 日期：2026-10-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-25
- claim_ttl：本次会话
- handoff_to：

## 背景

用户再次反馈 DSH 面板选择思考力度后似乎没有生效，并要求移除 `off`、支持 `xhigh`（若当前模型可用）。最近本机日志只记录 DSH 进程启动参数，不记录 ACP `session/set_config_option` 的请求和确认值，无法从旧日志判断刚才的回合究竟应用了哪个力度。

当前 DSH 自定义 profile 默认档位常量和 `serializeDshPatchYaml` 均硬编码为 `off|low|high|max`；新增值若未同步到运行 patch，ACP 不会公布该值，runner 会跳过下发。此外旧 profile 可能仍显式保存旧 `off` 映射，需要兼容归一化。

## 目标

默认验证模型和兼容的 DeepSeek 自定义模型使用 `low|high|xhigh|max`；选择值在提示发送前经 ACP 确认，并在本机日志留下不含 prompt/凭据的申请与确认信息。

## 范围

- 更新 DSH profile 能力定义、旧档位兼容归一化和运行 patch 序列化。
- 隐藏旧 session/profile 仍公布的 `off`，只有 ACP 公布的值可作为可选项。
- 为 DSH 思考力度应用路径增加无敏感内容的请求/确认诊断。
- 补充 parser、Webview、host/ACP 回归测试并同步产品说明与 ontology。

## 非目标

- 不改用户家目录中的 DSH profile 或日志。
- 不发送真实模型 prompt，不推断旧日志未记录的 ACP 回执。
- 不把 `xhigh` 宣称为比 `high` 更强；DeepSeek API 将其映射为 `high`。

## 验收标准

- [ ] 新默认 profile 与生成 patch 显示 `low|high|xhigh|max`，不包含 `off`。
- [ ] 旧 profile 的 `off|low|high|max` 配置可读取并归一化，不破坏保存或运行。
- [ ] `xhigh` 只在 ACP 实际公布时可选择，并在提示前以 `reasoning_effort` 配置确认。
- [ ] 日志记录请求值、当前可用值、确认值和应用状态，不记录 prompt、token、密钥或会话正文。
- [ ] 相关测试、build、ontology 校验通过；记录未覆盖的真实 Extension Host 验证。

## 影响面

- 代码目录：`src/cli/dshConfigModels.ts`、`src/extensionHost/interactiveTurnDsh.ts`、`src/extensionHost/modelSettings.ts`、Webview 与 DSH 测试。
- 文档目录：DSH provider contract、CLI 能力规格、功能清单、ontology、completed 执行计划。
- 配置与脚本：无用户配置文件或依赖变更。

## 风险与缓解

- 风险：用户显式旧 `off` 档位映射会导致配置拒绝。
- 缓解：读取阶段接受旧精确结构并归一化为新档位；不改写家目录源文件。
- 风险：DSH 当前 session 仍公布旧档位。
- 缓解：以 ACP 实际 options 为准；界面隐藏 `off`，未公布的 `xhigh` 不下发。

## 验证计划

- 最小相关验证：DSH 配置 parser、ACP runner/协议、host wire、模型状态和 Webview 测试。
- 单元自测命令：`npm run build` 与 `node --test` 指定 DSH 相关的 `dist/test` 文件。
- 扩展验证：检查 2026-10-25 本机日志；不执行真实模型请求；图形 Extension Host 点击验证仍需用户环境。

## 测试与清单同步

- 单元测试新增/更新：DSH profile 档位归一化、patch 序列化、运行时选项和日志确认路径。
- 单元自测结果：待执行。
- 失败处理记录：待执行。
- 功能清单：更新 DSH 支持档位和 ACP 确认说明。
- 相关文档同步：DSH contract、runtime reference、ontology。

## 任务列表

- [x] 追踪 UI、持久化、运行参数和旧日志。
- [x] 更新档位定义、旧配置归一化及 patch 生成。
- [x] 记录 ACP 应用与确认结果。
- [x] 补回归测试并同步事实文档。
- [x] 执行 build、相关测试和 ontology 校验。

## 决策记录

- 2026-10-25：DeepSeek 的 `xhigh` 是兼容别名，发送原始 `xhigh`；其服务端效果映射为 `high`，不是额外更强的一档。
- 2026-10-25：ACP 当前公布值仍是最终可选/可发送集合；即便兼容别名被支持，也不绕过 session 的 options 校验。

## 验证结果

- `npm run build` 通过。
- DSH 配置、ACP runner、Extension Host、live boundary 和 Webview 相关测试共 46 个通过，1 个真实端点测试按环境条件跳过。
- 生成 patch 实际包含 `reasoningEfforts: low/high/xhigh/max` 与 DeepSeek `compat`，不包含 `off: null`；真实 `dsh --profile acp --patch <path>` 的 `session/new` 公布 `low`、`high`、`xhigh`、`max`（另有空的 provider default 选项）。
- 真实 ACP 设置请求使用 `configId: "reasoning_effort"`、`value: "xhigh"`，响应确认 `currentValue: "xhigh"`。
- 旧日志 `~/.sinitek_cli/logs/sinitek-cli.2026-10-25.log` 只包含 DSH 启动参数，没有 ACP method、申请值或确认值；当时实际 patch 缺少 `reasoningEfforts` / `compat`，所以不能证明旧回合应用了思考力度。

## 当前结论

旧日志显示用户工作区选择值已保存为 `high`，当天 DSH 子进程有多次正常启动记录；旧日志没有 ACP method、请求 value 或确认 currentValue，因此不能证明旧回合是 provider 未应用还是仅行为观感相似。当前代码已同步生成档位映射，并增加不含 prompt、token、密钥和正文的 `dsh-reasoning-effort` / `dsh-reasoning-effort-apply-failed` 日志。
