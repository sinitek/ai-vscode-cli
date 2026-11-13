# 本机 Node 24 升级记录

核验日期：2026-11-10，macOS / Darwin arm64。本记录是本机环境交付，不是项目依赖、插件协议或 CLI 兼容性变更。

## 结果

- 新登录 shell 默认使用官方 Node **v24.22.2** / npm **11.19.1**；发行包经 nvm checksum 和官方 `SHASUMS256.txt` SHA-256 校验。未做 GPG 验签。
- nvm default 从 `22` 切到 `v24.22.2`。原 Node `v22.23.4`、npm `10.9.9`、全局包和可回滚安装均保留；十个全局包版本升级前后完全一致：Claude Code 2.1.311、CodeGraph 1.6.2、DSH 0.2.2-rc.1、Gemini CLI 0.66.0、Kimi Code 2.5.2、Codex 0.167.0、Grok 1.0.62、corepack 0.34.6、OpenCode 1.18.35、webcrack 2.16.0。
- `.zprofile` 和 `.zshrc` 在既有 nvm 加载行后各增加 `command -v nvm >/dev/null 2>&1 && nvm use --silent default && export PATH="$NVM_BIN:$PATH"`，修复继承旧 nvm 版本和 Homebrew Node22 抢占 PATH 的问题。`.zshenv`、Homebrew 安装和项目配置未改。
- 五种登录 shell 环境（交互/非交互、干净环境及继承旧路径）均解析到 Node24；七个 CLI 的无模型版本检查通过。旧 Node22 的十个全局包和二进制校验保持不变。

## 重要边界

- 已启动进程不会因 alias 变化而切换；VS Code 内嵌 Node 也不由 nvm 控制。一个未加载 profile 的非登录子进程仍解析到 Homebrew Node `v22.22.0` / npm `10.9.4`，这不是 Extension Host 探测结果。DSH 在现有宿主获得哪个 Node 取决于其实际子进程环境，尚未验证。
- npm 安装对既有 `sass_binary_site` / `always-auth` 配置发出弃用警告，并提示 allowScripts 未显式覆盖的安装脚本；版本核验和 DSH 初始化通过，不代表无警告安装或完整插件端到端兼容。
- 未修改项目依赖、lockfile、SDK、VS Code engine、源码或功能清单；未运行 build、回归、真实模型请求或压缩质量测试。回滚步骤已不适合直接照搬旧临时目录路径，应先在新终端读取当前 alias 与 shell 配置，再将 default 指回交付前记录的版本并 `nvm use`；不要覆盖后来修改过的 shell 文件。

官方依据及逐项安装输出保存在交付时的私有临时证据目录 `/private/tmp/sinitek-node24-upgrade.br0f7q`，该路径现仅是历史定位，不保证仍存在；其中 shell 配置备份可能包含敏感内容，不应提交或公开。已保存证据一致性脚本曾通过，不替代重新执行真实 shell/CLI 命令。
