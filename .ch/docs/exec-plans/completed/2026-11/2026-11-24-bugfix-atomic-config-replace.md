# 配置原子替换失败时保留原件

- 日期：2026-11-24
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

公共异步配置写入在 Windows 首次重命名失败后先删除原件，若再次重命名失败就留下缺失的运行配置。统一为同目录临时文件加一次重命名，放弃破坏性回退。

## 范围与非目标

- 修改 `src/shared/atomicWrite.ts` 和相关测试，同步配置故障约定和功能清单。
- 不改写入方路由、同步写入函数、重试策略或多文件事务，也不操作用户配置。

## 验收标准与风险

- 成功时仍替换已有文件；替换失败时返回原错误、保留目标内容，仅清理本次临时文件。
- 模拟 Windows 文件占用导致的重命名错误，分别验证 Codex `config.toml` 和 `auth.json` 原件保留。真实 Windows 环境另行确认其原生覆盖和文件占用行为；当前机器为 macOS，未运行 Windows 原生验证。

## 验证计划

- `npm run build`：通过。
- 先在未修复代码上运行 `node --test dist/test/shared/atomicWrite.test.js`，新加的 `config.toml` 与 `auth.json` 回归均因原件消失而失败，确认测试能复现缺陷；修复后同一测试 4/4 通过。
- `node --test dist/test/shared/atomicWrite.test.js dist/test/config/*.test.js dist/test/interactive/codexRuntimeConfig.test.js dist/test/interactive/codexRunnerLifecycle.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js`：1039/1039 通过。
- `python3 verify_mac.py --report .tmp/atomic-config-verify.pL03Kf/verification.json`：退出码 0；隔离构建与验收回归 1672/1672 通过，Loop+/Codex pool handoff 三轮及 public runner handoff 通过，改动前后源码指纹一致。报告标记 `fullyVerified=false`，因未覆盖真实 VS Code、真实模型和其它原生平台。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 ontology 单元测试：通过；`git diff --check`：通过。
- 已同步 `.ch/docs/ontology/domains/cli-plugin-runtime.json`、`.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/runbooks/PITFALLS.md`。Windows 原生文件替换仍待 Windows 主机实测。

## 当前结论

`writeFileAtomically` 不再按平台删除目标后重试；各平台统一执行一次同目录 `rename`，失败则返回原始错误并清理临时文件，目标文件保持不变。新增回归覆盖 Codex `config.toml` 与 `auth.json`。构建、局部测试、全部 Loop+/Codex 隔离验收及 Ontology 校验通过。尚未在 Windows 原生主机验证。
