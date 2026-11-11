# 对话 Tab 状态与共享配置争用修复

- 日期：2026-11-10
- 状态：completed
- 负责人：Codex

## 背景与目标

运行中的对话 Tab 会被中间 trace/system 错误标红；本机运行日志还出现面板配置读取及启动同时报「等待其他窗口配置操作超时」。修正展示状态，并降低共享配置互斥锁争用，不削弱跨窗口配置执行保护。

## 范围与非目标

- 范围：Tab 错误/运行优先级、共享配置只读快照与本进程写事务调度、相关回归与文档。
- 非目标：不更换基础设施、不强行移除存活进程的锁、不修改用户配置、不发布扩展。

## 验收标准

- 已验收：运行期间的中间错误保持错误气泡但不将 Tab 标成执行失败；终态失败仍标红，成功/重试恢复。
- 已验收：读取现有共享状态不争抢配置锁、不回写租约、不越过未就绪保护；首次初始化仍互斥。
- 已验收：同进程配置事务按目录串行；跨进程启动租约、写配置互斥和崩溃恢复保持有效。
- 已验收：构建、最小回归、浏览器状态验证及 ontology 校验通过；完整 Extension Development Host 和 Windows/Linux 现场未运行。

## 影响面与风险

- 代码：`src/config/sharedRuntimeConfig.ts`、Webview Tab 渲染/事件及相关测试。
- 文档：功能清单、运行时设计、ontology 和本计划。
- 风险：无锁读取可能见到写入中的未就绪快照；启动仍以互斥内的真实状态检查为准。活锁不按时间强拆。
- 回滚：仅撤回本次代码差异；不改变持久化格式。

## 验证计划

- 先补回归并确认旧实现失败，再修复与构建。
- `npm run build`
- `node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/config/configService.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/webview/tabRunStatus.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`
- Chromium 使用真实 Webview 脚本的隔离页面验证，不写入用户会话。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`

## 实施与验证结果

- `npm run build`：通过，技术栈与持久化结构未变化。
- 修复前回归：构建成功后，针对中间错误、运行/错误优先级、已有配置快照争锁和同进程事务竞争的 4 项新断言均在旧实现失败；分别复现错误类覆盖运行类与锁超时。
- 最小相关单测：`node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/config/configService.test.js dist/test/webview/conversationtabsummarytooltip.test.js dist/test/webview/tabRunStatus.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`，255/255 通过。包含真正子进程写锁未释放时拒绝 acquire、进程终止后锁恢复、未就绪配置继续拒绝启动及首次初始化只执行一次。
- 页面分组：在已构建的 `dist/` 上执行 `package.json` 中 `test:page` 的 `node --test` 子命令，470/470 通过；未与构建并行。核心分组同法执行 `test:core` 的 `node --test` 子命令，297/297 通过。分组有重叠，不相加为独立用例总数。
- 浏览器：`node .tmp/chat-tab-status-config-smoke.cjs`，使用真实完整生成 Webview、模拟 VS Code 消息桥；1100×850 和 390×850 共 16 项状态断言通过，页面/控制台/网络错误为 0。覆盖前后台中间错误、流式错误、重试标记、终态失败、成功收尾和重新启动。检查了窄屏截图；产物在 ignored 的 `.tmp/chat-tab-status-config-smoke/`。
- 本机只读验证：直接用编译后的 `SharedRuntimeConfig.read()` 对现有 Codex、Claude、Grok 共享选择各并发读取 100 次，均返回就绪快照，耗时分别约 3/1/2 毫秒；不修改原生配置、不申请执行租约、不调用 provider。
- ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`，9/9 通过。
- 测试准备问题：首次新增夹具使用了 ES2020 不支持的 `Promise.withResolvers`，按夹具兼容问题分类后改成原生 Promise 信号，不升级 TypeScript target；之后构建和回归全部通过。

## 文档与记忆同步

- 已同步功能清单、运行时设计和两条 ontology 规则；不增加设置、依赖或语言包。
- 事实已进入对应运行时设计，避免重复记忆索引；无需修改 `ARCHITECTURE.md`、`ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`。

## 最终结论与边界

- 已通过 CodeGraph 定位共享配置入口，并核对 Tab 源码；只读本机日志确认超时存在，未发现当前仍持有的 mutex，不能断言每次超时都是同一原因。
- 已确认所有面板读取原本都获取写互斥锁，且同进程事务也靠轮询竞争；已通过只读快照与进程内顺序队列消除无谓竞争，保留真实配置写入超时保护。
- 召回 focus：会话 tab 错误状态、配置锁超时；anchor 为空。召回索引为 baseline，未采纳无关历史计划。
- 真实跨进程写操作持续占锁时仍会拒绝启动，这是安全保护而非强拆对象。本次没有发布或替换已安装扩展；需要加载新构建后重载窗口。完整真实 VS Code/CLI/provider 任务及 Windows/Linux 现场未执行，不以隔离 Chromium 或本机只读验证冒充端到端验收。
