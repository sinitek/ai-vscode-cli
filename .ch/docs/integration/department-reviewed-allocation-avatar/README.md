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
