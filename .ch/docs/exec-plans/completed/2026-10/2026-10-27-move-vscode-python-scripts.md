# 将 VS Code Python 脚本统一迁入 scripts

- 日期：2026-10-27
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-27
- claim_ttl：本轮任务
- handoff_to：

## 背景

导出、发布及跨平台辅助脚本已复制到 `scripts/`，但根目录仍保留重复入口，调用方、测试和开发手册也有未迁完的路径。

## 目标

统一以 `scripts/` 为这四个 Python 脚本的唯一位置，并确保直接执行、相互导入、开发启动、打包发布、测试及文档路径一致。

## 范围

- `scripts/export_vscode_extension.py`、`scripts/publish_vscode_extension.py`、`scripts/vscode_extension_process.py`、`scripts/vscode_extension_win.py`。
- `run_dev.py`、脚本测试、VSIX 忽略规则、活动开发文档与相关 Ontology 来源路径。

## 非目标

- 不改 VSIX 内容策略、市场发布行为或用户可见功能。
- 不执行真实 VS Code 市场发布。
- 不重写历史执行记录中的旧命令。

## 验收标准

- [x] 四个入口仅存在于 `scripts/`，根目录不留重复脚本。
- [x] 从仓库外通过绝对路径执行导出/发布入口时可正常加载项目模块。
- [x] 开发启动器及 Python 回归测试能导入迁移后的辅助模块。
- [x] 活动文档、忽略规则和 Ontology 来源路径与新位置一致。
- [x] Python 回归测试、`npm run build` 与差异检查通过。

## 影响面

- 代码目录：仓库根目录、`scripts/`、`scripts/tests/`
- 文档目录：`.ch/docs/runbooks/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`、`docs/`
- 配置与脚本：`.vscodeignore`、`media/workspace-scaffold/.vscodeignore`

## 风险与缓解

- 风险：脚本移动后 Python 的 `sys.path` 不再包含仓库根目录，导致从其他工作目录启动失败。
- 缓解：入口通过脚本位置推导仓库根目录；用仓库外绝对路径启动测试覆盖。

## 验证计划

- 最小相关验证：运行 `scripts/tests/` 中三个脚本回归测试。
- 单元自测命令：`python3 -m unittest discover -s scripts/tests -p 'test_*vscode_extension*.py' -v`。
- 扩展验证：`npm run build`、`python3 -m py_compile ...`、Ontology 校验及 `git diff --check`。

## 测试与清单同步

- 单元测试新增/更新：修正迁移位置断言、子进程入口导入路径，并确认发布入口可从仓库外加载。
- 单元自测结果：`python3 -m unittest discover -s scripts/tests -p 'test_*vscode_extension*.py' -v` 通过（21 项）；`python3 -m unittest discover -s scripts/tests -p 'test_run_dev.py' -v` 通过（10 项，真实 Windows `.cmd` 测试在 macOS 跳过）。
- 失败处理记录：VSIX 审计正则原先只匹配 `scripts/` 目录本身，不能匹配子文件；改为覆盖整个子树并由 Python/TypeScript 回归验证。打包集成测试旧路径及 macOS 缺少 `python` 命令的问题一并改为新脚本路径和跨平台 Python 命令选择。
- 功能清单：不涉及用户可见功能；维护既有打包/发布入口路径。
- 相关文档同步：更新开发手册、发布运行手册、忽略规则和 Ontology 来源引用。

## 任务列表

- [x] 核对现有复制文件及调用关系
- [x] 删除根目录重复脚本并修正引用
- [x] 运行脚本回归、构建和结构校验
- [x] 完成文档同步并归档计划

## 决策记录

- 2026-10-27：保留 `scripts/` 中已有版本作为唯一实现；历史计划与踩坑记录保留原始命令以维持事件准确性。

## 当前结论

已删除根目录重复入口，`run_dev.py` 和导出入口均能从脚本位置解析仓库根目录。`npm run build` 通过；`node --test dist/test/shared/vsixPackaging.test.js` 14/14 通过；Python 脚本和开发启动器回归通过；Python 编译、Ontology 校验及 `git diff --check` 通过。真实离线 VSIX 导出与审计通过，产物包含 1270 个条目（36.62 MiB）；未执行市场发布。Windows `.cmd` 分支因当前验证环境为 macOS 未实测。
