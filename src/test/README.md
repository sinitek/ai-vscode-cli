# 测试目录

测试按被测模块划分为一级目录，文件名保持原有命名，便于从生产代码目录反向定位回归覆盖：

| 目录 | 覆盖范围 |
| --- | --- |
| `cli` | CLI 命令、参数、OpenCode/Gemini 适配 |
| `config` | 配置服务、MCP、配置中心与配置页控件 |
| `core` | 跨模块运行时、诊断、重试与会话基础能力 |
| `extensionHost` | Extension Host 运行时编排与 Prompt 执行入口 |
| `graph` | Graph 规划、调度、存储、工作区与运行面板 |
| `interactive` | Codex/Claude 交互 Runner 与 App Server 协议 |
| `loop` | Loop 任务、辩论、子任务与 Loop 相关界面 |
| `memory` | 长期记忆、索引、召回与运行门禁 |
| `session` | 会话、Tab、消息处理与提示词历史 |
| `shared` | 通用工具、工作区脚手架与写入范围校验 |
| `webview` | 通用 Webview、静态页面、脚本与显示行为 |

`vscodeMock.ts` 位于测试根目录，作为各模块共享的 VS Code 运行时夹具。构建后测试目录会映射到 `dist/test/<模块>/`；全量测试由 `scripts/run_unit_tests.js` 递归发现。
