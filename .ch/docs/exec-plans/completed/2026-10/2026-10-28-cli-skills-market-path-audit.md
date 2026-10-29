# Skills 市场 CLI 安装位置核对

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

Skills 市场已覆盖多个本地 CLI，需要确认用户级安装根目录和官方文档一致，并让功能规格准确反映当前目标集合。

## 目标

核对 Claude、Codex 以外所有 Skills 市场目标的官方安装位置；修正实际错误并同步过期规格。

## 范围

- 市场目标：OpenCode、Grok、DSH、Kimi Code、ZCode。
- 对照官方技能文档、当前路径解析器、技能列表和安装测试。
- 同步功能规格、功能清单和 Ontology。

## 非目标

- 不核验 Claude、Codex。
- 不变更 CLI 运行协议、配置读写或市场下载实现，除非发现安装位置与官方事实不符。
- 不改写历史已完成计划。

## 验收标准

- [x] 五个 CLI 的全局技能目录与官方事实逐一核对。
- [x] 功能规格和清单反映全部七个市场目标及路径。
- [x] Ontology 中的配置档案技能市场范围不再过期。
- [x] 相关构建、测试与文档校验通过。

## 影响面

- 代码目录：`src/config/cliGlobalSkills.ts`、`src/shared/userHomePaths.ts`（核对，不预设变更）。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/ontology/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：部分 CLI 支持环境变量、用户目录和项目目录多种技能来源，混淆安装范围。
- 缓解：以 CLI 官方用户级目录作为本市场落点，逐项保留默认目录和受支持的 home 覆盖。

## 验证计划

- 最小相关验证：路径解析和市场安装单测、功能清单文档校验。
- 单元自测命令：`npm run build`；`node --test dist/test/config/cliGlobalSkills.test.js dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js`。
- 扩展验证：Ontology validate 与测试；检查官方文档路径是否覆盖默认全局位置。

## 测试与清单同步

- 单元测试新增/更新：路径实现如有更改时补回归；若仅同步遗漏文档则不改测试。
- 单元自测结果：`npm run build` 通过；相关 50 项测试通过；`node --check media/config/assets/config-app-ui.js`、`git diff --check`、Ontology validate 和 9 项 Ontology 单测通过。
- 失败处理记录：无。
- 功能清单：同步七个技能管理/市场目标。
- 相关文档同步：能力规格、运行事实来源、Ontology。

## 任务列表

- [x] 盘点 CLI 目标与安装解析器。
- [x] 对照官方文档核验五个 CLI。
- [x] 修正文档与 Ontology 范围。
- [x] 运行针对性验证并归档计划。

## 决策记录

- 2026-10-28：默认全局目录与官方文档一致；后续修复聚焦七目标清单及遗漏路径说明，不为风格差异更改运行代码。

## 当前结论

OpenCode、Grok、DSH、Kimi Code、ZCode 五个市场目标的用户级默认目录均与官方说明匹配：`${XDG_CONFIG_HOME:-~/.config}/opencode/skills`、`~/.grok/skills`、`${DSH_HOME:-~/.dsh}/skills`、`${KIMI_CODE_HOME:-~/.kimi-code}/skills`、`~/.zcode/skills`。实现落点正确，无需修改安装路径代码。本轮补强市场安装回归，实际验证五个非 Claude/Codex 目标均写入各自解析根目录；已同步当前功能规格、运行时参考和 Ontology。所有计划内构建、测试和校验通过。
