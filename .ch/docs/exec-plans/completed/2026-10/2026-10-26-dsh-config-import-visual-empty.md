# DSH 配置导入与空配置可视化修复

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次会话
- handoff_to：

## 背景

当前工作区已将 DSH 默认模型改为完整字符串 `deepseek-v4.1-flash`，但配置校验仍把同名响应别名当作不可配置值，导致范例无法解析；配置范例的一键导入因此静默不更新编辑器。DSH profile 为空时，JSON 到可视化模式也直接报空配置错误，无法通过可视化填写后保存。

## 目标

- 让当前 DSH 默认模型范例可被后端和配置页正常解析。
- 让“一键导入”真正覆盖当前编辑器草稿，并在范例无效时显示错误而不是静默成功。
- 让空 DSH 配置可以切换到可视化草稿，填写后通过现有保存与后端校验落盘。
- 范例 JSON 显式包含空的 `apiKey` 字段，不写入真实密钥。

## 范围

- `src/cli/dshConfigModels.ts` 的模型别名兼容校验。
- `media/config/assets/config-app-ui.js` 的 DSH 范例、导入、空配置草稿和保存状态。
- DSH 配置模型与页面回归测试。
- DSH 契约、功能清单和本执行计划的验证结论。

## 非目标

- 不改变 DSH ACP 运行协议、patch 文件结构或密钥注入边界。
- 不写入真实 API Key、真实端点或用户运行数据。
- 不重构其他 CLI 配置编辑器。

## 验收标准

- [x] `createDshExampleProfileText()` 与配置页范例能通过 DSH 校验，且包含空 `apiKey` 字段。
- [x] 范例一键导入后编辑器内容和可视化状态被更新；失败时显示真实错误且不关闭范例抽屉。
- [x] 空 DSH 配置可从 JSON 切换到可视化草稿，保存前继续校验必填字段，填写完成后可保存。
- [x] 相关单测、构建、空白校验和 `node --check` 通过。

## 影响面

- 代码目录：`src/cli/dshConfigModels.ts`、`media/config/assets/config-app-ui.js`。
- 测试目录：`src/test/cli/dshConfigModels.test.ts`、`src/test/config/dshconfigpage.test.ts`。
- 文档目录：`.ch/docs/references/dsh-custom-provider-contract.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。

## 风险与缓解

- 风险：把响应别名和配置模型混用会再次导致默认范例不可执行。
- 缓解：仅当响应别名与当前验证模型不同才拒绝别名；当前二者同名时按已确认模型 id 处理。
- 风险：空草稿被误当成已验证配置保存。
- 缓解：仅放宽模式切换，保存仍调用严格 `readDshUiDocument` 和后端 `commitDshDocument`。
- 风险：范例中加入 `apiKey` 造成密钥误存。
- 缓解：只加入空字符串，不生成占位密钥；保存规范化仍删除空值。

## 验证计划

- 最小相关验证：`node --test dist/test/config/dshconfigpage.test.js dist/test/cli/dshConfigModels.test.js`。
- 单元自测命令：`npm run build`、`npm run validate:whitespace`、`node --check media/config/assets/config-app-ui.js`、`git diff --check`。
- 扩展验证：如页面静态覆盖受影响，运行对应配置页测试；当前仓库无可用无头 VS Code Extension Host 点击入口。

## 测试与清单同步

- 单元测试新增/更新：默认模型别名兼容、范例 `apiKey`、一键导入可解析、空配置切换草稿和完整保存前校验。
- 单元自测结果：`npm run build`、`npm run validate:whitespace`、`node --check media/config/assets/config-app-ui.js`、`git diff --check` 通过；DSH 配置模型与配置页相关单测 20 项通过。
- 失败处理记录：未发现本次范围内失败；扩展宿主真实点击验收仍受当前仓库无可用无头 VS Code Extension Host 入口限制，未执行。
- 功能清单：同步 DSH 配置页范例和空配置可视化行为。
- 相关文档同步：同步 DSH 配置契约说明。

## 任务列表

- [x] 统一默认模型与响应别名校验
- [x] 修复范例导入与空配置草稿
- [x] 补充回归测试并完成验证
- [x] 归档执行计划

## 决策记录

- 2026-10-26：保留当前工作区已确认的 `deepseek-v4.1-flash` 模型 id；同名响应别名不再被当成独立非法值。
- 2026-10-26：范例只提供空 `apiKey` 字段，不提供任何密钥占位值。

## 当前结论

已修复同名模型与响应别名的误判，范例显式包含空 `apiKey` 且一键导入会覆盖当前编辑状态；空 profile 可先切换到可视化草稿，保存仍由严格校验守住必填字段边界。构建、空白检查、脚本语法检查和 20 项 DSH 配置相关单测均通过。
