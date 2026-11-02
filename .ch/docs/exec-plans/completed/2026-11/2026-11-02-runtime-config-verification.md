# 任务启动配置读回校验优化

- 日期：2026-11-02
- 状态：completed
- 负责人：Codex

## 背景与目标

统一任务入口在启动或重试 CLI 前调用 `applyConfigById`，无论档案身份是否变化都会重新应用。运行配置读回与预期文本逐字不同即抛出“未成功更新配置”；同进程队列不协调其他窗口和 CLI 的写入。目标是减少格式差异误报、恢复短暂写入冲突，并保留真实失败阻断。

## 范围与非目标

- 范围：运行配置语义校验、冲突有限重试、错误定位、相关回归与事实文档。
- 非目标：改变任务档案选择规则、长期文件锁、跨进程启动原子性、修改用户真实配置、升级依赖或界面改版。
- 当前工作区干净，沿用当前分支原地修复；不额外创建分支或 worktree。

## 验收标准

- 等价 JSON / JSONC / TOML 的格式、对象键顺序、注释或换行变化不误报；数组顺序和真实字段差异仍失败。
- 只针对读回校验冲突进行有上限的完整应用重试；权限、解析和写入错误不盲目重试。
- 持续不一致仍阻止启动，报错指出 CLI 和文件，不泄漏配置值或凭证。
- 同一 CLI 的既有串行顺序、Codex 配置与认证配对以及 Claude MCP 浅合并契约保持不变。
- 最小相关测试及 `npm run build` 通过，并以临时 HOME 进行真实文件验证。

## 影响面与风险

- 代码：`src/config/`；测试：`src/test/config/`。
- 文档：功能清单、运行参考、本体规则；不改变架构分层。
- 风险：外部持续覆盖仍可能失败；有限重试不等同于跨进程锁，重试只覆盖本次应用。
- 回滚：还原本次校验和重试变更，不改变档案格式或迁移用户数据。

## 验证计划

- 先补可重现的语义误报与冲突回归，确认旧实现失败，再修复。
- 最小相关验证：配置策略、配置服务、DSH 与配置应用队列测试。
- 扩展验证：`npm run build`、配置域单测、ontology 校验及其单测。
- 本机验证：临时 HOME 中真实文件读写及独立进程并发应用；不读取或改写用户凭证。

## 测试与清单同步

- 单元测试新增/更新：结构化校验矩阵、重试边界与非校验错误、Codex 临时/持续覆盖与队列恢复、DSH 提交标记前恢复。
- 单元自测结果：`npm run build` 通过；最小相关 76 项、`node --test dist/test/config/*.test.js` 配置域 353 项通过；`npm run test:unit` 共 2522 项，2521 项通过、1 项跳过、0 失败。
- 失败处理记录：新增的 5 条回归在旧实现上全部失败，属于已确认的实现缺陷（逐字比较误报、短暂覆盖无恢复和缺少定位），修复后通过。
- 功能清单与 ontology：已同步配置校验和恢复行为，运行参考补充触发链、边界和排查方法。
- 记忆判断：稳定结论进入运行参考；不写自动任务流水或重复热区记忆。

## 当前结论

CodeGraph 结构查询和磁盘源码共同确认触发链：`runPrompt` 的执行回调 → `applyConfigById` → `configService.applyConfig` → CLI strategy 写入并读回校验。已实现语义校验与有界恢复。

临时 HOME 中用两个独立 Node 进程同时调用真实 `configService.applyConfig`，在读文件前注入 40 毫秒延迟扩大实际文件竞争窗口：6 轮均触发并恢复冲突，12 次应用全部成功，总应用尝试 20 次；每轮结束 `config.toml` / `auth.json` 配对一致。只使用隔离的合成配置，无真实 CLI 网络调用或用户配置读写；临时目录已清理。该验证证明已覆盖的短暂竞争可以恢复，不代表任意外部写入下的跨进程原子性保证。

## 最终验证与边界

- `node_modules/.bin/c8 --include=dist/config/runtimeConfigVerification.js --reports-dir=/tmp/sinitek-config-verification-coverage --temp-directory=/tmp/sinitek-config-verification-coverage/tmp node --test dist/test/config/runtimeConfigVerification.test.js`：新增校验器语句、分支、函数、行覆盖率均为 100%。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- `git diff --check`：通过；未新增依赖、修改框架或更改真实运行配置。
- 全量单测唯一跳过项是既有 DSH live 集成用例，需显式设置 `SINITEK_DSH_LIVE=1` 及回环模型地址/凭证；本次不启用真实模型调用。
- 未执行真实 VS Code Extension Host、Windows 系统或浏览器验证：本次只改变配置应用后端，无 UI 结构修改，路径继续复用既有跨平台实现。
- 架构无需更新；稳定排查结论已进入运行参考，未把本次任务流水写入热区记忆。
