# VSIX 无损瘦身与平台定向导出 — 维护/构建/发布治理

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex
- 类型：chore

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-23-vsix-size-reduction.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-23-bugfix-vsix-required-resources.md); [文档](2026-10-23-docs-vsix-size-reduction.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

裁剪开发产物并支持平台定向 VSIX 导出和依赖审计。仅承担维护/构建/发布治理；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的维护/构建/发布治理；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。chore 平台导出成功依赖 bugfix 修正必需资源清单；原测试曾覆盖裁剪、目标依赖拒绝和资源存在性，仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-23-chore-vsix-size-reduction.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

现有 `sinitek-cli-tools-1.1.3.vsix` 为 38.56 MiB。压缩后 Claude SDK 占 25.35 MiB，当前平台 sharp/libvips 占 7.11 MiB，误入包的 `.tmp` 占 1.49 MiB。Claude SDK 内置 CLI 是 Windows `.cmd` 入口的后备，图片库、WASM 与 ripgrep 都不能作为无用依赖直接删除。

## 范围与非目标

- 清除开发临时文件、构建 source map 与 SDK 类型声明，不修改源码构建方式或本地依赖。

- 默认保留通用包行为，新增显式平台目标，仅排除其他平台资源；目标包单独命名并带 VSIX 平台标记。

- 强化 SDK、目标平台原生依赖、包内资源审计。

- 不升级依赖、不删除 SDK 内置 CLI、不裁剪界面资源、不新增下载或安装运行时依赖。

## 验收标准

- 默认导出仍包含 SDK 已提供的五个平台 ripgrep 和当前安装的原生依赖。

- 定向包保留目标平台的 rg、ripgrep.node、sharp/libvips 与全部通用运行时资源；缺少目标原生依赖时明确失败。

- 默认包不再包含根级 `.tmp`、构建 source map 或 SDK 类型声明。

- 最小回归测试、`npm run build`、通用包与当前平台定向包实测通过，并对比包内文件和体积。

- 同步打包手册、完成后归档计划。

## 影响面与风险

- 脚本与配置：`export_vscode_extension.sh`、`.vscodeignore`、新增平台规则脚本。

- 风险：vsce 的否定规则优先于排除规则，SDK 广泛否定模式会让平台裁剪失效；通过实际 vsce 文件列表验证。

- 风险：跨平台打包缺少对应 sharp 依赖；提前校验并失败，不用宿主平台依赖冒充目标平台资源。

- 回滚：恢复本次脚本和 ignore 改动；不改已安装依赖和业务源码。

## 验证计划

- 最小验证：脚本语法检查、目标规则和缺失资源单元测试。

- 真实验证：运行通用导出与 `--target current` 导出，检查 VSIX manifest、解包加载依赖、SDK CLI `--version` 和 rg `--version`。

- 对比验证：原始包与瘦身包中保留文件按内容摘要比较，确认只删除明确范围内的开发或其他平台文件。

## 验证结果

| 产物 | 实际字节 | MiB | 相对原包缩减 | 文件数 |

| --- | ---: | ---: | ---: | ---: |

| 原始通用包 | 40,433,715 | 38.56 | — | 1557 |

| 瘦身通用包 | 38,282,330 | 36.51 | 5.32% | 1249 |

| macOS ARM64 平台包 | 20,502,325 | 19.55 | 49.29% | 1240 |

- `npm run build`、`bash -n export_vscode_extension.sh`、`node --check scripts/vsix_target.js` 均通过。

- 相关单测：`node --test dist/test/shared/vsixPackaging.test.js dist/test/interactive/claudeRunner.test.js dist/test/loop/loopCommunicationFilePreview.test.js dist/test/shared/workspaceScaffoldSkillPaths.test.js`，63/63 通过，其中新增打包回归 13 项。

- 全量单测：`node scripts/run_unit_tests.js`，1887 项中 1873 通过、14 失败。原始 HEAD 在仓库外独立副本中复测（仅复用依赖并补齐本机 ignored lockfile）为 1874 项中 1860 通过、同样 14 失败，失败名称集合完全一致，无新增失败。

- 真实导出：`./export_vscode_extension.sh --target current` 与 `./export_vscode_extension.sh` 均通过；`unzip -tq` 两个归档通过。

- SHA-256 对比：通用包删除 308 个开发文件，平台包额外删除 9 个其他平台文件；所有保留的 `dist`、`media`、运行时依赖和 manifest `package.json` 内容与原包逐文件一致，无新增包内文件。仅归档内容类型及平台标记 XML 元数据按预期变化。

- 平台标记：通用包无 `TargetPlatform`，定向包明确为 `darwin-arm64`。

- 解包隔离加载通过：Claude SDK `query`、marked 渲染、Zod、cross-spawn、yauzl、sharp/libvips 与原生 ripgrep binding。

- 真实子进程：解包 SDK `cli.js --version` 返回 `2.1.12 (Claude Code)`，目标 `rg --version` 返回 `ripgrep 14.1.1`。

- 缺依赖失败验证：本机运行 `--target win32-x64` 在构建前明确拒绝缺失的 Windows sharp 依赖；不产出误标平台包，不改变本机依赖。

- Ontology 校验及其 9 项 Python 单测通过；改动文件空白校验、`git diff --check` 通过。

## 历史失败分流与未覆盖边界

- 14 个历史失败集中在 CLI 自动修复/Grok 枚举、Claude 指令隔离断言、Grok 尾部空白和 Webview 指令折叠/规则加载夹具；原始 HEAD 可复现，未扩大修改业务代码。

- 第一次原始 HEAD 副本验证另出现缺 `package-lock.json` 的环境失败：该文件在本机存在但未跟踪，复制本机 lockfile 后回到与当前完全相同的 14 项失败；不是本次功能缺陷。

- Windows/Linux 各 target 的包内规则、所需依赖及失败路径有单元护栏，但本机只真实生成并运行 macOS ARM64；其他系统的真实 Claude 对话与图片操作未实测。

- 未运行浏览器 smoke 或真实模型请求：本次不修改 UI 或会话代码，使用保留资源内容一致性与解包依赖/CLI 验证覆盖打包边界，不声称完成所有终端功能端到端测试。

## 文档与记忆同步

- 已同步本地打包手册、无需更新 `ARCHITECTURE.md`。

- 保持现有依赖版本、本地构建 source map 与源码不变；不提交 lockfile、不修改内置 skills/catalog。

## 当前结论

任务已完成。默认继续输出通用包，通过开发产物排除安全节省约 2.05 MiB；需要更小包时显式使用 target，当前 macOS ARM64 包比原包小约 49.29%。两个实际产物均保留在 `dist/`。本计划归档于 `.ch/docs/exec-plans/completed/2026-10/2026-10-23-chore-vsix-size-reduction.md`。

## 实施中发现与处理

- 首次实打包被嵌套 scaffold Python 缓存拦截：原 `__pycache__/**` 只覆盖根目录，不删除 scaffold 内容。
