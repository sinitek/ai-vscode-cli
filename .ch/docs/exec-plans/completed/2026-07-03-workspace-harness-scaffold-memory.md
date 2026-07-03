# 工作区 harness scaffold 长期记忆落地

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

当前 VS Code 插件已经实现了一版工作区长期记忆，但存储路径是 `<workspace>/.sinitek_cli/memory/`，并且把工作区已有 `.ch/` 视为冲突信号。最新需求改为参考目标系统 `/Users/fangjiawei/sinitek/sinitek_codex_harness/app`，把 `.ch`、`.agents`、`AGENTS.md`、`ARCHITECTURE.md` 作为工作区 scaffold 自动安装，长期记忆直接使用这套结构，不再额外旁路到 `.sinitek_cli/memory/`。

## 目标

实现插件在工作区自动初始化 harness scaffold，并把长期记忆与踩坑记录写入 `.ch` 结构中。

## 范围

- vendor 目标系统 scaffold 模板到插件仓库，供 VSIX 安装后离线复制
- 插件启动或需要长期记忆时，自动把 `.ch/`、`.agents/` 安装到工作区
- 缺失时创建 `ARCHITECTURE.md`
- 缺失时创建 `AGENTS.md`，存在时按幂等规则 append 模板内容
- 缺失时创建 `CLAUDE.md`，内容只引用 `AGENTS.md`；已有 `CLAUDE.md` 保持原样
- 长期记忆热区改到 `.ch/docs/memory/`
- 生成索引改到 `.ch/docs/generated/memory-index/`
- 踩坑记录改到 `.ch/docs/runbooks/PITFALLS.md`
- 去掉“.ch 自动禁用长期记忆”的旧运行时门禁
- 更新测试与事实来源文档

## 非目标

- 不做目标系统完整业务规则文件改写
- 不新增手动管理 `.ch` scaffold 的 UI
- 不替换现有 CLI / 面板技术栈

## 验收标准

- [x] 打开工作区并启用长期记忆后，插件会自动补齐 `.ch/`、`.agents/`、`ARCHITECTURE.md`、`AGENTS.md` 创建/追加逻辑，以及只引用 `AGENTS.md` 的 `CLAUDE.md`
- [x] 长期记忆读写、召回、生成索引都基于 `.ch/docs/memory/` 与 `.ch/docs/generated/memory-index/`
- [x] 踩坑记录落到 `.ch/docs/runbooks/PITFALLS.md`
- [x] 工作区已有 `.ch/` 时，不会自动禁用长期记忆
- [x] `npm run build` 与相关单测通过
- [x] 文档与功能清单同步到新的事实来源

## 影响面

- 代码目录：`src/extension.ts`、`src/memory/`、`src/test/`
- 文档目录：`docs/`、`.ch/docs/`
- 配置与脚本：`media/` 下新增 workspace scaffold 模板资源

## 风险与缓解

- 风险：工作区已有 `AGENTS.md` 时重复追加模板内容
- 缓解：使用明确标记块保证 append 幂等

- 风险：VSIX 未打包 dot-dir 模板资源，运行时找不到 scaffold
- 缓解：模板放入 `media/workspace-scaffold/` 并用本地构建验证

- 风险：从 `.sinitek_cli/memory` 切到 `.ch` 后文档和测试出现路径错配
- 缓解：统一从 `memoryPaths` 计算路径并更新相关断言

## 验证计划

- 最小相关验证：长期记忆路径与 scaffold 初始化单测
- 单元自测命令：`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试新增/更新：`src/test/longTermMemory.test.ts`、`src/test/memoryRuntimeGate.test.ts`
- 单元自测结果：`npm run build` 通过；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js` 16/16 通过
- 失败处理记录：无
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步长期记忆设计、CLI 参考、插件能力清单与 runtime 事实来源

## 任务列表

- [x] 确认当前实现与目标 scaffold 的冲突点
- [x] vendor 目标系统 `.ch/.agents` 与根模板文件到插件资源目录
- [x] 实现工作区 scaffold 自动安装、`AGENTS.md` 幂等 append 与 `CLAUDE.md` 缺省创建
- [x] 把长期记忆和踩坑记录迁到 `.ch` 结构，并去掉 `.ch` 禁用门禁
- [x] 更新测试与文档
- [x] 执行 build 和相关单测

## 决策记录

- 2026-07-03：采用“工作区 harness scaffold”方案，放弃插件私有 `.sinitek_cli/memory` 作为主长期记忆路径。

## 当前结论

已完成。当前插件会在工作区自动安装与目标系统同构的 `.ch` / `.agents` scaffold，并在缺失时创建 `ARCHITECTURE.md`、按幂等标记追加根级 `AGENTS.md`、创建只引用 `AGENTS.md` 的 `CLAUDE.md`。插件侧长期记忆热区现已迁移到 `.ch/docs/memory/`，generated recall 位于 `.ch/docs/generated/memory-index/`，踩坑记录位于 `.ch/docs/runbooks/PITFALLS.md`。`.ch` 不再作为禁用长期记忆的门禁。验证通过：`npm run build`；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js`。
