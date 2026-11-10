# CLI 上下文压缩能力核查

- 核查日期：2026-11-10。
- 范围：当前插件源码、PATH 中实际 CLI、官方 npm registry 的 `latest`、DSH/Kimi 已安装包源码与隔离 ACP 探针。
- 本轮只升级本机全局 CLI，不修改插件运行逻辑、项目依赖、用户配置、凭据或已有会话。

## 1. 先区分三种能力

- **插件手动入口**：对话面板「常用指令 → 压缩上下文」是否显示。
- **插件执行后自动压缩**：全局设置开启后，已有会话的任务成功执行超过 5 分钟，再由插件触发压缩；单次最多等待 3 分钟。
- **CLI 自身自动压缩**：CLI 内部按上下文压力等条件触发，不等同于插件执行后自动压缩。

前两项以 `src/webview/viewContentScript/modelAndPanelState.ts#syncCommonCommandOptions`、`src/contextCompactionRunner.ts#CONTEXT_COMPACTION_STRATEGY_CLIS` 和 `src/extension.ts#maybeAutoCompactContextAfterPromptSuccess` 为事实来源，不能只看 Runner 是否有压缩函数。

## 2. 插件当前七个 CLI

| CLI | 本机版本（本轮结束时） | 插件手动入口 | 插件执行后自动压缩 | 后台压缩路径 |
| --- | --- | --- | --- | --- |
| Codex | 0.167.0 | 有 | 支持 | 原生 thread 压缩 |
| Claude Code | 2.1.311 | 有 | 支持 | `/compact`；明确不支持或缺少完成信号时兼容摘要换会话 |
| OpenCode | 1.18.35 | **没有** | 支持 | 已有原生压缩策略，但前端常用指令白名单未包含它 |
| Grok | 1.0.62 | 有 | 支持 | ACP `session/prompt` 发送 `/compact`，等待原生完成通知 |
| DSH | **0.2.2-rc.1** | **没有** | **未接入** | Runner 明确抛出 `compaction-unsupported`；CLI 内部有自动压缩 |
| Kimi Code | **2.5.2** | **没有** | **未接入** | Runner 明确抛出 `compaction-unsupported`；CLI 内部有自动压缩且 ACP 已有 `/compact` 命令 |
| ZCode | CLI 3.16.3-41 / runtime 0.17.0 | 有 | 支持 | `session/compact`，等待同会话 `session_compacted` |

因此，缺少**面板手动入口**的有 OpenCode、DSH、Kimi；缺少**后台策略及插件执行后自动压缩接线**的只有 DSH、Kimi。没有独立压缩 RPC 不等于没有原生命令，Kimi 就是两者不同的例子。

## 3. 最新版与实际升级

从官方 registry 核对，避免只依赖本机配置的镜像：

```sh
npm view @deepseek-ai/dsh dist-tags engines --json --registry=https://registry.npmjs.org
npm view @moonshot-ai/kimi-code dist-tags engines --json --registry=https://registry.npmjs.org
npm install -g @deepseek-ai/dsh@latest @moonshot-ai/kimi-code@latest
dsh --version
kimi --version
```

| 包 | 升级前 | 官方 `latest` / 升级后 | 说明 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh` | 0.2.1-rc.2 | 0.2.2-rc.1 | 官方 latest 本身仍是 rc，不称为稳定版 |
| `@moonshot-ai/kimi-code` | 2.3.3 | 2.5.2 | 不安装 3.0.0-canary |

DSH 声明 `engines.node >=24.9.0`，当前 PATH 的 Node 为 `22.23.4`，安装出现 `EBADENGINE`。本轮在该 Node 下实测版本查询、ACP 初始化、新建会话、普通模型回合和关闭成功，但不代表满足官方支持范围或完整功能兼容。未擅自升级 Node。Kimi 声明 `node >=22.19.0`，当前环境满足。

## 4. DSH 0.2.2-rc.1：ACP 仍无手动压缩命令面

- 隔离 `DSH_HOME`、HOME 和 cwd，使用临时 provider patch 与 loopback OpenAI-compatible SSE 服务，不读用户配置或使用真实密钥。
- `initialize` 广告 `session/close`、`list`、`resume`，没有压缩能力；`session/compact` 真实返回 `-32601`，`data.method=session/compact`。
- `session/new` 成功，但不发送 `available_commands_update`。
- 将 `/compact` 作为 `session/prompt` 发送，loopback 模型请求确实收到原样用户文本，返回普通助手答复与 `end_turn`；这**不是**原生压缩。
- 已安装包 `@deepseek-ai/dsh-acp/lib/index.js` 将 prompt 构造成普通用户消息；官方 ACP 文档明确不支持 commands。内部 `dsh-command-compact` 的存在不能当成 ACP 可调用证据。
- `dsh-compaction-basic` 仍注册压力与 overflow 恢复触发，默认 `thresholdRatio=0.8`。本轮未制造上下文压力，不声称验证过自动压缩终态。

官方来源：[ACP 契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)、[compaction-basic](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/compaction/compaction-basic)。既有插件接线见 `dsh-custom-provider-contract.md` 第 10 节。

## 5. Kimi 2.5.2：ACP 的 `/compact` 可用，但仍不是独立 RPC

- 同样使用隔离 HOME、`KIMI_CODE_HOME`、临时 TOML、loopback provider；模型只调用本机模拟服务。
- `session/compact` 仍返回 `-32601`，不能宣称新增了该 RPC。
- `session/new` 后真实收到 `available_commands_update`，其中包含 `compact`；`/help` 也列出 `/compact — Compact the conversation context`。
- 先完成一轮模拟模型会话，再经 `session/prompt` 发送纯文本 `/compact`，收到开始确认和异步 `Compaction completed.`（含消息数及前后 token）。本轮验证的是命令与生命周期，模拟摘要不证明真实模型的摘要质量或 token 降幅。
- 已安装包仍把原生自动压缩开始与完成映射为普通 `agent_message_chunk`，不是独立结构化压缩事件；现有插件 `readKimiCompactionUpdate()` 能识别这些官方文本。
- Kimi 的 ACP 原生命令已经提供，不应笼统描述为“CLI 不支持手动压缩”。当前缺的是插件按钮与主动调用策略；普通对话请求可能附带 harness 提示，不能把未经验证的插件输入框 `/compact` 当成专用调用路径。
- 如果后续接入，应保留同会话映射，注册完成监听后再发命令，等待后台终态，并处理失败、取消、超时、停止及迟到通知；不能把 RPC 的 `end_turn` 或开始确认当作压缩成功。

官方来源：[Kimi ACP 参考](https://moonshotai.github.io/kimi-code/zh/reference/kimi-acp.html)。既有资料对照见 `kimi-code-official-reference.md` 第 0、6、8 节。

## 6. 验证边界与后续

- 原生 ACP 隔离探针通过：DSH 字面 `/compact` 到达模型；Kimi 原生命令广告、开始及完成通知均被断言。
- `npm run build` 通过；`node --test dist/test/config/kimiCodeDocContract.test.js dist/test/core/contextCompactionRunner.test.js dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/kimiAppServerProtocol.test.js` 共 70 项通过、0 失败。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、文档相对引用与 `git diff --check` 通过。
- 未进行真实模型服务调用、上下文自动溢出测试、VS Code Extension Development Host 点击验收或 Windows 实跑。
- 本轮没有插件行为变化，不更新功能清单条目或 ontology 语义；仅补充现有参考资料，后续真正开放按钮时再同步产品规格、ontology 与测试。
- 若要补齐入口：OpenCode 可复用已有后台策略；Kimi 可基于已验证的 `/compact` 生命周期设计接入；DSH 仍不能直接复用 ACP `/compact`。
