# 产研部 Git 集成候选交接

本页仅交接本地候选；最终远端同步、合理合并和合并树全量回归尚未执行，门禁继续开放。

- 实际基线/shared master：`f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`。
- 候选分支：`codex/department-candidate-round414-20261116`。
- 本地候选提交：`c53f9defc811e5fddcf87e2d052ab0c6069c3087`。
- 独立 worktree：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-candidate-round414-20261116`，创建后及提交后均干净。
- 候选内入口：`.ch/docs/integration/department-round414/README.md`；同目录 manifest.json 为 332 条来源/候选文件及 SHA-256 清单，artifact-hashes.json 绑定其余审查材料。
- 执行报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-414-department-git-candidate-snapshot.md`。

候选包含真实 Loop/Loop+ 复用、角色配置、共享容量、统一方案、协作、弹窗/原名角色图标及三模式开关所需的核心、存储、Owner 和夹具依赖。报告清单区分已接受与失败/阻塞交付；当前源码与既有构建快照的对应和每个混合文件的 hunk/依赖依据在候选材料中，不以文件名前缀判归属。

共享 ontology 中三个安装/ZCode 引用修改及无关格式化未纳入，原件保留；候选仅对四个新增文件移除末尾空行并记录前后哈希。平台脚本/测试在读取期间发生并发开发，本候选取 round-403 已接受实体版本，平台 runbook 也匹配其已接受哈希；round-414 追踪增量须主审后单独整合，不能当作本候选已验证范围。

复核时本地 origin/master 为 `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`，基线落后 29 提交，44 条选择路径重叠。原基线临时索引的补丁适用性和最终暂存空白检查通过；origin 临时索引的补丁检查失败，具体文件见候选 conflict-risk.json。没有 fetch、合并、push 或发布。

本轮未重跑 build、单测、CLI、EH 或浏览器。冻结时完整 src 的 807 个文件与 round-410 已接受构建源码一致，随后四处仅 EOF 空白归一化；最终为 803 个完全一致及 4 个 EOF-only，对应 package.json/tsconfig.json 一致。未复制 ignored lock、本机依赖、dist、凭据、运行现场或本机索引，不宣称依赖安装可复现。

round-410 冷宿主 `live-leader-unverifiable` 仅是安全只读拒绝，不是恢复接管。原未知/仍 live 责任和容量继续保留，round-400/405/408 等历史失败与执行快照边界不变。根 feature 保持 active / in_progress。实现及必要验证收口后，另行整合平台增量和 origin 的共享合同，执行最终同步/合理合并，再针对真实合并树全量回归并修复实现或夹具；不得以本候选提交关闭平台及最终合并回归门禁。


## Round 416：本地 origin 三方语义整合候选

以上为 round-414 的历史候选及其证据边界。本轮已在全新外置 worktree 完成本地三方冲突整合，供主审；最终远端同步、合理合并、平台增量与真实合并树全量回归仍未收口。

- 新整合 merge commit：`51a5e7b15c54921611721fe14863e60361d64e72`；树 `7e91cfbcff24d0e1eb436374c832b791af3e70d2`。
- 新分支：`codex/department-local-integration-round416-20261116`。
- 新 worktree：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-local-integration-round416-20261116`，初始及最终均干净。构建使用的临时依赖 symlink 已移除，依赖实体保留。
- 两父依次为原候选 `c53f9defc811e5fddcf87e2d052ab0c6069c3087` 与已有本地 origin `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`，共同祖先 `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`；本轮未 fetch/pull/push/发布。
- 新审查入口：该 worktree 的 `.ch/docs/integration/department-round416/README.md`，同目录 `semantic-review.md`、`overlap-review.json`、双方差异及 `source-manifest.json`/`artifact-hashes.json` 分别记录解决依据、33 条自动合并风险路径和来源哈希。
- 执行报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-416-department-git-local-conflict-integration.md`。

真实 Git 冲突为 11 路径/32 块，双方重叠仍为 44 路径；旧 15 处补丁不适用不是冲突数量。整合保留部门准入/Owner 完整清理后归还容量，与 origin 事件驱动冻结验收批次、attempt 身份、显式停止/继续、配置锁及会话收尾。普通失联活动探针不能提前释放部门 Owner。普通 Tab 保留报告/压缩后收尾，fixture 持久层不回退 Map。

标准 `npm run build` 及 483 项最小相关回归的最终有效结果通过，首错及每次覆盖边界保存在新目录。两父补丁适用、路径/大小写、1,413 条来源 SHA-256、旧材料和冻结平台字节、最终暂存空白检查通过。提交中的实现树与构建后快照一致，提交后相对已冻结实现树的差异仅为新证据目录；旧 11 份材料未改写成新树证据。共享 HEAD/master/索引及混合状态在交接前均与本轮基线一致，本轮共享仅追加此节。

平台三路径继续冻结 round-403 版本，未读取共享并发修复字节，后续增量必须另行合入。三个安装/ZCode ontology 引用继续保留共享原件、待归属复核。本轮未跑全量、旧 EH、真实 CLI、浏览器或平台脚本；静态/VM UI 回归不等于真实 UI 验收。round-410 冷安全拒绝不是恢复接管，根 feature 仍 active/in_progress，平台及最终同步/合并后全量回归门禁继续开放。


## Round 419：已接受平台增量后继候选

本轮仅将已接受 round-414/416 平台三路径纳入 51a 后继树，不重新执行平台验证；最终远端同步、合理合并、真实最终合并树全量回归、必要平台与冷恢复接管门禁仍开放。

- 新提交：`c76b5132d6c0430dfb03f150fb8220010265e32f`；树 `f2f1a1cb3436de590b13305900816d40d27c0cdf`；唯一父提交 `51a5e7b15c54921611721fe14863e60361d64e72`。
- 新分支：`codex/department-platform-delta-round419-20261116`；外置 worktree：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-platform-delta-round419-20261116`，初始及提交后干净。原 c53、51a 分支及两批材料不变。
- 相对 51a 仅改 `scripts/verify_department_platform.js`、`scripts/verify_department_platform.test.js`、`.ch/docs/runbooks/department-platform-verification.md`，另加 `.ch/docs/integration/department-round419/` 的 14 份独立材料，共 17 路径；没有吸入并发 UI/EH。
- JS SHA-256：`7a6ed43e68695509e675437cedc31296ee35ce1a4b8183ac5ab0b80cf8908304`；测试：`0f5996576fb3c220c83576b3217dc4880bf77020f88c050921658c0602f32183`；平台 runbook：`c3d885f0dcf5625ad984bbfa3d8c5f9ebfc93197e54a5dd40010a933e39418fd`。测试及 runbook 旧报告没有完整哈希，本轮按报告描述核对 diff/章节并记录稳定来源哈希，不能追认为历史执行字节哈希。
- 新证据入口为上述 worktree 的 `.ch/docs/integration/department-round419/README.md`；`sources.json` / `write-paths.json` / `reused-evidence.json` 给出来源、完整路径及复用边界。`artifact-hashes.json` SHA-256 为 `cbba376e942a4c81dcb4b0a3f64d35a36f9751d1f93304326131d56b00665de4`。
- 执行报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-419-department-git-platform-delta-integration.md`。

复用 51a 最终标准 build 与 483 项相关回归、平台自身 24 项行为检查、round-416 首文件 26/26、round-414 后两文件 12/12 和 20/20；没有新 build/运行/完整 58 项。本轮最小来源、差异、JSON/文档合同及空白检查通过；原两批共 49 份证据保持父树字节。原 round-414 首文件失败未改写。round-416 PID 64303 无 close 但最终 POSIX 快照确认缺席，只满足直接记录集合合同，完整树仍 unconfirmed；不得上升为 Windows/Linux 通过、Owner receipt/CLOSED 或容量归还。生产 Owner、required 资源、回收标准与容量合同未改。

共享本轮仅追加本节，HEAD/master/索引保持原样；未 fetch/pull/push/发布或清理其它 worktree。旧材料仍各自属于旧快照。三个未定 ontology 引用保留共享原件；round-410 冷安全拒绝仍非恢复接管，根 feature 保持 active/in_progress。主任务继续审查来源边界，并在真正最终同步与整合树上执行必要平台及全量回归。


## Round 428：已接受 UI 增量隔离后继

本节仅存在于新的 UI 候选树；共享交接及原 UI 树保持只读。候选从 `c76b5132d6c0430dfb03f150fb8220010265e32f` 建立，分支 `codex/department-accepted-ui-round428-20261116`，worktree 为 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-accepted-ui-round428-20261116`。最终提交及 tree 见本轮外部报告，避免在提交自身写循环引用。

接受来源为 `/private/tmp/department-ui-queued-focus-round422`。仅原样纳入三个 webview 文件、两个测试、两个 smoke 脚本和 UI runbook 八条路径；路径使用 Git 实际大小写。七条以 Round-425 最终哈希核对，tabs smoke 是 Round-422 保留的 Round-419 增量，并非 Round-425 新增。完整路径、哈希、源码闭包和旧证据范围见 `.ch/docs/integration/department-round428/README.md` 与同目录清单。没有吸入并发冷恢复或 EH 字节。

复用 Round-425 标准 build、71/71 单测及单 1440 深色焦点生命周期结果；Round-424 双视口键盘/排队及 Round-419 tabs 仅按未变范围复用。源码与执行树闭包相同不等于所有历史浏览器场景在新快照重跑；原失败、修复和逐次输入边界继续保留。本轮只核对父提交、精确路径、来源稳定性与候选字节、文档/JSON、空白及提交状态，没有运行 build、单测、浏览器、平台、CLI 或 EH。

iframe sandbox、消息身份校验、同步 inert/关闭归焦、无 bridge fallback 和异步模型成功不抢焦按接受来源保留，没有重新设计 UI。根 feature 保持 active/in_progress；round-410 冷安全拒绝不是恢复接管。运行时冷恢复、第二 EH、必要平台及最终远端同步/合理合并/真实最终合并树全量回归均继续开放。没有 fetch/pull/push、发布或共享 HEAD/index 操作。

本轮报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-428-department-git-accepted-ui-delta-integration.md`。


## Round 433：已审额度策略与总监 UI 后继候选

本轮从已审策略提交 `083d5da06b4cc9d91434935616b7cecd6a7c5b19` 建立单父后继；该策略提交的唯一父为 `37d5847758a3ca1679be9eebdd8bd49e5a523c3d`。分支 `codex/department-reviewed-allocation-round433-20261116`，实体 worktree 为 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-reviewed-allocation-round433-20261116`。最终 commit/tree 由外部本轮报告记录，避免提交内循环引用。

保留父树全部策略与历史材料，仅逐字节导入 `/private/tmp/department-allocation-ui-round431-20261116` 已审 11 条产品、测试、脚本及 runbook 路径，再追加本交接与 `.ch/docs/integration/department-reviewed-allocation/sources.json`，相对唯一父共 13 路径。清单记录来源报告、全部路径和 SHA-256；包含新增 webview 额度模块、scenario helper 和实际 `departmentGroupChatHost.test.ts`，使用 Git 现有大小写。来源 UI 树、策略树、共享树和提示修复树均未写入；未读取提示修复树字节，未吸入冷恢复增量。

本轮没有修改已审产品字节或安装依赖，也不重跑 build、单测、浏览器、CLI 或 EH。复用策略最终标准 build 与 13 项、UI 最后标准 build、相关 40 项中的未变范围和最后宿主 5 项，以及 1440 深色 / 280 浅色 fixture 浏览器结果；保留原构建首错、修复与各快照边界。这些分树结果不证明新增生产组合已构建或通过，也不证明真实额度已经执行。新增清单和交接仅做 JSON/文档格式、来源稳定哈希、差异、路径/大小写和提交状态检查。

实际 reader/writer 安装、持久 CAS、同步联合准入、中央功能清单/ontology/active 计划、冷恢复、第二 EH、必要平台以及最终远端同步/合理合并/真实合并树全量回归全部继续开放；不调整 Owner 证明、回收或容量标准。根 feature 保持 active/in_progress，round-410 冷安全拒绝仍不是恢复接管。本轮不 fetch/pull/push、发布或修改共享 HEAD/index、父记录与调度状态。

本轮报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-433-department-git-reviewed-allocation-delta-integration.md`。

## Round 436：已审额度提示修复单父后继

本轮从已接受 `d35263a5f7d150b57b10668f2ad1c3bf0b066d43` 保存最终提示字节，分支 `codex/department-reviewed-allocation-prompt-round436-20261116`，外置实体树 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-reviewed-allocation-prompt-round436-20261116`。最终 commit/tree 见本轮外部报告，避免提交内循环引用。原候选和提示来源树保持只读。

仅导入 `/private/tmp/department-employee-allocation-prompt-round431-20261116` 的五条完整已审交付，包括未跟踪的提示契约；实际路径和 SHA-256 见 `.ch/docs/integration/department-reviewed-allocation-prompt/sources.json`。角色提示及角色测试按 round-431 未变哈希核对，builder、builder 测试及契约按 round-433 修复后的最终哈希核对。round-431 原验收失败及构建首错继续保留，旧失败 builder 字节未导入。相对唯一父仅五条来源路径、新清单和本交接，共七条；策略/UI 及全部历史材料不变。

复用 round-433 最终标准构建和提示 builder 34/34；未变角色测试、策略和 UI 证据只按原输入范围复用。本轮只检查来源稳定性、候选/暂存/提交 blob、完整差异路径、未跟踪集合、JSON/文档格式、大小写、空白和提交后状态，不安装依赖、不 build、不跑单测、浏览器、CLI 或 EH。这些复用证据没有证明新的生产组合通过；未扩展提示行为或修改已审字节。

真实 reader/writer、持久 CAS 和同步联合准入由另一所有者交付；中央功能清单/ontology/active 计划、冷恢复返修、第二 EH、必要平台、最终远端同步/合理合并与最终合并树全量回归全部继续开放。Owner、容量释放及清理标准不变；根 feature 仍 active/in_progress，round-410 冷安全拒绝不等于恢复接管。未吸入生产接线或冷恢复返修增量，未 fetch/pull/push、发布、修改共享 HEAD/index、父记录或调度状态。

本轮报告：`/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-436-department-git-reviewed-allocation-prompt-candidate.md`。


## Round-440 局部额度/提示/真实 UI-EH 组合

以已审热点修复 `da47ec72295416fd4a7ff7c877bc483d658e77ff` 新建外置工作树，合入已审提示后继 `e613344552c559b934561ccd3506582955dbe68a`。共同来源为 `d35263a5f7d150b57b10668f2ad1c3bf0b066d43`；无冲突 merge `08374899d4f162e4a31fa203f80c02dbc3720a1e`，tree `9c84cdf217582f1079b00608bdb75305ab710105`。完整七条提示增量初次均逐字节对应 e613；五条已审交付保持原哈希，本清单/交接随后仅追加组合说明。da47 的历史同步修复、原 UI、准入及 extension 字节保持不变。

新专属薄 harness 复用现有隔离环境、精确 Webview 适配器、免费 Responses provider 与原 Owner 观察器；只增加额度消息/真实准入/进程退出旁听及最小场景。构建、定向测试、真实场景首错与只读证据复核见 [专属验证手册](department-employee-allocation-eh-verification.md)。最终交付 commit/tree 与全部路径哈希记在 round-440 attempt 报告，避免文档自身提交身份循环。

这是局部组合候选，未导入正在返修的冷恢复、第二 EH 或其它未验收增量；未修改恢复回调、executionresources、coldgenerationrecovery 或其证明标准。最终统一产品、平台、远端同步合理合并及最终合并树全量回归继续开放。未 fetch/pull/push/发布，也未改共享 HEAD/index 或任何历史来源报告。


## Round-443：已审额度/提示/UI-EH 与固定角色头像候选

从 `84518c13758eb7b972ee4ca405543a91b75c8ca3` 在 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-allocation-avatar-round443` 建立外置独立树，分支 `codex/department-allocation-avatar-round443`。核对头像 `5e5cca4f232bc4bd98db753aeb3489ca0e2024d9` 的唯一父和双方merge-base均为 `da47ec72295416fd4a7ff7c877bc483d658e77ff`，无冲突合入完整四路径增量。真实merge commit `e9fea635adb966f7e743221c45fd793e37f07cf5`，tree `a8a29e15265b6e0d31fb713b17751ff38f01f078`，两父依次84518c、5e5cca；四条来源字节均保持。最终文档交接后继身份及全部八路径哈希在round-443外部报告，不作自引用。

新材料为 [README](../integration/department-reviewed-allocation-avatar/README.md) 和同目录sources.json：列明两个来源报告/哈希、父提交、全部来源增量、blob/SHA-256、组合身份、复用结果及开放门禁。追加本节并维护本候选中央FEATURE_INVENTORY；旧sources.json和旧报告均未覆盖。保留845的da47线性历史同步、持久CAS、同步联合准入、e613五条提示及所有薄harness。头像仅局部成员层级映射总/组/员，不改全局头像、Tab/emoji、样式/交互、权限或执行链。

本轮只对新组合运行一次标准 `npm run build`（exit0通过，clean+tsc）与来源/差异/JSON/文档/空白检查，不重跑有效单测、浏览器、CLI或EH。按原输入复用845标准build及新增13项、da47定向11、策略13、提示builder34、原UI/host和头像3渲染/两视口fixture。run4原命令仍failed，只读复核通过证明真实保存/下次准入、四份原required receipts、完整CLOSED、容量归还与四worker自然退出；最新完整driver未第五次运行，run1/2清理未知，历史原始记录不改写。本组合不宣称新真实UI-EH通过。

没有合入并行冷恢复生产代码、full EH driver或能力链，也不竞争改其所有者符号。根feature保持active/in_progress；最终统一产品及真实UI-EH、冷恢复合入、必要平台、全部完成测试后的远端同步合理合并与真实最终合并树全量回归继续开放。原来源物理树、共享HEAD/index、调度/active ids/Loop+快照及父记录均未修改，未fetch/pull/push或发布。


## Round-675：额度/头像候选的新显示图标后继

从已审 `e0ec605fc0b38ab0a59bb2268faac84efbeb3668` / tree `f2400710a8fdc0d5b26e9116802feefad113594e` 建立独立树 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-role-icons-round675`，分支 `codex/department-role-icons-round675`，不重做旧e9fea merge。round-443具体完成事实与后附配置等待超时outcome=failed并存，原报告不改写。当前按宿主既定fullstack配置启动，不删除锁/改用户配置/改路由，不切模型或委派。

本后继仅显示映射：部门☀️/🌛/⭐️，普通Loop/Loop+主🌛/子⭐️；原名、身份、模式、tooltip及总/组/员头像保持。来源清单仅追加round675Continuation，不覆盖原来源或旧执行段落；新标准build、既有定向用例、有界1440深色/280浅色fixture结果及完整增量hash以round-675报告和[角色会话说明](department-conversation-verification.md#round-675新角色图标显示后继)为准。最终commit/tree在外部报告，避免自引用。

没有合入并行冷恢复未审代码或改其full EH driver/证明链，未重跑额度EH/真实CLI/冷恢复。旧run4原failed与只读复核passed、run1/2清理未知及旧emoji快照边界保留。根feature为active/in_progress；统一产品/冷恢复组合、必要异平台、实现测试完成后的远端同步合理合并与真实最终合并树全量回归继续开放，不发布。

round-675实际结果：后继标准build通过；定向首轮12/14（两项因旧fake DOM options缺失失败），补齐该测试夹具并tsc后仅重跑受影响3项，3/3通过，其余11项不重跑。成员树两视口首次通过，Tabs首轮场景模式key等待超时保留，修正场景后两视口通过且browserErrors=[]。这些是显示fixture证据，不是生产EH重验。

## Round 676：刷新主干上的累计整合

当前后续实现基线为独立 worktree `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-mainline-integration-round676-20261116`，分支 `codex/department-mainline-integration-round676-20261116`。分支从fetch后默认主干 `origin/master` `e890e36352570b6cda9fc531df06ca2007a09ec6` 建立；角色图标候选 `a3a0d37a0723791645259c4abebbd6d129d52b79` 与该主干的merge-base为 `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`。最终本地整合提交、tree与parent顺序以round-676 attempt report和同目录 `README.md` 为准；后续任务必须以该提交为基线，不从旧候选或共享工作树续做。

来源二为 `/tmp/department-cold-mixed-round674-product` 的完整已接受实体，源基线 `c76b5132d6c0430dfb03f150fb8220010265e32f`。逐目录比较确认55条tracked路径变化；src closure `c806bda98c0d408b20db775112ce2c62460084b8f44718e3930485fce11751bd`、scripts closure `d677e1691181020ddca60d3c61071083041e738fa0e204f3a76cce14e6d1ec13`。round-674原12路径patch/manifest SHA-256分别为 `eda945156e60e6c0aa6351eaae323e785e6eaa62a9552c92024dad99dfcfc55e` / `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`，用于验证该轮增量，不替代完整实体。来源沿round443→round440→round437→c76追溯；角色候选沿既有祖先链，未重复cherry-pick历史额度/提示/头像提交。完整路径和身份见 `.ch/docs/integration/department-mainline-integration/`。

本轮13个真实unmerged路径逐项语义复核后标记解决：中央功能清单保留新旧证据边界；`extension.ts` 同时保留主干事件/attempt/session配置与部门中央装配、代次恢复和原代环境快照接线；组聊coordinator保留普通任务来源身份及部门ownership/capacity控制；决策策略与orchestration保留主干冻结验收批次、attempt及prompt结算合同和部门每轮Ledger准入、路由及协作；Codex pool保留两侧生命周期与原清理职责；task store保留主干retention/迁移和部门元数据、受控来源身份；session message action保留部门配置scope与主干request结算；两个测试文件分别合并workspace/global设置行为及普通/部门任务持久化断言；Loop群聊面板同时保留nonce/部门弹窗和主干loading-ready/请求生命周期；类型与window dispatch合并两侧消息字段/handler。没有整文件盲选。

本轮为新组合仅运行标准 `npm run build`。第一次发现round-674 production wiring测试缺少 `});`；修复后发现主干有效Loop+配置解析器解构和task store迁移helper丢失；最小补齐后最终build exit 0。三个代码/测试修复没有单测覆盖，需在整合接受后做定向行为验证。ontology合入cold recovery规则，最终 `--validate` 结果见attempt report。

没有重跑round675有效定向14项/两浏览器视口、round674的7项/ontology工具9项/真实第二EH及Codex退出场景；按原报告输入复用且不扩大平台范围。图标首轮用例失败与Tabs超时、额度早期run1/2未知清理及run4原driver失败/只读复核通过、round440具体guard旧分支未直接捕获均保留。真实CLI/UI-EH完整组合、必要Windows/Linux、工作区人数覆盖（后到用户需求）、最终分支全量回归仍开放；build不构成上述行为验收。

## Round 694: Mainline Semantic Merge Repair

Continue in `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-mainline-integration-round676-20261116`, branch `codex/department-mainline-integration-round676-20261116`, from parent `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e`. Preserve the merge history and deliver these fixes in a new child commit. Do not fetch/recreate the integration or edit the separate workspace-count settings owner's code, feature inventory, ontology or active plan.

The acceptance review found two concrete omissions. Coordinator refresh returned when a leader lacked its own `panelsByTaskId` entry even though a director panel held a valid modal binding. Keep the `openingPanels` guard for an existing panel, but allow valid modal subscribers through the same scope/root/task/instance checks and post-await revalidation; do not alias the director panel under the leader id. The active `codexAppServerPoolCore.ts` also failed to carry mainline `f1e15cee57ed5e93492a0b6fbb6ac8693fd64b2a`'s unknown-thread notification fix. An explicit unknown `threadId` is not ownership evidence. Keep it in the existing bounded buffer until confirmed start/resume ownership or a known parent-child link permits routing. Preserve ownedExecution identity, notification source/sequence, operation generations, bounded replay, failure accounting and exact cleanup.

The first modal-only acceptance probe did not reach its refresh assertion because its fake Webview did not emit the current `loadingReady` handshake. The run ended exit 1 with zero passing assertions after stopping only its own test process; this is fixture incompatibility evidence, not a behavior result. Update fake loadingReady/DOM-ready handling with bounded test waits, retaining production waits and business assertions. Run the repaired-tree build, focused modal load/action/refresh and stale-close tests, both foreign-notification connection variants, confirmed-start replay and impacted ownedExecution coverage. Reuse `department_group_chat_host_smoke.cjs` for the modal refresh browser path and keep its theme, narrow viewport and browser-error checks. Do not rerun unrelated Tabs/avatar matrices.

Round-676 build, ontology validation, clean-tree checks and 55-path cold-source identity remain historical results for the old tree. Keep them separate from repair results; the round-674 manifest SHA is `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412`. Record actual repair commit/tree, path identities, commands, results and remaining gates in the round-694 report and integration materials. Full regression, real UI-to-EH/CLI and required cross-platform evidence remain open; do not claim overall completion.
