# 配置档案字段规范化策略

- 日期：2026-11-05
- 状态：completed
- 类型：refactor
- 负责人：Codex（Loop+ 独立 fullstack attempt）

## 背景与目标

`configService.ts` 的列表、单项读取、保存重复平台分派，DSH/Kimi Code/ZCode 的字段清理完全同构。提取无 IO、模块级七平台显式注册表，保留公开 Facade、磁盘形状与既有入口差异。

## 范围与非目标

- 范围：`src/config/configService.ts` 与纯 `configprofilenormalization.ts` 的行为保持重构。新增纯策略/服务特征测试的历史证据按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-config-profile-normalization-strategies.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。历史文档范围：`ARCHITECTURE.md` 实际边界说明。测试依赖策略契约，历史文档分工依据本计划确认的模块边界。原 docs companion `2026-11-05-docs-config-profile-normalization-strategies.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 非目标：运行配置策略、Runner/启动参数、UI、业务规则、平台支持、路径/锁/重试/原子写盘、Loop 调度和宿主状态；不执行发布、不创建分支或提交。
- 不修复缺失的旧 runtime 设计文档，不生成索引或热区记忆。

## 事实来源与影响面

- 已按 ontology skill 查询 `配置档案` 和 `plugin.config_profile`，status 为 ready；核对 source_refs 中 `ARCHITECTURE.md` 的 CLI/Interactive/Config 服务层、能力规格与 FEATURE_INVENTORY 的激活档案同步契约。
- CodeGraph 已定位三个入口及私有规范化函数的调用者，包含扩展宿主、配置面板和复制路径；索引可能过期，后续以直接读取的当前代码为准。
- 工作区根目录是宿主仓库符号链接视图；真实仓库 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli` 起始 `git status --short` 为空。Git 校验在真实仓库执行，避免视图中的符号链接误报。

## 验收标准

- [x] 七平台显式 `Record<CurrentConfigPlatform, Strategy>`，分 `list/read/save`；共享 canonical content 与三平台清理规则，不新增 IO、依赖或深拷贝。
- [x] 保留 Grok read 不规范化、Claude undefined-only 读取默认、OpenCode legacy 阶段差异及所有平台 read/save 删除 geminiSkills。
- [x] 保存仍复制并先校验，保留提交、美化、OpenCode 阻断豁免及写盘边界；ZCode 仅 content 被 JSON 美化。
- [x] 编译、原 61 项、新测试及指定相关回归通过，`git diff --check` 通过；完成后按月份归档。

## 风险与缓解

- 风险：把入口历史差异误统一、扩大删除字段、提前改变校验输入、触碰真实配置。
- 缓解：先特征测试，再表驱动检查七平台/三阶段、空字符串/null/undefined、未知字段/引用、幂等；服务夹具隔离 HOME 及所有 CLI home，所有源校验保留在规范化之前。
- 保存的 OpenCode legacy skills/env 清理若前移，仅作用于服务已有浅拷贝；后续模型校验只接收 content，格式化仅处理 content/mcpContent/authContent，故不改变校验输入、异常或写盘边界，需由拒绝保存与持久化测试验证。

## 验证计划

- 重构前：`npm run build`，然后 `node --test dist/test/config/configService.test.js dist/test/config/configSourceValidation.test.js dist/test/config/opencodeConfigService.test.js`。
- 重构后重新 build；新增测试及相关回归为历史证据，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-config-profile-normalization-strategies.md` 见测试计划移除审计；本计划仅记录重构实现验证。
- 最后 `git diff --check`；失败按实现/夹具/环境/历史分类，不降低断言或修复范围外问题。

## 实现验证与边界

- 重构前：`npm run build` 通过；原 61 项加新增 5 项服务入口特征测试共 66 项通过、0 失败。
- 历史测试开发中曾出现两次夹具问题：DSH 空源不是有效基线（`DSH profile is empty.`），改用有效范例；OpenCode 缺少 baseURL 是阻断错误，改用合成 `.invalid/api` URL 覆盖原有豁免。测试计划移除审计仅保留结果与失败摘要，不保留详细测试证据；来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-config-profile-normalization-strategies.md`。
- 最终验证按以下顺序串行执行（先 clean/build 完成，再运行测试，无构建/测试并行）：

  ```bash
  npm run build
  node --test dist/test/config/configprofilenormalization.test.js
  node --test dist/test/config/configService.test.js dist/test/config/configSourceValidation.test.js dist/test/config/opencodeConfigService.test.js
  node --test dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/sharedRuntimeConfig.test.js dist/test/config/currentConfigOwnership.test.js dist/test/config/dshConfig.test.js dist/test/config/kimiCodeConfig.test.js dist/test/config/zcodeConfig.test.js dist/test/config/grokConfigMapping.test.js
  node --test dist/test/config/configPaths.test.js dist/test/config/runtimeConfigVerification.test.js dist/test/config/configApplyQueue.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/newConfigFromExample.test.js dist/test/config/dshconfigpage.test.js dist/test/config/kimiCodeConfigPage.test.js dist/test/config/openCodeMcpConfig.test.js
  git diff --check
  ```

- 结果：build 通过；纯策略 67/67、服务组 66/66（原 61 + 新增 5）、直接相关回归 81/81、额外边界回归 99/99，合计 313 项通过、0 失败、0 跳过；diff 空白检查通过。包含嵌套测试，使用 Node 汇总的 `tests` 而非顶层 `1..N` 计数。
- 证据日志：`/tmp/config-normalization-pre-tests.log` 记录重构前 66 项；`/tmp/config-normalization-final-build.log` 和 `/tmp/config-normalization-final-{pure,service,related,boundary}.log` 记录最终结果。
- FEATURE_INVENTORY 与 ontology 无需更新：用户可见行为、业务语义、平台/权限/状态/跨域契约和现有事实来源路径均不变；新增纯实现边界的实际架构文档写作原由已退役 docs companion 承接（仅历史分工）。
- 无 UI 变更，UI 外观审查和浏览器验证不适用。

## 任务列表

- [x] 核对约束、ontology 和 CodeGraph 调用者。
- [x] 锁定服务入口既有磁盘行为。
- [x] 实现纯策略；测试与架构文档交付由关联计划分别追踪。
- [x] 完成重构并按月份归档。

## 决策与收益

- 沿用已选方向，不重做选题，不启动并行代理。三套入口平台 if 链改为各一次策略调用；三份同构清理合为一份，五处内容同步共用原语，Codex 复制的三个原私有 getter 调用点共用唯一 getter。
- `configService.ts` 从 1346 行降至 1215 行；新增纯模块 69 行，生产实现合计净减 62 行，不以搬移 if 链代替去重。
- OpenCode 保存的 env/legacy skills 处理前移到源校验之后：检查当前代码可知后续美化只处理三个文本字段，模型阻断校验仍只接收相同 content 和 undefined env；新测试显式确认两类豁免代码、阻断拒绝原文件不变，以及 source 校验先于会删除 mcpContent 的策略。提交、格式化和写盘前校验未下沉到纯模块。
- 可维护性：七平台注册表编译期覆盖，显式阶段和表驱动测试让历史差异可见；安全：原子写盘/权限/锁/激活行为保留，纯模块仅 type import，无新增 IO、密钥读取、日志或环境快照；性能：每次常数级分派与原地字段赋值/删除，无新增深拷贝、缓存或异步工作，未做性能基准，不声称实测加速。

## 未执行验证与限制

- 未执行全仓全量单测、真实 CLI/Extension Development Host、Windows/Linux 实机验证或性能基准；本次为纯字段重构，已执行配置入口及直接影响边界的回归。
- 无 UI/样式/交互改动，浏览器和截图验收不适用。未发布、未创建提交/分支、未修改调度状态或任务记录。

## 当前结论

完成内部重构和回归，用户可见行为与业务语义未变；无需更新 FEATURE_INVENTORY、ontology、热区记忆或索引。无已知失败或未决实现问题。
