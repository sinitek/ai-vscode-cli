# 修复 VSIX 缺少 jsonc-parser 导致扩展无法激活

- 日期：2026-11-04
- 状态：completed
- 类型：bugfix
- 负责人：Codex

## 背景与目标

`src/config/modelimport.ts` 在扩展加载阶段直接导入 `jsonc-parser`，但项目未声明该生产依赖。本机开发依赖 `@vscode/vsce` 间接安装了该包，掩盖了 VSIX 生产依赖收集时的遗漏。目标是恢复已发布功能的可加载性，并在打包阶段阻止同类遗漏。

## 范围与非目标

- 修复生产依赖声明、保持现有版本和 `.vscodeignore` 放行约定。
- 在现有通用包与平台包审计中检查解析器的包描述和 CommonJS 入口；回归开发不属本计划，历史摘要按关联删除审计定位。
- 由关联文档计划同步打包运行手册、功能清单与已有 ontology 规则；本计划不承接独立文档写作。
- 不修改模型导入业务逻辑，不升级框架或其他依赖，不发布市场版本，不改动用户已有 README 和版本号修改。
- 当前工作区继续修复，不创建分支或 worktree；锁文件按仓库规则仅本地更新，不纳入交付。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-jsonc-runtime-dependency.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 历史文档分工：原 docs companion `2026-11-04-docs-jsonc-runtime-dependency.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。本计划只承接依赖声明与打包护栏修复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- [x] `jsonc-parser` 是显式生产依赖，版本沿用本机已有的 3.3.1。
- [x] 通用包及所有支持的平台包均保留并审计解析器；缺少入口或包描述时拒绝导出。
- [x] 生产依赖声明与所有支持平台包的解析器资源护栏完成；相关回归、构建和导出结果作为验证证据记录在关联计划与本计划下方。
- [x] 实际导出 VSIX，并在仓库外隔离目录加载其解析器与模型导入模块，作为修复验证而非本计划的测试开发交付。

## 影响面与风险

- 配置：`package.json`、`.vscodeignore`。
- 脚本与测试：`scripts/vsix_target.js`、`src/test/shared/vsixPackaging.test.ts`。
- 文档：打包运行手册、功能清单、已有 VSIX ontology 规则。
- 风险：开发机依赖可能掩盖打包缺失；通过最终 ZIP 审计和隔离加载验证规避。
- 平台：纯 JavaScript 依赖不改变平台支持范围；Windows 原生扩展宿主验证留给实际 Windows 环境。

## 验证计划

- 历史上先添加回归并确认修复前失败，再执行修复后的验证命令；结果见下文，删除审计仅保留摘要，不再提供存活测试计划入口。
- `npm run build`
- `node --test dist/test/shared/vsixPackaging.test.js dist/test/config/modelimport.test.js dist/test/config/modelimportui.test.js`
- `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
- `python3 scripts/export_vscode_extension.py`，再从导出包提取文件到系统临时目录进行 Node 加载验证。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `git diff --check -- <本次修改路径>`

## 任务列表

- [x] 确认根因和既有用户修改。
- [x] 修复生产依赖与打包护栏（不承接回归开发；历史测试摘要见关联删除审计）。
- [x] 完成构建、打包和隔离加载验证。
- [x] 记录实现状态与未覆盖平台边界（文档写作原由已退役 docs companion 承接（仅历史分工））。

## 测试与清单同步

- 历史测试摘要见上列删除审计；`2026-11-04-docs-jsonc-runtime-dependency.md` 当时承担（该页已退役，仅历史分工）运行手册、功能清单和 ontology 规则同步。本节仅保留实现验收所引用的历史验证证据，不承接新增回归开发。
- 修复前打包回归：16 项中 14 项通过、新增 2 项如预期失败，分别暴露生产依赖缺失与资源审计遗漏。
- 测试实现调整：首次构建因测试使用 ES2022 的 `Object.hasOwn` 失败，已按项目 ES2020 目标改为既有 `Object.prototype.hasOwnProperty.call` 写法，重跑构建通过；未调整编译配置。
- 修复后构建：`npm run build` 通过，真实导出时的 prepublish 构建同样通过。
- Node 最小相关回归：72 项全部通过，覆盖打包、模型导入与模型导入 UI 协议。
- Python 脚本测试：44 项完成，43 项通过、1 项按既有条件跳过；未执行实际市场发布。
- Ontology：`--validate` 通过，ontology 查询脚本 9 项单测全部通过。
- 生产依赖：离线刷新本地锁文件后，`npm ls --omit=dev jsonc-parser` 显示直接生产依赖 `jsonc-parser@3.3.1`。
- 真实导出：`python3 scripts/export_vscode_extension.py` 通过，通用包 `dist/sinitek-cli-tools-1.8.1.vsix` 含 1175 个 ZIP 条目，37,690,513 字节（35.94 MiB），其中解析器文件 19 个。
- 隔离验证：将最终 VSIX 解压到系统临时目录，清除 `NODE_PATH`，确认不存在开发工具 `@vscode/vsce`，仍可从包内加载 `jsonc-parser@3.3.1`、解析带注释和尾随逗号的 JSONC，并加载和调用 `dist/config/modelimport.js` 的纯函数入口。
- 空白检查：全量 `git diff --check` 命中用户并发修改的 `AGENTS.md:8` 既有尾随空格；未改动该文件。本次修改路径的定向检查通过。
- 未覆盖：未运行全仓 Node 单测、未在真实 Windows VS Code 扩展宿主激活；本次无页面实现改动，不需要浏览器视觉验证。Windows 需要安装新生成的通用 VSIX 并重载窗口确认最终激活。

## 当前结论

根因是运行时代码直接导入了未声明的生产依赖，开发工具的传递依赖掩盖了遗漏。已修复声明和放行规则，完成通用包及所有平台包的资源审计护栏；最终 VSIX 已通过 ZIP 审计和仓库外隔离加载。新增回归是历史工作，摘要按上列删除审计的完整来源值定位，不转入本 bugfix 计划；运行手册/功能清单/ontology 同步原由已退役 docs companion 承接（仅历史分工）。保留用户已有 README、版本号及并发 AGENTS 修改，没有发布市场版本。
