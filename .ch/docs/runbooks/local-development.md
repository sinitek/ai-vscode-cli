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

如需审计历史 Gemini catalog 与快照变更，应读取 Git 历史或已归档执行计划，不要把历史资源恢复到当前 VSIX：

```bash
git log -- media/official-skills/gemini media/official_skills_catalog.json
```

> 说明：当前同步脚本只接受 Claude、Codex、OpenCode；历史 Gemini 资料不属于当前 catalog、打包资源或可执行维护路径。

### 5. 验证 Loop 子任务规则隔离

Loop 主任务保持真实工作区和项目规则。Loop 子任务必须从临时隔离根执行，根 `AGENTS.md`、`CLAUDE.md` 和项目 Skills 目录不得暴露给子 CLI。修改该边界后执行：

```bash
npm run build
node --test \
  dist/test/loopSubtaskExecutionRoot.test.js \
  dist/test/opencodeCommandRunner.test.js \
  dist/test/loopPromptBuilders.test.js \
  dist/test/loopPromptQueue.test.js \
  dist/test/loopMainFailure.test.js \
  dist/test/loopSubtaskThinking.test.js
```

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
- 按 `.vscodeignore` 排除根级 harness、文档、CodeGraph、本地脚本、测试产物和 Python 缓存
- 解包审计 VSIX 清单，若 `.agents/`、`.ch/`、`.codegraph/`、`docs/`、`scripts/`、`dist/test/` 等开发态内容误入包内会直接失败
- 校验关键运行时文件仍在包内，包括 `dist/extension.js`、本地化文件、`media` 资源、workspace scaffold 和 Graph 面板的 Dagre 依赖
- 输出到 `dist/sinitek-cli-tools-<version>.vsix`

## Loop 子任务规则隔离发布前验证

对涉及 Loop 子任务调度、cwd、CLI 参数或项目规则加载的修改，执行以下验证。`npm run build` 会清理共享 `dist/`，因此构建与测试应由同一验证流程顺序运行。

```bash
set -euo pipefail
npm run build
node --test \
  dist/test/loopSubtaskExecutionRoot.test.js \
  dist/test/opencodeCommandRunner.test.js \
  dist/test/loopPromptBuilders.test.js \
  dist/test/loopPromptQueue.test.js \
  dist/test/loopMainFailure.test.js \
  dist/test/loopSubtaskThinking.test.js
git diff --check
```

<!-- 已移除的 Loop Workflow Skill 快照发布流程（历史记录，不可执行）

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
  dist/test/loopLegacyMigration.test.js \
  dist/test/loopSkillGuidance.test.js \
  dist/test/loopTaskStore.test.js \
  dist/test/loopPromptBuilders.test.js \
  dist/test/loopSkillIntegration.test.js \
  dist/test/sessionMessageActions.test.js \
  dist/test/loopParallel.test.js \
  dist/test/loopDebate.test.js \
  dist/test/loopMainFailure.test.js \
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
-->

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
