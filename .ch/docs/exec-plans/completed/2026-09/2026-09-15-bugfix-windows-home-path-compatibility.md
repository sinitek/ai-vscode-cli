# Windows 用户目录与 CLI 路径兼容 — 既有缺陷修复

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本会话
- 类型：bugfix


### 背景

插件在 Windows 上无法稳定运行，根因是把 `~/.codex/xxxxx` 这类 Unix home 路径当作真实文件系统路径。Windows 不会展开 `~`，官方 Codex 可执行文件也不在 npm 全局目录，配置原子写覆盖在 Windows 上也会失败。

### 目标

让用户级目录、CLI 命令、配置读写和提示词路径在 Windows / macOS / Linux 使用原生路径，并正确展开 `~`、`~/`、`~\` 与 Windows `%VAR%`。

### 范围

- 统一 home / CODEX_HOME 展开
- Windows 官方 Codex bin 发现
- 配置原子写覆盖
- Skills / 配置中心 / 提示词引用路径

### 非目标

- 不重写配置页编译产物里仅作文案的 `~/` 提示
- 不解决 Windows 文件符号链接权限、长路径前缀 `\\?\` 的 Codex 上游差异
- 不引入新的 CLI 或改技术栈

### 验收标准

- [x] `~/`、`~\`、`%USERPROFILE%` 在进入 fs / spawn 前展开为原生路径
- [x] Codex 配置、Skills、CODEX_HOME 指向同一用户级目录
- [x] Windows 能发现 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`
- [x] 已存在配置文件的原子写在 Windows 语义下可覆盖
- [x] 相关单测通过，`npm run build` 通过

### 影响面

- 代码目录：`src/shared/`、`src/cli/`、`src/config/`、`src/interactive/`、`src/webview/`
- 配置与脚本：无新依赖

### 风险与缓解

- 风险：CODEX_HOME 生效后测试夹具可能写到真实用户目录
- 缓解：测试隔离 HOME / USERPROFILE / CODEX_HOME

### 任务列表

- [x] 排查 Unix 路径与 Windows 缺口
- [x] 落地共享路径与原子写
- [x] 接入命令解析、配置、Skills、提示词

### 当前结论

Windows 用户级路径已统一展开为原生路径；官方 Codex bin 可被发现；配置原子写可覆盖。配置页编译产物里仍有 `~/` 文案，不影响实际读写。未做真实 Windows E2E。

## 分类依据与真实状态

bugfix（原feature改判）：背景明确已在使用的插件Windows无法稳定运行，~展开、官方bin发现与原子写是既有路径契约缺陷，不补造版本号；test与docs均明确实际交付。63项通过只属本机单测，真实Windows E2E未做及编译产物~/文案残留保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
