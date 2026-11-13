# 模型导入平台策略注册表重构

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：Codex fullstack 子模型
- claimed_at：2026-11-05
- claim_ttl：本次执行内有效
- handoff_to：主审查者
- 类型：refactor

## 背景与目标

`src/config/modelimport.ts` 原本 1249 行，把七类 CLI 的供应商解析、不同配置格式写回、有界 HTTP 模型发现、安全校验和公开 API 编排混在一个文件里。

- `providersFor` 是七分支 `switch`，`applyMultiImport` 又按平台二次分支，`discoverImportModels` 与 `applyModelImport` 各自保留 Claude/Codex 特例。
- 新增一个平台需要同时理解并改动多处，且公共校验、凭据解析、脱敏和草稿克隆没有明确的归属边界。
- 方向分析中对比了 `configService`（运行配置已策略化）和 Loop 编排（高风险并发状态），选择模型导入，避免为了模式而重复抽取已策略化模块。决策辅助 confidence 0.95 仅作方向参考，不作为正确性证据。

完成一次保持行为的重构：把平台差异收进以 `ModelImportPlatform` 为键的显式策略注册表，同时保留 `src/config/modelimport.ts` 作为兼容 Facade，三个公开函数签名、异步性质、结果结构和既有类型导出不变。

## 范围与非目标

- 新增 `src/config/modelimporttypes.ts`：公共契约与内部契约（草稿、供应商、payload、结果、选项、`InternalProvider`、策略接口）。
- 新增 `src/config/modelimportshared.ts`：被多层复用的纯工具，包括 JSON/JSONC/TOML 解析包装、安全 ID/字段键、URL 与凭据校验、脱敏、草稿克隆、供应商构造与禁用原因、协议归一。
- 新增 `src/config/modelimportedits.ts`：JSONC/TOML 定向编辑助手（格式适配边界）。
- 新增 `src/config/modelimportdiscovery.ts`：有界 HTTP 模型发现，包括地址构造、响应/分页上限、同源重定向与分页校验、`Promise.race` 超时。
- 新增 `src/config/modelimportplatformstrategies.ts`：七项策略表 `satisfies Record<ModelImportPlatform, ModelImportPlatformStrategy>`，每项配对供应商解析与导入写回，Claude 额外提供发现字段构建器。
- `src/config/modelimport.ts` 收缩为 Facade：payload 校验、供应商存在性、安全模型 ID、操作顺序与公开 DTO 投影。

- 不改变 Webview 协议、页面结构、交互、布局、主题或文案；不改 `media/config/assets`。
- 不翻译或改写既有错误文本（UI 安全错误映射依赖它们）。
- 不增加自动保存、激活、文件系统写入、后台发现请求或真实 CLI 调用。
- 不新增依赖，不改 `package.json`，不提交、不建分支，不执行发布脚本。
- 不为协议认证/分页差异强行建策略（网络协议 switch 保留在 discovery 内）。

- 实际策略回归为历史测试开发记录，证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)；ARCHITECTURE 写作原由已退役 docs companion 承接（仅历史分工），本计划不承接测试或文档任务。

## 设计

依赖方向单向：

```text
modelimport.ts (Facade)
    ├─→ modelimportplatformstrategies.ts ─┐
    ├─→ modelimportdiscovery.ts ──────────┤
    └─────────────────────────────────────┴─→ modelimportshared.ts → modelimporttypes.ts
                                              modelimportedits.ts ─→ modelimportshared.ts
```

- 策略表使用 `as const satisfies Record<ModelImportPlatform, ModelImportPlatformStrategy>`，七项编译期完整。
- `ModelImportPlatformStrategy` 含 `providers`、`writeDraft` 和可选 `discoveryFields`；Facade 只按 `payload.platform` 取表项，不再有七平台 `switch`。
- Facade 仍集中通用参数验证、当前草稿供应商存在性、安全 ID 检查与操作顺序（拒绝空选择 → 安全校验 → 委托写回）。
- 底层模块不得反向导入 Facade，避免循环依赖与安全规则复制。
- 每次调用都从当前 payload 草稿解析供应商，不缓存供应商、环境变量、凭据或上次草稿。

## 关键不变量

- 严格 payload/draft 字段白名单、2 MiB 草稿上限、平台白名单、选中模型去重与校验、`fields` 仅允许 Claude。
- 失败时不修改调用方草稿；`applyModelImport` 返回的草稿是新的克隆。
- Codex/OpenCode 优先 `configContent`，其他平台优先 `content`；返回目标字段与 `authContent` 保留方式不变。
- 多模型导入仅排除同一供应商的既有模型；全部已存在时返回等价克隆草稿；空选择仍拒绝。
- 逐平台约束（Codex 根 `model`、Claude 五字段、OpenCode JSONC、Grok 同源去重与别名、DSH 模板与 `SINITEK_DSH_API_KEY`、Kimi provider-local 模板、ZCode `personalModelIds`）按原实现迁移，逻辑逐行对照。
- `publicProvider` 不暴露 `apiKey`、`apiKeyEnv`、`requestBaseUrl`、`config`、`sourceId`、`existingModelIds`、`protocolKind`。

## 验收标准

- [x] 七项策略表编译期完整，Facade 无七平台 switch。
- [x] 三个公开函数签名、异步性质、结果结构与类型导出兼容，既有断言零删减。
- [x] 平台供应商/写回/发现/错误文本与原实现差分一致，输入草稿不变。

## 影响面与风险

生产 `src/config/modelimport*.ts` 模块重排；未新增依赖、未改 package.json 或构建脚本。

- 风险：重构改变平台写回细节。缓解：先做结构迁移再逐平台对照原实现，并额外用临时差分脚本对 HEAD 版本做供应商/发现/写回/错误文本的逐平台对比（脚本与临时基线文件已删除，不进入交付）。
- 风险：安全规则被复制到多处。缓解：URL/凭据/ID/脱敏规则只在 `modelimportshared.ts` 维护，discovery 与 strategies 只复用。
- 风险：Facade 变成新的巨型条件链。缓解：架构边界用例断言 Facade 无平台 `switch`、无 `payload.platform ===` 分支。
- 风险：忽略 `AbortSignal` 的注入 fetch 挂起。缓解：超时仍由 `Promise.race` 与 `AbortController` 双保险，既有超时用例保留。

## 任务列表

- [x] 逐平台契约确认，建立 types/shared/edits/discovery/strategies。
- [x] 收缩兼容 Facade，保留通用校验、操作顺序与安全规则单一来源。
- [x] 与 HEAD 原实现逐平台差分对照。

## 决策记录

- 2026-11-05：选择「静态策略表 + 兼容 Facade」，不用类继承、DI 容器或运行时注册；平台差异只有一处事实来源，Facade 保留通用校验与操作顺序。
- 2026-11-05：将 JSONC/TOML 编辑助手拆到 `modelimportedits.ts`，不塞进 `shared`，因为它们只服务写回边界。
- 2026-11-05：协议认证/分页分支留在 discovery，不强行策略化，避免把网络协议差异伪装成平台差异。
- 2026-11-05：Codex 单选写回保留「先过滤同供应商既有模型再要求恰好一项」的原语义，不把已存在模型误判为空选择。

## 验证计划与历史结果

历史构建、104项定向、2926项全量与最终2949项全量结果，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md` 见测试计划移除审计；文档校验与既有 AGENTS 空白失败原指向 docs companion（已退役，完整记录未恢复；不据退役抹去失败）。本计划的行为保持实证如下：

- 差分对照（临时脚本，未入库）：对 HEAD 原实现与重构后 Facade 逐平台比较 `getModelImportProviders`、`applyModelImport`（含全部已存在、空选择、单/多模型、Claude fields）与 `discoverImportModels`（含两页分页与请求失败），七平台结果与错误文本一致；最终代码上复跑一次（7 平台 × providers/apply（新模型、全部已存在、空选择）/discover 分页/discover 失败 + 3 组非法 payload），全部一致。临时基线与脚本已删除，清理后重新 `npm run build`，`dist/config/modelimportbaseline.js` 不再存在。

## 主审发现与修复证据（第二轮补记）

主审首次交付发现两类缺口，不能再称“完全无遗漏”。原文未更改允许字段、顺序、错误文本或 API 行为。

1. **单一来源缺口**：`src/config/modelimport.ts` 曾再次字面定义 `CLAUDE_FIELD_KEYS`，与 `src/config/modelimportshared.ts` 导出的五字段白名单重复。修复为 Facade 直接 `import { CLAUDE_FIELD_KEYS } from "./modelimportshared"` 并删除本地常量；`assertApplyPayload` 仍用同一数组校验 `model`、`env.ANTHROPIC_DEFAULT_HAIKU_MODEL`、`env.ANTHROPIC_DEFAULT_SONNET_MODEL`、`env.ANTHROPIC_DEFAULT_OPUS_MODEL`、`env.CLAUDE_CODE_SUBAGENT_MODEL`，错误文本仍为 `applyModelImport fields are invalid.`。Facade 平台白名单同时改为 `Object.keys(MODEL_IMPORT_PLATFORM_STRATEGIES)`，不再维护独立字面数组。

第二类架构遗漏由 docs 承接；新增三条回归的历史开发记录按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md` 见测试计划移除审计。此补记与 [范例导入单一来源修复](2026-11-05-refactor-example-import-model-discovery.md#背景与目标)记录同一补正背景，不当成两次独立运行。

## 文档与功能清单边界

- 功能清单：`FEATURE_INVENTORY` 无需行为更新。理由：用户可见能力、协议、错误文案、草稿边界与安全限制均未变化，本次只是宿主内部结构重排；既有条目已描述「按草稿解析供应商、显式发现、边界保留」的事实，来源路径 `src/config/modelimport.ts` 仍有效。

ontology 未新增概念，原 `plugin.rule.model_import_host_draft_boundary` 的 `source_refs` 中 Facade 入口仍有效，语义未变，不强行拆概念，仅以 `ontology --validate` 核对来源；实际 ARCHITECTURE 说明由 docs 负责。

## 未验证项

- 未启动 VS Code / Extension Development Host，未做浏览器视觉验收；UI 契约由现有 `modelimportui.test.ts` 与 `cliPageConfigCoverage.test.ts` 的静态/VM 断言覆盖，不等同视觉验收。
- 未运行真实 CLI 调用、真实供应商模型发现或漏洞扫描；按任务约束仅使用注入 fetch 的离线夹具。
- 未运行严格 100% 覆盖率门禁（`test:core-coverage` / `test:page-coverage`）；历史覆盖缺口见 `.ch/docs/exec-plans/tech-debt-tracker.md`，本次未降低阈值。
- 未执行发布脚本、未提交、未创建分支、未安装或升级依赖。

## 当前结论

行为保持重构及主审补正完成，原 completed 保留；全量/差分为历史执行，不声明本轮执行或真实供应商/CLI通过。

## 关联计划

- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留模型导入七平台策略与架构边界测试的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md`；不再作为现行测试责任。
- 历史文档分工：模型导入 Facade 与平台扩展架构说明，共享本来源的历史背景与接口。 原 docs companion `2026-11-05-docs-model-import-platform-strategies.md#背景与目标` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
