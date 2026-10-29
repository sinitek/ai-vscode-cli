# ZCode 配置保存与 AI 面板同步修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

配置页激活档案同步平台列表遗漏 ZCode，保存逻辑依赖的激活 ID 为空，导致仅保存档案而未应用运行时配置；AI 面板正确读取运行时，却继续显示旧模型。已有档案与运行时可能已分叉，不能仅靠内容匹配恢复身份。

## 范围与非目标

- 补齐 ZCode 激活档案同步，并复用宿主的激活状态（含工作区偏好回退）。
- 按 ZCode 保留其他供应商的合并语义识别当前档案，避免使用 Codex TOML 匹配。
- 验证激活档案保存、应用、模型刷新及失败提示；未激活档案保存不得自动切换。
- 保留前一任务及用户已有修改，不覆盖真实配置，不发模型请求，不升级依赖，不提交或新建分支。

## 验收标准

- ZCode 参加初始及周期激活状态同步；已分叉的激活档案身份不丢失。
- JSON 格式或对象键顺序变化、保留无关供应商不影响识别；其他档案不误判为激活。
- 激活档案保存后应用运行时并等待面板刷新；未激活档案仅保存；应用失败明确区分“已保存”和“已应用”。
- 构建、定向单测、隔离 Chromium 配置页验证及 ontology 校验通过。

## 影响面与风险

- 代码：配置合并、宿主激活识别、配置桥接、配置页启动同步及对应测试。
- 文档：功能清单、ZCode 指南、ontology 与本计划。
- 风险：不能从内容差异猜测应激活的档案；由宿主现有工作区偏好回退恢复身份，无身份时不擅自激活。
- 测试使用独立临时目录和占位凭据，不改用户运行时配置；新包安装不自动重载当前 VS Code。

## 验证计划

- 先补回归断言并验证原实现失败，再修改实现。
- `npm run build`。
- `node --test dist/test/config/zcodeConfig.test.js dist/test/config/cliPageConfigCoverage.test.js`。
- 追加宿主配置状态相关测试与 Chromium 真实配置页保存、激活、失败场景。
- `git diff --check` 与 ontology `--validate`、skill 单测。

## 测试与清单同步

- 单元测试新增/更新：激活同步覆盖所有 CLI、宿主身份桥接、供应商保留式 JSON 匹配与已分叉身份回退；执行真实 ZCode 保存按钮和共享应用回调，覆盖激活保存、刷新确认屏障、未激活保存和应用失败。
- 回归证据：新增的前三项测试在修复前全部失败，日志 `/tmp/sinitek-zcode-save-before.log`；修复后通过。
- 单元自测结果：`npm run build` 与配置定向 40/40 通过；7 个相关测试文件扩大回归 83 项通过（排除 1 项已证实的历史失败）；ZCode Webview 定向 4/4 通过。
- 失败处理记录：扩大回归发现既有静态页面测试仍断言禁用的 Grok 出现在选项中（`Missing static page snippet: <option value="grok">grok</option>`）；注入 HEAD 原始 `viewContentStrings.ts` 重跑同一用例仍相同失败，基线 `/tmp/sinitek-zcode-save-static-baseline.log`，不修改无关功能。新集成测试初次使用 `replaceAll` 超出现有 TypeScript lib，已改为兼容的正则替换并重跑通过。
- 浏览器验证：真实配置页 HTML／脚本配合真实宿主配置服务、临时磁盘档案及占位凭据，跨页验证已分叉激活档案保存后真实聊天页模型下拉即时更新、未激活保存不切换，共 3 场景通过；标准 Chromium smoke runner 的激活保存和应用失败提示 2 场景通过，浏览器／HTTP／请求错误均为 0。截图已检查。
- 结构验证：`git diff --check`、ontology `--validate` 与 ontology skill 9 项单测通过。
- 交付验证：`python3 scripts/export_vscode_extension.py --target current` 构建和平台资源检查通过，生成 `dist/sinitek-cli-tools-1.5.0-darwin-arm64.vsix` 并通过 VS Code `--install-extension ... --force` 安装。安装目录中的 `extension.js`、`configView.js`、`configPanel.js`、`webviewCommandCoordinator.js` 与本次构建 SHA-256 完全一致；打包后再次执行扩大回归，83/83 通过。
- 功能清单与相关文档：已同步 ZCode 指南、功能清单及 ontology 激活保存同步规则；架构边界不变，无需改写架构文档。复发原因及恢复指引已进入指南，无需重复写入热区、EVENT_MEMORY 或新增 runbook。

### 扩大回归命令

```sh
node --test --test-skip-pattern='renders history, settings, run-status, queue, and help overlays' dist/test/config/zcodeConfig.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/config/configappcompactcontrols.test.js dist/test/config/configappcompactlayoutstyles.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js
node --test --test-name-pattern='ZCode' dist/test/webview/clipagescriptruntimecoverage.test.js
node /tmp/sinitek-zcode-save-browser-check.cjs
node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario /tmp/sinitek-zcode-save-smoke.json
node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario /tmp/sinitek-zcode-save-failure-smoke.json
```

## 决策记录

- 2026-10-29：激活身份由宿主通过 ZCode `getCurrent` 响应的 `activeConfigId` 提供，复用已有 `loadConfigState`；不在配置 Webview 重建一套供应商合并匹配规则，不以唯一档案猜测激活状态。
- 2026-10-29：宿主 ZCode 匹配比较“按现有应用规则合并后是否仍为当前状态”，复用应用合并函数并使用深度比较容忍对象键顺序；不读取或写入真实模型凭据，不修改用户刚保存的模型值。

## 当前结论

修复、回归、打包和本机安装均完成，已保留用户刚保存的模型值，未自动重载当前窗口。浏览器测试使用隔离的 VS Code 消息桥接和临时磁盘，但配置页、配置服务与聊天页均为真实代码；未自动操作当前 Extension Host。用户执行 `Developer: Reload Window` 后重新保存当前激活 ZCode 档案，看到“已更新当前激活的配置”即可确认已应用；若无激活标记先手动激活目标档案。模型名称仍必须由服务实际支持，配置同步修复不会为服务添加模型。
