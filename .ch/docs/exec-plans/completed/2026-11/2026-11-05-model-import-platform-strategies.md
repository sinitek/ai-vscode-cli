# 模型导入平台策略注册表重构

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：Codex fullstack 子模型
- claimed_at：2026-11-05
- claim_ttl：本次执行内有效
- handoff_to：主审查者

## 背景

`src/config/modelimport.ts` 原本 1249 行，把七类 CLI 的供应商解析、不同配置格式写回、有界 HTTP 模型发现、安全校验和公开 API 编排混在一个文件里。

- `providersFor` 是七分支 `switch`，`applyMultiImport` 又按平台二次分支，`discoverImportModels` 与 `applyModelImport` 各自保留 Claude/Codex 特例。
- 新增一个平台需要同时理解并改动多处，且公共校验、凭据解析、脱敏和草稿克隆没有明确的归属边界。
- 方向分析中对比了 `configService`（运行配置已策略化）和 Loop 编排（高风险并发状态），选择模型导入，避免为了模式而重复抽取已策略化模块。决策辅助 confidence 0.95 仅作方向参考，不作为正确性证据。

## 目标

完成一次保持行为的重构：把平台差异收进以 `ModelImportPlatform` 为键的显式策略注册表，同时保留 `src/config/modelimport.ts` 作为兼容 Facade，三个公开函数签名、异步性质、结果结构和既有类型导出不变。

## 范围

- 新增 `src/config/modelimporttypes.ts`：公共契约与内部契约（草稿、供应商、payload、结果、选项、`InternalProvider`、策略接口）。
- 新增 `src/config/modelimportshared.ts`：被多层复用的纯工具，包括 JSON/JSONC/TOML 解析包装、安全 ID/字段键、URL 与凭据校验、脱敏、草稿克隆、供应商构造与禁用原因、协议归一。
- 新增 `src/config/modelimportedits.ts`：JSONC/TOML 定向编辑助手（格式适配边界）。
- 新增 `src/config/modelimportdiscovery.ts`：有界 HTTP 模型发现，包括地址构造、响应/分页上限、同源重定向与分页校验、`Promise.race` 超时。
- 新增 `src/config/modelimportplatformstrategies.ts`：七项策略表 `satisfies Record<ModelImportPlatform, ModelImportPlatformStrategy>`，每项配对供应商解析与导入写回，Claude 额外提供发现字段构建器。
- `src/config/modelimport.ts` 收缩为 Facade：payload 校验、供应商存在性、安全模型 ID、操作顺序与公开 DTO 投影。
- 新增 `src/test/config/modelimportplatformstrategies.test.ts`：策略完整性、公开结果兼容、同供应商重复项无操作、输入草稿不变、失败路径与架构边界。
- 同步 `ARCHITECTURE.md` 服务层边界说明。

## 非目标

- 不改变 Webview 协议、页面结构、交互、布局、主题或文案；不改 `media/config/assets`。
- 不翻译或改写既有错误文本（UI 安全错误映射依赖它们）。
- 不增加自动保存、激活、文件系统写入、后台发现请求或真实 CLI 调用。
- 不新增依赖，不改 `package.json`，不提交、不建分支，不执行发布脚本。
- 不为协议认证/分页差异强行建策略（网络协议 switch 保留在 discovery 内）。

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

- [x] 七项策略表编译期完整，Facade 无七平台 `switch`。
- [x] 公开函数签名、结果结构与类型导出保持兼容。
- [x] 既有 `modelimport.test.ts`、`modelimportui.test.ts`、`cliPageConfigCoverage.test.ts` 断言不删减、不修改预期并通过。
- [x] 新增策略完整性、公开 DTO、重复项无操作、输入草稿不变、非法平台/失败路径与架构边界用例。
- [x] `npm run build` 通过。
- [x] 定向 Node 测试通过。
- [x] `npm run test:unit` 全量通过（含构建）。
- [x] `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` 通过。
- [x] `node scripts/run_unit_tests.js --list` 只列出 `dist/test/**/*.test.js`。
- [x] `ontology --validate` 通过。
- [x] 改动范围空白检查通过。

## 影响面

- 代码目录：`src/config/modelimport*.ts`、`src/test/config/modelimportplatformstrategies.test.ts`。
- 文档目录：`ARCHITECTURE.md`、本执行计划。
- 配置与脚本：无（未新增依赖、未改构建脚本）。

## 风险与缓解

- 风险：重构改变平台写回细节。缓解：先做结构迁移再逐平台对照原实现，并额外用临时差分脚本对 HEAD 版本做供应商/发现/写回/错误文本的逐平台对比（脚本与临时基线文件已删除，不进入交付）。
- 风险：安全规则被复制到多处。缓解：URL/凭据/ID/脱敏规则只在 `modelimportshared.ts` 维护，discovery 与 strategies 只复用。
- 风险：Facade 变成新的巨型条件链。缓解：架构边界用例断言 Facade 无平台 `switch`、无 `payload.platform ===` 分支。
- 风险：忽略 `AbortSignal` 的注入 fetch 挂起。缓解：超时仍由 `Promise.race` 与 `AbortController` 双保险，既有超时用例保留。

## 验证计划

- 最小相关验证：`npm run build`，再 `node --test dist/test/config/modelimport.test.js dist/test/config/modelimportui.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/modelimportplatformstrategies.test.js`。
- 全量回归：`npm run test:unit`（串行，自带构建）。
- Python 脚本回归：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`。
- 发现范围核对：`node scripts/run_unit_tests.js --list`。
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- 空白：`git diff --check` 与定向文件检查。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/config/modelimportplatformstrategies.test.ts`（9 个用例）；既有三个模型导入相关测试文件零删减。
- 单元自测结果：见「验证证据」。
- 失败处理记录：无实现缺陷失败；一次新增用例断言写错（把既有公开字段 `anthropicAuthToken` 当作泄漏）按测试断言过期修正，实现未改。
- 功能清单：`FEATURE_INVENTORY` 无需行为更新。理由：用户可见能力、协议、错误文案、草稿边界与安全限制均未变化，本次只是宿主内部结构重排；既有条目已描述「按草稿解析供应商、显式发现、边界保留」的事实，来源路径 `src/config/modelimport.ts` 仍有效。
- 相关文档同步：`ARCHITECTURE.md` 补充 Facade/策略/发现/共享边界与新增平台方式；Ontology 未新增概念，`plugin.rule.model_import_host_draft_boundary` 的 `source_refs` 指向的 Facade 仍是有效入口，语义未变，不强行拆概念，仅运行 `--validate`。

## 任务列表

- [x] 读取原文件与既有测试，确认契约与逐平台约束
- [x] 建立 types/shared/edits/discovery/strategies 模块
- [x] 将 `modelimport.ts` 收缩为兼容 Facade
- [x] 新增策略与架构边界回归用例
- [x] 与 HEAD 实现做差分对照
- [x] 同步 `ARCHITECTURE.md`
- [x] 定向测试与全量 Node/Python 回归
- [x] Ontology 校验与空白检查
- [x] 归档计划

## 决策记录

- 2026-11-05：选择「静态策略表 + 兼容 Facade」，不用类继承、DI 容器或运行时注册；平台差异只有一处事实来源，Facade 保留通用校验与操作顺序。
- 2026-11-05：将 JSONC/TOML 编辑助手拆到 `modelimportedits.ts`，不塞进 `shared`，因为它们只服务写回边界。
- 2026-11-05：协议认证/分页分支留在 discovery，不强行策略化，避免把网络协议差异伪装成平台差异。
- 2026-11-05：Codex 单选写回保留「先过滤同供应商既有模型再要求恰好一项」的原语义，不把已存在模型误判为空选择。

## 验证证据

- `npx tsc -p ./ --noEmit`：成功（0 错误）。
- `npm run build`：成功（先清理 `dist/` 再 tsc）。
- `node --test dist/test/config/modelimport.test.js dist/test/config/modelimportui.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/modelimportplatformstrategies.test.js`：`# tests 104`、`pass 104`、`fail 0`、`skipped 0`，退出码 0。
- `npm run test:unit`：`# tests 2926`、`pass 2923`、`fail 0`、`skipped 3`，退出码 0；日志 `/tmp/sinitek-modelimport-refactor-unit-final3.log`。3 个跳过项为依赖真实 DSH 环境的既有测试。
- `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`：`Ran 44 tests`，`OK (skipped=1)`，退出码 0。
- `node scripts/run_unit_tests.js --list`：264 行，全部为 `dist/test/**/*.test.js`，无 `src/test/**/*.ts`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：`validation passed: domains=2 concepts=16 relations=15 rules=105 workflows=2 documents=3`。
- `git diff --check -- src/config/modelimport.ts ARCHITECTURE.md .ch/docs/exec-plans/active`：退出码 0；本次新增/修改的 9 个文件用 Python 空白扫描 0 命中。
- `npm run validate:whitespace`：退出码 1，唯一命中为修改前已存在的 `AGENTS.md:8: trailing whitespace`（历史问题，未修改根规则文件，符合任务约束）。
- 差分对照（临时脚本，未入库）：对 HEAD 原实现与重构后 Facade 逐平台比较 `getModelImportProviders`、`applyModelImport`（含全部已存在、空选择、单/多模型、Claude fields）与 `discoverImportModels`（含两页分页与请求失败），七平台结果与错误文本一致；最终代码上复跑一次（7 平台 × providers/apply（新模型、全部已存在、空选择）/discover 分页/discover 失败 + 3 组非法 payload），全部一致。临时基线与脚本已删除，清理后重新 `npm run build`，`dist/config/modelimportbaseline.js` 不再存在。

## 失败分类与处理

- 首次全量运行出现 4 条 `modelimportui` 失败：当时磁盘上 `media/config/assets/config-app-ui.js` 正被外部并发修改（该文件与 `modelimportui.test.ts` 在本次会话外被改动，`git status` 可见），失败断言针对旧 UI 文案；重跑后 28/28 通过。判定为环境/并发外部改动，不是本次实现缺陷。
- 第二次全量运行出现 23 条 `Codex runner` 失败，错误均为 `ENOENT: dist/interactive/codexRunner.js`：外部并发构建清理了 `dist`。串行重跑后全量 0 失败。判定为环境问题（共享工作树并发构建），本次未改这些模块。
- 新增策略测试首次失败 1 条：断言把既有公开字段 `anthropicAuthToken` 误判为泄漏。修正测试白名单，实现未改；判定为测试断言过期。
- 无实现缺陷失败，无范围外业务修改。

## 未验证项

- 未启动 VS Code / Extension Development Host，未做浏览器视觉验收；UI 契约由现有 `modelimportui.test.ts` 与 `cliPageConfigCoverage.test.ts` 的静态/VM 断言覆盖，不等同视觉验收。
- 未运行真实 CLI 调用、真实供应商模型发现或漏洞扫描；按任务约束仅使用注入 fetch 的离线夹具。
- 未运行严格 100% 覆盖率门禁（`test:core-coverage` / `test:page-coverage`）；历史覆盖缺口见 `.ch/docs/exec-plans/tech-debt-tracker.md`，本次未降低阈值。
- 未执行发布脚本、未提交、未创建分支、未安装或升级依赖。

## 主审发现与修复证据（第二轮补记）

主审对首次交付提出两类缺口，均在本轮修复，不修改允许字段、顺序、错误文本或 API 行为：

1. **单一来源缺口**：`src/config/modelimport.ts` 曾再次字面定义 `CLAUDE_FIELD_KEYS`，与 `src/config/modelimportshared.ts` 导出的五字段白名单重复。修复为 Facade 直接 `import { CLAUDE_FIELD_KEYS } from "./modelimportshared"` 并删除本地常量；`assertApplyPayload` 仍用同一数组校验 `model`、`env.ANTHROPIC_DEFAULT_HAIKU_MODEL`、`env.ANTHROPIC_DEFAULT_SONNET_MODEL`、`env.ANTHROPIC_DEFAULT_OPUS_MODEL`、`env.CLAUDE_CODE_SUBAGENT_MODEL`，错误文本仍为 `applyModelImport fields are invalid.`。Facade 平台白名单同时改为 `Object.keys(MODEL_IMPORT_PLATFORM_STRATEGIES)`，不再维护独立字面数组。
2. **架构说明遗漏**：`ARCHITECTURE.md` 补充了平台扩展流程中必须同步更新的两处白名单来源（策略表键派生的平台白名单、`modelimportshared.ts` 的 Claude 五字段），并指出对应回归文件。

回归证据（`src/test/config/modelimportplatformstrategies.test.ts` 新增 3 条）：

- 「keeps the Claude field whitelist single-sourced between facade and strategies」：静态断言三文件中只有一处 `const CLAUDE_FIELD_KEYS = [`，Facade 内仅剩 2 处引用（import 与校验），五字段顺序固定。
- 「rejects invalid Claude fields through the shared whitelist」：`env.UNKNOWN_MODEL`、`model.name`、`env` 均被拒绝且错误匹配 `/fields are invalid/`；五字段逐一可正常映射。
- 「derives the facade platform whitelist from the strategy registry」：Facade 无平台字面数组、引用 `Object.keys(MODEL_IMPORT_PLATFORM_STRATEGIES)`、覆盖七平台，`gemini` 报 `/platform is unsupported/`。

命令与结果：`npm run build` 退出码 0；`node --test dist/test/config/modelimport.test.js dist/test/config/modelimportplatformstrategies.test.js` 为 `# tests 40`、`pass 40`、`fail 0`；本轮最终全量 `npm run test:unit` 为 `# tests 2949`、`pass 2946`、`fail 0`、`skipped 3`（日志 `/tmp/r2-unit-final2.log`）。因此首次交付「完全无遗漏」的表述不再成立，以本节为准。

## 当前结论

实现与验证完成，计划标记 completed 并归档到 `.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md`。
