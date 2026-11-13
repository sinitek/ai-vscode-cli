# 参考资料索引

## 当前资料

- `.ch/docs/references/codex-official-alignment.md`：本骨架与 Codex 官方规范的对齐说明
- `.ch/docs/references/authoritative-skills.md`：外部权威技能候选、来源、适用边界与复用建议
- `.ch/docs/references/codegraph.md`：CodeGraph 可选集成方式、启用流程和使用边界
- `.ch/docs/references/deepseek-harness-api-reference.md`：本机 `@deepseek-ai/dsh@0.2.1-rc.2` 的上游程序化契约。`0.2.1-rc.2` 仍是发布候选，不是稳定版
- `.ch/docs/references/dsh-custom-provider-contract.md`：自定义 OpenAI-compatible provider 的脱敏 patch、环境变量、可选 profile 根级 `apiKey`、配置页和插件实跑边界。可执行模型 id 必须完整使用 `deepseek-v4.1-flash`。凭据默认引用 `SINITEK_DSH_API_KEY`，直接密钥只在本机配置档案和备份保存并在启动时注入子进程。未配置模型不能执行。缺失 usage 不显示为 0。adapter-fallback 不是服务容量。原生 compaction 不支持。真实权限请求与图形 Extension Host 点击验收未验证
- `.ch/docs/references/kimi-code-official-reference.md`：`@moonshot-ai/kimi-code` 2.3.2 的官方安装、命令、配置字段、权限模式、ACP 能力矩阵与 Skills 布局，并对照列出插件接线差异。思考档位由 `capabilities` / `support_efforts` 决定，默认配置与配置页范例已写入两项；ACP 没有压缩方法；`--auto` / `--yolo` 与 `-p` 互斥

## 历史验证记录

- `.ch/docs/references/codex-thread-handoff-windows-validation.md`：Windows 控制协议与真实 Codex CLI 验证；活动 Codex 计划引用其证据。仅代表记录中的 Windows 环境，未覆盖原生 macOS/Linux 或真实 VS Code 多窗口。
- `.ch/docs/references/codex-1.7.6-regression-validation.md`：LP83/LP84 回归和交付摘要。Marketplace 已有包与最终 Git 构建存在三处运行时差异；不可据此声称最终构建新发布。
- `.ch/docs/references/codex-compaction-native-host-validation.md`：VS Code 1.145.0 更新锁阻止 Extension Host 启动；原生标签/压缩验收未完成。
- `.ch/docs/references/cli-context-compaction-audit.md`：2026-11-10 DSH/Kimi ACP 隔离探针快照，不代表当前安装版本。
- `.ch/docs/references/node24-local-runtime-upgrade.md`：macOS 本机 Node24 交付记录；既有进程和 VS Code 内嵌 Node 不随 nvm alias 切换。

## 维护原则

- 这里只放高复用、高稳定度的参考资料。
- 参考资料负责“外部依据”，不负责替代本仓库自己的规则文档。
