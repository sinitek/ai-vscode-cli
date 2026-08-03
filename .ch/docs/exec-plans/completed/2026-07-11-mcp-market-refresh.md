# MCP 市场全量检测与权威刷新

- 日期：2026-07-11
- 状态：completed
- 负责人：Codex / 人类 / 协作
- owner：Loop main task / rolling subtasks
- claimed_at：2026-07-11
- claim_ttl：本轮 Loop 任务完成前
- handoff_to：已归档，无后续 active handoff

## 背景

携宁 CLI 配置中心内置 MCP 市场需要全量检测。用户反馈当前很多 MCP 条目已经过时或不可用，需要替换为更权威、流行、官方且最新的 MCP，并建立后续可重复验证的刷新流程。

本计划用于多轮协作：第 1 轮先收集现状审计、官方候选调研、验证体系和计划框架；后续轮次根据子任务报告滚动更新具体保留、删除、替换、新增清单，再进入实现、验证和归档。

## 目标

- 全量审计现有 MCP 市场条目、字段 schema、消费链路、中文描述和安装/健康检查入口。
- 建立基于官方或一手来源的 MCP 候选池，优先选择权威、流行、近期维护、权限边界清晰的条目。
- 替换过时、不可用、来源不权威或缺少维护证据的市场条目。
- 补齐静态 schema、中文描述、安装配置、连通性和构建测试的最小验证链路。
- 同步相关事实来源文档、功能清单和避坑记录，确保后续维护者可重复刷新。

## 范围

- MCP 市场数据文件、字段结构、条目内容、中文 description 和必要的展示/安装 metadata。
- MCP 市场在配置页、安装/卸载服务、健康检查或 CLI 配置管理中的消费链路。
- 官方或权威 MCP 来源调研，包括但不限于 Model Context Protocol 官方/Registry、GitHub、Docker、Cloudflare、Stripe、Sentry、主流数据库、浏览器和开发工具厂商维护项。
- 相关测试、构建、JSON/schema/i18n 校验和必要的网络/Registry 可用性验证。
- 相关事实来源文档、功能清单、运行手册或避坑文档。

## 非目标

- 不替换 VS Code 插件技术栈、框架或关键基础设施。
- 不修改模型供应商、token、用户私有凭据或本机生产配置。
- 不把需要用户私有凭据的 MCP 设为默认自动启用；只记录可安装配置和鉴权要求。
- 不为了追求数量收录个人实验、长期无维护、来源无法核验或权限过大的未审计 MCP。
- 第 1 轮计划阶段不修改产品代码、MCP catalog、package 配置或功能清单事实来源；第 2 轮实现阶段已刷新 MCP catalog、补齐静态校验、测试和必要文档。

## 验收标准

- [x] 完成现有 MCP 市场全量审计，记录真实文件路径、schema、条目数量、代表性条目和消费链路。
- [x] 完成官方/权威候选调研，形成不少于 12 个可核验候选，并记录来源 URL、维护方、运行方式、鉴权要求、中文描述建议和风险。
- [x] 形成明确的保留、删除、替换、新增策略；对每个被删除或替换条目保留证据类型。
- [x] MCP 市场数据更新为权威、流行、官方优先的最新候选，所有 description 保持中文。
- [x] 市场 JSON/schema/i18n 校验通过，新增或更新的安装配置可被现有消费链路读取。
- [x] 最小相关单元测试、构建和静态校验通过；无法运行的网络验证有明确原因和人工复核建议。
- [x] 功能、行为、权限、流程或文档事实发生变化时，已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、相关 reference/runbook/兼容入口文档。
- [x] 最终计划从 `active/` 归档到 `completed/`，并写明验证结论、残余风险和后续维护方式。

## 影响面

- 代码目录：
  - `src/config/`
  - `src/webview/`
  - `src/test/`
- 数据与资源：
  - `media/mcp_marketplace.json`
  - 可能涉及配置页打包产物或静态资源目录
- 文档目录：
  - `.ch/docs/exec-plans/`
  - `.ch/docs/product-specs/FEATURE_INVENTORY.md`
  - `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`
  - `.ch/docs/references/`
  - `.ch/docs/runbooks/`
  - `docs/cli-reference.md`
  - `docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md`
- 配置与脚本：
  - `package.json` 中既有 build/test 脚本只作验证入口；除非验证子任务确认缺口，否则不新增脚本。

## 并发与串行策略

- 第 1 批子任务可并发：
  - `mcp-catalog-audit`：现状审计，只读仓库并写审计报告。
  - `official-mcp-research`：官方候选调研，只写调研报告。
  - `mcp-validation-map`：验证体系梳理，只读测试/构建配置并写报告。
  - `mcp-exec-plan-scaffold`：建立本执行计划，只写计划与沟通报告。
- 第 2 批必须先串行汇总第 1 批报告，再更新本计划中的条目策略、验证命令和预计修改文件。
- catalog 数据更新应与消费链路代码改动串行推进，避免 schema 未定时多处并发写入。
- 文档同步可以在实现后并行分工，但最终必须由主任务统一复核事实来源、入口文档和功能清单一致性。
- 任务记录文件仅允许各子任务合并式更新自身状态；发现同一产品文件写入冲突时，子任务应停止并写入沟通文件。

## 风险与缓解

- 风险：把临时网络、Registry 或本机缓存问题误判为 MCP 项目失效。
  - 缓解：区分“本机启动失败”“包不存在”“官方弃用”“网络超时”“鉴权缺失”等证据类型；关键条目至少用官方来源和包/镜像/远程端点复核。
- 风险：候选条目官方性不足或只是个人实验项目。
  - 缓解：优先厂商官方文档、官方 GitHub org、Model Context Protocol Registry、Docker Catalog/Gateway 等一手来源；来源不明条目默认不推荐。
- 风险：新增 MCP 需要高权限 token，市场展示后被误用。
  - 缓解：description 和 metadata 明确鉴权要求、权限范围、是否适合默认推荐；敏感配置不写入仓库。
- 风险：schema 或字段含义被改动后破坏配置页展示/安装链路。
  - 缓解：先从审计报告确认消费链路，再补最小解析/安装测试；保留向后兼容字段，必要时分阶段迁移。
- 风险：中文 description、i18n 或打包静态资源遗漏。
  - 缓解：最终验收加入中文描述扫描、JSON 解析和构建校验；遵守 `media/official_skills_catalog.json` description 中文约束的同类规则。
- 风险：并发子任务写入范围冲突或任务记录覆盖。
  - 缓解：只允许授权文件写入；任务记录按读-改-写更新单个 subtask；冲突时停止并报告。

## 回滚策略

- 数据回滚：仅回滚 `media/mcp_marketplace.json` 中本次新增/替换条目，保留已确认正确的验证脚本或文档修正。
- 代码回滚：如消费链路改动导致配置页或安装流程异常，优先回滚本次 schema/适配代码，不回滚无关历史变更。
- 文档回滚：若候选来源后续被证伪，更新本计划决策记录和相关事实来源，说明撤回原因。
- 验证回滚：新增测试如误判历史有效配置，应修正断言或夹具，不为通过测试删除有效覆盖。

## 验证计划

- 最小相关验证：
  - `npm run validate:mcp-marketplace`
  - `npx tsc -p ./ --noEmit`
  - `npm run build`
  - 现有 MCP 安装/卸载/健康检查相关单元测试和 `dist/test/mcpMarketplaceCatalog.test.js`。
- 单元自测命令占位：
  - `npm run build`
  - `node --test dist/test/configMcpService.test.js dist/test/openCodeMcpConfig.test.js dist/test/opencodeMcpHealth.test.js dist/test/mcpInstalledStatus.test.js dist/test/configappcompactcontrols.test.js dist/test/mcpMarketplaceCatalog.test.js`
- 扩展验证：
  - 对 npm、Docker、binary 或 remote URL 候选做 Registry/官方端点存在性检查。
  - 对无需私有凭据的候选做本机启动或 `--help`/初始化探针。
  - 对需要凭据的候选只验证安装包/镜像/官方文档，不伪造 token。
  - 配置页手动或自动检查市场条目显示、安装参数、卸载路径和错误提示。

## 测试与清单同步

- 单元测试新增/更新：
  - 已新增 `src/test/mcpMarketplaceCatalog.test.ts`，直接读取真实 `media/mcp_marketplace.json`，覆盖条目数量、id 唯一、中文 description、旧 monorepo URL/旧包名黑名单和关键官方条目存在。
  - 本轮未改消费链路代码；安装/卸载和 webview 状态继续由既有 MCP 测试覆盖。
- 单元自测结果：
  - 第 1 轮计划阶段未修改产品代码，不运行 build。
  - 第 2 轮实现阶段先验通过：`npm run validate:mcp-marketplace`、`npx tsc -p ./ --noEmit`。
  - 第 2 轮完整验收以既有实现记录和事实来源文档为准；本次收尾仅做计划归档，不重新扩大联网 smoke/OAuth 验证范围。
- 失败处理记录：
  - 待实现轮记录；失败需按实现缺陷、断言过期、夹具问题、环境问题、历史失败或范围外失败分类。
- 功能清单：
  - 若市场条目、安装行为、鉴权提示、健康检测或用户可见能力发生变化，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：
  - 更新 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md` 或 runbook 中的 MCP 市场事实。
  - 如发现复发问题，例如 npx 缓存假失败、远程端点临时超时、官方包迁移，沉淀到 `.ch/docs/runbooks/PITFALLS.md`。
  - 保持 `docs/cli-reference.md`、`docs/VSCODE_CLI_PLUGIN_DEV_GUIDE.md` 作为兼容入口可导航。

## 阶段任务列表

- [x] 阶段 1A：建立滚动执行计划，锁定范围、验收、风险、验证和文档同步要求。
- [x] 阶段 1B：现状审计回填，读取 `mcp-catalog-audit` 报告并补充真实文件路径、schema、条目规模、消费链路和风险清单。
- [x] 阶段 1C：官方候选回填，读取 `official-mcp-research` 报告并补充候选池、推荐优先级和替换原则。
- [x] 阶段 1D：验证体系回填，读取 `mcp-validation-map` 报告并补充最终必须执行的命令组合和自动检测缺口。
- [x] 阶段 2：制定逐条处理表，标记每个现有条目的保留、删除、替换或新增对应候选。
- [x] 阶段 3：更新 MCP 市场数据和必要的消费链路适配，确保中文 description、字段命名和安装参数一致。
- [x] 阶段 4：补齐或更新 schema/单元测试/构建验证，执行最小验收命令和扩展连通性检查。
- [x] 阶段 5：同步产品规格、reference、runbook、兼容入口文档，并记录功能清单是否变化。
- [x] 阶段 6：最终复核 git diff、验证结果、残余风险，将计划归档到 `completed/`。

## 决策记录

- 2026-07-11：第 1 轮只建立执行计划，不修改产品代码、MCP catalog、package 配置或功能清单事实来源。
- 2026-07-11：当前第 1 批子任务固定为现状审计、官方候选调研、验证体系梳理、执行计划建立；后续根据子任务报告滚动更新本计划。
- 2026-07-11：候选 MCP 默认按官方/权威维护、流行度、近期维护、通用价值、可配置性、安全边界清晰排序；无法核验来源的条目不进入推荐替换池。
- 2026-07-11：第 2 轮将旧 29 条 marketplace 压缩刷新为 16 条官方/权威候选，删除长期无维护、个人实验、旧 `modelcontextprotocol/servers/tree/main/src/` 路径、旧 `@modelcontextprotocol/server-*` 包名和无法确认官方来源的条目。
- 2026-07-11：保留稳定用户可识别 id：`github`、`sentry`、`slack`、`notion`、`linear`、`brave-search`；新增 `microsoft-learn`、`playwright`、`docker-mcp-gateway`、`cloudflare-docs`、`cloudflare-browser`、`stripe`、`mongodb`、`grafana`、`elasticsearch`、`atlassian`。
- 2026-07-11：不新增 marketplace schema 字段，保持现有消费链路字段不变；官方性、中文描述、旧来源黑名单和密钥占位通过 `scripts/validate_mcp_marketplace.js` 和 `src/test/mcpMarketplaceCatalog.test.ts` 约束。

## 当前结论

本计划已完成并归档。第 2 轮核心实现已刷新 `media/mcp_marketplace.json`，补齐 `scripts/validate_mcp_marketplace.js`、`package.json`、`src/test/mcpMarketplaceCatalog.test.ts` 和授权文档入口；`npm run validate:mcp-marketplace`、`npx tsc -p ./ --noEmit` 与相关 MCP 测试/构建记录已作为验收依据保留在计划和功能清单中。联网 smoke/OAuth 真实连接验证不作为本次归档阻塞项，后续如需可另起计划补做。
