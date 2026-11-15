# 本轮检查与复用边界

| 范围 | 命令或动作 | 结果及边界 |
| --- | --- | --- |
| 环境/父来源 | 宿主 cwd 的 pwd/rev-parse/status；Python 从父 loop-tasks.json 解析两个指定 communicationFile；读取其报告、round-414 平台报告、共享 Git 交接 | 成功。宿主是临时 symlink overlay，初始 status 有 symlink/删除显示及 .gitignore 循环警告，仅作定位，不据此判归属。后续明确使用真实共享 Git 仓库；未改 overlay。 |
| 技能/refs | 读取 using-git-worktrees/SKILL.md；共享 show-ref、rev-parse、worktree list；Python 捕获共享索引/status/ref 基线 | 成功；本地 HEAD/master f5b5ac57、origin/master 8f396c1b，原 c53 与 51a refs 均保持。旧失效 worktree 注册仅观察、不 prune。 |
| 隔离创建 | git -c core.hooksPath=/dev/null worktree add -b codex/department-platform-delta-round419-20261116 <外置路径> 51a5e7b15c54921611721fe14863e60361d64e72；完整 porcelain status | 成功，初始干净；无依赖安装、链接或 build。 |
| 来源 | Python 读取三个 allowlist 来源，逐项 SHA/大小/旧 Git blob 对比，写入新树后再读来源与候选；git diff --name-only 51a | 成功。三个新字节哈希匹配；只改三路径。没有复制目录、并发 UI/EH 或运行时私有现场。 |
| 差异与文档合同 | 直接检查三路径 git diff；Python verify_delta.py 检查报告描述、JS 字段/门禁、24 个顶层测试注册、runbook UTF-8/换行/围栏/关键词/行尾空格 | 成功，静态核对，不是新的 24 项运行；三个最终输入此后未改。 |
| JSON 首次诊断 | 只读 Python 同时打印两份报告字段，错误假设 round-416 同样使用顶层 tests | exit 1，KeyError: tests。round-416 使用 execution.tests；修正读取后，下面的合同审计通过。不是平台失败，也未重跑平台。 |
| 静态审计首次执行 | python3 /private/tmp/department-platform-delta-round419/verify_delta.py | exit 1；词法计数把 template-string 里的临时测试也算入（25）。缩小到文件现有双引号顶层注册，24 个；仅修审计脚本，未改测试。原脚本 verify_delta-01.py 保留 scratch。 |
| JSON/六份 Owner 源码 | 修正后的同一审计脚本；按旧 tests[] 与新 execution.tests 两种 schema 断言；核对两原报告 SHA、直接/整树/强制动作；比对六个源码 SHA 与历史实体产品源/编译 SHA | exit 0。round-414 失败保留，round-416 仅首文件通过，整树未确认；不是本轮运行产物或新构建。 |
| 原材料 | 同脚本逐个对比两批 11+38 份继承材料与 51a Git blob | 成功，49 文件未变；未扩大旧材料适用范围。 |
| 实现空白 | git diff --check 51a5e7b15c54921611721fe14863e60361d64e72 | exit 0；三个源路径最终字节已定。 |

后续证据封装、JSON 可解析/哈希/压缩/路径、最终暂存空白、提交父树/干净状态及共享保存检查另见 `final-checks.json`（检查动作在提交前运行并记录）。提交后的最终事实写本轮沟通文件，避免把提交后结果预写入提交自引用。

不运行的检查：build、旧 483 项、入口 24 项、Owner CLI、完整 58 项、EH/CLI/模型、浏览器/视觉、全量回归及 Windows/Linux 主机探测。原因是本轮只整合已接受稳定字节，不改既有验证输入；仍有效结果按各自快照复用。最终真实合并树门禁不能由这些复用或静态检查代替。各次检查后仅添加新证据、共享交接及本轮报告；未再改被检查的三个源文件。
