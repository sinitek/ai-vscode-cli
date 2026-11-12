# Codex 有效运行配置指纹修复

- 日期：2026-11-12
- 类型：bugfix
- 关联计划：`2026-11-12-bugfix-codex-release-state.md`（汇合后统一构建与三轮 live）
- 状态：in-progress
- 负责人：Codex，独立 Loop+ attempt

## 目标与范围

修复完整 config.toml/auth.json 原文散列导致其它项目写信任、格式与注释变化重建 runner。仅修改配置身份算法、宿主/原生压缩 cwd 传递和相关测试。保留现有并行改动、1.9.2、配置锁与租约；pool、runner、manager、参数构造及中心规格/ontology 由其它任务持有。

## 验收标准

- [x] 临时 HOME 中真实指纹/信任函数证明 A 不受 B 信任和等价格式影响。
- [x] 认证、供应商、configId、来源、当前项目未知设置、祖先权限和其它运行键变化仍隔离；数组保序。
- [x] 无 cwd、非法配置、无法读取和不确定路径保守处理；覆盖真实路径、symlink、Windows 大小写与目录边界。
- [x] 宿主传实际 cwd，压缩沿用同一算法；实际 manager 在稳定指纹复用、变化时迁移。
- [x] 隔离编译、相关源测试、无写入类型检查通过，并写指定 attempt 报告。

## 设计与风险

复用 @iarna/toml 和 JSON 解析；类型标记的确定性编码仅排序对象键，保留未知字段、数组、日期、bigint 和非有限数。配置来源含配置目录及文件真实路径。只排除 cwd 与记录路径都可 realpath 且并非当前目录/祖先的绝对项目键；相对、无法确认及逻辑祖先记录保留。无 cwd 不排除项目，也不添加 trust 覆盖。

当前 runner 已 realpath 并传入 projects.<该精确路径>.trust_level=trusted，随后持久写入同一叶子。身份中只覆盖该叶子，保留当前其它设置和祖先权限；改变被启动覆盖的磁盘 trust 本身不等于有效权限变化。非法 TOML/JSON 或项目结构拒绝，错误不包含配置原文/认证。

边界：仅处理既有全局配置指纹输入，不新增配置层加载框架；命令/参数/cwd 由现有 manager/pool 隔离。原生平台与最终三轮 live 待汇合。

## Tasklist:

- [completed] 核对当前规则、ontology 事实、计划、调用链和 git diff
- [completed] 实现语义身份与 cwd 边界
- [completed] 补充回归并隔离验证
- [completed] 写报告并交接中心文档同步事实
- [completed] round 11 汇合后的正式构建、331/331 受影响回归和默认三轮 live

## 验证记录

- 隔离编译：`npx tsc --outDir .tmp/codex-effective-config-attempt --sourceMap false --incremental false`，4 次均 exit 0，最后一次覆盖最终代码与测试；不构建/消费共享 dist。
- 首轮：`node --test .tmp/codex-effective-config-attempt/test/{config/codexRuntimeConfigIdentity,config/configService,extensionHost/promptInteractiveRuntime,core/contextCompactionRunner,interactive/codexRuntimeConfig}.test.js`（实际使用逐个路径，花括号仅简写），147/149；新增 10 项全部通过。失败分别为 Windows CRLF 样例断言及压缩登记新增 metadata 的旧断言，修正测试后仅复验失败项，2/2。
- 最终保守分支加固后：identity 测试文件 8/8；`--test-name-pattern 'host uses execution cwd|Codex compact passes cwd|native reads do not create config files|OpenCode config UI exposes separate model and MCP config paths|context compaction strategy registry selects Codex and preserves selection lifecycle'` 配合 configService/core/host 三文件，5/5。未重跑仍有效的其它首轮覆盖。
- `npx tsc --noEmit --incremental false`：两次 exit 0，最后一次覆盖最终代码；tracked 文件 `git diff --check` 通过。
- 最终 Python 尾空白与末尾换行检查：本次 9 个源码/测试、计划及报告共 11 文件通过，之后仅补记该结果。
- ontology 搜索脚本工作区已删除，从 Git 只读执行；首次 stdin 默认定位根错误，补齐虚拟原路径后因本工作区 .ch/docs 链接到仓库外而被路径边界校验拒绝。已直接读取适用 cli-plugin-runtime domain 和 source_refs（configService、runtime reference、runner/manager）核对；不修改共享 ontology。
- 最后运行代码/测试变更后完成以上最终编译、13 项针对性测试和 noEmit；此后仅更新计划与报告，不使代码验证失效。原生 macOS/Linux、正式 build/三轮 live 未执行。

## 附带修复与交接

压缩 setRunner 原先只带 configId/fingerprint，会覆盖 manager 已登记的 command/args/cwd，造成后续稳定指纹也无法复用；在本任务拥有的压缩边界传完整既有 metadata，未改 manager。新增 `src/test/config/codexRuntimeConfigFixture.ts` 仅复用临时 HOME、真实指纹与信任函数，避免三组测试重复夹具。configService 既有 OpenCode 样例断言仅归一 CRLF，不改其它 CLI 产品行为。

中心文档应同步：仅当前精确 realpath 的 trust_level 按启动覆盖 trusted；祖先和其它相关配置保留；无 cwd 不排除项目；动态 HOME 与认证继续隔离；无效/断链配置拒绝；压缩与宿主共用算法和 cwd。仍需主任务评审有效语义与最终集成，不以自测代替验收。

## 待汇合

runtime reference、FEATURE_INVENTORY、ontology 已随公共修复汇合。round 11 默认 `node scripts/verify_codex_thread_handoff_acceptance.js --live --report "$env:TEMP\codex-handoff-round11-final-default-20261112.json"` 退出 0：自带共享构建成功、331/331、默认 3/3（60145 / 60175 / 60103 ms），清理均确认。

另增真实公共 runner 验证，显式修改 configFingerprint 后原 thread 在真实 thread/closed 后迁移、另一 thread 继续运行；0.162.1 即时策略为 37 ms。该脚本不调用内容指纹算法，不能扩大此前 13 项指纹证据的覆盖。新增验证代码后续修复与 8/8 回归不改变指纹/运行时代码；完整细节及一次被策略拒绝的失败临时目录清理见 [Windows 验证记录](../../references/codex-thread-handoff-windows-validation.md)。原生 macOS/Linux、真实 VS Code 多窗口和主任务接受审查仍缺，计划保持 active。
