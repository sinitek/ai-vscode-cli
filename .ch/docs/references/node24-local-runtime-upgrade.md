# 本机 Node 24 升级记录

核验日期：2026-11-10，macOS / Darwin arm64。此记录仅交付本机运行时，不改变项目依赖、插件协议或正在执行的适配任务。

## 结果与官方依据

- 官方 `https://nodejs.org/dist/index.json` 当日重新下载，按 `^v24\.\d+\.\d+$` 过滤并按数字版本降序选择，结果为 **v24.22.2**，发布日期 **2026-10-27**，LTS 代号 Krypton，配套 **npm 11.19.1**；不是其他主版本、nightly 或 RC。
- 通过已有 nvm 安装官方 `node-v24.22.2-darwin-arm64.tar.xz`，未使用 sudo、其他版本管理器或 Homebrew 安装操作；下载使用 HTTPS/TLS，未禁用证书验证。
- nvm 输出 `Checksums matched!`，另对保留的发行包使用官方 `SHASUMS256.txt` 独立复核，输出 `node-v24.22.2-darwin-arm64.tar.xz: OK`。
- 实际 SHA-256：`1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115`。这是 HTTPS 获取的官方 SHA-256 校验，不宣称额外完成 GPG 签名验证。
- nvm 默认 alias 从 `22` 改为 `v24.22.2`；在安装、包版本对照及七个 CLI 的版本检查成功之后才切换。
- 完整保留 `~/.nvm/versions/node/v22.23.4` 及其全局包和 npm 10.9.9，供旧进程继续使用及回滚。

本机私有证据目录：`/private/tmp/sinitek-node24-upgrade.br0f7q`，创建权限为 `0700`。官方索引、响应头、发行包、官方校验和、安装日志、前后包清单、探测脚本和真实输出均在其中。目录内 shell 原配置备份可能含敏感配置，只留在受保护的本机目录；不得将该目录整体提交到仓库。临时目录不是永久归档，应在清理临时文件前按需安全保留。

## 迁移与 shell 最小修正

升级前保存：旧默认 alias、Node/npm 路径及版本、全部全局包确切版本、包链接与 engines 元数据、bin 链接、`.zprofile` / `.zshrc` / `.zshenv` 原文件，以及旧 Node 二进制与 npm 元数据 SHA-256。旧全局包没有顶层链接包。

实际安装及迁移命令如下；包列表来自重新读取的旧环境，不使用浮动版本，也不将旧 npm 装回新环境：

```sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" --no-use
export NVM_NODEJS_ORG_MIRROR=https://nodejs.org/dist
nvm install -b --skip-default-packages v24.22.2
export PATH="$NVM_DIR/versions/node/v24.22.2/bin:$PATH"
npm install --global --no-audit --no-fund \
  --prefix "$NVM_DIR/versions/node/v24.22.2" \
  @anthropic-ai/claude-code@2.1.311 @colbymchenry/codegraph@1.6.2 \
  @deepseek-ai/dsh@0.2.2-rc.1 @google/gemini-cli@0.66.0 \
  @moonshot-ai/kimi-code@2.5.2 @openai/codex@0.167.0 \
  @xai-official/grok@1.0.62 corepack@0.34.6 opencode-ai@1.18.35 webcrack@2.16.0
# 迁移和 CLI 版本核验完成后执行：
nvm alias default v24.22.2
```

首次误将 `--no-use` 传给 `nvm install`，本机 nvm 将它当成版本并报 `Version '--no-use' not found`；未安装任何目标版本，alias 仍为 `22`。随后改为上面的有效命令。`--no-use` 仅用于加载 `nvm.sh`。失败及成功日志分别保留为 `nvm-install.log`、`nvm-install-retry.log`，没有将失败记录写成通过。

shell 实测确认存在两个问题：nvm 自动加载会沿用继承的旧 nvm 版本；受控干净交互登录会被 `.zshrc` 中 Homebrew / `node@22` 的前置路径抢占，修正前实际为 Homebrew Node `v22.22.0` / npm `10.9.4`。因此在 `.zprofile` 和 `.zshrc` 的既有 nvm 加载行之后各仅增加一行：

```sh
command -v nvm >/dev/null 2>&1 && nvm use --silent default && export PATH="$NVM_BIN:$PATH"
```

这既显式选择 default，也将 nvm bin 提到 Homebrew 和用户级旧 CLI 前面，没有硬编码 Node24 路径。原有 `node@22` 路径保留为低优先级候选，未改动 Homebrew 安装；`.zshenv` 未改，原配置与零上下文差异分别见证据目录 `before/`、`before/immediate-shell/`、`after/zprofile.diff`、`after/zshrc.diff`。`zsh -n` 检查通过。

## 全局包确切版本

| 包 | Node22 升级前 | Node24 升级后 |
| --- | --- | --- |
| @anthropic-ai/claude-code | 2.1.311 | 2.1.311 |
| @colbymchenry/codegraph | 1.6.2 | 1.6.2 |
| @deepseek-ai/dsh | 0.2.2-rc.1 | 0.2.2-rc.1 |
| @google/gemini-cli | 0.66.0 | 0.66.0 |
| @moonshot-ai/kimi-code | 2.5.2 | 2.5.2 |
| @openai/codex | 0.167.0 | 0.167.0 |
| @xai-official/grok | 1.0.62 | 1.0.62 |
| corepack | 0.34.6 | 0.34.6 |
| opencode-ai | 1.18.35 | 1.18.35 |
| webcrack | 2.16.0 | 2.16.0 |
| npm | 10.9.9 | **11.19.1，官方发行包自带** |

`npm ls -g --depth=0 --json` 前后清单、逐包精确比对输出见 `before/global-packages.json`、`after/global-packages.json`、`after/global-version-comparison.txt`。十个非 npm 包均为 `exact match`，原 Node22 全局清单复查仍完全一致。

新旧包目录逐一检查：顶层包均 `linked=false`，真实路径在各自版本前缀内；没有把 Node24 的整个 `node_modules` 链到 Node22。旧 `bin` 中的全部 17 个入口在新环境均存在，包括 corepack 提供的 pnpm / yarn shims；未执行这些 shims 下载或升级包管理器。

## 新登录环境真实验证

证据目录中的 `shell-probe.zsh` 实际执行 `command -v node npm`、`type -a node npm`、`node --version`、`npm --version`、`node -p 'process.execPath'`、`nvm alias default`、`nvm current` 及七个 CLI 的路径检查。运行命令：

```sh
E=/private/tmp/sinitek-node24-upgrade.br0f7q
/bin/zsh -lic '. /private/tmp/sinitek-node24-upgrade.br0f7q/shell-probe.zsh; node /private/tmp/sinitek-node24-upgrade.br0f7q/check-cli-versions.cjs'
/bin/zsh -lc '. /private/tmp/sinitek-node24-upgrade.br0f7q/shell-probe.zsh'
/usr/bin/env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh \
  TERM=xterm-256color PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  /bin/zsh -lic '. /private/tmp/sinitek-node24-upgrade.br0f7q/shell-probe.zsh; node /private/tmp/sinitek-node24-upgrade.br0f7q/check-cli-versions.cjs'
```

正常交互登录、正常非交互登录、`env -i` 受控交互登录、`env -i` 受控非交互登录，以及人为继承旧 Node22 优先 PATH / `NVM_BIN` 的交互登录，五种检查全部通过。真实输出关键摘录（完整 `type -a` 含重复路径及低优先级旧版本，保留在 `after/*shell.txt`）：

```text
command -v node npm:
/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/node
/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/npm
type -a node npm:
node is /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/node
... 下方仍存在 Homebrew、/usr/local 和部分继承的旧 nvm 路径 ...
npm is /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/npm
node --version:
v24.22.2
npm --version:
11.19.1
process.execPath:
/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/node
nvm alias default:
default -> v24.22.2 *
nvm current:
v24.22.2
```

## 插件 CLI 路径与版本检查

以下前六个命令解析在 `/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/`，来自本次独立安装的 npm 全局包；ZCode 独立于 nvm，由已有 Homebrew 前缀内的 npm 包入口提供，未迁移或更新。即使底层程序是原生二进制，也按其 npm 分发来源区分，而非误称由 Node 解释执行。

| 实际命令路径 | 无模型请求检查 | 真实 stdout（均退出 0） |
| --- | --- | --- |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/codex | `codex --version` | `codex-cli 0.167.0` |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/claude | `claude --version` | `2.1.311 (Claude Code)` |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/opencode | `opencode --version` | `1.18.35` |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/grok | `grok --no-auto-update --version` | `grok 1.0.62 (1474f9cbdd91)` |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/dsh | `dsh --version` | `0.2.2-rc.1` |
| /Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/kimi | `kimi --version` | `2.5.2` |
| /opt/homebrew/bin/zcode | `zcode --version` | `zcode-app-cli 3.16.3-41`；`zcode-runtime 0.17.0` |

实际入口与 `realpath`、参数、stdout/stderr、退出码完整保存在 `after/cli-versions-explicit-path.json`，正常与受控交互登录也分别执行了同一组七项检查。旧 nvm 环境的七项对照见 `before/cli-versions-nvm22.json`，版本相同。

还实际验证 `gemini --version` → `0.66.0`、`codegraph --version` → `1.6.2`、`corepack --version` → `0.34.6`、`webcrack --version` → `2.16.0`，均退出 0、stderr 为空。

原机器另有低优先级旧入口，例如 `~/.npm-global/bin/codex`（0.145.0）、`~/.npm-global/bin/opencode`（1.18.25）及 `/opt/homebrew/bin/kimi`（2.3.2）。原继承环境可能选中它们，新登录优先选择迁移后的 nvm 工具；这些独立安装均原样保留，不将路径优先级修正误报为 CLI 升级。

### DSH 最小无凭据启动

安装包声明 `engines.node = >=24.9.0`，用 npm 自带 semver 对实际 `process.version` 核验，输出：

```text
@deepseek-ai/dsh@0.2.2-rc.1: engines.node=>=24.9.0; runtime=v24.22.2; satisfies=true
```

实际运行 `/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/node /private/tmp/sinitek-node24-upgrade.br0f7q/dsh-initialize-smoke.cjs`。脚本用环境白名单，不继承真实凭据，隔离 HOME、DSH_HOME、XDG 路径、临时目录及工作目录，仅启动新进程 `dsh --profile acp` 并发送一条 ACP `initialize`，没有 authenticate、session/new、session/prompt 或模型调用。

返回 `protocolVersion: 1`，`agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" }`，`authMethods: []`；stdin EOF 后退出码 0，stderr 为空，未超时。响应中的 agentInfo 版本不等于 npm 包版本，两者不混淆。真实请求和响应见 `after/dsh-initialize-smoke.json`；临时配置仅在证据目录 `isolated-dsh/` 中。

## 生效范围、限制与后续验证

- **新启动的登录 zsh 默认生效**。既有终端、已启动 CLI 和 Extension Host 的继承环境不会被 alias 或文件编辑反向修改；Extension Host 自身的内嵌运行时也不由 nvm 切换。未声称现有 VS Code 宿主已切到 Node24，未终止或重启任何既有进程。
- 本执行宿主的一个未加载 profile 的非登录子进程，切换 alias 后仍实际解析到 Homebrew Node `v22.22.0` / npm `10.9.4`（`after/inherited-nonlogin-environment.txt`）。这不是 Extension Host 的探测结果，而是“旧继承环境不会即时更新”的直接例证。
- 插件若已保存 Node22 CLI 的绝对路径，该文件仍在，且旧全局包清单未变；本次不改 VS Code 设置、登录凭据、用户会话或插件适配实现。DSH 是否在既有宿主下获得 Node24，仍取决于该宿主实际给新子进程的环境，不能仅凭新 shell 验证推断通过。
- npm 11 安装成功，但对已有 `sass_binary_site` / `always-auth` 用户配置给出弃用警告，并列出未在 allowScripts 显式覆盖的安装脚本；未顺便改 `.npmrc` 或全局脚本策略。版本检查和 DSH 初始化均实际通过；不将这些警告伪装为无警告安装。
- 没有改项目 `package.json`、lockfile、`@types/node`、SDK、VS Code engine、共享实现、功能清单、ontology、总体计划或其他子任务报告。只交付本机环境和本文档，不改变产品契约，因此不更新功能清单或 ontology；迁移/回滚事实集中留在本参考文档，避免并发改写记忆热区。
- 按任务约束**未执行**会清理共享 `dist` 的 `npm run build`、项目回归或发布脚本；构建与回归明确留给主任务在新运行时串行执行。也没有真实模型请求或压缩质量测试；CLI 版本检查不等于完整插件端到端验收。

## 回滚

无需重新安装或卸载，原 Node22 全局包仍在。新终端中执行：

```sh
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" --no-use
nvm alias default "$(cat /private/tmp/sinitek-node24-upgrade.br0f7q/before/nvm-default)"
nvm use --silent v22.23.4
export PATH="$NVM_BIN:$PATH"
node --version
npm --version
node -p 'process.execPath'
```

预期回到 `v22.23.4`、`10.9.9` 和旧 nvm Node 路径；这会再次低于 DSH 的 Node 声明要求。新增 shell 行跟随 default，无需为版本回滚删除它们。若要撤销优先级修正，先重新读取当前 `.zprofile` / `.zshrc`，只删除本次新增的相同一行；不要盲目用整份备份覆盖后来并发编辑。`.zshenv` 无需恢复。不要为回滚删除仍可能被已有进程使用的任一 Node 版本。

回滚命令未实际切换运行，以免干扰已经交付的新默认；已独立验证旧 Node/npm 哈希及旧全局包清单未变，旧 nvm 七个 CLI 版本检查全部通过。

## 实际修改路径与证据索引

- 主修改：`/Users/fangjiawei/.nvm/versions/node/v24.22.2/**`、`/Users/fangjiawei/.nvm/alias/default`、`/Users/fangjiawei/.zprofile`、`/Users/fangjiawei/.zshrc`，以及本文档。
- nvm/npm 必要附带写入：`~/.nvm/.cache/bin/node-v24.22.2-darwin-arm64/**`、`~/.nvm/alias/lts/*`（nvm 刷新官方 LTS 别名，列表见 `after/nvm-lts-aliases.txt`）、npm 自身缓存和日志 `~/.npm/_cacache/**`、`~/.npm/_logs/**`。没有手工改写这些工具的内部实现。
- 临时证据与测试配置：`/private/tmp/sinitek-node24-upgrade.br0f7q/**`；本尝试目录的 `node24-evidence-location.txt` 仅保存该目录路径；指定 attempt report 单独写入任务要求的位置。
- 官方资料：`node-index.json`、`index-headers.txt`、`target-release.json`、`SHASUMS256.txt`、`node-v24.22.2-darwin-arm64.tar.xz`、`archive-checksum-verification.txt`。
- 完整检查：`before/`、`after/`，尤其是 `after/verification-summary.json`。运行 `/Users/fangjiawei/.nvm/versions/node/v24.22.2/bin/node /private/tmp/sinitek-node24-upgrade.br0f7q/verify-evidence.cjs` 对已保存的五种 shell、七项 CLI、精确包版本及 DSH 无凭据初始化证据进行断言，结果 `status: passed`；这是证据一致性检查，不替代真实命令执行。
