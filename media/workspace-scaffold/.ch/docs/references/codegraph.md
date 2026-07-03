# CodeGraph 可选集成

CodeGraph 是可选的语义代码图索引层，用来降低代理在陌生代码库里反复 `rg`、`find`、读文件的探索成本。它适合回答符号定位、调用链、影响面、架构入口和“这块代码怎么工作”这类问题。

## 集成定位

- CodeGraph 是可选加速层，不是 harness 的必装前置条件。
- harness 只提供使用约定与 skill，不把 `.codegraph/` 或用户级 MCP 配置复制进模板。
- 对 Codex CLI，CodeGraph 当前主要通过用户级 `~/.codex/config.toml` 暴露 MCP server；目标项目只需要自己的 `.codegraph/` 索引。
- `.codegraph/` 是本地缓存。不要把索引数据库、日志或机器本地状态当作项目事实来源。

## 推荐启用流程

已有 `codegraph` 命令时：

```bash
codegraph install --target codex --location global
cd /path/to/project
codegraph init
```

如果从本地源码目录安装，例如 `~/work/codegraph`：

```bash
cd ~/work/codegraph
npm install
npm run build
npm link
codegraph install --target codex --location global
cd /path/to/project
codegraph init
```

说明：

- `codegraph install` 会修改用户级 agent 配置，应只在用户明确同意时执行。
- `codegraph init` 会在当前项目创建 `.codegraph/` 并构建初始索引。
- 如果目标仓库不希望提交 `.codegraph/.gitignore`，应在项目根 `.gitignore` 明确加入 `.codegraph/`。

## 使用约定

- 复杂代码探索优先触发 `.agents/skills/codegraph/`。
- 一般顺序是先查状态，再用 `codegraph_context` 缩小范围，然后用 `codegraph_explore` 或 `codegraph_trace` 取关键源码和关系。
- CodeGraph 返回 stale 提示时，只直接读取被提示的文件；其余未提示部分仍可继续信任图谱。
- 代码改完后，MCP server 通常会自动同步。CLI-only 场景或切换分支后，先运行 `codegraph sync` 再继续依赖图谱。

## 不替代什么

- 不替代编译、类型检查、测试、lint。
- 不替代 `.ch/docs/` 的长期知识沉淀。
- 不替代最终编辑前对目标文件当前内容的确认。
