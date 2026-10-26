# DeepSeek Harness 接入

- 日期：2026-10-24
- 状态：completed
- 负责人：协作
- owner：round-13-dsh-documentation-closeout-sync
- claimed_at：2026-10-24T11:44:20Z
- claim_ttl：收尾已完成
- handoff_to：

## 背景

用户要求先在本机安装最新 DeepSeek Harness，再为携宁 CLI 插件增加 dsh 分组，并尽量支持上下文显示、压缩、模型切换、思考力度、skills 安装和规则文件。

官方推荐通道 `latest` 是发布候选 `@deepseek-ai/dsh@0.2.1-rc.2`，不是稳定版。`next` 的 `0.2.1-rc.3` 未安装。2026-10-24 的实现和文档收尾已经完成。本计划从 `active/` 归档到 `completed/2026-10/`。

## 目标

1. 本机按官方推荐通道安装可执行的 `dsh`，并留下可复核的版本证据。
2. 以安装版本的文档、类型和真实进程探针写成程序化契约。
3. 按该契约接入插件分组、配置页、ACP runner、Skills 根和规则链。
4. 用最终模型做插件实跑，并把未验证边界写清楚。

## 范围

- 本机全局安装 `@deepseek-ai/dsh@latest`。
- 上游契约 `.ch/docs/references/deepseek-harness-api-reference.md`。
- 自定义 provider 契约 `.ch/docs/references/dsh-custom-provider-contract.md`。
- `CLI_LIST` 追加 `dsh`，配置页、交互 runner、Skills 和规则链接入。
- 产品清单、ontology、用户可见说明和本计划收尾。

## 非目标

- 不把 `0.2.1-rc.2` 写成稳定版，不安装 `next`。
- 不恢复 Gemini。
- 不向本仓库添加 DSH 依赖，不把真实 key 或私人端点写入仓库。
- 不把 Grok `reasoning_efforts` 自动补齐或 `ultra -> max` 复制到 DSH。
- 不把原生 compaction 写成已支持。
- 不把真实权限请求或图形 Extension Host 点击验收写成已验证。
- 收尾不改运行时代码、密钥、调度状态、Loop+ 快照或 task record。

## 验收标准

- [x] 本机 `dsh` 指向官方 `@deepseek-ai/dsh@0.2.1-rc.2`，并明确它是发布候选。
- [x] 契约区分 ACP、SDK JSON-RPC、headless 和模型 HTTP API。
- [x] 命令顺序为 `codex`、`claude`、`opencode`、`grok`、`dsh`。
- [x] 交互主路径使用 `dsh --profile acp`，不复用 Grok `session/load`。
- [x] 模型 id 必须完整使用 `deepseek-v4.1-flash`。
- [x] 凭据只引用 `SINITEK_DSH_API_KEY`。
- [x] 配置页分组在 Grok 之后。Skills 根和 `AGENTS.md` 规则链已接入。
- [x] usage 缺失不显示为 0。adapter-fallback 窗口不能冒充服务容量。
- [x] 思考档按当前自定义 provider 公布值处理。当前模型没有公布档位，未公布值不下发。
- [x] 最终模型插件实跑覆盖新建、同进程续聊、新进程恢复和取消。
- [x] 上述行为有对应单元测试和插件实跑，并已同步产品清单。
- [x] 原生 compaction 明确记为不支持，没有用 `/compact` 冒充成功。
- [x] 真实权限请求和图形 Extension Host 点击验收保持未验证，没有虚报。

## 影响面

- 代码目录：`src/cli/`、`src/interactive/`、`src/extensionHost/`、`src/config/`、`media/config/assets/`。收尾轮次没有再改运行时代码。
- 文档目录：本计划、`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`、`docs/cli-reference.md`、`docs/插件功能清单.md`、`package.json`。
- 配置与脚本：无仓库脚本变化。本机全局 npm 前缀有 `@deepseek-ai/dsh@0.2.1-rc.2`。

## 风险与缓解

- 风险：`latest` 本身是 rc。缓解：契约锁定 `0.2.1-rc.2`。升级前重新探针。
- 风险：自定义模型的 `usage_update.size` 是适配器 fallback `262144`。缓解：宿主标记 `adapter-fallback`，不写成服务确认容量。
- 风险：真实服务没有发出权限请求。缓解：allow/reject 只记为协议夹具。Extension Host 对真实请求回答 cancelled，不自动批准。
- 风险：图形 Extension Host 不能无头执行。缓解：插件实跑证据来自宿主集成测试，不写成窗口点击验收。
- 回滚：卸载本机全局包用 `npm uninstall -g @deepseek-ai/dsh`。不要删除 `~/.dsh`。

## 验证计划

- 安装与上游探针：`npm view`、`dsh --version`、隔离 ACP/SDK/headless 探针。
- 插件实跑：配置服务激活、隔离 `DSH_HOME`、`prepareDshIsolatedLaunch`、`DshInteractiveRunner`、`createPromptInteractiveRuntimeHost`。覆盖 initialize、session/new、同一进程续聊、session/cancel、新进程 session/resume。
- 收尾文档校验：`npm run build`、`npm run validate:whitespace`、`git diff --check`。
- 未验证：真实 `session/request_permission` 往返，图形 Extension Development Host 点击验收，服务确认的上下文窗口，原生 compaction。

## 测试与清单同步

- 单元测试新增/更新：实现轮次已覆盖 runner、协议、配置页、Skills 和宿主接线。收尾轮次不新增运行时代码测试。
- 插件实跑：`SINITEK_DSH_LIVE=1` 下 `dshPluginLiveBoundary` 两条通过。usage size 为 `262144`，宿主来源为 `adapter-fallback`。`compactSession` 抛出 `compaction-unsupported`。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：参考索引、两份 DSH 契约、ontology、CLI 参考、插件功能清单和 `package.json` 用户可见描述已按当前事实更新。

## 任务列表

- [x] 核对 npm 身份、`latest` 和 `next`，安装官方推荐通道。
- [x] 用临时 `DSH_HOME` 探针 ACP、SDK 和 headless。
- [x] 写 API 契约和自定义 provider 契约。
- [x] 新增 DSH runner，主路径为 `dsh --profile acp`。
- [x] 追加 CLI 分组、命令设置和配置页，不打乱现有顺序。
- [x] 接入已配置模型列表、ACP 公布值校验和思考档。
- [x] 接入上下文用量、Skills 根和规则链。原生压缩明确不支持。
- [x] 用最终模型和专用凭据完成插件实跑。
- [x] 同步文档并把本计划归档。

## 决策记录

- 2026-10-24：安装 `latest` `0.2.1-rc.2`，不安装 `next` `0.2.1-rc.3`。
- 2026-10-24：交互主路径定为 ACP。`session/load` 返回 `-32601`。
- 2026-10-24：用户纠正模型为完整 id `deepseek-v4.1-flash`。不得回退、去前缀或改用响应别名 `deepseek-v4.1-flash`。
- 2026-10-24：自定义路由使用 `providers`、`api=openai-completions` 和 `apiKeyEnv=SINITEK_DSH_API_KEY`。
- 2026-10-24：当前自定义 provider 没有公布思考档。官方默认路由的 `off|low|high|max` 不搬到这条路由。
- 2026-10-24：收尾确认配置页、runner 和插件实跑已完成。真实权限请求与图形 Extension Host 点击验收仍未验证。

## 已确认事实

- 启动：`dsh --profile acp`，NDJSON JSON-RPC，`initialize.protocolVersion=1`。
- 会话：`session/new` 返回 UUID。恢复用 `session/resume`。取消用无 id 的 `session/cancel`。
- 模型线值：`["sinitek-custom","deepseek-v4.1-flash"]`。不在 `configOptions` 中就拒绝切换。
- 用量：只消费真实 `usage_update` 的 `used` 和 `size`。没有该事件时不显示 0。`size=262144` 是 adapter-fallback，不是服务容量。
- 未配置模型不能执行。官方路由握手接受任意字符串的结果不能搬到 `sinitek-custom`。
- Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。Skills 根：`<DSH_HOME>/skills`。规则链：全局 `<DSH_HOME>/AGENTS.md`，工作区共享 `AGENTS.md`。
- 压缩：ACP 没有可用的 `session/compact`。`compactSession` 返回 `compaction-unsupported`。不发送 `/compact`。原生 compaction 不支持。

## 仍未验证

- 真实服务没有发出 `session/request_permission`。allow-once 与 reject-once 只在协议夹具里验证。Extension Host 对真实请求回答 cancelled，不自动批准。
- 图形 VS Code Extension Development Host 没有执行 DSH 回合。`code --help` 没有 `--headless`。带 `--extensionDevelopmentPath` 的调用拉起图形界面后立即返回。
- 服务模型对象没有公布上下文窗口。不要把 adapter-fallback `262144` 写成服务容量。
- 自动压缩本次没有观察到。源码里的压力阈值行为没有在这次长上下文里跑到。

## 当前结论

安装、契约、配置页、ACP runner、Skills 根、规则链和最终模型插件实跑已经完成。命令顺序是 `codex`、`claude`、`opencode`、`grok`、`dsh`。Skills 目标是五个，顺序保持 Claude、OpenCode、Grok、Codex、DSH。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 明确不支持。真实权限请求和图形 Extension Host 点击验收未验证，不得虚报。本计划收尾时，配置页的 provider、模型 id 和 `apiKeyEnv` 仍为只读，只有 `baseURL` 可编辑。后续配置页轮次已落地 JSON/可视化双模式和有序多模型编辑，当前事实以产品规格和 `.ch/docs/references/dsh-custom-provider-contract.md` 为准。本计划已完成并归档。
