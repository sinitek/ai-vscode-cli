# Windows Loop 隔离与 CLI 发现加固 — 既有缺陷修复

- 日期：2026-09-20
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-20
- claim_ttl：本会话
- 类型：bugfix
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-20-windows-loop-cli-compat.md`

## 本类型目标

修复既有Windows Loop隔离根文件symlink EPERM、占用时rmSync导致任务失败，补齐常见CLI发现和CODEX_HOME规则路径；保留原停止/长路径边界。

## 范围与所有权

- 修复既有Windows Loop隔离根文件symlink EPERM、占用时rmSync导致任务失败，补齐常见CLI发现和CODEX_HOME规则路径；保留原停止/长路径边界。
- 本记录只承担 既有缺陷修复；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 修复既有Windows Loop隔离根文件symlink EPERM、占用时rmSync导致任务失败，补齐常见CLI发现和CODEX_HOME规则路径；保留原停止/长路径边界。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本类型范围核对原实现/治理结果与兼容边界；历史构建、测试或失败证据由[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)保管（没有测试开发时保留本类型原验证记录），迁移不产生新的产品通过声明。

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [2026-09-20-docs-windows-loop-cli-compat.md](2026-09-20-docs-windows-loop-cli-compat.md)：文档交付及证据；各自保持历史状态，不由关联关系推定通过。

## 本类型历史记录

### 背景

2026-09-15 已修复 `~/.codex` 字面路径、官方 Codex bin 发现和 Windows 配置原子写。剩余高风险点是 Loop 子任务临时根仍对顶层文件做 Windows 文件符号链接（默认 EPERM），以及临时目录 / OpenCode overlay 在文件占用时 `rmSync` 抛错。

### 目标

让 Loop 子任务隔离根和临时文件清理在未开启 Developer Mode 的 Windows 上可用，并补齐常见 CLI 安装目录发现与 `CODEX_HOME` 规则路径。

### 范围

- Loop 子任务执行根：目录 junction、文件 hardlink、跨盘回退、best-effort 删除
- OpenCode runtime overlay 清理
- Windows 额外 CLI 发现目录
- 全局规则路径走 `resolveCodexHomeDir` / Claude / OpenCode home
- 相关单测、功能清单、运行手册

### 非目标

- 不宣称真实 Windows E2E 已跑
- 不解决 Codex 上游 `\\?\` 长路径 / 项目信任 TOML key 差异
- 不改 Windows `taskkill /F` 的停止语义

### 验收标准

- [x] 带顶层 `package.json` 的工作区可创建 Loop 临时根，写入回写到真实文件
- [x] Windows 文件链接失败时给出可读错误，而不是裸 `EPERM`
- [x] 临时根 / overlay 删除失败不把成功任务打成失败
- [x] Windows 能发现 `%USERPROFILE%\.local\bin` 与 scoop shims
- [x] 全局 Codex 规则路径尊重 `CODEX_HOME`
- [x] 相关单测通过，`npm run build` 通过

### 影响面

- 代码目录：`src/loopSubtaskExecutionRoot.ts`、`src/shared/`、`src/cli/`、`src/config/`、`src/extension.ts`、`src/i18n.ts`
- 配置与脚本：无新依赖

### 风险与缓解

- 风险：hardlink 跨盘失败
- 缓解：临时根放到与工作区同卷，失败再尝试文件 symlink
- 风险：`rmSync` 跟随 junction 误删工作区
- 缓解：只删除临时根自身；junction/hardlink 作为目录项移除，不递归进目标

### 任务列表

- [x] 共享 best-effort 删除
- [x] Loop 执行根 Windows 链接
- [x] overlay / 规则路径 / CLI 发现

### 决策记录

- 2026-09-20：Windows 顶层文件优先 NTFS hardlink，避免依赖 Developer Mode；不使用 copy，以免写入无法回写。

### 当前结论

Windows Loop 子任务改为 junction + hardlink，临时目录和 OpenCode overlay 删除改为 best-effort；Windows CLI 发现补充 `.local\bin` / scoop / Volta / WinGet。本机无 Windows 宿主，不宣称真实 Windows E2E。

## 分类依据与真实状态

bugfix（原feature改判）：来源明确承接9/15已修复的Windows实际使用问题，剩余文件链接EPERM及占用删除抛错是既有Loop缺陷；兼容发现补齐同一修复范围。test：四组回归更新；docs：运行边界实际更新。26项通过与无Windows宿主未跑E2E保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
