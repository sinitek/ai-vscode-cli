# 已审额度、提示、UI-EH 与角色头像局部组合

本候选从 `84518c13758eb7b972ee4ca405543a91b75c8ca3` 建立新的独立物理工作树，完整合入头像 `5e5cca4f232bc4bd98db753aeb3489ca0e2024d9`。头像唯一父及双方共同来源为 `da47ec72295416fd4a7ff7c877bc483d658e77ff`；真实本地 Git 无冲突 merge 为 `e9fea635adb966f7e743221c45fd793e37f07cf5`，tree `a8a29e15265b6e0d31fb713b17751ff38f01f078`，两父依次为 84518c、5e5cca。没有按文件前缀选取或从共享混合树取字节。

完整来源、父提交、四条头像增量、基线相对 da47 的完整十四条增量、Git blob、SHA-256、两个来源报告及其哈希均在 [sources.json](sources.json)。最终交接后继的 commit/tree、八条完整增量及哈希以外部 round-443 attempt 报告为准，避免自引用。外置物理树为 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-allocation-avatar-round443`，分支 `codex/department-allocation-avatar-round443`。

## 保留的实现与设计

完整四条头像来源字节不变：`src/webview/loopGroupChatPanel.ts`、`scripts/department_group_chat_smoke.cjs`、`scripts/department_member_role_avatar_scenario.cjs`、[头像验证手册](../../runbooks/department-member-role-avatar-verification.md)。生产改动仅 `renderDepartmentRosterPanel` 的明确层级角色类型与总/组/员局部映射；不改全局 `getAvatarLabel`、participant.role 推断、消息头像、Tab 原名或 👴🏻👨🏻👶🏻。保留嵌套成员树、标题左侧28px圆形、12px居中字、8px gap、4px行内边距、badge主题变量和原状态/导航/验收定位/归焦行为，不重新设计。

84518c 内 da47 线性历史同步、持久单EH CAS、真实租约计数、同步本组/全局联合准入、desired/下次真实新attempt应用及 e613 五条提示来源字节和全部薄harness均保留。held/pending重复身份不激活；额度不是预留；仅全局0允许每组一次未释放overflow；保存、降低、拒绝不释放已有员工。未修改 Owner/Ledger、receipt、CLOSED、墓碑或恢复证明要求。

交接只额外更新中央 FEATURE_INVENTORY、本目录两份新材料与Git runbook，未覆盖任何旧 sources.json 或旧报告。头像旧手册“待统一更新清单”是其原交付时点的事实，本候选已纳入该补充要求。根 feature 仍 active/in_progress。显示字符与证据范围同步没有新增业务概念、权限、生命周期或接口，因此不更新ontology和active计划。

## 检查与证据边界

本组合唯一新的执行缺口是尚未编译：在本实体树只执行一次标准 `npm run build`，exit0通过（clean+tsc），以及来源/完整差异/JSON/文档格式/空白检查，实际结果和命令见外部本轮报告。使用现有依赖的临时node_modules链接，不安装升级；不重跑旧单测、浏览器、CLI或EH。没有语义冲突或来源代码修订使旧结果失效。

按原输入复用策略13项、UI40/最终host5、提示builder34、da47定向11、round440新增13（分组5+5+3）及头像3渲染和1440深色/280浅色浏览器。头像是显示fixture证据，不能扩大成真实EH验证。round440 run4原证据只读复核证明实际额度保存、下次新attempt、四份原required receipts、完整CLOSED、容量归还与四worker自然exit；原run4命令仍failed，修正后的完整driver无第五次运行。run1/2清理仍未完整确认，run3/4原失败及全部原始记录保持，不以run4为早期失败清理背书。本轮未对新头像组合执行新的真实UI-EH场景。

本树是供最终冷恢复合入的局部候选，不是最终统一产品。并行冷恢复生产代码、共享full EH driver及能力链未合入，也没有竞争修改其所有者符号。冷恢复合入、最终产品真实UI-EH、必要平台、全部完成测试后的远端同步合理合并及真实最终合并树全量回归继续开放；未fetch/pull/push或发布。


## Round-675：新角色图标显示后继

以上round-443来源和执行段落保持原时点事实。其最终e0ec提交及8路径、一次build和输入闭包已审查，本轮不重做旧合并或刷新旧检查；原communicationFile后附“等待其他窗口配置操作超时，任务未启动”outcome=failed继续保留，不与此前具体完成事实互相覆盖。当前由宿主按既定fullstack配置启动；没有删除配置锁、修改用户配置或路由、切换模型或由主模型代写。

新独立实体树 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-role-icons-round675`，分支 `codex/department-role-icons-round675`，唯一基线 `e0ec605fc0b38ab0a59bb2268faac84efbeb3668` / tree `f2400710a8fdc0d5b26e9116802feefad113594e`。本轮没有重新merge；仅显示后继的最终commit/tree、完整增量及hash见round-675外部报告。原sources.json的全部键值保留，仅追加round675Continuation。

新合同覆盖旧emoji：部门director☀️/leader🌛/employee⭐️，普通Loop与Loop+ main🌛/subtask⭐️；无角色会话不加图标，沿用部门优先、身份与模式判定，不按名称推断。不迁移Tab原名、持久会话/角色/tooltip。总/组/员圆形头像继续有效；结构、样式、尺寸、省略、主题和交互均不重设。公开面板被动观察器只同步精确总监caption，root解析与fail-closed判断保留；不按图标授予权限。新增负例只在其原测试内验证。

新emoji没有旧执行证据，故对本后继标准build、受影响既有定向测试、JS语法及现有两个有界浏览器入口补验证；不新建静态字形套件或复制页面。来源/evidence及实际命令见[角色会话说明](../../runbooks/department-conversation-verification.md#round-675新角色图标显示后继)。旧额度13、845新增13/真实run4只读事实及头像3/双视口证据按未变输入复用；旧emoji运行不追认为新emoji通过，run1/2清理未知不能用run4背书。

只有字符显示变化，无业务语义/权限/生命周期变化，不更新ontology，不竞争并行冷恢复ontology。保留CAS、联合准入、提示和线性历史同步；不修改departmentleaderproductionhost、冷恢复EH/full driver及证明链。冷恢复已有开放所有者，不接管或重复派发；统一产品及最终组合验证依赖两项交付，必要异平台缺真实授权执行端口，Git同步合理合并及合并树全量回归在实现测试完成后继续开放。根feature仍active/in_progress，本候选不是最终产品，未fetch/pull/push或发布。
