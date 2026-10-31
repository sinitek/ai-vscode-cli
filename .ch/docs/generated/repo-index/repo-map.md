# Repo Map

## 顶层目录与文件

| 路径 | 类型 | 用途 |
| --- | --- | --- |
| `.agents` | directory | 仓库级 skills 与代理工作流扩展 |
| `.ch` | directory | 仓库知识系统与执行文档 |
| `docs` | directory | 说明文档与设计/运维资料 |
| `media` | directory | 未自动识别用途；请结合相邻 README / AGENTS.md 判断 |
| `scripts` | directory | 自动化脚本 |
| `src` | directory | 主要源码目录 |
| `AGENTS.md` | file | 仓库级规则与导航入口 |
| `ARCHITECTURE.md` | file | 架构边界与模块职责说明 |
| `LICENSE` | file | 未自动识别用途；请结合相邻 README / AGENTS.md 判断 |
| `package-lock.json` | file | 未自动识别用途；请结合相邻 README / AGENTS.md 判断 |
| `package.json` | file | Node 项目脚本与依赖入口 |
| `README.md` | file | 项目概览与快速启动入口 |
| `run_dev.py` | file | 未自动识别用途；请结合相邻 README / AGENTS.md 判断 |
| `tsconfig.json` | file | 未自动识别用途；请结合相邻 README / AGENTS.md 判断 |

## 局部 AGENTS.md

- `.agents/skills/AGENTS.md`
- `.ch/docs/AGENTS.md`
- `media/workspace-scaffold/.agents/skills/AGENTS.md`
- `media/workspace-scaffold/AGENTS.md`

## 使用建议

- 先读根级 `AGENTS.md` 与 `.ch/docs/README.md`，再进入任务相关目录。
- 如果某个业务目录存在局部 `AGENTS.md`，优先读取最近的一层。
