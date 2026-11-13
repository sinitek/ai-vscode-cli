# Loop+ 旧版 Codex 交接超时与主任务暂停修复

- 日期：2026-11-13
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-13-bugfix-loop-subtask-run-ownership.md`（同属会话所有权问题，保留既有门禁）；`.ch/docs/exec-plans/active/2026-11-12-bugfix-codex-release-state.md`（底层释放协议验证边界独立保留）
- 状态：completed
- 负责人：Codex

## 背景与目标

只读日志确认主会话交接发生 waiting_close 超时，任务累计主 AI 失败 5 次后进入 needs-review；持久化 finalSummary 为空，群聊只显示泛化暂停说明。底层错误明确禁止自动重试，但 Loop+ 编排 catch 仅保留 message，仍重复调用，违反安全错误的重试约定。

## 范围与非目标

- 修复旧版/未知能力 CLI 的专属连接兼容策略、编排层不可重试错误处理、暂停原因持久化及旧任务展示，并补统一检测覆盖。
- 不修改真实任务、会话或业务文件，不发布、安装、重载扩展，不删除锁或强制终止其它会话。
- 不以超时推断 CLI 版本或协议不支持；不修改现有交接释放证据要求。

## 验收标准

- 不可重试会话错误只调用一次，暂停保留 review 队列，明确显示真实错误和安全恢复条件。
- 普通可重试错误仍遵守 5 次门槛，成功后清失败状态；显式继续重新判断而不伪造释放成功。
- 群聊、聊天与暂停文件使用同一失败原因；旧记录无 finalSummary 时可以重建失败说明。
- verify_mac.py / verify_win.py 的共享检测包含上述回归，不把单机通过称为跨平台完整验证。

## 影响面与风险

- Codex runner/pool 及能力分流、编排、主 AI 失败摘要、群聊状态投影、暂停记录及统一验收脚本。
- 风险：旧业务摘要覆盖新故障、显式继续读到旧原因、错误错误地重试或普通网络错误被提前暂停。以状态转换回归覆盖。

## 验证计划

- npm run build；相关 Loop+ 编排、暂停、群聊、摘要、统一验收单测。
- 共享回归集合、Python 入口测试与 ontology 校验。
- 真实任务日志仅只读核验；根目录 Python 入口分别对默认 0.145.0 与显式 0.167.0 执行三轮原生隔离交接及公共 runner 协议验证。原生 Windows 与安装态 VS Code 不冒充通过。

## 任务列表

- 日志与当前事实来源核对：已完成。
- 回归、实现、脚本和文档同步：已完成。
- 本机双版本验证与归档：已完成；其它平台及安装态验收边界保留。

## 决策记录

- 2026-11-13：历史日志只有 command=codex，不足以确认历史 CLI 版本；交接缺少释放证据时保持 fail-closed。
- 2026-11-13：进一步核对原生会话创建元数据为 0.145.0，历史启动环境 PATH 首选路径当前也解析 0.145.0；这支持兼容性调查，但不把创建版本当作所有历史恢复调用版本的证明。相同版本的旧源码隔离复现补足根因证据。
- 2026-11-13：准确核对官方 0.145.0 schema 不含 thread_unload_delay_secs，thread_lifecycle.rs 默认值为 30 分钟。新策略不猜测旧版参数：unsupported/unknown 使用专属进程，已确认 supported 保留共享。不同平台可能恰好选择不同 CLI 版本，不能简单归因为 macOS/Windows 对调。

## 当前结论

暂停是累计失败门槛触发，不是父任务成功。新增证据已定位兼容策略缺陷：0.145.0 上游原生卸载为 30 分钟，原共享策略不可能在 75 秒内正常交接。旧源码隔离复现约 75 秒持续 ACK/notSubscribed、没有 closed/notLoaded、迁移后模型请求未发出；新源码专属策略等待原进程退出后恢复原 thread，公共 runner 初测 57 毫秒、另一原会话继续运行，严格清理通过。不改用户 CLI/配置、不开启未知参数、不删除门禁。

## 验证过程与失败分类

- build 与第一批定向回归 228/228；初次扩大回归 766/766（后续新增断言需最终重建验证）。Python 根入口测试 11/11。
- 默认 Python 入口首次重跑误将控制台输出重定向到验收器保留的同名 .log，被拒绝覆盖；属于调用方式错误，换独立 console.log，不删除历史证据。
- 兼容 pool 探针初版先启动多个全新 app-server，偶发 SQLite 首次初始化竞争，属于隔离夹具时序问题；改为原进程初始化完成后启动 peer，不放宽失败判断。
- 兼容版原生恢复可能不会复现新版 writer 拒绝，不能虚构该证据。共享分支仍要求真实 writer 冲突；专属分支实际执行 retain/withThread 的异 owner 拒绝，并要求原进程 exit 及原 peer 保留。公共 runner 逐事件证据不变。

## 最终验证与交付边界

- `python3 verify_mac.py --runs 3 --report /tmp/loop-main-pause-default-final2.json`：build 通过，默认生产解析的 Codex 0.145.0，768/768、无跳过/取消/TODO。三轮专属交接 44 / 43 / 41 ms，公共 runner 63 ms；原进程实际退出先于原 thread 恢复，另一原会话继续运行，完整清理。
- `python3 verify_mac.py --codex "$(command -v codex)" --runs 3 --report /tmp/loop-main-pause-0167-final.json`：build 通过，显式 Codex 0.167.0，同一 768/768；共享池三轮 60055 / 60047 / 60055 ms，公共 runner 实际零延迟策略 26 ms，thread/closed 先于恢复，另一 thread 在原进程继续，完整清理。
- 两份报告均 passed=true、fullyVerified=false；附属 .log 与 .runner.json 保留，不覆盖旧失败证据。另以系统进程查询确认两份报告所有验证 PID 已退出。
- `python3 -m unittest discover -s scripts/tests -p 'test_verify_loop_plus.py'`：11/11；`test_vscode_extension_process.py`：4/4；ontology --validate 通过（138 rules），ontology tests 9/9；JS 脚本语法检查、git diff --check 通过。
- 已同步 FEATURE_INVENTORY、TESTING、CLI runtime reference、暂停排障与 PITFALLS、local-development 和 ontology。稳定规则已进入事实来源，不另写重复 EVENT_MEMORY。
- 未发布、安装或重载当前扩展；未修改用户真实任务/会话。尚未覆盖原生 Windows/Linux、真实 VS Code 多窗口、真实模型完整任务与未知外部 writer；不宣称这些缺口已解决或完整跨平台验收通过。关联的旧 active 计划保持原状态。
