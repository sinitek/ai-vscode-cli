# 参考资料索引

## 当前资料

- `.ch/docs/references/codex-official-alignment.md`：本骨架与 Codex 官方规范的对齐说明
- `.ch/docs/references/authoritative-skills.md`：外部权威技能候选、来源、适用边界与复用建议
- `.ch/docs/references/codegraph.md`：CodeGraph 可选集成方式、启用流程和使用边界
- `.ch/docs/references/deepseek-harness-api-reference.md`：本机 `@deepseek-ai/dsh@0.2.1-rc.2` 的上游程序化契约。`0.2.1-rc.2` 仍是发布候选，不是稳定版
- `.ch/docs/references/dsh-custom-provider-contract.md`：自定义 OpenAI-compatible provider 的脱敏 patch、环境变量、可选 profile 根级 `apiKey`、配置页和插件实跑边界。可执行模型 id 必须完整使用 `deepseek-v4.1-flash`。凭据默认引用 `SINITEK_DSH_API_KEY`，直接密钥只在本机配置档案和备份保存并在启动时注入子进程。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 不支持。真实权限请求与图形 Extension Host 点击验收未验证
- `.ch/docs/references/kimi-code-official-reference.md`：`@moonshot-ai/kimi-code` 2.3.2 的官方安装、命令、配置字段、权限模式、ACP 能力矩阵与 Skills 布局，并对照列出插件接线差异。思考档位由 `capabilities` / `support_efforts` 决定，默认配置与配置页范例已写入两项；ACP 没有压缩方法；`--auto` / `--yolo` 与 `-p` 互斥

## 维护原则

- 这里只放高复用、高稳定度的参考资料。
- 参考资料负责“外部依据”，不负责替代本仓库自己的规则文档。
