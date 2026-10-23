# VS Code 市场一键导出发布

- 日期：2026-10-23
- 状态：completed
- 负责人：Codex

## 背景与目标

用户要求直接执行 `publish_vscode_extension.sh`，导出插件并发布到 `sinitek`。现有脚本已有串联，但 manifest 使用 `Sinitek`、令牌被传入进程参数，且缺少鉴权预检与定向包支持。本机环境变量与 vsce 发布者缓存均无凭据，真实 `verify-pat sinitek` 返回 TF400813 未授权。

用户随后已完成本机登录；真实鉴权成功，当前阻塞不再是凭据，而是市场已存在 `1.2.0`，等待确认是否升级版本。

最终结果：用户明确批准升级 `1.2.1`，重新验证并上传成功，市场返回 `Published sinitek.sinitek-cli-tools v1.2.1`，脚本退出码 0。

## 范围与非目标

- 统一 publisher、复用现有导出与目标平台解析、鉴权预检、令牌环境变量传递、清晰失败提示。
- 补相关回归测试，更新发布 runbook、功能清单和 ontology。
- 不未经确认升级版本、不新建发布者、不修改本机密钥，不改变依赖版本和插件运行逻辑；重复版本被拒后用户已明确批准升级 `1.2.1`。

## 验收标准

- 默认命令按鉴权、导出审计、发布顺序执行，仅发布本次导出的 VSIX。
- 支持导出脚本已有的 `--target`；默认继续为通用包。
- 接受 `VSCE_PAT`、兼容 `VSCODE_MARKETPLACE_PAT` 或使用已有 vsce 登录；令牌不出现在子进程参数或日志中。
- 缺失或无效凭据、publisher 不匹配、导出失败均阻止发布。
- 执行构建、相关单测与真实本机导出/鉴权，明确记录真实发布结果。

## 影响面与风险

- 脚本与配置：`publish_vscode_extension.sh`、`package.json`。
- 测试：`src/test/shared/vsixPublishing.test.ts`，复用现有 VSIX 打包测试。
- 文档：runbook、功能清单、ontology。
- 发布为用户明确授权的外部写入；只有真实鉴权成功后发布，不自动递增版本或覆盖已有版本。
- Linux/macOS 使用 Bash；Windows 使用 Git Bash/WSL，原有 Windows Python 导出入口不变。
- 回滚可恢复脚本与 publisher；已成功上传的市场包不自动删除或下架。

## 验证计划与结果

- `bash -n publish_vscode_extension.sh`：登录提示修正后复验通过。
- `npm run build`：登录提示测试修正后复验通过。
- `node --test dist/test/shared/vsixPublishing.test.js dist/test/shared/vsixPackaging.test.js`：修正后复验 25/25 通过。
- `./export_vscode_extension.sh`：真实导出通过，1249 个条目、38282356 字节（36.51 MiB），通用平台运行时资源审计通过。
- `./publish_vscode_extension.sh`：真实执行因缺少发布凭据退出；从上级目录通过项目路径执行也能正确输出绝对登录命令，没有上传市场。
- 用户登录后重跑 `./publish_vscode_extension.sh`：鉴权成功、构建和导出审计通过，上传返回 `sinitek.sinitek-cli-tools v1.2.0 already exists.`，退出码 1；没有覆盖已有市场版本。
- `./node_modules/.bin/vsce show sinitek.sinitek-cli-tools --json`：确认市场已有通用版本 `1.2.0`，更新时间 `2026-10-23T03:48:29.640Z`（北京时间 2026-10-23 11:48:29），发布者为 `sinitek`。
- `./node_modules/.bin/vsce --version` 与 `login --help`：分别返回 3.9.2 与正常登录帮助，不需要安装旧的 vsce 包。
- ontology validate 与 `git diff --check`：修正后复验均通过。
- 用户批准升级后执行 `npm run build && node --test dist/test/shared/vsixPublishing.test.js dist/test/shared/vsixPackaging.test.js && ./publish_vscode_extension.sh`：全部通过，25/25 单测通过，vsce 返回 `DONE Published sinitek.sinitek-cli-tools v1.2.1.`，脚本退出码 0。
- `dist/sinitek-cli-tools-1.2.1.vsix`：1249 条目、38282357 字节（36.51 MiB）；真实解包确认 manifest 为 `sinitek.sinitek-cli-tools@1.2.1`，通用平台运行时资源审计通过。
- 上传成功后首次公开查询仍返回 `1.2.0`；CLI 已提示市场 URL 可能需数分钟更新，不将公开列表暂未刷新误判为上传失败，也不再次重传同版本。
- 非阻塞提示：vsce 提醒扩展包含 1249 个文件，建议未来考虑打包优化；不在本次发布扩大为构建体系重构。

## 决策与失败记录

- 用户在上级 `sinitek` 目录执行 `npx --no-install vsce login sinitek`，npm 尝试解析 `vsce@2.15.0` 并拒绝安装。这是登录指引缺少明确项目路径造成的环境/命令解析问题，不是项目 `@vscode/vsce@3.9.2` 缺失。
- 登录提示改为已解析的 vsce 可执行文件绝对路径；runbook 明确项目根目录与 scoped 包区别，回归测试校验带空格路径及不再推荐 npx。
- 本机登录已验证成功；市场重复版本属于预期的外部发布约束，不是鉴权或导出缺陷。未获用户确认前不自动将 `1.2.0` 升级，也不使用跳过重复参数冒充本次上传成功。
- 用户通过结构化确认批准将版本升级到 `1.2.1` 并发布；仅修改项目版本，不创建提交或 tag。测试夹具中的 `1.2.0` 是独立固定样本，不依赖项目真实版本，无需随发布机械替换。

## 当前进展与下一步

- 已检查当前脚本、导出护栏、vsce 3.9.2 鉴权实现和本机凭据可用性。
- 已完成脚本、身份、文档、ontology 与回归测试同步；`1.2.0` 的重复发布拒绝按预期生效。
- 用户批准的 `1.2.1` 已真实上传成功，本机保留对应通用 VSIX；未创建提交或 tag，未更改依赖版本。
- 稳定操作与登录坑已记录 runbook，真实发布结果同步功能清单；无需重复写入热区记忆或 EVENT_MEMORY。
- 后续发布先人工更新 `package.json` 版本，再执行 `./publish_vscode_extension.sh`；公开市场展示更新由服务端完成，不属于本地脚本失败。
