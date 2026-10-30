# CLI 配置跨窗口回写修复

- 日期：2026-10-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-30
- claim_ttl：本次会话
- handoff_to：

## 背景

多个 VS Code 窗口共享 CLI 原生配置文件。已有面板在被动状态刷新时把旧选择重新发送为 applyConfig，导致另一窗口刚激活的配置被覆盖。隔离验证已确认底层写入正常，错误来自被动刷新自动激活。

## 目标

所有 CLI 禁止被动刷新回写配置，保留用户显式切换；每次任务启动前按任务当前配置重新应用，避免另一窗口切换后误用原生文件。

## 范围

统一面板配置状态、任务启动配置准备、相关单测与行为事实来源。

## 非目标

不修改用户真实配置或凭据；不引入跨进程长期锁；不改动 CLI 协议和无关界面样式。

## 验收标准

- [x] 七个 CLI 的被动刷新和首次空激活快照均不发送自动激活请求。
- [x] 显式切换仍应用配置，等待完成后允许发送任务。
- [x] 普通、排队及绑定子任务启动前应用其选定配置，失败时不启动 CLI。
- [x] 配置中心和其他窗口的显式激活不会被空闲窗口抢回。
- [x] 构建、最小回归、本体与差异校验通过。

## 影响面

- 代码目录：src/webview/viewContentScript/、src/extension.ts，必要时抽取 src/config/ 的最小可测启动函数。
- 文档目录：.ch/docs/product-specs/、.ch/docs/runbooks/、.ch/docs/ontology/。
- 配置与脚本：不修改用户级文件。

## 风险与缓解

- 风险：移除自动激活后首次选择无生效身份，或任务使用其他窗口写入的配置。
- 缓解：区分面板选择与磁盘状态，任务启动前明确重应用；覆盖空值、失败和快速切换。
- 风险：运行中配置变化被误解为迁移已有 CLI 进程。
- 缓解：仅承诺任务启动前应用，不宣称已运行进程动态迁移或跨进程启动原子性。

## 验证计划

- 最小相关验证：面板运行时、配置应用、任务启动与绑定子任务测试。
- 单元自测命令：npm run build；相关 node --test dist/test/...；本体 validate 与 ontology 单测；git diff --check。
- 扩展验证：用临时目录和现有运行时代码重放跨窗口覆盖，确认真实配置校验和不变；无界面改动时不要求视觉冒烟。

## 测试与清单同步

- 单元测试新增/更新：`promptSessionHealth.test.ts` 覆盖七个 CLI 的三种派发路径、相同 ID 重应用、待提交等待、写入完成后派发、失败及 superseded 门禁、绑定子任务、执行快照、命令修复重试和无缓存回退；`clipagescriptruntimecoverage.test.ts` 覆盖七个 CLI 首次加载与重复刷新不写文件、显式切换仍提交、重置与无待提交状态跟随宿主身份。
- 单元自测结果：最终 `npm run build` 通过；配置/发送/任务关联 149/149 通过；面板配置筛选 32/32 通过；完整面板 118/121 通过，剩余三项为原版同样失败的范围外问题。
- 失败处理记录：新增测试的配置状态类型错误已修复；原有统一入口测试新增配置依赖的夹具已补齐；六条依赖空闲回写或持续保留旧身份的断言随新契约更新。三个范围外失败经过 HEAD 原版测试与原版两处面板模块的内存加载对照，基线为 104/107，通过/失败名称与最终结果一致，不扩展修复。
- 功能清单：已更新 `FEATURE_INVENTORY.md` 和能力说明的配置中心条目。
- 相关文档同步：已更新本体配置提交、全 CLI 快照及会话重置规则，以及 `PITFALLS.md`。不增加新架构组件，不更新 `ARCHITECTURE.md`；可复用故障原因已沉淀到 runbook，不重复写入滚动摘要或事件记忆。

## 任务列表

- [completed] 确认统一配置切换与任务启动入口
- [completed] 移除刷新回写并补齐启动前配置应用
- [completed] 补充回归测试并同步行为文档
- [completed] 执行构建与相关验证

## 决策记录

- 2026-10-30：按用户要求移除空闲状态刷新自动激活，而非增加长期文件锁；显式切换和每次任务启动才写入所选配置。
- 2026-10-30：配置提交队列保留；统一执行回调等待队列后解析任务配置，绑定子任务优先于显式快照和当前激活身份。首轮确定的档案用于命令修复重试，每次重试重新写入；失败或 superseded 阻止派发。OpenCode 预检移至应用后。
- 2026-10-30：无缓存时先取加载结果的激活档案，再回退有序首项；完全无档案时不强行创建或应用默认配置。

## 最终验证记录

```sh
npm run build
node --test dist/test/config/configService.test.js dist/test/config/configApplyQueue.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/extensionHost/promptAutoRepair.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js
node --test --test-name-pattern='profile|config|configuration|reset|switch' dist/test/webview/clipagescriptruntimecoverage.test.js
node --test dist/test/webview/clipagescriptruntimecoverage.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

- 构建及前两条相关测试命令通过，分别 149/149、32/32。
- 完整面板的三项已验证历史失败：错误气泡所属标签状态断言、隔离函数夹具缺少 `sharedProjectRuleCliNames`、窗口消息分支夹具未触发 `rulesHint`。最终为 118/121；内存加载 HEAD 原版测试和面板模块为 104/107，失败同名。未执行无关全仓单测。
- 本体 validate 通过（2 domains、83 rules）；本体 Python 单测 9/9 通过；差异空白校验通过。
- 本机隔离验证命令：`node` heredoc，创建临时 HOME、设置 HOME/USERPROFILE 并清除 Codex home 覆盖，加载实际配置服务保存两份虚构档案，提取实际 `applyConfigById`、`runPrompt` 与面板配置合并片段，在真实临时文件上重放。外部激活后四次空闲刷新产生零条 `applyConfig`，文件保持外部档案；实际统一入口在模拟 CLI 派发前重新写入任务档案；再次外部覆盖后，相同任务档案 ID 仍重新写入。
- 隔离重放未启动真实 CLI 或发送模型请求，临时目录已删除，真实用户 Codex 配置 SHA256 前后相同；未将真实配置、档案 ID 或凭据写入仓库。
- 未运行浏览器/真实 Extension Development Host 点击测试：本次不改变页面布局，核心证据来自执行面板实际脚本的运行时回归与真实临时原生文件重放；运行中旧版扩展的重新加载由用户执行，不声称已热更新。

## 当前结论

全部七个 CLI 已移除空闲回写并在任务启动前重新应用所选档案，相关回归和隔离文件验证通过。所有仍运行旧逻辑的 VS Code 扩展窗口需要更新/重载；不保证跨进程同时启动原子性或迁移已运行 CLI 进程。完整面板测试存在三项已核对的范围外历史失败。
