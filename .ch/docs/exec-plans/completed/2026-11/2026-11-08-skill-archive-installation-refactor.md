# 技能 ZIP 安装行为保持重构

- 日期：2026-11-08
- 状态：completed
- 负责人：Loop+ fullstack coding attempt（不切换主模型，不再委派）
- owner：round-1-refactor-skill-archive-installation
- claimed_at：2026-11-08
- claim_ttl：本次执行
- handoff_to：主任务主审

## 背景与目标

`lobehubSkillMarket.ts` 混合 HTTP、本地输入和布局、安全解压、安装结果收集与临时目录生命周期。本次只抽取真实重复流程，保留旧入口作为兼容 Facade，用函数式模板协调来源特定发现。

## 范围与非目标

- 范围：市场 Facade、本地 ZIP 适配器、共享安全解压与安装模板、离线回归、设计/架构导航/功能清单/Ontology 来源同步。
- 非目标：不改用户行为、HTTP 策略、技能命名、安全限制、CLI 替换/回滚规则、UI、依赖、版本或调度状态；不访问真实市场与用户技能目录；不发布、不提交、不创建分支。
- 预先存在：`package.json` 版本 1.8.7 → 1.8.8 为外部修改，保留且不纳入本次修改。

## 验收标准

- [x] 原公开导出、参数、Promise、结果形状、顺序和错误身份不变。
- [x] 两种本地布局与市场递归发现保持差异；共享层不依赖来源入口、HTTP 或 VS Code。
- [x] ZIP 安全代码及限制原样迁移，finally 覆盖解压/发现/安装且清理错误仍传播。
- [x] 离线安装、失败继续、清理、导出兼容回归和指定配置页测试通过。
- [x] 文档与 Ontology 同步且校验通过，计划归档；主审验收留给主任务。

## 影响面与风险

- 代码：`src/config/lobehubSkillMarket.ts`、`src/config/localSkillZip.ts`、`src/config/skillArchiveInstaller.ts` 与相关测试。
- 文档：`ARCHITECTURE.md`、设计文档、功能清单、Ontology 和本计划。
- 风险：输入检查顺序、结果省略字段、名称排序和重复项、错误类身份、清理异常变化。
- 缓解：逐段移动安全代码，不复制底层安装器，不引入模式旗标/继承/注册表；行为型断言及安全函数迁移比对。仅回退本次文件差异，保护并发修改。

## 验证计划

1. `npm run build`，构建结束后再串行测试，不与 dist 读取并行。
2. `node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js dist/test/config/skillArchiveInstaller.test.js`。
3. `git diff --check`。
4. `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
5. `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。

## 测试与清单同步

- 保留已有测试，将原 ZIP/临时 HOME 夹具无行为修改地移到 `src/test/config/skillArchiveFixtures.ts`；新增 `skillArchiveInstaller.test.ts` 的 13 项回归。
- 功能清单仅同步实现与验证路径，不声称新增功能。
- UI 无改动，以代码范围和配置页离线回归为证，不声称运行浏览器。
- 本次 memory recall focus 为 `skill ZIP installation`，anchor 为空，输出写独立 `/tmp`，未覆盖已有 recall 面；无命中任务专属记忆，回到当前源码与 Ontology source_refs。
- 实测命令与结果（2026-11-08，实际仓库根；构建与 dist 读取严格串行）：
  - `npm run build`：执行两次均成功，第一次验证提取代码，第二次包含完整新增测试；没有降低 TS 检查或改依赖。
  - `node --test dist/test/config/skillArchiveInstaller.test.js`：13/13 通过。
  - `node --test --test-concurrency=1 dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js dist/test/config/skillArchiveInstaller.test.js`：104/104 通过，0 失败/跳过，包含编译后离线真实文件系统安装。
  - `git diff --check`：通过；另检查四个新增 TS 文件无尾随空白。
  - `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 domains / 17 concepts / 16 relations / 113 rules / 2 workflows。
  - `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
  - 用 Node + TypeScript AST 将 HEAD 与当前三个模块的函数源码比对：21 个既有函数逐字相同（包含 HTTP、解压、安全、市场发现和规范化）；两个本地公开入口仅返回类型别名名称不同。
- 失败分类：无构建或测试失败。初次从符号链接执行视图运行 git 的删除假象属于执行环境路径问题，改用真实仓库根后确认只有原版本差异；未重置任何文件。
- 未运行：全量单测/严格覆盖率、Windows/Linux 实机、真实 CLI/市场/Extension Host、浏览器与性能基准。此次是局部无 UI 行为保持重构，已运行指定相关回归；不引入真实配置/网络副作用，不声称平台实机或性能提升。
- 文档同步：设计说明、ARCHITECTURE 单条导航、功能清单两项实现/验证路径、Ontology 实现路径与来源锚点（校正“Skills 本地 ZIP 导入”）。
- 记忆判断：可复用责任边界已上提设计文档，无新的事故/偏好/复发问题；不更新 EVENT_MEMORY 或 ROLLING_SUMMARY，不写自动流水账。

## 任务列表

- [x] 核对项目规则、Ontology 状态与来源、当前源码及预先存在修改。
- [x] 抽取来源适配器与模板，保持 Facade。
- [x] 补齐并执行离线行为回归。
- [x] 同步事实来源、完成验证、归档；attempt report 作为本次执行交接件。

## 决策记录

- 2026-11-08：按已确定设计实施兼容 Facade + 函数式 Template Method；没有待做的多方案结构化决策，不再选方向。
- 2026-11-08：执行目录是指向真实仓库的符号链接视图；在实际仓库根执行 git/build，避免将视图误判为大量删除。实际仓库起始状态仅 package.json 版本差异。

## 当前结论

实现、自测与文档收口完成，归档到 `.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md`。用户行为不变；本次自测完成不等于主审已经验收，最终验收仍由主任务决定。主任务给出的 263fc08e 基线为 build + 23 项，本次扩展回归独立实测 104 项全部通过。

## 第二轮：测试可移植性修复（2026-11-08）

- 范围仅为 `src/test/config/skillArchiveInstaller.test.ts` 和本归档记录；不重写已审查的生产实现，不修改原 Facade、错误契约、Ontology、功能清单或 UI。
- 问题分类：新增测试夹具/断言的跨平台假设。原用例实际解压 CON、aux.txt、LPT9、冒号、尾点/空格包装目录，再统一要求 localZipLayout；文件系统可能更早拒绝或规范化这些名称。主审提供的是隔离 HOME 下 mkdir 注入拒绝得到 badZip 的确定性证据，并非 Windows 实机结果。
- 修复分层：
  - 根布局保留全部七个原名称，以只含有效根 SKILL.md 的 ZIP 精确断言 SkillMarketError / invalidLocalZipName；名称仅为输入字符串，不创建非法路径。
  - 包装目录先实际解压合法 wrapper-name，再仅对当前归档根的 readdir Dirent 名称作注入；全部七个名称精确断言 SkillMarketError / localZipLayout，每个 mock 在 finally 恢复，匹配范围外调用透传。
  - 保留真实 `bad..name/SKILL.md` 解压案例，验证可由目标文件系统创建但业务规则拒绝的包装目录。
  - 新增当前归档 wrapper-name 的 mkdir 拒绝注入，精确断言共享 SkillMarketError / badZip；安装器 spy 的调用数为零、隔离 HOME 未写入且归档临时目录已删除；mock 均 finally 恢复。此项是模拟文件系统拒绝，不声称模拟完整 Windows 或实机运行。
  - 复查其余新增测试，市场 CON frontmatter 仍验证发现结果保留 CON；预先用隔离 HOME 下合法 `.claude/skills` 普通文件阻止安装，精确断言目标失败并有消息，不再依赖任何系统能成功创建 CON 目录。包装布局的 CON.zip 只作输入字符串、非法 frontmatter 也只作文本，均不创建非法路径。
- 覆盖保留：既有成功安装、部分/全部失败、排序、去重、隐藏内容、清理与错误传播回归未删减；原合并名称用例拆为四项，新增测试文件由 13 项变为 16 项，组合由 104 项变为 107 项。
- 实际命令与结果（严格先构建，再最小范围，再串行五文件）：
  - `npm run build`：exit 0。
  - `node --test dist/test/config/skillArchiveInstaller.test.js`：16/16 通过，0 失败/跳过。
  - `node --test --test-concurrency=1 dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js dist/test/config/skillArchiveInstaller.test.js`：107/107 通过，0 失败/跳过。
  - `git diff --check`：exit 0。
  - `shasum -a 256 -c /tmp/sinitek-round2-preserved-files.sha256`：全部通过；与本轮编辑前相比，所有 src/config/*.ts、package.json、package-lock.json、Ontology 域数据、共用夹具及原市场测试均未改变。package.json 的外部 1.8.7 → 1.8.8 差异完整保留。
- 本轮无构建/测试失败；只修复主审指出的跨平台夹具假设，没有放宽为任意错误、增加平台 skip 或扩大公开 API。
- 未运行 Windows/Linux 实机、全量测试/严格覆盖率、真实 CLI/网络市场/Extension Host/浏览器；本轮是测试修复，已有离线实际安装与相关回归通过，且没有生产/UI/本体变更。未重跑 Ontology 测试或更新本体数据，来源路径与业务语义均未变化。本机绿灯与注入证据不等同于跨平台实机证明。
- 本轮执行与验证完成，计划仍保留 completed 归档；最终独立验收仍由主任务决定。
