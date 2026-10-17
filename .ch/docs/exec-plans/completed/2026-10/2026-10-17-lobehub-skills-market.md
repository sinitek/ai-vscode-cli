# 配置页 LobeHub Skills 市场

- 日期：2026-10-17
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-17
- claim_ttl：1d
- handoff_to：

## 背景

携宁 CLI 配置页已能打开、删除和复制四个全局 Skills 目录。用户希望在导出、导入按钮右侧进入 LobeHub Skills 市场，搜索后下载，并在多选 CLI 时自动解压安装。

## 目标

- 配置目录工具栏在“导入”右侧提供“Skills 市场”。
- 弹层可搜索和分页浏览 LobeHub Skills。
- 下载时多选 Claude、Codex、OpenCode、Grok，扩展宿主下载 ZIP 并用 `yauzl` 解压到对应全局 skills 目录。
- 同名目录会先删除再安装；拒绝路径穿越、符号链接和加密条目。

## 范围

- 配置页 UI、配置协议、扩展宿主下载与安装。
- 相关单测、产品规格和 ontology。

## 非目标

- 不安装官方内置 catalog，不改启用状态。
- 不合并工作区技能、`~/.agents/skills` 或 Grok bundled skills。
- 不执行技能脚本。CLI 之间复制仍不覆盖同名技能。

## 验收标准

- [x] 导入按钮右侧出现 Skills 市场，可搜索并展示结果。
- [x] 下载前可多选 CLI，确认后自动解压安装到所选全局目录。
- [x] 同名目录会先删除再安装，非法 ZIP 不会写出目标目录之外的文件。
- [x] `npm run build` 和相关单测通过。

## 影响面

- 代码目录：`src/config`、`src/webview`、`media/config/assets`、`src/test/config`
- 文档目录：`.ch/docs/product-specs`、`.ch/docs/ontology`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：`package.json`、`package-lock.json`、`.vscodeignore`

## 风险与缓解

- 风险：市场 ZIP 可能包含路径穿越或符号链接。
- 缓解：只允许官方下载主机，`yauzl.validateFileName` 加目录边界检查，拒绝符号链接和加密条目，限制体积。
- 风险：`https://market.lobehub.com/api/v1/skills` 列表需要 bearer token。
- 缓解：搜索走公开的 `https://lobehub.com/api/discover/skills`，下载走官方 `/download`。

## 验证计划

- 最小相关验证：`npm run build` 后运行市场、全局 skills 和配置协议单测。
- 单元自测命令：`node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js`
- 扩展验证：`node --check media/config/assets/config-app-ui.js`

## 测试与清单同步

- 单元测试新增/更新：`src/test/config/lobehubSkillMarket.test.ts`，配置协议动作列表。
- 单元自测结果：2026-10-17 通过。`npm run build` 后 `node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js` 为 39 passed / 0 failed。
- 失败处理记录：无。
- 功能清单：更新 FEATURE_INVENTORY 与能力说明。
- 相关文档同步：ontology、PITFALLS。

## 任务列表

- [x] 确认配置页入口和 LobeHub 公开接口
- [x] 用 yauzl 实现搜索、下载和多 CLI 安装
- [x] 更新规格、ontology 并完成单测

## 决策记录

- 2026-10-17：搜索使用 `https://lobehub.com/api/discover/skills`；下载 URL 由 identifier 拼到 `https://market.lobehub.com/api/v1/skills/<id>/download`，不信任客户端传入的任意 URL。
- 2026-10-17：解压使用直接依赖 `yauzl`，不手写 ZIP 解析。
- 2026-10-17：市场安装遇到同名目录时先删除再安装。符号链接只删除链接本身。CLI 之间复制仍然不覆盖。

## 当前结论

配置页已提供 LobeHub Skills 市场。搜索走公开 discover 接口，下载由 identifier 拼出官方地址，并用 `yauzl` 解压安装到多选 CLI 的全局 skills 目录。同名目录会先删除再安装。

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliGlobalSkills.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/skillsCopyModal.test.js`：39 passed / 0 failed。
- 实机核对：discover 搜索返回技能列表；`/api/v1/skills` 列表为 401；`anthropics-skills-pdf` 下载为 200 的 ZIP。

## 残余风险

- LobeHub 页面大小当前固定约 21，不依赖客户端 `pageSize`。
- 市场接口或 ZIP 结构变化后需要再核对解析与安装。
