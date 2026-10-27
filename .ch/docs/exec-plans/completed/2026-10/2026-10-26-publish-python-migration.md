# VS Code 插件发布脚本 Python 迁移

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次会话
- handoff_to：

## 背景

当前市场发布与 VSIX 导出依赖 Bash、unzip 和 Unix 权限，无法在 Windows 直接执行。用户要求提供可在当前 Windows 环境运行的 Python 发布入口。

## 目标

将发布和实际导出流程迁移到 Python，保留鉴权、平台定向、pnpm 兼容、VSIX 审计和失败中止行为。

## 范围

- 新增 Python 发布与导出入口，移除旧 Bash 入口。
- 将发布集成测试迁移到 Python，并更新现有打包规则测试。
- 同步运行手册、功能清单、测试入口与 ontology 事实来源。

## 非目标

- 不执行真实市场发布，不自动升级版本或覆盖市场版本。
- 不修改插件运行时能力、CLI 配置或 VSIX 平台支持范围。

## 验收标准

- [completed] Windows 使用 python publish_vscode_extension.py 完成鉴权、导出审计与发布串联。
- [completed] 导出仅依赖 Python 标准库、Node.js/npm 和项目 vsce，不再要求 Bash/unzip。
- [completed] 模拟发布测试覆盖令牌、缓存、失败中止、平台包和 Windows .cmd 调用。
- [completed] Python 测试、相关 Node 测试、npm run build 和真实 Windows VSIX 导出通过。

## 影响面

- 代码目录：根目录发布/导出脚本、scripts/tests/、src/test/shared/。
- 文档目录：本地开发手册、测试手册、功能清单、ontology、相关 runbook。
- 配置与脚本：.vscodeignore、scaffold .vscodeignore。

## 风险与缓解

- 风险：Windows .cmd 参数、路径含空格及 pnpm 临时目录打包行为回归。
- 缓解：复用现有 Windows 进程调用器；保留原依赖布局策略，以模拟测试和真实通用导出验证。

## 验证计划

- 最小相关验证：Python 编译、发布与导出帮助、无效参数。
- 单元自测命令：python3 -m unittest discover -s scripts/tests -p test_*.py -v。
- 扩展验证：npm run build、相关 Node 测试、当前 Windows 真实导出与 ZIP 审计，不上传市场。

## 测试与清单同步

- 单元测试新增/更新：新增 Python 发布集成测试，迁移导出脚本测试。
- 单元自测结果：Python 23/23、Node 打包规则 13/13 通过；npm run build 通过；真实通用导出通过，1398 条目、31499472 字节。
- 失败处理记录：修复 Windows .cmd 捕获输出和 prepublish 清理 dist 导致产物消失；当前未跟踪 lockfile 曾解析 SDK 0.2.141 导致旧入口缺失，按现有代码兼容版本以 npm --no-save --package-lock=false 安装 0.2.12 后真实导出通过，未修改 manifest/lockfile。
- 功能清单：同步 Python 操作入口，不改变发布权限与顺序。
- 相关文档同步：已更新运行手册、测试手册、功能清单、PITFALLS 和 ontology；validate 通过。

## 任务列表

Tasklist:
- [completed] 检查现有 Bash 发布流程与仓库入口
- [completed] 梳理 Windows 下的打包、凭据和 vsce 调用方式
- [completed] 实现 Python 发布与导出流程、迁移回归测试
- [completed] 更新 Windows 使用文档和事实来源
- [completed] 验证脚本参数、错误处理、VSIX 审计和项目构建

## 决策记录

- 2026-10-26：发布实际调用 Python 导出脚本，避免 Windows 仍需 Bash；ZIP 清单使用 Python 标准库读取。

## 当前结论

已完成 Python 发布与导出迁移，未执行真实市场发布。Windows 运行 python publish_vscode_extension.py 即可在登录后发布。
