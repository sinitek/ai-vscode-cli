# Chat Markdown 链接功能文档同步

- 日期：2026-11-07
- 状态：completed
- 类型：docs
- 负责人：Codex

## 关联计划

- 功能范围见 [`2026-11-07-feature-chat-markdown-links.md`](2026-11-07-feature-chat-markdown-links.md)；合同回归见 .ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json。本记录仅跟踪事实源更新。

## 目标与范围

同步功能清单、产品能力说明、运行时设计和 ontology，记录受限 Markdown 链接协议、宿主打开路由、预览器缺失时的显式选择及不执行任意协议的安全边界。

## 验收标准

- 文档与实现保持一致，不宣称真实 Extension Host 验收已完成。
- ontology 结构验证通过，保留历史空白检查的范围外发现。

## 验证结果

- 功能清单、能力说明、运行时设计及 ontology 已同步。
- ontology `--validate` 通过（2 domains、112 rules）；`git diff --check` 通过。通用 whitespace 命令曾因未修改 `AGENTS.md:8` 历史尾空格失败；随后针对所有本次修改/新增文件的 whitespace 检查通过。
- 以上为原计划记录，本轮没有重跑。

## 当前结论

文档同步完成，真实 Extension Host 未验证。
