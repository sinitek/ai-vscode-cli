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

默认会刷新 Claude / Codex 的内置官方 Skills 归档，并输出 OpenCode 空平台占位。Gemini 已从当前配置中心支持范围移除；旧 Gemini 快照仅作历史迁移参考。
如需审计历史 Gemini 官方 extensions 快照，可显式执行：

```bash
python3 scripts/sync_official_skills.py --include-legacy-gemini
```

该命令只用于生成历史审计输出，不会把 Gemini 恢复为当前支持平台。旧 Gemini 刷新路径曾包含 repo 级进度日志、断点续传/重试，以及 tarball 失败时回退 shallow git clone。

> 说明：默认模式优先保证仓库内置 catalog 与配置页可稳定使用；Gemini 相关命令只用于历史快照审计，不代表当前插件继续支持 Gemini。

### 5. 维护 Loop 开发级 Workflow Skills 快照

批准的开发期上游仓库根为 `/Users/fangjiawei/work/agent-skills`。只有在明确刷新快照时才执行写入模式：

```bash
node scripts/sync_loop_workflow_skills.js --source /Users/fangjiawei/work/agent-skills
```

日常检查和发布前检查使用只读模式，不依赖外部目录：

```bash
node scripts/sync_loop_workflow_skills.js --check
node scripts/validate_loop_workflow_skills.js
```

同步脚本不联网、不 clone/pull；它在 staging 中生成并完整校验后才原子替换 `media/loop-workflow-skills/`。来源、MIT/NOTICE、manifest hash/bytes 和目录隔离规则以 `.ch/docs/references/authoritative-skills.md` 为准。

### 6. 一键启动开发主机（macOS）

```bash
./run_dev.sh
```

该脚本会：

- 自动执行 `npm install`
- 自动执行 `npm run build`
- 以 `--extensionDevelopmentPath` 方式启动 VS Code

如果脚本找不到 `code` 命令，会提示先在 VS Code 中安装 shell command。

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

### 1. 安装 vsce

```bash
npm i -g @vscode/vsce
```

### 2. 导出插件

```bash
./export_vscode_extension.sh
```

导出脚本会：

- 读取 `package.json` 中的版本号
- 调用 `vsce package`
- 输出到 `dist/sinitek-cli-tools-<version>.vsix`

## Loop Workflow Skills 发布前验证

以下命令供完整验证批次顺序执行。`npm run build` 会先清理共享 `dist/`，`vsce package` 也会触发 `vscode:prepublish`；存在并发子任务时，应由单一验证任务占用 build/VSIX 环境，避免互相删除产物。

### 1. 工具与入口预检

```bash
set -euo pipefail
for command_name in node npm jq rg git diff vsce unzip; do
  command -v "$command_name"
done
test -f scripts/sync_loop_workflow_skills.js
test -f scripts/validate_loop_workflow_skills.js
test -f media/loop-workflow-skills/manifest.json
test -x export_vscode_extension.sh
```

### 2. 快照、构建与定向回归

```bash
set -euo pipefail
node scripts/sync_loop_workflow_skills.js --check
node scripts/validate_loop_workflow_skills.js
npm run build
node --test \
  dist/test/lobsterSkillGuidance.test.js \
  dist/test/lobsterTaskStore.test.js \
  dist/test/lobsterPromptBuilders.test.js \
  dist/test/lobsterSkillIntegration.test.js \
  dist/test/sessionMessageActions.test.js \
  dist/test/lobsterParallel.test.js \
  dist/test/lobsterDebate.test.js \
  dist/test/lobsterMainFailure.test.js \
  dist/test/loopPromptQueue.test.js \
  dist/test/officialSkillService.test.js \
  dist/test/officialSkillsVersioning.test.js \
  dist/test/longTermMemory.test.js
```

### 3. `vsce ls` 与 manifest 逐项比对

先查看打包候选清单：

```bash
vsce ls --no-dependencies | rg '^media/loop-workflow-skills/'
```

再执行机器可判定的逐项比较。`manifest.json` 不索引自身，因此先单独确认它存在，再把其余打包文件与 `manifest.files[].path` 比对：

```bash
set -euo pipefail
PACK_ROOT="media/loop-workflow-skills"
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

jq -r --arg prefix "$PACK_ROOT/" \
  '.files[].path | $prefix + .' \
  "$PACK_ROOT/manifest.json" \
  | LC_ALL=C sort > "$VERIFY_DIR/manifest-payload.txt"

vsce ls --no-dependencies \
  | sed 's#^\./##' \
  | LC_ALL=C sort > "$VERIFY_DIR/vsce-all.txt"

rg "^${PACK_ROOT}/" "$VERIFY_DIR/vsce-all.txt" \
  | rg -v '/$' > "$VERIFY_DIR/vsce-pack.txt"
rg -x "${PACK_ROOT}/manifest\\.json" "$VERIFY_DIR/vsce-pack.txt"
rg -v -x "${PACK_ROOT}/manifest\\.json" "$VERIFY_DIR/vsce-pack.txt" \
  > "$VERIFY_DIR/vsce-payload.txt"

diff -u "$VERIFY_DIR/manifest-payload.txt" "$VERIFY_DIR/vsce-payload.txt"
```

### 4. 导出 VSIX 与解包逐项比对

```bash
set -euo pipefail
./export_vscode_extension.sh
VSIX="dist/sinitek-cli-tools-$(node -p "require('./package.json').version").vsix"
test -f "$VSIX"
unzip -l "$VSIX" | rg 'extension/media/loop-workflow-skills/'
```

使用 ZIP 条目名完成严格比较：

```bash
set -euo pipefail
PACK_ROOT="media/loop-workflow-skills"
VSIX="dist/sinitek-cli-tools-$(node -p "require('./package.json').version").vsix"
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

jq -r --arg prefix "extension/$PACK_ROOT/" \
  '.files[].path | $prefix + .' \
  "$PACK_ROOT/manifest.json" \
  | LC_ALL=C sort > "$VERIFY_DIR/manifest-vsix-payload.txt"

unzip -Z1 "$VSIX" \
  | sed 's#^\./##' \
  | LC_ALL=C sort > "$VERIFY_DIR/vsix-all.txt"

rg "^extension/${PACK_ROOT}/" "$VERIFY_DIR/vsix-all.txt" \
  | rg -v '/$' > "$VERIFY_DIR/vsix-pack.txt"
rg -x "extension/${PACK_ROOT}/manifest\\.json" "$VERIFY_DIR/vsix-pack.txt"
rg -v -x "extension/${PACK_ROOT}/manifest\\.json" "$VERIFY_DIR/vsix-pack.txt" \
  > "$VERIFY_DIR/vsix-payload.txt"

diff -u "$VERIFY_DIR/manifest-vsix-payload.txt" "$VERIFY_DIR/vsix-payload.txt"
```

两个 `diff -u` 都必须无输出且退出码为 `0`；只看到目录存在不算通过。

### 5. 受保护目录与 whitespace

```bash
set -euo pipefail
git diff --exit-code -- \
  media/official_skills_catalog.json \
  media/official-skills \
  media/workspace-scaffold \
  .agents/skills

test -z "$(git ls-files --others --exclude-standard -- \
  media/official_skills_catalog.json \
  media/official-skills \
  media/workspace-scaffold \
  .agents/skills)"

git diff --check
```

Loop workflow pack 的完整运行时语义见 `.ch/docs/references/cli-runtime-reference.md`；来源与维护边界见 `.ch/docs/references/authoritative-skills.md`。

## 最小交付前检查

因为本项目是 Node/TypeScript 插件，文档、配置或代码变更收尾前至少要确认：

```bash
npm run build
```

## 关键路径

- 入口：`src/extension.ts`
- 聊天面板 Webview：`src/webview/viewContent.ts`
- 配置中心面板：`src/webview/configPanel.ts`、`src/webview/configView.ts`
- 打包脚本：`export_vscode_extension.sh`
- 本地开发脚本：`run_dev.sh`

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
