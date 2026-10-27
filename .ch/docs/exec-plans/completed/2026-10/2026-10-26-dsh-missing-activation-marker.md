# 修复 DSH 缺少激活标记时的启动失败

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex

## 背景与目标

当前 Windows 用户目录存在 DSH `active-profile.json` 与 `active-patch.yaml`，但缺少 `active.json`，AI 对话面板执行时报 `DSH profile patch is not active.`。修复启动路径对已保存有效快照的识别，不改变外部 patch 与显式激活档案的优先级。

## 范围与非目标

- 覆盖 DSH 启动快照解析、回归测试、当前环境准备验证与事实文档。
- 不修改凭据、DSH 服务端点、CLI 权限或其他 CLI 启动逻辑。

## 验收标准与影响面

- [x] 仅有有效 `active-profile.json` 和 patch、没有 `active.json` 时可以准备隔离启动。
- [x] 无 patch 或没有任何有效档案时仍拒绝启动。
- [x] 相关测试与 `npm run build` 通过。
- [ ] 影响 `src/extensionHost/dshInteractiveLaunch.ts` 及其宿主回归测试。

## 风险与验证

- 风险：把不完整快照误判为有效；缓解：仍要求 patch 存在，后续沿用现有 profile 提交校验。
- 最小验证：`node --test dist/test/extensionHost/dshInteractiveHostWire.test.js`。
- 构建：`npm run build`。
- 当前环境：仅在已有 DSH 用户配置上调用启动准备函数，不输出或修改密钥；不发起付费模型请求。

## 测试与清单同步

- 新增无激活标记但有已应用档案的回归测试。
- 单元自测：相关 5 项启动测试通过；完整 `npm run build` 通过。
- 失败处理：初次全量构建遇到并行编辑产生的重复测试声明，范围外未修改；随后并行改动完成，复跑通过。历史模型前缀断言与 Windows symlink 权限失败不属于本次回归，本次相关测试无失败。
- 功能清单、运行契约和 ontology 已同步；ontology 校验通过。

## 当前进展

已在当前用户目录确认缺失 `active.json` 并完成修复。当前用户配置的准备启动和真实 `dsh --profile acp` 初始化、session/new 成功，未发送 prompt，未输出或改写凭据。无需修改本机 `active.json`。
