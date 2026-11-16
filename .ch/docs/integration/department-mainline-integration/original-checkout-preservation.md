# 原打开目录保全与差异分类（Round718）

本轮只保全与分类，不切分支，不授权删除或覆盖。比较基线是已接受 `0817f4519f3d5aa481af9ea64e848019da480b0e` / tree `b4d9054ad26fe49cd0d3c495c7fdb89463ebd850`。本提交只增加本说明与[机器摘要](original-checkout-preservation.json)，不修改现有五份交接记录、源码、测试或 dist；准确交付 commit/tree 在本轮外部报告记录，避免自引用。

## 原目录与保全范围

原目录 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli` 的物理路径相同，仍为 `master` / `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`（tree `a677410bc8ecefff56c8c38bb763930838aa4488`）。106条 tracked 修改，无 staged、删除或未合并；另有228条非ignored untracked。全部334项是普通文件、原权限0644，总计7,719,230字节，无需追随链接；所有父目录也经lstat确认是真实目录。

索引138,263字节，SHA256 `b4c56b0612d033a5b6386ae842c2426bd70edf086fd6d69ac87769074513ef2f`；staged补丁为空，unstaged二进制补丁1,131,502字节、SHA256 `88c22d9cb40140238354c0c1639a695638fb9bce8cf40d4400259874f7cd9eaf`。NUL status身份、原refs/索引stage及完整逐文件身份见机器摘要与受保护备份。

唯一外置备份：`/Users/fangjiawei/.cache/round718-original-checkout-ggf4x1v6`。根及子目录0700，普通文件0600；原文件/父目录权限和元数据另记，不把保护权限误认为原权限。保存原master完整可达历史bundle、HEAD commit/tree、refs身份、worktree占用、raw index（及任何sharedindex）、staged/unstaged binary patch、逐路径完整内容与类型/权限/SHA/mtime/ctime/inode、私有差异和分类脚本。refs记录不是其它分支完整对象备份，不改其它来源树。原文件若为symlink会保存链接目标而不跟随；本快照实际无链接、删除或特殊文件。

`before.json` SHA256 `bcdbce21abaed91ac5f7959db4f2428f2dc6b87bb334b887cfaeb3204a425baa`；最终 `final-inventory.json` SHA256 `fb740415dd888ededd59d9eee71ae7adf71fe19f036af79cd2d639e56a32b26c`，覆盖386份私有备份项；`comparison.json` SHA256 `c9783d4c1338e8041a1ea7d4102e39bc03ba36867adb1230430ffe8edccea116`。详细内容、差异、ACL/xattr记录只留本地，不进入Git或报告。没有将未知内容加入Git快照。native元数据334份读取成功，选定文件无xattr；未演练ACL/xattr恢复，不扩称整机恢复能力。

## 分类依据与未定内容

完整334路径及729个原HEAD→原工作文件变更opcode的身份/行范围保存在机器摘要；公开材料无原代码或运行时私有内容。机械hunk状态只是定位依据，不等同语义归属。分类先比较实际内容，再查同路径祖先blob，最后审剩余逐段差异，不能按文件前缀或最后提交名归属。

| 分类 | 路径数 | 依据与后续建议 |
| --- | ---: | --- |
| delivery-exact | 196 | 与0817同路径原样一致，接受树已保留；仍不赋予删除权。 |
| accepted-successor | 129 | 原完整blob在0817同路径接受祖先找到；每条记录具体祖先SHA。0817后继保留当前合同，不能用旧文件覆盖。 |
| accepted-successor-format | 1 | workflows JSON规范化后与`4b47d0a`完全相同，后继额度准入等事实保留。 |
| accepted-successor-reviewed | 3 | Git runbook原文为当前完整前缀；UI delta runbook保留419历史并以422/424/425纠正；group smoke后继保留49条/忙闲/迟到场景并修正queued/焦点夹具。 |
| accepted-successor-whitespace | 4 | `cliProcessRuntime.ts`及三个专用fixture仅多末尾空行；完整原字节仍保留。 |
| mixed-unresolved | 1 | runtime ontology包含部门旧事实及三个未定引用，必须分段处理，不能整文件归属。 |

129条接受祖先证据含混合文件，如 `extension.ts`、`loopTaskStore.ts`、群聊coordinator、modelSettings、FEATURE_INVENTORY、计划与多份测试；同一文件的418个exact-effect、53个new-content-present、157个original-only、101个overlap机械hunk不能直接判丢失。原blob接受历史以及Round694语义修复、Round695工作区/主干组合、Round704/706/708公共及冷夹具、Round711严格存储、Round714迁移和Round715群聊/Owner修复共同解释后继差异。依据现行active计划和这些已接受材料，保留真实验收、身份、receipt/CLOSED及容量边界；不回灌旧原目录。

唯一未定文件 `.ch/docs/ontology/domains/cli-plugin-runtime.json` 与接受祖先 `c53f9defc811e5fddcf87e2d052ab0c6069c3087` 规范化后仅三处 `source_refs` 的anchor/symbol差异：`plugin.rule.missing_cli_install_dialog`、`plugin.rule.zcode_one_click_install` 指向 `promptInstallMissingCli`，`plugin.rule.zcode_context_compaction` 指向 `shouldAutoCompactContextAfterRunForTarget`。原件用anchor，接受树用symbol。维持此前未定归属，不擅自合入，也不删原件；原字节在外置 `content/` 与私有diff中。部门/严格存储等接受后继仍以当前树为准。不存在本轮授权的新产品变更。

## 实际检查与完整性

`python3 /tmp/round718_preserve.py` exit0：读前/读后快照完全相等，原HEAD、master、branch、index/status、补丁以及334项内容/类型/权限/元数据均未变；refs/worktree占用在备份窗口也一致。bundle verify成功。copy使用O_NOFOLLOW及同一fd读前读后fstat，另从源重新读取校对，不以复制完成替代源稳定性。

`round718_compare.py`、`round718_provenance.py`、`round718_review.py`、`round718_nearest.py`均exit0，只读当前Git与外置快照。`round718_verify_backup.py`最终exit0：核对初始353项备份哈希，在受限自有restore-check目录重建334项并逐个验证原文件权限/字节，再reverse binary patch还原106条tracked为原HEAD字节。仅删除自己的restore-check，不触碰源。首轮权限断言发现派生review diff为0644（外层仍0700）；已仅把自有备份文件统一为0600，后续检查通过，未影响源或payload。

Python环境缺少os.listxattr，改用系统 `/usr/bin/xattr -s -lx` 与 `/bin/ls -led`，`round718_metadata.py` exit0；数据仅在私有备份。`round718_finalize_evidence.py` exit0：分类结束后再核对全部334项与原Git身份未变，封存最终清单。脚本的受保护副本保留于备份，仓库不引入通用工具。材料结构/路径/计数、差异卫生、提交及最终源身份检查见本轮报告。

## ignored及最终交接限制

未打包ignored依赖/产物和本地私有目录：node_modules、dist、.tmp、.codegraph、generated本地导航、Python cache、package-lock、DS_Store等；完整collapsed列表见JSON。仅按0817已跟踪路径与当前ignored实际路径核对，碰撞0，不读取它们的内容；这不表示可删除或安全覆盖。.tmp可能有独立树，CodeGraph是本地索引，均禁止clean。没有备份其它worktree、任意仓库外运行数据或整个Git数据库；后续切换前须复核真正最终tree及ignored阻碍、ACL/链接/独立内容。此保全只证明观察窗口，不保证未来没有writer。

交付分支 `codex/department-mainline-integration-round676-20261116` 仍被整合worktree占用。本轮未detach、移动或清理它，也未对原目录执行checkout/switch/reset/stash/clean/add/commit或写回/删除文件。后续先接受本保全及另两项独立交付，再以准确最终HEAD独立制定切换步骤：立即重验原快照；变化则补新备份；逐项决定未定/混合内容；处理分支占用；仅经该后继授权执行原目录交接并验证干净状态。不能用force checkout或全量回滚绕过保护。

本轮只新增两份文档，复用Round715标准build及官方397文件/5472项、5469通过/0失败/0取消/3环境跳过、自然退出，不重跑build/测试/浏览器/CLI/EH或来源审计。Round698、Round711历史失败和受控中断、Round714修复、manifest勘误、强制卫生回收与authority自然退出区别均不改。实际mixed组合及文档交付尚须各自接受，三live跳过、必要原生平台、最终原目录安全切换仍按各自范围开放；本轮不宣称根目标完成。
