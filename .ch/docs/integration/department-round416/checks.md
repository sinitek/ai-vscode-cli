# Round 416 检查台账

所有构建、最小 Node 回归在新独立 worktree 的实体源码及本地 dist 执行。`node_modules` 是到既有安装的未提交的临时符号链接；`npm run build` 清理的仅为此 worktree 的 dist。没有执行发布脚本。

| 范围 | 命令/动作 | 结果与有效边界 |
| --- | --- | --- |
| 输入及隔离 | 解析父 tasks[].subTasks[].communicationFile；核对 refs/merge-base，外置 `git worktree add -b codex/department-local-integration-round416-20261116 <新路径> c53f9def`，初始 `git status --porcelain` | 初始干净；基线/父 SHA 见 baseline.json。旧候选保持不变。 |
| 真实三方合并 | `git -c core.hooksPath=/dev/null merge --no-commit --no-ff 8f396c1b809c43320aad9c4c43eb05c9cf2a3c58` | exit 1，11 路径/32 块真实冲突。merge-output/unmerged/conflicts-initial 保留原现场的文本与对象标识。未整文件取 ours/theirs。 |
| 构建首错 | `npm run build` → build-01.log.gz | 失败：adapter else-if 语法错误；退出码未保存在原编排输出中，编译错误完整保留。修复后失效。 |
| 构建第二次 | 同命令 → build-02.log.gz | exit 2：部门群聊 fixture 缺 recordPromptHistory，补端口。 |
| 中间构建 | 同命令 → build-03/04/05.log | 均无编译错误；03、04 有完成 exit 0，05 原编排未保留退出码，最终由 06 标准成功构建覆盖。其后 TS 修改分别为行为修复/测试及夹具兼容，不能将早期构建作为最终源码证据。 |
| 最终标准构建 | `npm run build` → build-06.log.gz | exit 0；其后没有 TS/产品源码改动。后续仅新增本目录审查材料及共享交接。 |
| 运行时首轮 | `node --test dist/test/extensionHost/{loopPlusOrchestration,loopPlusRuntimeIntegration,loopPlusRuntimeAdmission,loopPlusAttemptIdentity,loopPlusDecisionStrategies}.test.js` | exit 1，232/241 通过。首错：repairSource 断言早于冻结 beta review、同 ID 派发 fixture 不完整、旧普通 Tab 时机、错误被后续清理/释放覆盖、普通 best-effort 关闭抛错。日志完整保留。最后两个文件共 30 项通过，之后其产品输入/断言未再改动，复用该有效结果。 |
| 运行时修复复核 | `node --test dist/test/extensionHost/{loopPlusOrchestration,loopPlusRuntimeIntegration,loopPlusRuntimeAdmission}.test.js` → regression-runtime-02.log.gz | exit 1，210/211 通过。唯一剩余 fixture 缺 reviews[].subtaskIds，协议拒绝先于所测调度拒绝；补真实任务关联，未放宽产品门槛。随后新增 Owner 收尾活动回归。 |
| 运行时最终复核 | 上述三文件同命令 → regression-runtime-03.log | exit 0，212/212。含新增 Owner 收尾期间普通活动探针 false 仍保持容量合同；其后只有独立 Webview 测试夹具修改，不影响这三个文件及运行时输入。 |
| 配置/会话/存储/群聊 | `node --test dist/test/config/sharedRuntimeConfig.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js dist/test/session/sessionTabCliSwitch.test.js dist/test/loop/departmentGroupChatHost.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/departmentruntimestore.test.js dist/test/loop/loopTaskIdentityCatalog.test.js` | regression-boundaries-01.log：exit 0，166/166。之后修改 adapter 与独立 UI fixture；这组所测产品文件和测试未改动。未重复刷新。 |
| UI 首轮 | `node --test dist/test/loop/departmentGroupChatPanel.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/webview/departmentConversationTabsWebview.test.js dist/test/webview/departmentsettingswebview.test.js dist/test/webview/looppluswebviewintegration.test.js` | regression-ui-01.log：exit 1，72/75。四文件 72 项通过；最后一文件 VM source extraction 缺真实部门 presentation 与 origin loading/error helper，不是视觉结论。 |
| UI 夹具复核 | `node --test dist/test/webview/looppluswebviewintegration.test.js` | regression-ui-02.log：exit 0，3/3。前四文件与其输入不变，复用 72 项结果。 |
| 临时索引补丁适用 | 对两个父树分别 `GIT_INDEX_FILE=<独立临时索引> git read-tree <parent>` 再 `git apply --cached --check relative-to-<parent>.patch` | 两者 exit 0。临时索引由 ref 创建，没有复制共享索引。patch 绑定 implementation tree，不包含后来新证据；不是最终远端可合并证明。 |
| 路径与来源 | 遍历所有继承/合并 tracked 路径，检查相对路径及 casefold 唯一；SHA-256 对应两父/共同祖先；旧证据、平台及三个 ontology 对象与不可变候选比对 | source-manifest/path-check/preserved-materials，脚本断言通过；未读取共享平台字节。 |
| 空白 | `git diff --check c53f9def`、`git diff --check 8f396c1b`；最终暂存检查另记录 | 源码阶段均 exit 0。不是整个历史仓库空白审计。 |

唯一最终有效的相关用例共 483 项（212 + 166 + 30 + 72 + 3），不是全量套件。首轮失败不能消除或改写；旧 11 份材料及历史失败的证据边界不变。源码未覆盖区域、真实 UI/浏览器、EH/真实 CLI、所有平台入口、完整部门生产进程链及全量合并树回归本轮均未执行。没有以 round-410 安全拒绝证明恢复接管。

原始两份失败日志及双方 patch 在检查后使用确定性 gzip 无损封存，解压 SHA-256 见 compression.json。适用性检查运行时使用未压缩临时 patch；压缩未改变任何 patch 或诊断字节。环境为 Node v24.22.2 / npm 11.19.1。source-manifest 的 1413 条文件在最终构建与最小回归后逐项重新散列，全部一致。

首次包含新证据的暂存空白检查发现 build-03 至 build-06 原始成功日志带 EOF 空行。所有构建日志随后也无损 gzip 封存，保留原始字节；此变动只影响证据包装，未更改源码、dist 或测试结果。

首次提交后洁净检查发现仅 `?? node_modules`：目录忽略规则不匹配该临时依赖 symlink。已仅 unlink 本轮创建的链接（不删除依赖实体），并纠正文档中的“忽略链接”表述；未触及源码或 dist，既有构建/测试仍有效。最终提交前检查 tracked/未跟踪均为空。此首错不作为产品失败，也不声称其先前已干净。
