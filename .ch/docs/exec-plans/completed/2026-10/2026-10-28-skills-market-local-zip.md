# Skills 市场本地 ZIP 安装

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

Skills 市场目前只支持在线搜索和下载。用户需要选择本地 ZIP 并安装到一个或多个 CLI 的全局 Skills 目录；ZIP 支持顶层单技能目录及 ZIP 根直接包含技能文件两种布局。

## 目标

- 在 Skills 市场增加本地 ZIP 选择与多 CLI 安装入口。
- 顶层只有一个技能目录时，以目录名作为技能名并剥离外层目录。
- ZIP 根直接包含 `SKILL.md` 时，以 ZIP 文件名作为技能名。
- 复用现有 ZIP 安全检查和 CLI 原子替换安装逻辑。
- 复核 Claude、Codex 以外 CLI 的官方全局技能目录；默认路径均与官方说明相符，不改路径解析。

## 范围

- `src/config/lobehubSkillMarket.ts`、配置 Webview 消息协议和 Skills 市场 UI。
- 上传 ZIP 的结构识别、安装测试、功能清单及 Ontology。
- 官方路径核对对象：OpenCode、Grok、DSH、Kimi Code、ZCode。

## 非目标

- 不核验 Claude、Codex 的官方技能目录。
- 不更改已核实正确的 CLI 全局目录，不改在线市场搜索/下载协议。
- 不增加 ZIP 格式以外的本地导入方式。

## 验收标准

- [x] 可从 Skills 市场选择本地 ZIP，并选择一个或多个 CLI 安装。
- [x] 单顶层目录 ZIP 安装目录名取自该目录，且不保留外层包装目录。
- [x] 根目录 ZIP 安装目录名取自 ZIP 文件名，内容不丢失。
- [x] 非 ZIP、缺少根 `SKILL.md`、越界路径、符号链接、加密条目及超限包均拒绝安装。
- [x] 五个非 Claude/Codex CLI 的默认用户技能目录保持与官方文档一致。
- [x] 相关构建、测试和文档校验通过。

## 影响面

- 代码目录：`src/config/`、`src/webview/`、`media/config/assets/`。
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/ontology/`。
- 配置与脚本：无。

## 风险与缓解

- 风险：ZIP 路径穿越、符号链接或解压炸弹可能写出临时/目标目录。
- 缓解：本地 ZIP 复用现有条目校验、体积限制、临时目录和 `installCliSkillDirectory` 的符号链接检查。
- 风险：扁平结构与单目录包装结构判断错误。
- 缓解：测试两种结构及缺失 `SKILL.md` 的拒绝行为；只在唯一顶层目录布局中剥离外层目录。

## 验证计划

- 最小相关验证：ZIP 安装单测、配置协议覆盖测试、Webview 脚本语法检查。
- 单元自测命令：`npm run build`；`node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliPageConfigCoverage.test.js`。
- 扩展验证：`git diff --check`、Ontology validate 和 Ontology 单测。

## 测试与清单同步

- 单元测试新增/更新：本地 ZIP 两种结构、多 CLI 落点和无效包拒绝。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/lobehubSkillMarket.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/cliGlobalSkills.test.js` 通过（42 项）；两个配置 Webview 脚本 `node --check` 通过；Ontology validate 与 9 项 Ontology 单测通过；`git diff --check` 通过。
- 失败处理记录：首次运行发现 UI 静态断言与当前文案不一致、`.zip` 隐藏文件名被 `path.extname` 提前归类为无效 ZIP；改为断言当前 ZIP 说明，并按 `.zip` 后缀识别文件，验证重跑通过。
- 功能清单：补充本地 ZIP 导入及命名规则。
- 相关文档同步：同步 CLI 技能市场规格及对应 Ontology 事实。

## 任务列表

- [x] 复核五个 CLI 的官方默认技能目录。
- [x] 增加安全 ZIP 选择、识别和安装流程。
- [x] 覆盖 ZIP 结构与协议回归。
- [x] 更新规格、清单和 Ontology。
- [x] 运行构建、单测及文档校验。

## 决策记录

- 2026-10-28：五个非 Claude/Codex 市场目标的默认目录均与官方资料一致；本次不改安装路径。
- 2026-10-28：通过 VS Code 原生文件选择器读取 ZIP，避免将压缩包二进制内容经 Webview 消息传输。
- 2026-10-28：本地 ZIP 接受根目录 `SKILL.md` 或唯一顶层技能目录两种布局；两者都复用扩展宿主安全解压和 CLI 技能目录替换流程。

## 当前结论

本地 ZIP 两种布局均已接通市场 UI、扩展宿主文件选择、CLI 多选安装和回归测试。OpenCode、Grok、DSH、Kimi Code、ZCode 的默认用户级技能目录与官方说明一致，无需改路径解析；全部构建、测试和文档校验通过。
