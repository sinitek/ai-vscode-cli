# 所有 CLI 配置保存刷新与初始化加载统一

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

ZCode 专项修复后继续核查所有 CLI。配置 Webview 仍对其他 CLI 自行猜测激活身份；AI 面板只加载当前 CLI 的完整档案，其余 CLI 依赖历史偏好，缺少档案身份时跳过原生模型读取，导致首次打开或保存其他 CLI 配置时状态不完整。

## 已确认需求

- 用户通过结构化输入选择“只刷新，不切换”：任何档案保存都刷新面板，只有激活档案自动应用，未激活档案不自动切换。
- 同时加载指并行读取各 CLI 本机配置、激活身份及可用模型，不启动所有 CLI，不批量激活、不创建默认档案、不发模型请求。
- 用户补充：Loop 仅为示例；Loop、Loop+、Graph 及所有共用子模型入口必须统一读取首次加载和保存后的完整状态，不要求先切换到目标 CLI。

## 范围与非目标

- 所有分组统一采用宿主激活身份，补齐 Grok／KimiCode／DSH 当前配置匹配。
- 面板首次及保存后加载所有 CLI 的独立配置快照，刷新对应模型缓存并隔离错误；无保存档案时也读取本机原生模型配置。
- 保留 Codex／Claude 的既有模型管理及显式模型偏好，不引入任意模型别名或覆盖服务模型。
- 保留前两轮及用户的未提交改动，不提交、新建分支、升级依赖或改写真实凭据。

## 验收标准

- 七个 CLI 初始并行加载，不因某个配置错误阻断其他分组；快照携带各 CLI 独立的激活身份。
- 激活档案保存应用并刷新当前 AI 面板；未激活档案保存更新列表，不切换配置或 CLI。
- 没有历史激活偏好或保存档案时，已存在的本机原生模型也可加载；已删除身份不沿用旧缓存。
- 构建、跨 CLI 定向回归、隔离浏览器保存与跨 CLI 模型刷新验证通过；文档及 ontology 同步。

## 影响面与风险

- 配置桥接、宿主配置匹配与状态构建、模型缓存、对应单测及文档。
- 所有配置采用读操作并行加载；模型和配置错误按 CLI 隔离，不批量写入运行时。
- 测试使用临时目录与占位凭据；保留旧版兼容路径，不改用户正在运行的会话。

## 验证计划

- 先补跨 CLI 激活同步、并行加载／种子复用／失败隔离、面板快照、无档案模型读取回归。
- `npm run build`；按 `.ch/docs/TESTING.md` 执行配置、面板状态与模型宿主最小及扩大回归。
- 使用 Chromium smoke skill 与隔离真实配置页／聊天页桥接验证保存行为，不调用模型服务。
- ontology 校验及 skill 单测，`git diff --check`，打包、更新本机插件并校验安装文件。

## 测试与清单同步

- `npm run build`：通过；首次四条新增回归修复前全部失败、实现后全部通过。
- 配置页、模型宿主、Grok／DSH 模型、面板状态定向回归：60 项通过，日志 `/tmp/sinitek-all-cli-save-targeted.log`。
- KimiCode、OpenCode、ZCode、跨 CLI 路由及会话消息扩大回归：45 项通过，日志 `/tmp/sinitek-all-cli-save-expanded.log`。
- 共享子模型路由／Codex 角色行及排除已证实历史失败的 Grok／Loop+ 回归：17 项通过，日志 `/tmp/sinitek-all-cli-save-shared-route-filtered.log`。
- Webview 新增矩阵覆盖七个主 CLI × Loop／Loop+／Graph × 七个目标 CLI，验证初始化、保存后模型变化、无误报和主 CLI 不切换；补充三种模式的加载中／已加载但无档案／读取失败／恢复生命周期，连同四项 ZCode 专项共 6 项通过，日志 `/tmp/sinitek-all-cli-save-modes.log`。生命周期夹具修正为与真实宿主一致的角色模型选择字段，不改生产逻辑迎合夹具。
- 完整 Webview 脚本回归 100／101 通过；唯一失败为已知的错误气泡所属标签状态断言，不在本次范围。扩大共享入口回归还有 4 项历史失败：Grok 两项及 Loop+ 两项抽取夹具缺少 helper／旧布局断言。用 `git show HEAD` 的原始脚本在隔离模块缓存中复核，4 项同样失败；证据 `/tmp/sinitek-all-cli-shared-route-baseline.log`。未修改测试以掩盖失败。
- Chromium 真实编译页面、真实配置服务及模型宿主配合临时 home：四个主 CLI × 三种模式 × 七个目标 CLI，共 84 次切换通过；另外覆盖跨页激活保存即时刷新、未激活保存不应用，该场景保存 2 次、应用 1 次，主 CLI 仍是 Codex／Graph。追加删除全部 ZCode 档案、保留原生配置、确认缺少档案不无限同步，以及恢复档案后控件恢复验证。无浏览器、HTTP 或请求错误。结果 `/tmp/sinitek-all-cli-browser-result.json`；未启动 CLI 或请求模型服务，未修改用户配置。
- bundled Chromium smoke：通过，结果 `/tmp/sinitek-all-cli-config-sync-smoke/result.json`，已查看截图，确认角色行和跨 CLI 子模型控件可见、可用且无重叠。初次浏览器脚本的定位器及导航前未消费桥接响应属于夹具问题，修正后不使用错误忽略名单。
- ontology 校验通过，75 条规则；ontology skill 9 项测试通过。功能清单、`ARCHITECTURE.md`、跨 CLI 同步规则及 `PITFALLS.md` 已同步；无需重复追加热区事件。
- 最终一次 `node --test --test-skip-pattern=...` 汇总运行上述 17 个测试文件，显式排除 5 项基线失败，222 项全部通过；日志 `/tmp/sinitek-all-cli-save-final-tests.log`。
- 本机打包与安装：`python3 scripts/export_vscode_extension.py --target current` 通过，生成 `dist/sinitek-cli-tools-1.5.0-darwin-arm64.vsix`，VSIX 内容校验通过；VS Code `--install-extension ... --force` 成功。安装位置 `/Users/fangjiawei/.vscode/extensions/sinitek.sinitek-cli-tools-1.5.0` 的 10 个关键编译文件 SHA-256 与本次构建一致，证据 `/tmp/sinitek-all-cli-install-hashes.log`。未自动重载 VS Code，当前进程需用户重载窗口才运行新代码。

## 当前结论

通过 CodeGraph 与当前源码确认并修复：面板只加载当前 CLI、原生缓存缺少身份就跳过、配置页重复猜测身份及部分原生格式误匹配。首次构建、保存刷新与心跳种子路径统一读取全 CLI 快照；角色入口共用完整模型状态，ZCode 主模型复用共享能力判定。明确 null 不回退旧身份，新应用配置可越过旧快照；读取阶段不批量应用或启动进程。真实缺少有效档案的跨 CLI 派发限制保持不变。

完整快照确认缺少档案或读取失败时显示实际原因，不再伪装成持续同步；有效配置恢复后自动恢复控件。功能、架构、ontology 与排障经验已同步，不需要新增自动热区记录。
