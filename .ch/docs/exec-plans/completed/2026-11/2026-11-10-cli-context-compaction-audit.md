# CLI 上下文压缩入口与最新版协议核查

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 背景与目标

核对插件当前七个 CLI 的手动压缩入口、插件执行后自动压缩与 CLI 原生自动压缩，升级目前只有 CLI 自行压缩、没有插件压缩入口的 DSH 和 Kimi，确认最新版是否提供可验证的调用契约。

## 范围与非目标

- 检查插件路由、Runner、官方文档、npm `latest` 和本机已安装包。
- 仅将本机 `@deepseek-ai/dsh`、`@moonshot-ai/kimi-code` 升级到官方 `latest`；不安装 alpha/canary，不升级其他 CLI 或项目依赖。
- 保留用户配置、凭据与已有会话；协议探测优先使用临时目录和无模型请求，不执行发布脚本。
- 本轮以审计、升级与协议实测为主；不因 CLI 内部存在压缩代码就虚构插件可调用入口。

## 验收标准

- 明确列出七个 CLI 的插件压缩支持和缺失项。
- 记录升级前后版本和核查日期，区分 `latest` 与预发布渠道。
- 对 DSH 和 Kimi 的独立压缩方法、命令发现、`/compact` 与自动压缩完成信号给出源码或协议证据。
- 如无需更改运行时代码，明确说明原因；如改变行为，同步测试、功能清单和 ontology。

## 影响面与风险

- 本机全局 npm 包：DSH、Kimi；安装前记录版本，可按原版本回滚。
- 仓库：执行计划及必要的压缩参考文档，不保存真实配置、认证信息或会话内容。
- DSH 的 `latest` 当前本身为 rc 版本；只使用官方标签，不把它描述为稳定版。
- 原生自动压缩通常需要上下文压力，未实际触发时只记录源码支持，不声称已验证成功。

## 验证计划

- `npm view <package> dist-tags version repository --json` 与升级后 `--version`。
- 使用临时工作区探测 ACP `initialize`、命令发现及未知方法，检查官方包实现；不访问历史会话。
- 如仅修改文档，检查引用和 `git diff --check`；若修改 TypeScript，按 `.ch/docs/TESTING.md` 执行相关单测与 `npm run build`。

## 任务列表

- [completed] 核对插件中的 CLI 与压缩入口
- [completed] 查询最新版本与自动压缩能力
- [completed] 升级 DSH 和 Kimi 并验证协议

## 当前证据

- `src/cli/types.ts`：七个 CLI 为 Codex、Claude、OpenCode、Grok、DSH、Kimi Code、ZCode。
- `src/contextCompactionRunner.ts`：压缩策略只包含 Codex、Claude、OpenCode、Grok、ZCode；DSH、Kimi Runner 的 `compactSession()` 明确抛出不支持错误。
- 本机升级前：DSH `0.2.1-rc.2`，Kimi `2.3.3`。
- 2026-11-10 npm 查询：DSH `latest=0.2.2-rc.1`，Kimi `latest=2.5.2`；不使用 Kimi `3.0.0-canary`。

## 最终结论与决策

- 面板手动入口缺少 OpenCode、DSH、Kimi；其中 OpenCode 已有后台策略与插件执行后自动压缩，不能与其余两者混为一谈。入口白名单只包含 Codex、Claude、Grok、ZCode。
- DSH 已升级为 `0.2.2-rc.1`。隔离 ACP `initialize`、`session/new`、`session/prompt`、`session/close` 通过；`session/compact` 返回 `-32601`，字面 `/compact` 到达本机模拟模型，不是原生压缩。内部自动压力压缩仍存在，但未触发验证。
- Kimi 已升级为 `2.5.2`。隔离 ACP 广告 `compact`，本机模拟模型回合后，`/compact` 收到开始与 `Compaction completed.`，证明原生命令可调用；没有新增独立 `session/compact` RPC，插件尚未接入专用按钮和主动压缩策略。
- DSH 新版声明 Node `>=24.9.0`，当前 Node `22.23.4` 的安装产生 `EBADENGINE`。虽然最小协议及回合成功，不视为官方支持或完整兼容；遵守基础设施版本约束，没有擅自升级 Node。
- 原始隔离探针及本机模拟协议记录保留在系统临时目录，不把会话或运行时日志提交仓库。未调用真实模型服务，未使用用户凭据。

## 测试与文档同步

- 实际升级：`npm install -g @deepseek-ai/dsh@latest @moonshot-ai/kimi-code@latest`；对照官方 registry 的 `npm view ... dist-tags engines --json --registry=https://registry.npmjs.org` 与升级后 `--version` 一致。
- 原生隔离探针：`node <系统临时审计目录>/probe.cjs` 通过。DSH 普通模型回合、字面 `/compact` 到达模型、Kimi 命令广告和后台完成通知均有断言；所有模型请求只发往 loopback SSE 模拟服务。
- `npm run build` 通过。
- `node --test dist/test/config/kimiCodeDocContract.test.js dist/test/core/contextCompactionRunner.test.js dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/kimiAppServerProtocol.test.js`：70 通过、0 失败、0 跳过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、文档相对引用检查、`git diff --check` 通过。
- 功能清单与 ontology：本轮没有插件运行时、能力接线、状态机或权限变化，既有 Kimi 规则已经记载 ACP `/compact` 与纯文本通知，故不改功能条目或 ontology 语义。
- 文档：新增 `.ch/docs/references/cli-context-compaction-audit.md`，补充 Kimi 官方参考与 DSH 配置契约的最新版复核；Node 版本边界与命令层级差异已经沉淀到事实来源，不另行复制进热区记忆。
- 未验证：DSH 自动上下文压力压缩、真实模型摘要质量、真实 VS Code 点击路径、Windows 环境。Codex 手册抓取返回 HTTP 403，本轮关于既有插件策略的结论以当前源码为准，不依赖该抓取。
