# 配置备份表驱动重构（config-backup-registry）

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- owner：round-2 子任务（msg_1793254575059_b2ba006663089 / config-backup-contract-repair-and-refactor）
- claimed_at：2026-10-29
- claim_ttl：本次子任务会话内
- handoff_to：无

## 背景

`src/config/configService.ts` 的六个 `backup*Config` 函数（claude、codex、opencode、grok、kimi-code、dsh）是同一条备份流程的六份拷贝，仅在「文件名前缀/扩展名、读取来源、DSH 是否 0o600」三处不同；`getBackupList` 又用一段嵌套三元维护「平台 → 备份文件前缀」的第二份知识。round-1 审计推荐将其表驱动化，但 round-1 报告存在契约错误，本计划先纠正，再实施。

### round-1 审计契约纠正（本计划的明确修正，不改写历史报告）

1. **时间戳唯一性错误**：round-1 契约第 3 条声称「不同调用之间时间戳不同（含秒级重入时也由 ISO 毫秒区分）」。实际实现只使用 `new Date().toISOString()`（毫秒精度），同一毫秒内的两次调用会生成相同时间戳、相同文件名（后写覆盖前写）。正确契约是：**同一调用内的多个文件共享一次生成的时间戳；实现不得提供跨调用唯一性保证，也不得新增随机后缀、计数器或碰撞处理**。测试不得断言不同调用必然产生不同路径。
2. **执行器草案顺序错误**：round-1 草案把生成时间戳放在读取之前，并建议逐文件顺序写。现有实现是**先完成全部读取（Claude 的 settings/MCP 经 `Promise.all` 并行；Codex 复用 `readCodexConfig` 的 `Promise.all`），再生成一次时间戳，再按描述顺序构造全部路径并行写入**。执行器必须保持该顺序。
3. **表平台声明错误**：round-1 草案把表声明为七平台 `Record<CurrentConfigPlatform, BackupSpec>`（含 zcode），同时又要求 zcode 备份不并入表。正确做法是表的键类型为 `Exclude<CurrentConfigPlatform, "zcode">`，覆盖 claude、codex、opencode、grok、dsh、kimi-code 六项；ZCode 保留 `src/config/zcodeConfig.ts:backupZcodeProviderConfig` 的独立备份端口（`.bak-Date.now()` 命名、缺失/访问失败返回 `null`、策略转换为 `[]`）。
4. **产物状态纠正**：round-1 为纯分析子任务，未新增代码测试或可运行产物，`tests`、`artifacts` 应标注 not applicable，而非「测试通过」。

## 目标

在 `configService` 内引入私有备份策略描述表和单一固定流程执行器，消除六份流程拷贝与 `getBackupList` 的第二份前缀映射；所有公开导出、文件名、数组顺序、内容、权限、异常传播保持不变。

## 范围

- `src/config/configService.ts`：新增私有 `BACKUP_PLATFORMS` 描述表（键 `Exclude<CurrentConfigPlatform, "zcode">`）与 `runBackup` 执行器；六个 `backup*Config` 导出改为薄包装；`getBackupList` 前缀改查同一张表（zcode 保留 `zcode_` 兼容分支）。
- `src/test/config/configService.test.ts`：扩展回归测试。
- `ARCHITECTURE.md`「CLI / Interactive / Config 服务层」：补一句备份表驱动的事实说明（不含易过期行数）。
- 本执行计划。

## 非目标

- 不迁移 ZCode 备份进新表；不修正其备份目录与 `getBackupList` 的历史差异。
- 不重构 `normalize*ConfigFields`、webview 时间戳副本或其他 round-1 候选。
- 不新增依赖、公开 API、类继承体系或 DI 容器；不改 UI、webview 消息协议。
- 不新增取消接口、事务、回滚、清理或错误吞噬；不改变并行写失败时可能留下部分文件的既有行为。

## 固定流程契约（执行器实现依据）

1. `await ensureDir(BACKUP_DIR)`（`BACKUP_DIR` 仍在模块加载时由 `path.join(os.homedir(), ".ai_cli_tools_backups")` 求值）。
2. `await` 对应平台的读取回调（读取回调内完成全部读取；Claude 继续 `Promise.all` 并行 settings/MCP，Codex 继续复用 `readCodexConfig`）。
3. 只生成一次 `new Date().toISOString().replace(/[:.]/g, "-")`。
4. 按描述顺序构造全部备份路径。
5. 并行写文件（DSH 用 `encoding: "utf-8", mode: 0o600` 并在写完后 `await fs.chmod(path, 0o600)`；其余平台 Node 默认 mode）。
6. 返回与描述顺序相同的 `string[]` 绝对路径。

行为不变量：

- 文件名严格保持：`claude_settings_<ts>.json`、`claude_mcp_<ts>.json`；`codex_config_<ts>.toml`、`codex_auth_<ts>.json`；`opencode_config_<ts>.json`；`grok_config_<ts>.toml`；`kimi-code_config_<ts>.toml`；`dsh_config_<ts>.json`。
- 内容来自现有 `readClaudeConfig/readClaudeMcpConfig`、`readCodexConfig`、`readOpenCodeConfig`、`readGrokConfigText`、`readKimiCodeConfigTextFromDisk`、`readDshConfigText`，保持原文字节与 utf-8，不解析重排，不备份 Codex `.env`，不缓存读取，不在表初始化时执行读取。
- `GROK_HOME` 仍在操作时经 `resolveGrokConfigPath()` 解析；缺失文件返回空串的 reader 规则沿用。
- 所有目录、读取、写入和 chmod 错误原样拒绝向上传播。
- `getBackupList` 保持 `ensureDir → readdir → normalizeConfigPlatform → startsWith(prefix) → sort().reverse()`，返回文件基名；前缀为 `claude_`、`codex_`、`opencode_`、`grok_`、`dsh_`、`kimi-code_`、`zcode_`；`gemini` 归一为 opencode；未知平台由 normalizer 抛错；不新增扩展名/格式筛选。
- ZCode 的 `backupZcodeProviderConfig` 与 `cliRuntimeConfigStrategies.ts` 的 backup 包装不变。
- 六个导出 `backup*Config` 函数保留名称与 `() => Promise<string[]>` 签名；`createCliRuntimeConfigStrategies` 端口、`backupConfig` 归一化分派与所有调用者（`src/webview/configPanel.ts:247/:250`）兼容。

## 验收标准

- [x] 表驱动执行器替代六份重复流程，键类型排除 `zcode`
- [x] `getBackupList` 复用同一前缀事实，不再维护第二份映射
- [x] 全部公开导出、文件名、顺序、内容、权限、异常语义不变
- [x] 回归测试覆盖 DSH/Kimi 文件名与原文、七平台 + gemini 列表前缀隔离与逆序、跨平台噪声、DSH 0o600（POSIX）、普通 IO 失败传播、共享时间戳
- [x] `npm run build` 与 `node --test dist/test/config/configService.test.js dist/test/config/cliruntimeconfigstrategies.test.js` 通过（33/33）
- [x] `git diff --check` 干净
- [x] ARCHITECTURE.md 与本计划同步归档

## 影响面

- 代码目录：`src/config/configService.ts`
- 测试目录：`src/test/config/configService.test.ts`
- 文档目录：`ARCHITECTURE.md`、`.ch/docs/exec-plans/completed/2026-10/2026-10-29-config-backup-registry.md`

## 风险与缓解

- 风险：时间戳共享与文件顺序在重构中漂移。缓解：现有 `configService.test.ts` 的 runtime backups 测试逐文件名断言，再补共享时间戳用例。
- 风险：并行 ZCode 上下文压缩改动同处工作树。缓解：开工基线已记录 16 个 dirty 文件（`src/contextCompactionRunner.ts`、`src/interactive/zcodeRunner.ts`、`src/interactive/zcodeAppServerProtocol.ts`、`src/webview/viewContentScript/*`、`src/webview/viewContentStrings.ts`、`docs/zcode-guide.md`、FEATURE_INVENTORY、ontology、`completed/2026-10/2026-10-29-zcode-context-compaction.md` 等），本次仅检查自身增量；测试失败若来自这些变更，保留证据并分类。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/config/configService.test.js dist/test/config/cliruntimeconfigstrategies.test.js`
- 扩展验证：`git diff --check`；`npm run validate:whitespace`（范围外不强制）
- 启动应用：not applicable（无独立应用产物）；浏览器烟测：not applicable（不改页面）

## 测试与清单同步

- 单元测试新增/更新：`src/test/config/configService.test.ts` 新增 3 个用例（DSH/Kimi 备份名与原文与 0o600、七平台 + gemini 列表前缀隔离与跨平台噪声、读失败传播），保留既有 runtime backups 与策略端口委托测试
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/configService.test.js dist/test/config/cliruntimeconfigstrategies.test.js` 连续 5 次 33/33 通过；`git diff --check` 无输出；`node scripts/check_trailing_whitespace.js` 对改动文件无告警
- 失败处理记录：首轮运行中新增 DSH/Kimi 用例断言两次备份产生 2 个列表项而失败（同毫秒时间戳覆盖同名文件，1 !== 2）——这正是本计划纠正的 round-1 契约错误；修正夹具为不断言跨调用唯一性（`>= 1`）并注明原因后重跑，连续 5 次全绿
- 功能清单：不更新 FEATURE_INVENTORY（纯内部行为保持重构，导出与用户可见行为不变）
- 相关文档同步：ARCHITECTURE.md 配置服务层一句事实说明

### ontology 更新判断

不更新 ontology：本次不改变概念、关系、状态机或事实来源路径；`plugin.config_profile` 及相关规则的既有描述不受内部表驱动实现影响。

## 任务列表

- [x] 记录 dirty 基线与并行改动边界
- [x] 查询 ontology（`plugin.config_profile`、`plugin.rule.dsh_profile_edit`）并核对 source_refs
- [x] CodeGraph 定位 `backupClaudeConfig` 及调用者（configPanel.ts:247/:250 唯一非测试调用者）
- [x] 实现 `BACKUP_PLATFORMS` 表 + `runBackup` 执行器 + `getBackupList` 前缀复用
- [x] 扩展回归测试
- [x] 构建与单测验证
- [x] ARCHITECTURE.md 同步
- [x] 归档计划

## 决策记录

- 2026-10-29：表键类型采用 `Exclude<CurrentConfigPlatform, "zcode">`，zcode 备份维持独立端口（修正 round-1 七平台声明错误）。
- 2026-10-29：执行器顺序固定为 ensureDir → 读取 → 一次时间戳 → 构造路径 → 并行写（修正 round-1 时间戳前置草案）。
- 2026-10-29：不做跨调用时间戳唯一性保证，不新增碰撞处理（修正 round-1 契约第 3 条）。
- 2026-10-29（round-3）：`BackupFileSpec.baseName` 只存平台无关片段，文件名由 `runBackup` 用同一表项 `prefix` 拼接（修正 round-2 前缀双重事实缺陷）。
- 2026-10-29（round-3）：非 DSH 备份权限断言改为与同目录默认创建对照文件比较，不假设具体权限位（修正 round-2 umask 环境假设缺陷）。

## 当前结论

实施完成。`BACKUP_PLATFORMS` 表（键 `Exclude<CurrentConfigPlatform, "zcode">`）与 `runBackup` 执行器落地，六个导出函数改为薄包装，`getBackupList` 复用同一前缀事实；ZCode 独立备份端口未动。回归 33/33 通过（5 次连跑），`git diff --check` 干净。round-1 审计的三处契约错误（时间戳唯一性、执行器顺序、七平台表声明）已在「背景」节纠正并落实到实现与测试。

round-3 定向修复后：前缀单一事实来源（`prefix` 与 `baseName` 片段组合生成文件名）与权限测试环境无关性两项主审缺陷已消除，restrictive umask 验证通过。详见下节。

## round-3 主审验收缺陷修复（2026-10-29，追加记录）

主审验收证据：共同执行流程、六个兼容导出、ZCode 例外及文档已实施；`npm run build` 通过，默认环境 `node --test dist/test/config/configService.test.js dist/test/config/cliruntimeconfigstrategies.test.js` 33/33 通过，`git diff --check` 干净。但 contracts、tests、omissions and regressions 未通过，两项缺陷如下，均为定向修复，不重做已正确的部分。

### 缺陷一：前缀双重事实（失败分类：contracts / 设计契约未落实）

round-2 实现中 `runBackup` 只用 `file.baseName` 拼路径，表项虽同时保存 `prefix: "claude_"` 与 `baseName: "claude_settings"` 等完整平台前缀，但创建文件与列表过滤仍是两份可独立漂移的前缀知识，不满足「文件名通过同一项前缀组合生成」的契约。

修复：`BackupFileSpec.baseName` 只存平台无关片段（claude 为 `settings`/`mcp`，codex 为 `config`/`auth`，opencode、grok、kimi-code、dsh 均为 `config`）；`runBackup` 统一以 `${spec.prefix}${file.baseName}_${timestamp}${file.suffix}` 拼接路径。六个平台的前缀仅在 `BACKUP_PLATFORMS` 各项 `prefix` 定义一次，`getBackupList` 仍读取该字段。未保留另一套完整平台文件名前缀、覆盖路径或重复映射，未新增通用注册框架、公开测试接口、继承体系或依赖。最终文件名与路径数组顺序逐项不变，组合关系为：

| 平台 | prefix | baseName 片段 | 组合出的原文件名 |
| --- | --- | --- | --- |
| claude | `claude_` | `settings` / `mcp` | `claude_settings_<ts>.json`、`claude_mcp_<ts>.json` |
| codex | `codex_` | `config` / `auth` | `codex_config_<ts>.toml`、`codex_auth_<ts>.json` |
| opencode | `opencode_` | `config` | `opencode_config_<ts>.json` |
| grok | `grok_` | `config` | `grok_config_<ts>.toml` |
| kimi-code | `kimi-code_` | `config` | `kimi-code_config_<ts>.toml` |
| dsh | `dsh_` | `config` | `dsh_config_<ts>.json` |

至此验收标准「`getBackupList` 复用同一前缀事实」才真正成立：备份文件名前缀与列表过滤的单一事实来源为 `BACKUP_PLATFORMS[*].prefix`。

### 缺陷二：Kimi 权限测试环境假设（失败分类：tests / 环境假设错误）

round-2 新增断言 `assert.notEqual(kimiStat.mode & 0o777, 0o600)` 把默认权限误当作固定权限：非 DSH 平台沿用 Node 默认创建权限，合法的继承 umask 077 可使 Kimi 备份本来就是 0o600。主审实测 `(umask 077; node --test --test-name-pattern='DSH and Kimi Code backups' …)` 得 0 pass / 1 fail（actual=expected=384 即 0o600，exit 1）。

修复：删除「非 DSH 权限不得等于 0o600」的假设。在同一临时备份目录用普通 `fs.writeFile`（不显式传 mode）创建对照文件 `reference_default_mode_file`（不匹配任何平台前缀），POSIX 上断言 Kimi 备份权限位与该默认创建文件一致；DSH 仍独立断言 0o600；Windows 继续跳过权限位断言但保留文件名、原文等行为验证。未修改 Kimi 生产权限、未给非 DSH 平台加 chmod、未改测试进程 umask、未吞权限异常。原两行测试注释的信息（同毫秒时间戳覆盖导致不断言列表长度为 2）保留在本节与测试名称中。

### round-3 验证记录

- `npm run build`：通过（exit 0）
- `node --test dist/test/config/configService.test.js dist/test/config/cliruntimeconfigstrategies.test.js`：33/33 通过（exit 0）
- `(umask 077; node --test --test-name-pattern='DSH and Kimi Code backups' dist/test/config/configService.test.js)`：1/1 通过（exit 0），缺陷二消除
- `git diff --check`：无输出（exit 0）

### round-3 范围说明

本次实际修改文件：`src/config/configService.ts`、`src/test/config/configService.test.ts`、`ARCHITECTURE.md`、本计划，未超出建议范围。工作树中既有的 ZCode、Webview、Graph、Loop、extension、ontology/功能清单等并行改动未纳入、未覆盖、未回滚，与本修复无关。FEATURE_INVENTORY 与 ontology 仍不更新：前缀拼接方式为内部实现细节，无用户可见行为及语义变化。
