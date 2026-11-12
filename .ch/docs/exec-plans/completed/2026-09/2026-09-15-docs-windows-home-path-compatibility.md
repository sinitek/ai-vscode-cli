# Windows 用户目录与 CLI 路径兼容 — 文档

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本会话
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-15-windows-home-path-compatibility.md`

## 本类型目标

保留已拆分的用户级路径边界文档，涵盖产品清单、cli-runtime-reference、PITFALLS和runtime design。

## 范围与所有权

- 保留已拆分的用户级路径边界文档，涵盖产品清单、cli-runtime-reference、PITFALLS和runtime design。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 保留已拆分的用户级路径边界文档，涵盖产品清单、cli-runtime-reference、PITFALLS和runtime design。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-09-15-bugfix-windows-home-path-compatibility.md](2026-09-15-bugfix-windows-home-path-compatibility.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 影响面

- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`

### 测试与清单同步

- 功能清单：已更新 CLI / 配置路径边界说明
- 相关文档同步：cli-runtime-reference、PITFALLS、runtime design doc

### 任务列表

- [x] 同步文档

## 分类依据与真实状态

bugfix（原feature改判）：背景明确已在使用的插件Windows无法稳定运行，~展开、官方bin发现与原子写是既有路径契约缺陷，不补造版本号；test与docs均明确实际交付。63项通过只属本机单测，真实Windows E2E未做及编译产物~/文案残留保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
