# Windows 用户目录与 CLI 路径兼容

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本会话

## 背景

插件在 Windows 上无法稳定运行，根因是把 `~/.codex/xxxxx` 这类 Unix home 路径当作真实文件系统路径。Windows 不会展开 `~`，官方 Codex 可执行文件也不在 npm 全局目录，配置原子写覆盖在 Windows 上也会失败。

## 目标

让用户级目录、CLI 命令、配置读写和提示词路径在 Windows / macOS / Linux 使用原生路径，并正确展开 `~`、`~/`、`~\` 与 Windows `%VAR%`。

## 范围

- 统一 home / CODEX_HOME 展开
- Windows 官方 Codex bin 发现
- 配置原子写覆盖
- Skills / 配置中心 / 提示词引用路径
- 相关单测、功能清单和运行手册

## 非目标

- 不重写配置页编译产物里仅作文案的 `~/` 提示
- 不解决 Windows 文件符号链接权限、长路径前缀 `\\?\` 的 Codex 上游差异
- 不引入新的 CLI 或改技术栈

## 验收标准

- [x] `~/`、`~\`、`%USERPROFILE%` 在进入 fs / spawn 前展开为原生路径
- [x] Codex 配置、Skills、CODEX_HOME 指向同一用户级目录
- [x] Windows 能发现 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`
- [x] 已存在配置文件的原子写在 Windows 语义下可覆盖
- [x] 相关单测通过，`npm run build` 通过

## 影响面

- 代码目录：`src/shared/`、`src/cli/`、`src/config/`、`src/interactive/`、`src/webview/`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无新依赖

## 风险与缓解

- 风险：CODEX_HOME 生效后测试夹具可能写到真实用户目录
- 缓解：测试隔离 HOME / USERPROFILE / CODEX_HOME

## 验证计划

- 最小相关验证：新增 shared path / atomic write / command resolution 单测
- 单元自测命令：`npm run build` 后跑相关 `node --test dist/test/...`
- 扩展验证：本机无 Windows 宿主，不宣称真实 Windows E2E 已跑

## 测试与清单同步

- 单元测试新增/更新：`src/test/shared/userHomePaths.test.ts`、`src/test/shared/atomicWrite.test.ts`、命令解析 / 配置路径 / prompt 路径回归
- 单元自测结果：`npm run build` 通过；相关 63 个单测通过
- 失败处理记录：无
- 功能清单：已更新 CLI / 配置路径边界说明
- 相关文档同步：cli-runtime-reference、PITFALLS、runtime design doc

## 任务列表

- [x] 排查 Unix 路径与 Windows 缺口
- [x] 落地共享路径与原子写
- [x] 接入命令解析、配置、Skills、提示词
- [x] 补测并验证
- [x] 同步文档

## 当前结论

Windows 用户级路径已统一展开为原生路径；官方 Codex bin 可被发现；配置原子写可覆盖。配置页编译产物里仍有 `~/` 文案，不影响实际读写。未做真实 Windows E2E。
