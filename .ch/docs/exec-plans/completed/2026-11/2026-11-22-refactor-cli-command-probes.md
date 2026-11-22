# 统一 CLI 后缀探测并缩小单命令检查范围

- 日期：2026-11-22
- 类型：refactor
- 关联计划：无
- 状态：completed
- 负责人：Codex（Loop+ 第 3 轮子任务）

## 背景与目标

正常解析与自动修复分别解释 Windows `PATHEXT`，启动等待门禁则为一个 CLI 扫描全部命令。共享纯候选生成规则，并让等待门禁只检查所选 CLI。

## 范围与非目标

- 修改 `src/cli/commandResolution.ts`、`src/cli/cliCommandRepair.ts` 及各自单测，保留各入口独立的目录顺序和文件可用性规则。
- 不改 shell、参数转义、配置写入、重放、注册表读取和进程启动错误分类。

## 验收标准

- [x] 已配置扩展名按原名探测；无扩展名沿用 `PATHEXT` 顺序及空值语义。
- [x] 保留正常目录搜索省略裸文件、显式路径和修复搜索允许裸文件回退的差异。
- [x] 等待门禁只读取/探测所选 CLI；批量检查和文件可用性规则保留。
- [x] 专属输出目录构建成功，四个指定测试文件通过，临时输出已清理。

## 影响面

- 代码目录：`src/cli/commandResolution.ts`、`src/cli/cliCommandRepair.ts`。
- 测试：`src/test/cli/commandResolution.test.ts`、`src/test/cli/cliCommandRepair.test.ts`；并验证 workspace/prompt 修复调用方。
- 文档：本执行计划。
- 外部契约保持不变；无需更新功能清单、架构、运行时参考或本体。

## 风险与缓解

- 共享候选函数接受显式裸文件回退策略；正常目录搜索使用 omit，显式路径和修复搜索使用 allow。各入口仍各自执行文件存在性或可用性检查，未统一目录顺序。
- PATHEXT 顺序、空白项、无前导点、空值、已配置扩展名、显式路径回退、修复目录优先级及单 CLI 访问边界均有回归断言。

## 验证计划与结果

- 构建：`npm run build -- --outDir /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV/dist`，通过。首次构建发现测试夹具 getter 类型错误（TS2378）；将 getter 改为显式抛错后重跑通过。
- 命令解析测试：`node --test /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV/dist/test/cli/commandResolution.test.js`，9/9 通过。
- 命令修复测试：`node --test /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV/dist/test/cli/cliCommandRepair.test.js`，16/16 通过。
- 工作区修复调用方：`node --test /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV/dist/test/session/workspaceCliRepair.test.js`，3/3 通过。
- Prompt 自动修复调用方：`node --test /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV/dist/test/extensionHost/promptAutoRepair.test.js`，7/7 通过。
- 首次合并多文件到单个 `node --test` 命令的尝试被当前 Node CLI 按单个逗号路径解析，未执行测试；改为四个独立命令后上述测试均通过。
- 清理：`node -e "require('fs').rmSync('/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-cli-probes-round3.t8ZthocV',{recursive:true,force:true})"`，成功且确认目录不存在；shell `rm -rf` 被安全策略拒绝后改用此命令。
- 限制：Windows 分支由 macOS Node 上的模拟平台与临时 POSIX 文件验证；未在 Windows 原生验证 PATHEXT、注册表和进程启动。

## 测试与清单同步

- 单元测试新增/更新：Windows 候选顺序、PATHEXT 未设置与空值、显式路径与普通 PATH 搜索裸文件行为、修复裸文件回退/目录优先级，以及等待门禁不访问其它 CLI。
- 单元自测结果：隔离构建成功；四个套件共 35 项通过。
- 失败处理：构建夹具类型错误已修复并重跑；测试多文件参数解析问题通过独立执行消除。无剩余失败。
- 功能清单：无需更新，重构未改变用户可见行为或外部契约。
- 相关文档同步：归档本计划；无其他行为文档需变更。

## 任务列表

- [x] 核对探测契约和共享工作区范围。
- [x] 实现重构并补回归。
- [x] 隔离构建、测试并归档证据。

## 决策记录

- 2026-11-22：只共享 Windows 候选生成；通过显式策略区分裸文件回退，不共享目录搜索、文件检查或平台注入。

## 当前结论

本轮代码与定向测试完成。macOS 上模拟 Windows 测试通过；Windows 原生行为仍需主任务按平台验收策略决定是否补验。本计划记录本轮执行事实，不替代主任务审查。
