# Codex 启动链路加固实施

- 日期：2026-04-23
- 状态：completed
- 负责人：Codex

## 背景

已完成当前插件与目标系统 `/Users/fangjiawei/work/cli_mcp/apps` 的 Codex 启动链路对比。当前插件的高风险点集中在：macOS 下 shell 包装启动、`detached` 进程组、未显式固定 `CODEX_HOME`、未预置 project trust，以及使用 `killProcessTree()` 的粗暴关闭。

## 目标

在不做无关大改的前提下，对当前插件的 Codex 交互式运行链路做最小加固：

1. 优先直接启动 Codex 可执行文件，避免 macOS `zsh -lc` 包装；
2. 显式构造 Codex 子进程环境，固定 `CODEX_HOME` / `CODEX_HOME_DIR` 并清理高噪音环境变量；
3. 启动前确保 workspace trust；
4. 将收尾逻辑改为优雅关闭优先，降低长任务被粗暴打断的概率；
5. 补充最小生命周期日志，便于后续排障。

## 范围

- `src/interactive/codexRunner.ts`
- 可能新增与 Codex trust / home 相关的小型辅助模块
- 对应文档同步

## 非目标

- 本轮不重构整个 interactive 框架
- 本轮不扩展到 Claude / Gemini
- 本轮不引入完整的 raw stream logger 体系
- 本轮不处理与本次问题无关的现有未提交改动

## 验收标准

- [x] Codex runner 优先直接 `spawn` 已解析的可执行路径
- [x] 子进程环境显式注入 `CODEX_HOME` / `CODEX_HOME_DIR`
- [x] 启动前会为当前工作区写入/确保 trust 配置
- [x] 正常结束与异常结束都优先走 graceful shutdown
- [x] `npm run build` 通过

## 影响面

- 代码目录：`src/interactive/`
- 文档目录：`.ch/docs/exec-plans/`、`.ch/docs/runbooks/`、必要时 `.ch/docs/product-specs/`
- 配置与脚本：读写用户本地 Codex config（`~/.codex/config.toml` 或 `CODEX_HOME`）

## 风险与缓解

- 风险：直接去掉 shell 包装后，少数 GUI 启动场景下 PATH 解析可能不如此前宽松
- 缓解：优先使用 `resolveCliCommand()` 解析绝对路径；仅在确实找不到时再回退 shell 模式
- 风险：写 trust 配置可能影响用户本地 Codex 配置文件
- 缓解：仅追加/更新单个项目节，保持最小改动，使用原子写入

## 验证计划

- 最小相关验证：TypeScript 编译通过；静态检查启动参数、环境变量、关闭逻辑
- 扩展验证：如可稳定复现，再进行长任务手工验证

## 测试与清单同步

- 单元测试：当前仓库无对应测试基建，本轮先不新增
- 功能清单：如涉及启动行为说明变化，补充事实来源文档
- 相关文档同步：记录本实施计划与避坑项，必要时补充能力规格

## 任务列表

- [x] 建立实施计划与范围
- [x] 实现直接启动与环境隔离
- [x] 实现 trust 与 graceful shutdown
- [x] 同步文档说明
- [x] 构建验证并收尾

## 决策记录

- 2026-04-23：优先做最小高收益改动，不把目标系统整套日志框架整体搬入插件。
- 2026-04-23：保留 macOS shell fallback，但仅在命令无法直接解析时使用；主路径改为优先直接 `spawn` 已解析 CLI。

## 当前结论

已完成第一轮 Codex runner 启动加固：

- `src/interactive/codexRunner.ts` 现在优先直接启动已解析的 Codex CLI，并关闭默认 `detached`。
- 新增 `src/interactive/codexRuntimeConfig.ts`，统一处理 `CODEX_HOME` / `CODEX_HOME_DIR`、project trust 与 trust override。
- 回合结束与异常中止改为优先走渐进式关闭，降低 flush 边界被粗暴打断的概率。
- 已同步更新运行时事实来源、设计文档、能力规格和避坑指南。

### 已验证什么

- `npm run build` 通过。
- TypeScript 编译已覆盖新增 helper 与 `codexRunner` 改动。

### 还没验证什么

- 尚未在 VS Code Extension Host 中跑一次真实长任务做手工回归。
- 尚未验证 macOS shell fallback 分支的极端收尾行为；该分支仅在命令无法直接解析时触发。
