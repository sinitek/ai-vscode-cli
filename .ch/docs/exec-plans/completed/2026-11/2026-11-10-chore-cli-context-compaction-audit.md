# CLI 上下文压缩入口与最新版协议核查

- 日期：2026-11-10
- 状态：completed
- 类型：chore
- 负责人：Codex
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-10-cli-context-compaction-audit.md`

## 目标与范围

核查七CLI压缩入口并历史升级DSH/Kimi官方latest及隔离协议探测。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- [2026-11-10-docs-cli-context-compaction-audit.md](2026-11-10-docs-cli-context-compaction-audit.md)：独立承接文档/事实源交付及其历史校验。

## 验收标准

- 核查七CLI压缩入口并历史升级DSH/Kimi官方latest及隔离协议探测；原可观察契约、非目标和限制以以下分配的原文为准。
- 维护升级与文档为两类型；只运行既有70项测试和临时探针，不造仓库test开发；EBADENGINE、Node22不支持、HTTP403及未触发自动压缩保留。

## 验证与真实状态

验证计划：本类型交付的原验证结果及未覆盖环境保留在下方；本来源只运行既有70项测试和临时探针，不承接独立测试开发。本次不重跑历史业务验证。文档交付见关联 docs 计划。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

核对插件当前七个 CLI 的手动压缩入口、插件执行后自动压缩与 CLI 原生自动压缩，升级目前只有 CLI 自行压缩、没有插件压缩入口的 DSH 和 Kimi，确认最新版是否提供可验证的调用契约。

### 范围与非目标

- 检查插件路由、Runner、官方文档、npm `latest` 和本机已安装包。
- 仅将本机 `@deepseek-ai/dsh`、`@moonshot-ai/kimi-code` 升级到官方 `latest`；不安装 alpha/canary，不升级其他 CLI 或项目依赖。
- 保留用户配置、凭据与已有会话；协议探测优先使用临时目录和无模型请求，不执行发布脚本。
- 本轮以审计、升级与协议实测为主；不因 CLI 内部存在压缩代码就虚构插件可调用入口。

### 验收标准

- 明确列出七个 CLI 的插件压缩支持和缺失项。
- 记录升级前后版本和核查日期，区分 `latest` 与预发布渠道。
- 对 DSH 和 Kimi 的独立压缩方法、命令发现、`/compact` 与自动压缩完成信号给出源码或协议证据。
- 如无需更改运行时代码，明确说明原因；本轮未改插件行为，相关文档交付与无需更新清单/ontology的依据见关联docs计划。

### 影响面与风险

- 本机全局 npm 包：DSH、Kimi；安装前记录版本，可按原版本回滚。
- DSH 的 `latest` 当前本身为 rc 版本；只使用官方标签，不把它描述为稳定版。
- 原生自动压缩通常需要上下文压力，未实际触发时只记录源码支持，不声称已验证成功。

### 验证计划

- `npm view <package> dist-tags version repository --json` 与升级后 `--version`。
- 如仅修改文档，检查引用和 `git diff --check`；若修改 TypeScript，按 `.ch/docs/TESTING.md` 执行相关单测与 `npm run build`。

### 任务列表

- [completed] 核对插件中的 CLI 与压缩入口
- [completed] 查询最新版本与自动压缩能力
- [completed] 升级 DSH 和 Kimi 并验证协议

### 当前证据

- `src/cli/types.ts`：七个 CLI 为 Codex、Claude、OpenCode、Grok、DSH、Kimi Code、ZCode。
- `src/contextCompactionRunner.ts`：压缩策略只包含 Codex、Claude、OpenCode、Grok、ZCode；DSH、Kimi Runner 的 `compactSession()` 明确抛出不支持错误。
- 本机升级前：DSH `0.2.1-rc.2`，Kimi `2.3.3`。
- 2026-11-10 npm 查询：DSH `latest=0.2.2-rc.1`，Kimi `latest=2.5.2`；不使用 Kimi `3.0.0-canary`。

### 最终结论与决策

- 面板手动入口缺少 OpenCode、DSH、Kimi；其中 OpenCode 已有后台策略与插件执行后自动压缩，不能与其余两者混为一谈。入口白名单只包含 Codex、Claude、Grok、ZCode。
- DSH 已升级为 `0.2.2-rc.1`。隔离 ACP `initialize`、`session/new`、`session/prompt`、`session/close` 通过；`session/compact` 返回 `-32601`，字面 `/compact` 到达本机模拟模型，不是原生压缩。内部自动压力压缩仍存在，但未触发验证。
- Kimi 已升级为 `2.5.2`。隔离 ACP 广告 `compact`，本机模拟模型回合后，`/compact` 收到开始与 `Compaction completed.`，证明原生命令可调用；没有新增独立 `session/compact` RPC，插件尚未接入专用按钮和主动压缩策略。
- DSH 新版声明 Node `>=24.9.0`，当前 Node `22.23.4` 的安装产生 `EBADENGINE`。虽然最小协议及回合成功，不视为官方支持或完整兼容；遵守基础设施版本约束，没有擅自升级 Node。
- 原始隔离探针及本机模拟协议记录保留在系统临时目录，不把会话或运行时日志提交仓库。未调用真实模型服务，未使用用户凭据。

### 测试与文档同步

- 实际升级：`npm install -g @deepseek-ai/dsh@latest @moonshot-ai/kimi-code@latest`；对照官方 registry 的 `npm view ... dist-tags engines --json --registry=https://registry.npmjs.org` 与升级后 `--version` 一致。
- 原生隔离探针：`node <系统临时审计目录>/probe.cjs` 通过。DSH 普通模型回合、字面 `/compact` 到达模型、Kimi 命令广告和后台完成通知均有断言；所有模型请求只发往 loopback SSE 模拟服务。
- `npm run build` 通过。
- `node --test dist/test/config/kimiCodeDocContract.test.js dist/test/core/contextCompactionRunner.test.js dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/kimiAppServerProtocol.test.js`：70 通过、0 失败、0 跳过。
- 未验证：DSH 自动上下文压力压缩、真实模型摘要质量、真实 VS Code 点击路径、Windows 环境。Codex 手册抓取返回 HTTP 403，本轮关于既有插件策略的结论以当前源码为准，不依赖该抓取。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。维护升级与文档为两类型；只运行既有70项测试和临时探针，不造仓库test开发；EBADENGINE、Node22不支持、HTTP403及未触发自动压缩保留。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
