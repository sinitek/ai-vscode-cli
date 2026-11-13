# 配置档案复制策略提取

- 日期：2026-11-08
- 状态：completed
- 类型：refactor
- 负责人：Loop+ 本次 fullstack coding attempt
- owner：round-2-refactor-config-copy-strategies
- claimed_at：2026-11-08
- claim_ttl：本次实现与自测结束
- handoff_to：主审（独立兼容验收由另一任务负责）
- 历史来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md`

## 目标与范围

行为保持的七平台复制纯策略与copyConfig Facade，清除抽取遗留死函数/导入。

非目标：其他类型交付分别由关联计划负责，不承接其测试开发、文档编写或实现范围；原文的产品非目标及风险继续有效。

## 关联计划

- 历史回归证据已转入.ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json；本计划不承接独立测试开发。
- 历史文档分工：文档/事实源交付及其历史校验。 原 docs companion `2026-11-08-docs-config-profile-copy-strategies.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 行为保持的七平台复制纯策略与copyConfig Facade，清除抽取遗留死函数/导入；原可观察契约、非目标和限制以以下分配的原文为准。
- 原字段、49对限制、错误优先级、JSONC回退与浅复制不变；22/22、186/186、修复前及后333/333分阶段保留，无需语义更新清单/ontology。

## 验证与真实状态

验证计划：本类型的历史行为验证结果与未覆盖环境保留在下文；原 docs companion 已退役，其完整记录未恢复；独立测试开发及其已保留的结果/限制摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md），该计划已移除，不是当前验证入口，也不把测试开发并入本类型。本次不重跑历史业务验证。

原状态：completed。本类型已交付，保留原有完成语义和所有未验证边界；不表示宿主父任务或本次中央迁移已完成。

本次仅迁移计划，不执行下述历史命令。原文中的“本轮/本次/当前”均指原交付阶段，不指2026-11-11本次迁移。未运行、历史失败、跳过与后续纠正不因completed而消失；跨类型的整体结果只作关联交付背景，不构成本类型实施范围。

## 历史实施与证据

以下从同一来源按责任分配；历史范围/任务表中涉及关联类型的措辞仅说明当时协调或验收背景，以本文上面的单类型范围为准，不重新认领已拆走的交付。

### 背景与目标

CLI 参数构建、Runner 生命周期和上下文压缩已有策略结构；配置复制仍把七平台构造、四组跨平台限制、命名与持久化混在 configService 中。本次使用轻量 Strategy + Facade 提取无 I/O 规则，不以文件大小为重构依据。主审既有 decision-model 返回 profile_copy、confidence=0.99，仅作为选型辅助，不是正确性证据；本实现不重新决定候选。

### 范围与非目标

- 新增 configCopy.ts：静态七平台 Record、命名、按原优先级拒绝、内容构造；metadata 显式注入。
- copyConfig 保留公开签名、normalize → getById/notFound → 限制 → getList/name → 时间/ID → build → await saveConfig → 返回原对象的顺序；不改 saveConfig 及其锁、激活、校验、权限、原子写。
- 不改 UI、协议、依赖、发布、分支、提交、Loop 调度或运行记录，不扩展旧 TOML MCP 提取器或做无关安全改造。

### 验收标准

- [x] 七种目标策略与四组限制原样保留，legacy gemini 只经现有 normalizeConfigPlatform。
- [x] 保持字段集合、configContent 空字符串优先级、默认值、Skills 浅复制/元素复制和源不变。

### 影响面与风险

- 代码：src/config/configService.ts、src/config/configCopy.ts；src/test/config/configcopy.test.ts曾由独立 test 类型计划承接；该计划已移除，历史证据摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md）。
- 风险：CodeGraph 有未解析边，不能推定无其他调用；保留服务 API 并跑真实现有回归。独立测试并行写入，写前复读目标，避免覆盖；dist 构建仅本任务串行执行。
- 兼容细节：保留 OpenCode → DSH → Kimi Code → ZCode 错误优先级；保留 Claude/Codex/Grok 历史跨平台路径、JSONC 格式化及数组引用行为。
- 回滚：只撤回策略抽取、接线、测试和文档；无配置迁移或用户数据回滚。

### 任务列表

- [x] 核对根规则、ontology 和 CodeGraph 源码，确认契约与边界。
- [x] 提取策略并接线 facade。

### 决策记录

- 2026-11-08：使用简单函数、显式类型和模块级 Record，不引入继承、插件或运行时注册。复用 canonical 内容与既有 JSON/JSONC 解析器；保留原宽容回退，不重写通用解析器。
- 2026-11-08：执行目录是共享仓库的符号链接镜像，git 状态在镜像下误报缺失；后续在真实仓库路径操作，未修改或修复镜像，也不新建 worktree/分支。
- 2026-11-08：策略内只保留原有“解析失败退空对象”薄适配，严格/JSONC 通用解析仍调用 shared/jsonObject；不复制解析器。复用既有 Kimi/ZCode 纯文本构造，其模块的文件辅助函数不被调用；无 I/O 测试同时覆盖直接构造的历史不可达分支。

### 依据与边界

- 主审修复前已完成标准 build 与六文件合并测试 333/333，证据为 `/tmp/sinitek-copy-main-review.yyBDvc/build.log`、`tests.tap`；公开契约独立测试已通过。此处保留为修复前证据，不冒充本轮复验。
- 本轮在宿主提供的 `/private/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-loop-subtask-CiznYu` 操作，没有继续使用 round 2 临时工作目录。
- CodeGraph 优先查询后未返回目标源码正文，按当前磁盘源码和 TypeScript AST 复核：服务中的 readJsonObjectText/ConfigPathPlatform 各仅 1 处标识符出现；parseJsonObjectText/JsonObjectParseMode 各 2 处（导入加死函数内使用）；辅助函数体去注释打印与策略模块完全相同，没有存活调用。
- 修复仅删除 configService 中该私有死函数及 ConfigPathPlatform、parseJsonObjectText、JsonObjectParseMode 三个导入，保留仍有 14 处标识符出现的 isPlainObject。configCopy 内辅助函数、七平台策略和所有测试保持不动，不重抽通用工具、不清理其他历史死代码。
- 此次是 omissions and regressions / maintainability 收尾，不是修复功能测试失败；未改变公开 API、错误顺序、字段优先级、JSON/JSONC 回退、ID/时间、saveConfig、UI 或依赖。无需新增/修改测试断言、FEATURE_INVENTORY 或 ontology 语义，也不修改另一任务的验收测试。

### 本轮实际命令与结果

- 内联 Node/TypeScript AST 检查：服务不再含 readJsonObjectText、ConfigPathPlatform、parseJsonObjectText、JsonObjectParseMode；isPlainObject 仍为 14 处。SHA-256 对比修复前 manifest：configCopy.ts 和六个测试源文件全部 OK。

### 当前结论

原实现自测、主审修复前合并验证和本轮修复后 333/333 复验已分别记录；此次抽取遗留死函数/无用导入已清除，归档计划仅确认本实现与本轮收尾完成，不宣称主任务最终验收完成。主审可据本轮 diff 与新日志继续最终收口。保留旧 TOML 提取器与坏 JSONC 空对象回退的局限属于兼容要求，不是本次待修缺陷；CodeGraph 未解析边仍是索引限制。

## 当前进展与剩余边界

本类型历史交付保持原状态，未新增执行结果。原字段、49对限制、错误优先级、JSONC回退与浅复制不变；22/22、186/186、修复前及后333/333分阶段保留，无需语义更新清单/ontology。 最终中央映射合并、外部引用更新及根任务集成由后续所有者处理。
