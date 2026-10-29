# README 市场图片资源修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

README 使用本地 `media/loop-plus-intro.jpg`，导出时禁用相对链接改写。图片虽在 VSIX 内，但未登记为可寻址市场资产，市场页面无法解析该相对路径。修复共享导出流程，使发布脚本上传的同一产物包含公开图片资产与 HTTPS 引用，仓库 README 仍可本地预览。

## 范围与非目标

- 修改 Python 导出、相关回归测试、发布操作文档、功能清单和已有本体规则。
- 不修改用户已有 README 内容、不新增图床依赖、不变更版本或执行真实市场发布。

## 验收标准

- 打包后 README 图片引用当前发布者、插件名和版本的 Gallery HTTPS 资产地址。
- VSIX 清单登记图片资产，文件内容不变，目标平台和其他资源不变。
- 遗漏资源、相对图片或未登记资产会阻止审计；处理失败不破坏原始 VSIX。
- 本机真实导出与相关单测通过。

## 影响面与风险

- 实现：`scripts/export_vscode_extension.py`，由 `scripts/publish_vscode_extension.py` 复用。
- 测试：`scripts/tests/test_export_vscode_extension.py` 与已有发布测试。
- 文档：本地开发 runbook、功能清单、CLI runtime 本体规则。
- Gallery 资产只有发布对应新版本后才可访问；不以本地 ZIP 验证声称线上已经生效。
- 已发布 `1.5.0` 不能覆盖；版本升级与真实发布留给用户明确操作。

## 验证计划

- `python3 -m unittest discover -s scripts/tests -p 'test_export_vscode_extension.py'`
- `python3 -m unittest discover -s scripts/tests -p 'test_publish_vscode_extension.py'`
- `python3 scripts/export_vscode_extension.py`（包含 `npm run build`）及 ZIP 内容检查。
- 本体结构校验和相关脚本测试。

## 测试与清单同步

- 新增图片地址转换、资产登记、幂等、缺图、遗漏登记与原包保护回归。
- 同步功能清单、runbook 与现有打包本体规则；不新增业务概念。
- 导出脚本单测：17 项通过；发布脚本单测：11 项通过。
- `node --test dist/test/shared/vsixPackaging.test.js`：14 项通过，覆盖通用包和五种目标平台的现有约束。
- 本体 `--validate` 通过，本体脚本 9 项测试通过。
- `python3 scripts/export_vscode_extension.py`：通过，内含 `npm run build`；生成 `dist/sinitek-cli-tools-1.5.0.vsix`，1,278 个文件，38,376,836 字节。
- 实际 ZIP 检查通过：无坏条目；README 使用当前版本的 HTTPS 地址；截图资产路径和 Addressable 正确；JPEG MIME 为 `image/jpeg`，图片字节与源文件完全一致，SHA-256 为 `376ff74faf6ee253fc1fda651ffda54683abafffed4ec28423f1f62ffe64e500`。
- 失败分类：首次手工 MIME 断言误以为 vsce 的 Extension 是 `jpg`，实际为 `.jpg`；属于检查断言错误，修正后复验通过，未改动正确的打包内容。
- 未覆盖范围：没有修改版本或执行真实市场上传，不能声称新截图资产已在线可访问；浏览器验证应在维护者发布新版本后进行。

## 决策记录

- 2026-10-29：使用标准 Gallery 截图资产而非新增外部图床。官方 `tfx-cli@0.24.2` 的 `_build/exec/extension/_lib/vsix-manifest-builder.js` 将截图登记为 `Microsoft.VisualStudio.Services.Screenshots.<序号>` 且 `addressable: true`；本次沿用该约定。
- 2026-10-29：从市场公开查询确认当前版本 `1.5.0`，并匿名请求该版本官方 `assetbyname` 图标地址得到 HTTP 200 / `image/png`。新介绍图复用同一资产路由，但按包内版本独立生成地址。
- 2026-10-29：只改写包内 README 和 VSIX 清单，使用同目录临时文件原子替换；失败保留原包，平台信息、图片字节及其他资源不变。发布脚本继续上传导出并审计后的同一产物。

## 当前结论

实现、51 项相关测试、真实构建和打包审计已完成；用户 README 改动保留。无需更新架构或新增业务概念，已有本体规则和发布文档已同步，真实踩坑沉淀到 PITFALLS，不额外扩张热区记忆。线上生效仍需维护者升级版本并运行原发布脚本，发布后匿名检查新版本图片地址与市场展示。
