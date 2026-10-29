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

- 按本机 `node_modules` 布局安装依赖：已有 pnpm 布局且本机有 pnpm 时用 `pnpm install`，否则用 `npm install`
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

### 7. 统计有效代码行数

```bash
npm run stats:loc
```

默认统计 `src` 与 `media`。有效行会去掉空行和注释，源码与单测分开汇总后再合计；第三方目录、压缩/生成文件、二进制和非代码文件会被跳过。可加 `--by-file` 看每个文件，或 `--json` 做机器可读输出：

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
- 统一传入 `--no-rewrite-relative-links`，保留 README 的相对图片路径，避免非 GitHub/GitLab 仓库无法推导图片地址而打包失败；审计会确认 README 和 `media/loop-plus-intro.jpg` 随包保留。此选项不提供公开图片托管，市场页面若需要展示图片，仍应在 README 使用可公开访问的 HTTPS 图片地址
- 若当前 `node_modules` 是 pnpm 布局，先复制到临时目录安装成 vsce 可识别的 hoist 布局再打包；本机没有 pnpm 时临时目录改走 `npm install`。不要直接对 pnpm 树执行 `vsce package`（它会跑 `npm list` 并 `ELSPROBLEMS`）
- 若工作区还没有 `vsce`，会先按本机布局安装依赖
- 按 `.vscodeignore` 排除根级 harness、文档、CodeGraph、本地脚本、`.tmp` 截图与页面、测试产物、构建 source map、SDK 类型声明以及所有层级的 Python 缓存；开发构建仍保留 source map
- 使用 Python 标准库读取 ZIP 清单并审计，若 `.agents/`、`.ch/`、`.codegraph/`、`.tmp/`、`docs/`、`scripts/`、`dist/test/`、构建 source map 等开发态内容误入包内会直接失败；无需安装 unzip
- 校验关键运行时文件仍在包内，包括 `dist/extension.js`、配置页三段脚本与 Monaco loader、workspace scaffold、Graph 面板的 Dagre 依赖、沟通文件预览的 `marked` 依赖，以及 Claude SDK、内置 `cli.js`、全部 WASM、rg 与 ripgrep.node；审计失败会打印具体缺失文件，不再只显示子进程退出码
- 平台包仅保留对应平台的 SDK ripgrep 和 sharp/libvips，额外检查目标平台原生依赖，拒绝混入其他平台资源；保留 SDK 和原生依赖的许可证
- 默认输出到 `dist/sinitek-cli-tools-<version>.vsix`，结束时打印实际 MiB/字节大小

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
