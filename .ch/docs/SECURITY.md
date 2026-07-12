# 安全与可靠性基线

这个文件合并安全和可靠性的 starter 基线，避免在冷启动阶段维护两份空壳原则文档。

## 通用基线

- 不把秘密信息写进仓库。
- 不把生产配置、客户数据或真实密钥当测试夹具。
- 只在当前任务范围内读写文件；工具风险分级见 `.ch/docs/TOOL_POLICY.md`。
- 所有非平凡改动都应有明确验证计划；测试规则见 `.ch/docs/TESTING.md`。
- 验证优先从最小相关范围开始，再扩展到更广范围。
- 项目知识优先本地化，减少对外部不可控上下文的依赖。

## Loop 内置 Workflow Skill 信任边界

### 静态供应链与加载根

- `media/loop-workflow-skills/` 是随扩展分发的静态快照，不是运行时下载源。生产代码只从 `context.extensionUri.fsPath` 下的固定 `LOBSTER_SKILL_PACK_RELATIVE_PATH="media/loop-workflow-skills"` 读取；不会扫描 cwd、workspace、用户 Home、外部源、仓库 `.agents/skills`、workspace scaffold 或官方 Skills 安装目录。
- `manifest.json` 只接受 `schemaVersion=1` 和精确键集合：顶层 `schemaVersion/source/files/skills`；`source` 为 `name/url/version/license/snapshotSha256`；`files[]` 为 `path/bytes/sha256`；`skills[]` 为 `id/name/description/path/bytes/sha256/supportFiles/developmentOnly/phases/taskKinds/roles/requiredCapabilities/priority/positiveTriggers/negativeTriggers`。缺字段、未知字段、重复 ID/路径、未知 schema、入口与 `files[]` 不一致或 supportFiles 未索引都会使整包不可用。
- `files[].path`、`skills[].path` 和 supportFiles 必须是规范化的相对 POSIX Markdown 路径；拒绝绝对路径、反斜杠、drive/UNC、NUL、`.`、`..`、隐藏路径段和非 `.md` 文件。loader 对扩展根、pack 根和最终资源执行 `realpath` containment，并对每个路径段执行 `lstat`；符号链接、目录/普通文件类型不符、特殊文件、缺失文件或逃逸到根目录外均失败。
- 完整性校验同时检查规范化 inventory 的 `snapshotSha256`、每个文件的 `bytes` 和 SHA-256。manifest 最大 1 MiB，单个资源最大 64 KiB，manifest 声明的 pack payload 总量最大 1 MiB；资源必须是严格 UTF-8 且不含 NUL，入口 Markdown 还必须通过 frontmatter、控制字符和保留 delimiter 清洗。
- prompt 预算由宿主代码强制：catalog 最多 32 项、description 最多 240 个 JavaScript 字符单元、catalog 最多 12,000 个字符单元；每子任务最多 3 个 ID、单篇正文最多 24,000 个字符单元、总正文最多 32,000 个字符单元。超限整项/整篇及其后续项跳过，不在规则中间截断；supportFiles 只验证完整性，不自动拼入 prompt。

### 模型与运行时边界

- 模型输出、manifest 路径、Markdown 正文和 Skill 自报能力一律按不可信输入处理；提示词中的“不得越权”不是安全边界，真正的边界是严格 loader、ID-only 决策归一化和 `applyLobsterMainDecisionForRun` 中央复核。
- 主模型只能请求稳定 `skillIds`。路径、hash、bytes、正文和 `skillGuidance` 只能由宿主从已校验快照生成；模型伪造的这些字段以及 CLI、model、command 和未知字段不会进入 Store。capability 只由宿主声明，当前普通子任务固定为空集合，模型或 Markdown 自报无效。
- Skill 选择器不得改写 CLI/model、`writeFiles`、`conflictGroup`、并发计划或任务授权。主模型提出的 `writeFiles` 仍是既有、需要归一化的不可信调度输入，不是 capability 或额外权限证明；Skill 正文不能追加文件范围，也不能把自身声明提升为宿主权限。
- 宿主只持久化中央校验后的 `skillIds/skillGuidance` 快照。正文唯一消费点是子任务 `modelPrompt`；它不进入 display prompt、Webview HTML、日志，也不作为 shell 命令、可执行路径、文件路径或 JSON key。诊断日志只包含 `code` 和可选 `skillId/resourcePath`。
- 自动 retry 复用 Store 中的原快照，不重新加载资源或重新选择，避免扩展资源变化导致同一子任务行为漂移。

### 安全降级与产品边界

- `non_development`、unknown 和 legacy 任务在加载前关闭该能力；资源、schema、路径、hash、bytes、UTF-8、NUL、门禁或预算任一失败，以及没有合法 ID 时，均返回无 catalog、无正文的原 Loop 行为，不进入 `needs-review`，不累计主任务 AI 失败。
- 降级时绝不扫描 Home、workspace、cwd、外部上游或官方 Skills 目录作为替代源，避免把用户可修改内容提升为扩展内置执行要求。
- 首版没有 UI、i18n 或用户配置开关，也没有运行时联网同步；未来若开放 capability、额外资源源或用户配置，必须重新定义可信来源、权限和测试，不能把规划中的能力写成当前安全边界。

## 真实项目需要补齐

- 输入边界校验与输出脱敏
- 权限模型和角色矩阵
- 关键变更的审计日志
- 秘密管理与环境隔离
- 第三方依赖治理与升级策略
- 本地可启动、可复现、可观察
- 健康检查、就绪检查、关键依赖探活
- 关键路径自动化验证
- 日志、指标、链路的统一入口
- 安全事件、发布回滚和故障排查 runbook

## 对代理尤其重要

- 不基于猜测构造安全关键逻辑。
- 不绕过权限边界临时“先跑通”。
- 不把环境或历史失败伪装成通过验证。
- 失败时先保留证据，再按 `.ch/docs/TESTING.md` 的分流规则处理。

## 与 harness 的关系

安全和可靠性不是后置审查动作，而是仓库结构、配置、命令规则、文档习惯共同形成的约束系统。
