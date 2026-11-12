# 配置模型发现与导入宿主事实来源更新

- 日期：2026-11-04
- 类型：docs
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-04-feature-config-model-import-host.md`（文档描述依赖宿主实现确认的导入行为与安全边界）；[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（历史证据审计入口，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-config-model-import-host.md` 定位历史记录；仅保留已移除 test 计划原记载的独立测试开发与验证结果摘要，不是存活 test 计划，本 docs 计划不承接测试开发）
- 状态：completed（Grok 与其它 CLI 凭据复用修复及回归完成）
- 负责人：Codex
- owner：model-import-credential-reuse

## 背景与目标

将配置管理模型导入宿主能力及其边界反映到用户可见功能事实来源和 `cli-plugin-runtime` ontology，避免实现计划成为唯一能力说明。

## 范围与非目标

- 范围：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中配置管理模型导入宿主能力，并注明 bridge 尚待集成；检查并更新 `.ch/docs/ontology` 中配置档案概念/规则。
- 非目标：不改变实现或测试，不声称前端整体集成完成；不扩大产品承诺到真实远端可用性、自动保存或激活。

## 验收标准

- [x] 功能清单描述模型导入宿主能力，并准确标明桥接待集成。
- [x] ontology 更新配置档案概念/规则，保留导入不保存/激活、凭据和协议边界。
- [x] 记录需后续主任务验收的前后端集成边界。

## 实际结果与验证

- 实际更新配置管理的模型导入宿主能力描述，并标注 bridge 待集成。
- 实际检查并更新配置档案概念/规则 ontology。主计划记录了 ontology 校验通过；本计划不将其扩写为未发生的独立测试工作。
- 文档相关验证作为历史证据保留于主计划；本轮未运行 ontology 脚本或全局文档门禁。

## 当前结论

功能清单与 ontology 文档交付有独立目标和范围，已完成。真实远端/密钥、前端 bridge 与完整集成验收仍由主任务处理。
