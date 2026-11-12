# 将 VS Code Python 脚本统一迁入 scripts — 维护/构建/发布治理

- 日期：2026-10-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-27
- claim_ttl：本轮任务
- handoff_to：
- 类型：chore

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-27-move-vscode-python-scripts.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-27-docs-move-vscode-python-scripts.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

将四个 VS Code Python 脚本统一到 scripts，清除重复入口。仅承担维护/构建/发布治理；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的维护/构建/发布治理；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-27-chore-move-vscode-python-scripts.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- 导出、发布及跨平台辅助脚本已复制到 `scripts/`，但根目录仍保留重复入口，调用方、测试和开发手册也有未迁完的路径。

## 目标

- 统一以 `scripts/` 为这四个 Python 脚本的唯一位置，并确保直接执行、相互导入、开发启动、打包发布、测试。

## 范围

- `scripts/export_vscode_extension.py`、`scripts/publish_vscode_extension.py`、`scripts/vscode_extension_process.py`、`scripts/vscode_extension_win.py`。

## 非目标

- 不改 VSIX 内容策略、市场发布行为或用户可见功能。

- 不执行真实 VS Code 市场发布。

- 不重写历史执行记录中的旧命令。

## 验收标准

- [x] 四个入口仅存在于 `scripts/`，根目录不留重复脚本。

- [x] 从仓库外通过绝对路径执行导出/发布入口时可正常加载项目模块。

- [x] 开发启动器及 Python 回归测试能导入迁移后的辅助模块。

- [x] Python 回归测试、`npm run build` 与差异检查通过。

## 影响面

- 代码目录：仓库根目录、`scripts/`、`scripts/tests/`

- 配置与脚本：`.vscodeignore`、`media/workspace-scaffold/.vscodeignore`

## 风险与缓解

- 风险：脚本移动后 Python 的 `sys.path` 不再包含仓库根目录，导致从其他工作目录启动失败。

- 缓解：入口通过脚本位置推导仓库根目录；用仓库外绝对路径启动测试覆盖。

## 验证计划

- 最小相关验证：运行 `scripts/tests/` 中三个脚本回归测试。

- 单元自测命令：`python3 -m unittest discover -s scripts/tests -p 'test_*vscode_extension*.py' -v`。

## 测试与清单同步

- 确认发布入口可从仓库外加载。

- 单元自测结果：`python3 -m unittest discover -s scripts/tests -p 'test_*vscode_extension*.py' -v` 通过（21 项）；`python3 -m unittest discover -s scripts/tests -p 'test_run_dev.py' -v` 通过（10 项，真实 Windows `.cmd` 测试在 macOS 跳过）。

- 失败处理记录：VSIX 审计正则原先只匹配 `scripts/` 目录本身，不能匹配子文件；改为覆盖整个子树并由 Python/TypeScript 回归验证。打包集成测试旧路径及 macOS 缺少 `python` 命令的问题一并改为新脚本路径和跨平台 Python 命令选择。

- 维护既有打包/发布入口路径。

## 任务列表

- [x] 核对现有复制文件及调用关系

- [x] 删除根目录重复脚本并修正引用

- [x] 运行脚本回归、构建和结构校验

## 决策记录

- 2026-10-27：保留 `scripts/` 中已有版本作为唯一实现；历史计划与踩坑记录保留原始命令以维持事件准确性。

## 当前结论

已删除根目录重复入口，`run_dev.py` 和导出入口均能从脚本位置解析仓库根目录。`npm run build` 通过；`node --test dist/test/shared/vsixPackaging.test.js` 14/14 通过；Python 脚本和开发启动器回归通过；Python 编译、Ontology 校验及 `git diff --check` 通过。真实离线 VSIX 导出与审计通过，产物包含 1270 个条目（36.62 MiB）；未执行市场发布。Windows `.cmd` 分支因当前验证环境为 macOS 未实测。
