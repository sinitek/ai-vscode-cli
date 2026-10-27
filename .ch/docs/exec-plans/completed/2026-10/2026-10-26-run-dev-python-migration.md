# run_dev.py 启动脚本迁移

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次会话
- handoff_to：

## 背景

将原 Bash 开发启动流程迁移为 Python，支持 Windows 直接启动，并保留 macOS 的 VS Code 路径解析和开发宿主行为。按用户要求删除 `run_dev.sh`，只保留 Python 开发启动入口。

## 目标

新增跨平台 `run_dev.py`，在 Windows、macOS 和 Linux 上完成依赖安装、构建和开发宿主启动。

## 范围

- 将工作区依赖安装策略从 Bash 函数迁移到 Python。
- 解析跨平台 VS Code `code`/`code.cmd` 入口。
- 保留独立窗口、扩展开发路径、构建和 pnpm/npm 选择行为。
- 同步开发手册与打包忽略规则。

## 非目标

- 不修改插件运行时、CLI 配置或 VS Code 扩展功能。
- 不改变现有依赖安装脚本供导出/发布脚本使用的行为。

## 验收标准

- [completed] `python run_dev.py --help` 在当前 Windows 环境运行成功，脚本支持 macOS/Linux 路径分支。
- [completed] Python 脚本保留依赖安装、`npm run build` 和 `code --new-window --extensionDevelopmentPath=...` 流程。
- [completed] 删除 `run_dev.sh`，文档和当前配置只使用 Python 入口。
- [completed] 文档和忽略规则不再遗漏 Python 入口。

## 影响面

- 代码目录：根目录启动脚本。
- 文档目录：`.ch/docs/runbooks/local-development.md`、相关故障手册和功能清单路径。
- 配置与脚本：`.vscodeignore`、`media/workspace-scaffold/.vscodeignore`、`run_dev.sh`。

## 风险与缓解

- 风险：Windows `.cmd` 命令和 macOS 应用内置 `code` 路径的调用方式不同。
- 缓解：按平台解析命令，Windows 通过 `COMSPEC` 调用 `.cmd`，macOS 保留应用路径优先级并回退到 PATH。

## 验证计划

- 最小相关验证：Python 编译检查、`--help`、静态检查脚本关键参数。
- 单元自测命令：`python3 -m unittest discover -s scripts/tests -p 'test_run_dev.py' -v`；`npm run build` 后运行相关 Node 打包规则测试。
- 扩展验证：在当前 Windows 环境运行 Python 启动入口；macOS 用应用路径优先和 PATH 回退测试核对兼容逻辑。

## 测试与清单同步

- 单元测试新增/更新：`scripts/tests/test_run_dev.py` 覆盖安装策略、失败中止、macOS 入口和真实 Windows `.cmd` 参数；VSIX 忽略规则回归新增 Python 入口。
- 单元自测结果：Python 11/11 通过；`node --test --test-name-pattern 'VSIX excludes developer artifacts' dist/test/shared/vsixPackaging.test.js` 1/1 通过。
- 失败处理记录：首轮 macOS 路径断言在 Windows 上因斜杠规范化失败，属于测试夹具平台假设问题；断言改为使用宿主 `Path` 表示，重跑 11/11 通过。
- 功能清单：开发者启动入口变化，不改变终端用户功能；更新实现路径以保留事实来源。
- 相关文档同步：更新本地开发手册、pnpm 混用故障手册、测试入口和功能清单；当前可执行入口及文档均无 Bash 包装说明。历史完成计划保留当时记录。
- 本机真实验证：当前 Windows 上执行 `python3 run_dev.py`，依次完成 `npm install`（依赖已是最新状态）、`npm run build`（TypeScript 构建通过）、VS Code 调用，退出码 0；最新 `window2/exthost/exthost.log` 可查到开发扩展激活记录。
- 其他校验：`python3 -m py_compile run_dev.py scripts/tests/test_run_dev.py`、`python3 run_dev.py --help`、`git diff --check` 均通过；`Test-Path run_dev.sh` 为 False。
- 未验证范围：当前机器为 Windows，macOS/Linux 无真机启动验证；已覆盖 macOS 应用命令优先、缺失/不可执行时 PATH 回退测试和 Windows 真实 `.cmd` 含空格参数调用。
- Ontology/记忆判断：未改变业务概念、权限或运行时状态机，现有 ontology 无直接指向旧启动脚本的来源路径，无需更新；启动方式已写入 runbook，无需新增热区事件。

## 任务列表

Tasklist:
- [completed] 检查启动脚本和事实来源
- [completed] 实现 Python 启动脚本并删除 Bash 入口
- [completed] 同步文档与忽略规则
- [completed] 完成脚本和插件构建验证

## 决策记录

- 2026-10-26：跨平台逻辑集中到 `run_dev.py`，复用已有 Python 辅助脚本中的命令调用和 Windows VS Code 路径查找；按用户要求删除 Bash 入口。

## 当前结论

已完成 Python 启动迁移和 Bash 入口删除；Windows 实际安装、构建及开发宿主启动通过，脚本回归 11/11 和打包排除回归 1/1 通过。macOS/Linux 启动命令为 `python3 run_dev.py`，保留 macOS 应用路径优先级，无真机验证环境。
