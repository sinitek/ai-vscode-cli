# 配置档案复制策略提取

- 日期：2026-11-08
- 状态：completed
- 负责人：Loop+ 本次 fullstack coding attempt
- owner：round-2-refactor-config-copy-strategies
- claimed_at：2026-11-08
- claim_ttl：本次实现与自测结束
- handoff_to：主审（独立兼容验收由另一任务负责）

## 背景与目标

CLI 参数构建、Runner 生命周期和上下文压缩已有策略结构；配置复制仍把七平台构造、四组跨平台限制、命名与持久化混在 configService 中。本次使用轻量 Strategy + Facade 提取无 I/O 规则，不以文件大小为重构依据。主审既有 decision-model 返回 profile_copy、confidence=0.99，仅作为选型辅助，不是正确性证据；本实现不重新决定候选。

## 范围与非目标

- 新增 configCopy.ts：静态七平台 Record、命名、按原优先级拒绝、内容构造；metadata 显式注入。
- copyConfig 保留公开签名、normalize → getById/notFound → 限制 → getList/name → 时间/ID → build → await saveConfig → 返回原对象的顺序；不改 saveConfig 及其锁、激活、校验、权限、原子写。
- 新增纯策略测试；更新配置请求设计文档。另一任务拥有 configCopyCompatibility.test.ts，本次不修改或借其通过替代自测。
- 不改 UI、协议、依赖、发布、分支、提交、Loop 调度或运行记录，不扩展旧 TOML MCP 提取器或做无关安全改造。

## 验收标准

- [x] 七种目标策略与四组限制原样保留，legacy gemini 只经现有 normalizeConfigPlatform。
- [x] 保持字段集合、configContent 空字符串优先级、默认值、Skills 浅复制/元素复制和源不变。
- [x] 固定 metadata 的纯测试覆盖命名、限制优先级、JSONC/MCP 和无 I/O/时钟/随机数。
- [x] 标准构建与指定四组回归通过，隔离 HOME、CLI 路径和缓存；ontology validate 通过。
- [x] 文档记录责任边界、实际命令/结果、剩余风险并归档，只声称本实现与自测完成。

## 影响面与风险

- 代码：src/config/configService.ts、src/config/configCopy.ts、src/test/config/configcopy.test.ts。
- 文档：本计划、.ch/docs/design-docs/config-center-request-commands.md。
- 风险：CodeGraph 有未解析边，不能推定无其他调用；保留服务 API 并跑真实现有回归。独立测试并行写入，写前复读目标，避免覆盖；dist 构建仅本任务串行执行。
- 兼容细节：保留 OpenCode → DSH → Kimi Code → ZCode 错误优先级；保留 Claude/Codex/Grok 历史跨平台路径、JSONC 格式化及数组引用行为。
- 回滚：只撤回策略抽取、接线、测试和文档；无配置迁移或用户数据回滚。

## 验证计划

- npm run build
- 在临时 HOME、USERPROFILE、XDG_CACHE_HOME、TMPDIR 和 npm 缓存下，env -i 清除各 CLI HOME、XDG_CONFIG_HOME 等继承路径覆盖（缺省路径因此随临时 HOME，测试自身覆盖也只使用临时目录）：node --test dist/test/config/configcopy.test.js
- 同一隔离环境：node --test dist/test/config/configService.test.js dist/test/config/opencodeConfigService.test.js dist/test/config/configprofilenormalization.test.js dist/test/config/configProfileRequestHandlers.test.js
- python3 .agents/skills/ontology/scripts/search_ontology.py --validate
- git diff --check（限定本次文件），不运行发布或浏览器 smoke。

## 测试与清单同步

- 新增 src/test/config/configcopy.test.ts，22 个测试，覆盖七目标精确字段、全部 49 对限制、空值优先级、命名编号、MCP/JSONC、源不变及 Skills 引用语义；固定 metadata 并通过 mock 禁止文件/HTTP/子进程/时钟/随机数调用。不修改另一个任务的 configCopyCompatibility.test.ts。
- 实际构建：npm run build，退出 0；新增纯策略测试 22/22，指定四文件回归 186/186，均退出 0，无失败、跳过或取消，无需失败分类修复。
- ontology validate 通过：domains=2、concepts=17、relations=16、rules=113、workflows=2、documents=3。
- git diff --check 和 node scripts/check_trailing_whitespace.js 的本次文件范围检查均退出 0，包含新增文件的空白检查。
- FEATURE_INVENTORY 无需语义更新：配置页仍只复制当前 CLI，服务保留既有跨平台兼容，没有用户可见变化。
- ontology 无需语义更新：档案概念、权限、状态、输入输出、关系与场景均不变；原 configService 和设计文档 source_refs 仍有效。完成后校验引用，不移动既有事实来源。
- ARCHITECTURE 的配置服务边界不变；细化职责进入既有请求设计文档，不增加重复全局说明。
- 本次无 UI 改动，浏览器验证不适用。

## 任务列表

- [x] 核对根规则、ontology 和 CodeGraph 源码，确认契约与边界。
- [x] 提取策略并接线 facade。
- [x] 补充纯策略测试并执行隔离验证。
- [x] 更新设计、记录真实结果并归档，写本次 attempt report。

## 决策记录

- 2026-11-08：使用简单函数、显式类型和模块级 Record，不引入继承、插件或运行时注册。复用 canonical 内容与既有 JSON/JSONC 解析器；保留原宽容回退，不重写通用解析器。
- 2026-11-08：执行目录是共享仓库的符号链接镜像，git 状态在镜像下误报缺失；后续在真实仓库路径操作，未修改或修复镜像，也不新建 worktree/分支。
- 2026-11-08：策略内只保留原有“解析失败退空对象”薄适配，严格/JSONC 通用解析仍调用 shared/jsonObject；不复制解析器。复用既有 Kimi/ZCode 纯文本构造，其模块的文件辅助函数不被调用；无 I/O 测试同时覆盖直接构造的历史不可达分支。

## 实际命令与结果（原实现自测 / round 2）

隔离根目录为 `/tmp/sinitek-config-copy-validation.XEVLOn`（由 mktemp 创建）；先建立 home/cache/npm-cache/tmp，再对构建与两次测试使用如下实际前缀：

```sh
env -i PATH="$PATH" HOME="$validation_root/home" USERPROFILE="$validation_root/home" XDG_CACHE_HOME="$validation_root/cache" npm_config_cache="$validation_root/npm-cache" TMPDIR="$validation_root/tmp/" LANG=en_US.UTF-8 npm run build
env -i PATH="$PATH" HOME="$validation_root/home" USERPROFILE="$validation_root/home" XDG_CACHE_HOME="$validation_root/cache" npm_config_cache="$validation_root/npm-cache" TMPDIR="$validation_root/tmp/" LANG=en_US.UTF-8 node --test dist/test/config/configcopy.test.js
env -i PATH="$PATH" HOME="$validation_root/home" USERPROFILE="$validation_root/home" XDG_CACHE_HOME="$validation_root/cache" npm_config_cache="$validation_root/npm-cache" TMPDIR="$validation_root/tmp/" LANG=en_US.UTF-8 node --test dist/test/config/configService.test.js dist/test/config/opencodeConfigService.test.js dist/test/config/configprofilenormalization.test.js dist/test/config/configProfileRequestHandlers.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
git diff --check -- src/config/configService.ts src/config/configCopy.ts src/test/config/configcopy.test.ts .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md
node scripts/check_trailing_whitespace.js src/config/configService.ts src/config/configCopy.ts src/test/config/configcopy.test.ts .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md
```

构建、纯策略和回归日志分别保留在隔离根目录的 build.log、strategy-tests.log、regression-tests.log。按 build → 策略测试 → 现有回归串行执行，无并行构建读取 dist 的竞争。空白检查归档前运行过 active 路径，归档后用 completed 路径复核。没有访问真实用户 HOME/CLI 配置或缓存；未运行 CLI/网络集成、全量单测、页面测试或浏览器。构建只有 npm 版本提示，没有变更依赖或安装。

## 抽取遗漏收尾与修复后复验（round 3 / 2026-11-08）

### 依据与边界

- 主审修复前已完成标准 build 与六文件合并测试 333/333，证据为 `/tmp/sinitek-copy-main-review.yyBDvc/build.log`、`tests.tap`；公开契约独立测试已通过。此处保留为修复前证据，不冒充本轮复验。
- 本轮在宿主提供的 `/private/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/sinitek-loop-subtask-CiznYu` 操作，没有继续使用 round 2 临时工作目录。
- CodeGraph 优先查询后未返回目标源码正文，按当前磁盘源码和 TypeScript AST 复核：服务中的 readJsonObjectText/ConfigPathPlatform 各仅 1 处标识符出现；parseJsonObjectText/JsonObjectParseMode 各 2 处（导入加死函数内使用）；辅助函数体去注释打印与策略模块完全相同，没有存活调用。
- 修复仅删除 configService 中该私有死函数及 ConfigPathPlatform、parseJsonObjectText、JsonObjectParseMode 三个导入，保留仍有 14 处标识符出现的 isPlainObject。configCopy 内辅助函数、七平台策略和所有测试保持不动，不重抽通用工具、不清理其他历史死代码。
- 此次是 omissions and regressions / maintainability 收尾，不是修复功能测试失败；未改变公开 API、错误顺序、字段优先级、JSON/JSONC 回退、ID/时间、saveConfig、UI 或依赖。无需新增/修改测试断言、FEATURE_INVENTORY 或 ontology 语义，也不修改另一任务的验收测试。

### 本轮实际命令与结果

新建隔离根目录 `/tmp/sinitek-copy-cleanup.XxnEhh`，`validation_root` 指向该目录；先创建 home/cache/npm-cache/tmp。下列构建和测试按顺序执行，前一项退出后才运行后一项，没有并行 clean/read dist。env -i 清除继承的 CLI HOME、XDG_CONFIG_HOME 等路径覆盖，缺省路径随临时 HOME，Node 模块缓存由新进程/既有夹具隔离。

```sh
env -i PATH="$PATH" HOME="$validation_root/home" USERPROFILE="$validation_root/home" XDG_CACHE_HOME="$validation_root/cache" npm_config_cache="$validation_root/npm-cache" npm_config_update_notifier=false TMPDIR="$validation_root/tmp/" LANG=en_US.UTF-8 npm run build
env -i PATH="$PATH" HOME="$validation_root/home" USERPROFILE="$validation_root/home" XDG_CACHE_HOME="$validation_root/cache" npm_config_cache="$validation_root/npm-cache" npm_config_update_notifier=false TMPDIR="$validation_root/tmp/" LANG=en_US.UTF-8 node --test dist/test/config/configcopy.test.js dist/test/config/configCopyCompatibility.test.js dist/test/config/configService.test.js dist/test/config/opencodeConfigService.test.js dist/test/config/configprofilenormalization.test.js dist/test/config/configProfileRequestHandlers.test.js
shasum -a 256 -c "$validation_root/untouched.sha256"
python3 src/../.agents/skills/ontology/scripts/search_ontology.py --validate
node scripts/check_trailing_whitespace.js src/config/configService.ts .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md
repository_root=$(cd src/.. && pwd -P)
git --git-dir="$repository_root/.git" --work-tree="$repository_root" diff --check -- src/config/configService.ts .ch/docs/design-docs/config-center-request-commands.md .ch/docs/exec-plans/completed/2026-11/2026-11-08-config-profile-copy-strategies.md
```

- 标准 build：退出 0，clean + tsc 完成，日志 `build.log`。
- 六文件测试：退出 0，333/333 通过，0 失败/跳过/取消，日志 `tests.tap`。无测试失败，不需要修复夹具或弱化断言。
- 内联 Node/TypeScript AST 检查：服务不再含 readJsonObjectText、ConfigPathPlatform、parseJsonObjectText、JsonObjectParseMode；isPlainObject 仍为 14 处。SHA-256 对比修复前 manifest：configCopy.ts 和六个测试源文件全部 OK。
- ontology validate：退出 0，domains=2 concepts=17 relations=16 rules=113 workflows=2 documents=3；本次文件范围的空白检查与差异检查均通过。
- 本轮只更改服务、既有设计文档、本归档计划及本轮独有 attempt report；写前复读并使用局部 patch，未发现同符号竞争，未覆盖其他并发工作。镜像缺少 .agents 入口时通过 src/../.agents 访问同一仓库工具；git 显式指定真实仓库工作树以避免镜像伪删除，不更改当前执行 cwd。
- 未运行全量单测、页面、真实 CLI/网络或 VS Code 宿主集成，未发布、提交、切分支、改依赖、调度或其他报告。本轮无 UI 修改，浏览器验证不适用。

## 当前结论

原实现自测、主审修复前合并验证和本轮修复后 333/333 复验已分别记录；此次抽取遗留死函数/无用导入已清除，归档计划仅确认本实现与本轮收尾完成，不宣称主任务最终验收完成。主审可据本轮 diff 与新日志继续最终收口。保留旧 TOML 提取器与坏 JSONC 空对象回退的局限属于兼容要求，不是本次待修缺陷；CodeGraph 未解析边仍是索引限制。
