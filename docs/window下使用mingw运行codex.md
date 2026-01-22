# windows 下使用 mingw 运行 codex

## 背景

codex 对应 windows 兼容度不好，在执行过程中会发现一些脚本错误，因此希望能在 mingw 下执行 codex,减少错误

## 待澄清（每轮对话持续更新）

1) 影响范围：仅 codex 走 mingw，还是也允许 claude/gemini 未来复用？
   - 选项 A：仅 codex（最小改动）
   - 选项 B：做成通用“Windows 下用 bash 包一层”的能力（可扩展，但配置/测试更多）

2) 默认开关：Windows 下是否默认启用？
   - 选项 A：默认 true（即装即用，失败时自动降级）
   - 选项 B：默认 false（更保守，用户明确开启）

3) 自动探测失败时的行为：
   - 选项 A：降级为直接 spawn codex，并在面板提示“未找到 bash，已降级”（推荐）
   - 选项 B：直接报错中断，并提示用户配置 bash 路径

4) bash 来源与优先级（Windows 上常见有 Git for Windows / MSYS2）：
   - 选项 A：优先使用用户配置的 bashPath；未配置则自动探测
   - 选项 B：只做自动探测（不提供手动覆盖）

5) 终端运行（命令面板触发的 `runCli`）是否也要走 mingw？
   - 选项 A：是（行为一致，但 PowerShell/引号兼容要额外处理）
   - 选项 B：否，仅面板流式执行（`runCliStream`）走 mingw（实现更稳，推荐）

6) 你当前 Windows 环境里可用的 bash 来自哪里？
   - 选项 A：Git for Windows（例如 `C:\\Program Files\\Git\\bin\\bash.exe`）
   - 选项 B：MSYS2（例如 `C:\\msys64\\usr\\bin\\bash.exe`）
   - 选项 C：两者都有（需要明确优先级）
   - 选项 D：不确定（需要你贴 `where git` / `where bash` 的结果）

7) 现有问题的具体报错/症状是什么？（用于验收标准）
   - 选项 A：codex 在 PowerShell 直接运行报错，但在 Git Bash/MSYS2 bash 下正常
   - 选项 B：codex 在 VS Code 插件面板里运行报错，但在系统终端正常
   - 选项 C：两边都报错（可能是安装/权限/网络问题，不一定能靠 bash 解决）

8) 自动探测时是否需要显式排除 WSL 的 `bash.exe`？
   - 背景：Windows 可能存在 `C:\\Windows\\System32\\bash.exe`（会拉起 WSL），这通常不是我们要的 mingw/msys bash。
   - 选项 A：排除（推荐：优先 Git for Windows / MSYS2 的 bash）
   - 选项 B：不排除（实现简单，但可能误用 WSL）

## 已确认方案（2026-01-19）

- 范围：仅 codex（1A）
- 默认开关：Windows 默认启用（2A）
- 失败策略：探测失败时降级为直接 spawn codex，并在面板 trace 里提示一次（3A）
- 可配置：提供 bashPath 手动覆盖（4A）
- 生效位置：仅面板流式执行 `runCliStream` 走 bash；命令面板触发的 `runCli` 不改（5B）
- bash 来源：Git for Windows（6A）
- 现象：codex 在 PowerShell 直接运行报错，但在 Git Bash / bash 下正常（7A）
- WSL bash：不排除（8B）；但实现上会优先选 Git for Windows/MSYS2 的 bash，只有在找不到时才可能落到 WSL bash

## 设计

### 1. 添加配置

是否 Windows 下自动启用 bash(mingw/msys) 运行 codex

boolean 类型,默认为 true

建议补充配置项（便于兜底）：

- `sinitek-cli-tools.windows.codex.useBash`：boolean，默认 true（仅 Windows 生效）
- `sinitek-cli-tools.windows.codex.bashPath`：string，可选；手动指定 `bash.exe` 绝对路径

### 2. 插件启动或首次运行时探测 bash.exe 位置（仅 Windows）

探测优先级建议：

1) 若用户配置了 `bashPath` 且文件存在，直接使用
2) 否则尝试根据 `git.exe` 推导（兼容 Git for Windows / MSYS2）
3) 若仍失败：按“待澄清-3”选择降级或报错

- 当前是否为 windows 系统，如果否则跳过，否则执行下一步
- 查找 `git.exe` 路径（等价于 PowerShell `where git`）
  
  根据返回值尝试候选 bash 路径（按顺序检查文件是否存在）：
  - 若为 `\\xxx\\cmd\\git.exe`（Git for Windows 常见）
    - `\\xxx\\bin\\bash.exe`（常见）
    - `\\xxx\\usr\\bin\\bash.exe`（备选）

  - 若为 `\\xxx\\mingw64\\bin\\git.exe`（MSYS2 mingw64 常见）
    - `\\xxx\\usr\\bin\\bash.exe`（常见）
    - `\\xxx\\mingw64\\bin\\bash.exe`（若用户环境确实放在这里）

  - 若为 `\\xxx\\usr\\bin\\git.exe`（MSYS2/MSYS 环境常见）
    - `\\xxx\\bash.exe`

### 3. 执行策略

- 仅当 `cli === "codex"` 且 `process.platform === "win32"` 且 `useBash === true` 时生效
- 实现方式：spawn `bash.exe -lc "<codex command + args>"`，保证 codex 运行在 bash 环境下
- 需要注意参数转义：把 codex 的 command/args 全部做 POSIX 单引号转义后拼成一条命令字符串传给 `-lc`

### 4. 观测与提示

- 面板日志/trace 中打印：最终是否使用 bash、bash 路径、原始 codex 命令解析来源（便于排障）
- 若降级：在面板提示一次（避免刷屏）
