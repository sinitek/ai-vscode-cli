# Windows Loop 隔离与 CLI 发现加固

- 日期：2026-09-20
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-20
- claim_ttl：本会话

## 背景

2026-09-15 已修复 `~/.codex` 字面路径、官方 Codex bin 发现和 Windows 配置原子写。剩余高风险点是 Loop 子任务临时根仍对顶层文件做 Windows 文件符号链接（默认 EPERM），以及临时目录 / OpenCode overlay 在文件占用时 `rmSync` 抛错。

## 目标

让 Loop 子任务隔离根和临时文件清理在未开启 Developer Mode 的 Windows 上可用，并补齐常见 CLI 安装目录发现与 `CODEX_HOME` 规则路径。

## 范围

- Loop 子任务执行根：目录 junction、文件 hardlink、跨盘回退、best-effort 删除
- OpenCode runtime overlay 清理
- Windows 额外 CLI 发现目录
- 全局规则路径走 `resolveCodexHomeDir` / Claude / OpenCode home
- 相关单测、功能清单、运行手册

## 非目标

- 不宣称真实 Windows E2E 已跑
- 不改 Graph worktree 默认执行模式
- 不解决 Codex 上游 `\\?\` 长路径 / 项目信任 TOML key 差异
- 不改 Windows `taskkill /F` 的停止语义

## 验收标准

- [x] 带顶层 `package.json` 的工作区可创建 Loop 临时根，写入回写到真实文件
- [x] Windows 文件链接失败时给出可读错误，而不是裸 `EPERM`
- [x] 临时根 / overlay 删除失败不把成功任务打成失败
- [x] Windows 能发现 `%USERPROFILE%\.local\bin` 与 scoop shims
- [x] 全局 Codex 规则路径尊重 `CODEX_HOME`
- [x] 相关单测通过，`npm run build` 通过

## 影响面

- 代码目录：`src/loopSubtaskExecutionRoot.ts`、`src/shared/`、`src/cli/`、`src/config/`、`src/extension.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/runbooks/`、`ARCHITECTURE.md`
- 配置与脚本：无新依赖

## 风险与缓解

- 风险：hardlink 跨盘失败
- 缓解：临时根放到与工作区同卷，失败再尝试文件 symlink
- 风险：`rmSync` 跟随 junction 误删工作区
- 缓解：只删除临时根自身；junction/hardlink 作为目录项移除，不递归进目标

## 验证计划

- 最小相关验证：Loop 执行根、fs cleanup、command resolution、OpenCode overlay
- 单元自测命令：`npm run build` 后跑相关 `node --test dist/test/...`
- 扩展验证：本机无 Windows 宿主，不宣称真实 Windows E2E

## 测试与清单同步

- 单元测试新增/更新：`src/test/loop/loopSubtaskExecutionRoot.test.ts`、`src/test/shared/fsCleanup.test.ts`、`src/test/cli/commandResolution.test.ts`、`src/test/cli/opencoderuntimeconfig.test.ts`
- 单元自测结果：`npm run build` 通过；相关 26 个单测通过
- 失败处理记录：无
- 功能清单：已更新 Loop 隔离与 Windows CLI 发现边界
- 相关文档同步：capabilities、cli-runtime-reference、PITFALLS、ARCHITECTURE

## 任务列表

- [x] 共享 best-effort 删除
- [x] Loop 执行根 Windows 链接
- [x] overlay / 规则路径 / CLI 发现
- [x] 单测与文档
- [x] 构建验证并归档计划

## 决策记录

- 2026-09-20：Windows 顶层文件优先 NTFS hardlink，避免依赖 Developer Mode；不使用 copy，以免写入无法回写。

## 当前结论

Windows Loop 子任务改为 junction + hardlink，临时目录和 OpenCode overlay 删除改为 best-effort；Windows CLI 发现补充 `.local\bin` / scoop / Volta / WinGet。本机无 Windows 宿主，不宣称真实 Windows E2E。
