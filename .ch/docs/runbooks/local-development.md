# 本地开发与打包手册

本文档吸收了原 `docs/DEBUG.md`、`docs/DEVELOPMENT.md` 以及旧开发手册中仍有效的运行方式，作为当前仓库的本地开发 runbook。

## 适用范围

- 本地开发 VS Code 插件
- 调试 Webview 与 Extension Host
- 打包导出 VSIX

## 日常开发命令

### 1. 安装依赖

```bash
npm install
```

### 2. 构建插件

```bash
npm run build
```

### 3. 开发期持续编译

```bash
npm run watch
```

### 4. 同步内置官方 Skills 快照

```bash
npm run sync:official-skills
```

默认会刷新 Claude / Codex 的内置官方 Skills 归档，并输出 OpenCode 空平台占位。Gemini 已从当前配置中心支持范围移除，仓库不再保留 Gemini 官方 extensions 的 ZIP 快照或同步参数。

如需审计历史 Gemini catalog 与快照变更，只查 Git 历史，不要恢复 `media/official-skills/gemini`，也不要放回当前 VSIX。

> 说明：当前同步脚本只接受 Claude、Codex、OpenCode；历史 Gemini 资料不属于当前 catalog、打包资源或可执行维护路径。

### 5. 验证 Loop 子任务规则隔离

Loop 主任务保持真实工作区和项目规则。Loop 子任务必须从临时隔离根执行，根 `AGENTS.md`、`CLAUDE.md` 和项目 Skills 目录不得暴露给子 CLI。修改该边界后执行：

```bash
npm run build
node --test \
  dist/test/loop/loopSubtaskExecutionRoot.test.js \
  dist/test/cli/opencodeCommandRunner.test.js \
  dist/test/loop/loopPromptBuilders.test.js \
  dist/test/loop/loopPromptQueue.test.js \
  dist/test/loop/loopMainFailure.test.js \
  dist/test/loop/loopSubtaskThinking.test.js
```

#### DSH Loop+ 真实会话续接验证

已有可用的本机 DSH、激活档案和凭据后，构建并显式启用真实测试（会向当前配置的模型服务发送两个子任务请求，可能产生费用）：

```bash
npm run build
SINITEK_DSH_LOOP_LIVE=1 node --test dist/test/extensionHost/dshLoopSessionResumeLive.test.js
```

PowerShell 先设置 `$env:SINITEK_DSH_LOOP_LIVE='1'`，再运行相同 `node --test` 命令；结束后用 `Remove-Item Env:SINITEK_DSH_LOOP_LIVE` 取消。可选 `SINITEK_DSH_COMMAND` 指向要测试的 DSH 可执行文件。未显式开启时这些测试默认跳过。

测试只读取本机激活的 `active-profile.json` 和 `active-patch.yaml`，凭据仅注入新 DSH 子进程环境；会话、文件和 HOME 全部使用独立临时目录并在测试后清理，不改用户配置或已有会话。第一项真实协议测试确认换 cwd 拒绝、原 cwd 恢复；第二项用生产 Loop+ 调度适配器和 DSH 执行策略，以脚本主模型触发失败验收，再销毁原进程，让真实 DSH 续接并凭上一轮仅在上下文中提供的校验码修复文件。输出只记录断言结果，不输出配置、凭据或模型正文。图形 Extension Development Host 点击和真实主模型决策不在此用例范围内。

#### Loop+/Codex 一键修复检测（macOS / Windows）

前置条件：安装项目要求的 Node.js/npm、git、Codex，并已在仓库安装依赖。macOS 终端、Windows PowerShell 和 CMD 使用同一命令：

```text
npm run verify:loop-plus
```

根目录另提供 Python 3.9+ 入口，复用同一检测流程，不额外安装依赖或改变验收范围：

```text
macOS：python3 verify_mac.py
Windows：python verify_win.py
```

参数直接透传，例如 `python3 verify_mac.py --codex "/opt/local CLI/bin/codex" --runs 3 --report "/tmp/loop-fix.json"`；Windows 使用 `python verify_win.py --codex "C:\Program Files\Codex\codex.cmd" --report "C:\Temp\loop-fix.json"`。`--help` 查看同一份参数说明，不开始检测。入口按自身位置定位仓库，不依赖当前目录；保留检测退出码，中断返回 130，找不到 Node 或脚本时返回 1。它们不是独立安装包，仍需完整仓库、Node/npm、git、Codex 与已安装的项目依赖。

也可双击 `scripts/verify_loop_plus_fix.command`（macOS）或 `scripts/verify_loop_plus_fix.cmd`（Windows）。启动器不依赖当前工作目录，转发参数并保留检测退出码；Windows 无参数双击时暂停供查看结果。macOS 如未保留可执行权限，使用 `bash scripts/verify_loop_plus_fix.command`。需要显式原生入口时运行 `node scripts/verify_loop_plus_fix.js --live`；`--help` 不构建、不启动 Codex。

默认三轮约需 3–5 分钟，包含原 pool 默认约 60 秒卸载等待，不以开启零延迟或减少轮次规避旧故障。自动顺序执行：

1. 构建当前源码，定位实际 Codex 可执行文件并记录版本、平台、架构、源码版本、commit 和 dirty。
2. 执行必要回归集：同 session 并发所有权、迟到回调、完成摘要轮次边界、面板状态恢复、正常关闭与失败保留 Tab、原会话交接及检测脚本自身。
3. 重复真实写锁冲突 → 原 thread 交接 → 同进程另一 thread 保留 → 完整清理。
4. 通过公共 runner 和实际版本能力探测，检查真实释放先于恢复、另一 thread 继续运行、探测/运行子进程退出、stdio 关闭和临时目录删除。能力未知不强行启用 `thread_unload_delay_secs=0`。

检测不调用真实模型、不读写真实任务/会话、不自动安装或重载扩展、不发布。默认用插件相同的命令解析规则解析 `codex`，**不读取激活档案中的自定义命令**；有自定义配置时应显式传入插件实际使用的路径。`--codex` 优先于 `CODEX_COMMAND`，两者均未指定时才解析默认命令。版本检查及全部原生阶段固定使用同一路径。带空格路径必须加引号，例如：

```text
npm run verify:loop-plus -- --codex "C:\Program Files\Codex\codex.cmd" --report "C:\Temp\loop-fix.json"
npm run verify:loop-plus -- --codex "/opt/local CLI/bin/codex" --report "/tmp/loop-fix.json"
```

以上是路径格式示例，使用前替换为真实路径；`--codex` 只接受可执行文件路径，不接受带配置参数的整段命令。可用 `--runs 1` 做快速诊断（允许 1–20）；报告记录实际轮数，单轮通过不能替代默认三轮验收。

默认报告位于系统临时目录，终端输出具体位置。`--report <文件.json>` 同时生成同名 `.log` 阶段日志与 `.runner.json` 公共 runner 详细协议报告；已有任一文件时拒绝启动，避免覆盖证据。失败发生在公共 runner 前时没有该阶段报告，不伪造通过。报告保留失败阶段、退出码、监督/清理证据、单测统计和每轮结果。

- **退出 1 / `passed=false`**：任一步失败、单测跳过/取消/TODO、缺失或不一致的协议证据、非正常退出、输出未完成或清理未确认。不能只凭某条 `handoff_verified` 或退出码 0 判定成功。查看报告和日志，不要静默换另一版本的 Codex 让结果变绿。
- **退出 0 / `passed=true`**：只代表该报告所列平台、源码和 Codex 版本的必要回归与隔离运行时通过。`fullyVerified=false` 与 `notCovered` 始终保留：本入口没有验证已安装扩展、真实 VS Code 多窗口/成功自动关闭 Tab、真实模型完整任务、其它平台、其它 CLI 或全仓单测。
- 要判断跨平台是否完全修复，需在 macOS 与 Windows 对同一源码分别运行并保留报告，再对实际安装的新扩展补做真实 Loop+ 端到端验收：运行中不得假完成；同 session 重复继续不能打断原调用；正常完成自动关闭子 Tab；失败保持失败且保留证据。未执行的项目不得写成已通过。

旧 `verify_codex_thread_handoff.js` / `verify_codex_thread_handoff_acceptance.js` 仅保留 pool 专项诊断；`verify_codex_runner_unload.js` 为公共 runner 专项诊断。判断此次完整源码修复优先使用统一入口，不能只跑旧脚本。

本入口属于开发测试工具，不新增插件用户可见能力；本次脚本优化无需再次变更功能清单，前一轮运行时修复的功能条目仍为事实来源。

2026-11-13 本机验证：macOS arm64 / Node 24.22.2，显式固定 Codex 0.167.0，默认三轮完整入口退出 0；构建通过，必要回归 717/717（无跳过），pool 交接耗时 60080 / 60048 / 60037ms，公共 runner 以真实 `thread/closed` 在 26ms 后交接。四组进程退出、stdio 关闭、临时目录删除均确认，另核对自有 PID 已不存在；重复指定已有报告时退出 1 且文件未改。ontology 校验与 9 项 Python 测试通过，启动器本机帮助调用及语法检查通过。检测暴露的空白命令能力探测已修复并补回归：空白不再默认探测另一个 Codex。

本机默认命令解析另有 Codex 0.145.0，与显式通过的 0.167.0 不同；上述通过记录不覆盖 0.145.0，更不能反推历史任务的实际版本。Windows 启动参数及失败收尾有自动化断言，但 Windows 原生运行和真实安装扩展的 Loop+ 端到端验收未执行。全仓单测不在本入口范围，不能把必要回归通过写成全仓通过。

### 6. 一键启动开发主机（Windows / macOS / Linux）

需要 Python 3.9+、Node.js/npm 和 VS Code。Windows 运行：

```powershell
python run_dev.py
```

macOS / Linux 运行：

```bash
python3 run_dev.py
```

该脚本会：

- 按本机 `node_modules` 布局安装依赖：已有 pnpm 布局且本机有 pnpm 时用 `pnpm install`，否则用 `npm install --no-fund`（仅关闭赞助提示，保留警告和错误）
- 若本机是 pnpm 布局但没有 pnpm，会删除该 `node_modules` 后改走 `npm install`，避免直接混用
- 自动执行 `npm run build`
- 以 `--new-window --extensionDevelopmentPath` 方式在独立窗口启动 VS Code

脚本始终以脚本所在仓库为工作目录，支持从其他目录启动。macOS 优先使用 `/Applications/Visual Studio Code.app` 内置的 `code`；其他情况查找 PATH，Windows 还会查找用户安装目录和 Program Files 中的 `code.cmd`。

可用 `--code` 指定 VS Code 命令路径；依赖和构建结果已准备好时可用 `--skip-install`、`--skip-build` 跳过相应步骤：

```powershell
python run_dev.py --skip-install
python run_dev.py --code "C:\Program Files\Microsoft VS Code\bin\code.cmd"
```

`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` 因机器环境而异，已加入 `.gitignore`，不要提交。不要在 pnpm 的 `node_modules` 上手动执行 `npm install`。

如果脚本找不到 `code` 命令，会在安装依赖前退出，并提示配置 PATH 或通过 `--code` 指定命令路径。

#### npm 安装与构建警告

- `Unknown user config` 指向用户级配置。用 `npm config get userconfig` 定位文件，先在仓库外备份，再移除废弃的 `sass_binary_site`、`always-auth`，保留 registry、认证和其他配置。嵌套的 `npm run clean` 也会读取配置，因此同一问题可能重复显示为 `Unknown user config` 和 `Unknown env config`；如果清理后仍有 `Unknown env config`，检查启动环境中是否单独设置了对应的 `npm_config_*` 变量。
- `not yet covered by allowScripts` 表示 npm 跳过了未获准的依赖安装脚本。项目的 `allowScripts` 只按确切版本放行已核对的 VSCE 签名工具和系统凭据存储依赖。依赖升级后用 `npm install-scripts ls` 查看未覆盖项，核对来源和脚本后再按包更新放行，不要全量批准。

### 7. 统计代码行数

```bash
npm run stats:loc
```

默认统计 `src` 与 `media`。行数会去掉空行和注释，源码与单测分开汇总后再合计；第三方目录、压缩/生成文件、二进制和非代码文件会被跳过。可加 `--by-file` 看每个文件，或 `--json` 做机器可读输出：

```bash
node scripts/count_effective_loc.js --by-file
node scripts/count_effective_loc.js --json
```

## 推荐调试流程

### Extension Host 调试

1. 在仓库根目录执行 `npm run build`
2. 用 VS Code 打开当前仓库
3. 按 `F5` 启动 Extension Development Host
4. 在新的开发主机窗口中验证侧边栏、命令和 Webview 行为

### Webview 调试

在 VS Code 或开发主机中执行：

```text
Developer: Toggle Developer Tools
```

适用场景：

- 排查聊天面板脚本错误
- 查看 `postMessage` / `onDidReceiveMessage` 行为
- 检查 Webview DOM、样式与运行时异常

## 打包 VSIX

### 1. 安装依赖

```bash
npm install
```

### 2. 导出插件

```bash
python3 scripts/export_vscode_extension.py
```

默认仍导出通用包，不按构建机平台删除 SDK 的其他平台资源。如只分发给某个平台，可显式导出更小的平台包：

```powershell
python scripts/export_vscode_extension.py --target current
python scripts/export_vscode_extension.py --target win32-x64
```

`current` 按运行打包脚本的 Node.js 平台/架构解析；支持 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`win32-x64`。平台包带 VSIX target 标记，文件名为 `dist/sinitek-cli-tools-<version>-<target>.vsix`，只能分发到对应平台；不要拿 macOS 平台包替代 Windows/Linux 通用发布。SDK 本身不包含 Windows ARM64、Linux ARM32 或 Alpine 专属 ripgrep，本脚本不宣称新增这些平台支持。

建议在目标系统安装完整依赖后打包；跨平台打包必须已经安装目标平台的 sharp/libvips，否则预检失败，不会静默删除图片处理能力。脚本只生成临时 ignore 文件，不修改本机 `node_modules` 或项目 `.vscodeignore`。

导出脚本会：

- 读取 `package.json` 中的版本号
- 优先调用项目内 `node_modules/.bin/vsce package`，若缺少本地依赖则回退到全局 `vsce`
- 统一传入 `--no-rewrite-relative-links`，避免 vsce 对非 GitHub/GitLab 仓库猜测图片地址；随后仅在 VSIX 内将 README 的介绍图转换为当前发布者、插件名和版本的 Gallery `assetbyname` HTTPS 地址，并在 `extension.vsixmanifest` 中登记为 `Microsoft.VisualStudio.Services.Screenshots.1` 可寻址资产。仓库 README 保持相对路径，图片字节保持不变，无需另建公开图床
- 新增本地 README 图片时，在 `scripts/export_vscode_extension.py` 的 `README_IMAGE_ASSETS` 中登记路径和唯一截图资产类型；审计会拒绝未转换的相对图片、不安全的 HTTP 地址、缺失文件或错误资产登记。外部图片仍应使用可匿名访问的 HTTPS 地址
- 新资产地址只有发布对应版本后才能访问；已发布版本不能覆盖，应先由维护者升级 `package.json` 版本再运行发布脚本，不能用当前市场旧包验证尚未上传的图片资产
- 若当前 `node_modules` 是 pnpm 布局，先复制到临时目录安装成 vsce 可识别的 hoist 布局再打包；本机没有 pnpm 时临时目录改走 `npm install`。不要直接对 pnpm 树执行 `vsce package`（它会跑 `npm list` 并 `ELSPROBLEMS`）
- 若工作区还没有 `vsce`，会先按本机布局安装依赖
- 按 `.vscodeignore` 排除根级 harness、文档、CodeGraph、本地脚本、`.tmp` 截图与页面、测试产物、构建 source map、SDK 类型声明以及所有层级的 Python 缓存；开发构建仍保留 source map
- 使用 Python 标准库读取 ZIP 清单并审计，若 `.agents/`、`.ch/`、`.codegraph/`、`.tmp/`、`docs/`、`scripts/`、`dist/test/`、构建 source map 等开发态内容误入包内会直接失败；无需安装 unzip
- 校验关键运行时文件仍在包内，包括 `dist/extension.js`、配置页三段脚本与 Monaco loader、workspace scaffold、沟通文件预览的 `marked` 依赖、模型导入的 `jsonc-parser` 包描述与 CommonJS 入口，以及 Claude SDK、内置 `cli.js`、全部 WASM、rg 与 ripgrep.node；审计失败会打印具体缺失文件，不再只显示子进程退出码
- 平台包仅保留对应平台的 SDK ripgrep 和 sharp/libvips，额外检查目标平台原生依赖，拒绝混入其他平台资源；保留 SDK 和原生依赖的许可证
- 默认输出到 `dist/sinitek-cli-tools-<version>.vsix`，结束时打印实际 MiB/字节大小

扩展运行时直接导入的 npm 包必须显式列在 `package.json` 的 `dependencies`，并沿用 `.vscodeignore` 的对应包放行约定；不能依赖 `@vscode/vsce` 等开发工具间接安装。否则本地构建和单测可能正常，但 VSIX 收集生产依赖时遗漏模块，安装后激活报 `Cannot find module`。修复后必须重新导出并安装 VSIX，单纯重载已安装的旧包不会补齐依赖。`jsonc-parser` 已纳入所有打包目标的资源审计。

Claude SDK 的内置 `cli.js` 是 Windows `.cmd` 启动路径的后备；SDK WASM、原生 ripgrep 和 sharp/libvips 都属于运行时能力，不可为了缩包一并删除。`.vscodeignore` 由 vsce 实现的否定模式优先于排除模式，不能再加 `!node_modules/@anthropic-ai/**` 等宽泛放行，否则会让平台裁剪与类型声明排除失效。对应护栏见 `src/test/shared/vsixPackaging.test.ts`。

Claude SDK 固定为 `0.2.12`：新版 SDK 已改为按平台拆分原生 CLI，不能直接沿用当前通用包的资源布局与审计规则。需要升级时必须先同步实现平台依赖解析、打包裁剪、审计及跨平台真实验证。

## 发布到 VS Code 市场

市场发布者 ID 为 `sinitek`，插件 ID 为 `sinitek.sinitek-cli-tools`，以 `package.json` 为准。市场列表图标使用根字段 `icon` 指向的 `media/icon.png`（128×128 PNG）。侧栏的 `media/logo.svg` 不会出现在市场页面；更换图标后必须发布新版本。

首次在本机终端登录，输入具有 Marketplace `Manage` 权限且有权管理 `sinitek` 的 PAT；不要把令牌粘贴到聊天、脚本或仓库文件中：

```powershell
.\node_modules\.bin\vsce.cmd login sinitek
python scripts/publish_vscode_extension.py
```

以上命令必须在插件项目根目录执行，不是在上级 `sinitek` 目录。也可直接使用项目 `node_modules/.bin/vsce` 的绝对路径登录。项目依赖为 `@vscode/vsce`；不要在其他目录运行 `npx --no-install vsce`，否则缺少本地可执行文件时会尝试解析旧的非 scoped `vsce` 包，并因禁止安装而失败。

脚本先验证发布者与鉴权，再调用 Python 导出脚本构建、审计 VSIX，最后通过 `vsce publish --packagePath` 上传同一份产物。非交互环境支持通过安全环境变量注入 `VSCE_PAT`，兼容 `VSCODE_MARKETPLACE_PAT`，前者优先；令牌不放入命令行参数。缺少 vsce 时复用项目依赖安装流程；无凭据或鉴权失败会在构建之前退出。
交互式终端中，无论发布成功或失败，脚本都会保留窗口并等待按 Enter 关闭，便于查看失败原因；CI 与管道调用不会等待输入。

默认发布通用包 `dist/sinitek-cli-tools-<version>.vsix`；确有平台分发需求时，可用 `python scripts/publish_vscode_extension.py --target current` 或导出脚本已有的显式平台值。平台包不替代其他系统的通用包。Windows 使用 `python`，Linux/macOS 使用 `python3`；发布、导出和进程调用不依赖 Windows 专属模块或 Git Bash/WSL，路径含空格受支持。跨平台命令执行由 `scripts/vscode_extension_process.py` 统一处理，仅 VS Code 的 Windows 安装路径探测保留在 `scripts/vscode_extension_win.py`。

市场不允许覆盖已发布的同版本包；脚本不会自动改版本、创建提交或 tag。需要更新时先手动调整 `package.json` 的版本再重跑。上传失败保留本次导出的 VSIX；仅需离线安装包时仍使用 `python scripts/export_vscode_extension.py`，不需要市场凭据。

## Loop 子任务规则隔离发布前验证

对涉及 Loop 子任务调度、cwd、CLI 参数或项目规则加载的修改，执行以下验证。`npm run build` 会清理共享 `dist/`，因此构建与测试应由同一验证流程顺序运行。

```bash
set -euo pipefail
npm run build
node --test \
  dist/test/loop/loopSubtaskExecutionRoot.test.js \
  dist/test/cli/opencodeCommandRunner.test.js \
  dist/test/loop/loopPromptBuilders.test.js \
  dist/test/loop/loopPromptQueue.test.js \
  dist/test/loop/loopMainFailure.test.js \
  dist/test/loop/loopSubtaskThinking.test.js
git diff --check
```

## 最小交付前检查

因为本项目是 Node/TypeScript 插件，文档、配置或代码变更收尾前至少要确认：

```bash
npm run build
```

## 关键路径

- 入口：`src/extension.ts`
- 聊天面板 Webview：`src/webview/viewContent.ts`
- 配置中心面板：`src/webview/configPanel.ts`、`src/webview/configView.ts`
- 打包脚本：`scripts/export_vscode_extension.py`
- 本地开发脚本：`run_dev.py`

## 常见问题

### `code` 命令不存在

在 VS Code 中执行：

```text
Cmd+Shift+P -> Shell Command: Install 'code' command in PATH
```

### 构建后看不到最新效果

优先确认：

- 是否执行了 `npm run build` 或 `npm run watch`
- 是否重开了 Extension Development Host
- 是否需要重新加载 Webview / 打开开发者工具检查前端报错
