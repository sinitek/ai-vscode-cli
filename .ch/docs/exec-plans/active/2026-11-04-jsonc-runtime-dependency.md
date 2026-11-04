# 修复 VSIX 缺少 jsonc-parser 导致扩展无法激活

- 日期：2026-11-04
- 状态：in-progress
- 负责人：Codex

## 背景与目标

`src/config/modelimport.ts` 在扩展加载阶段直接导入 `jsonc-parser`，但项目未声明该生产依赖。本机开发依赖 `@vscode/vsce` 间接安装了该包，掩盖了 VSIX 生产依赖收集时的遗漏。目标是恢复已发布功能的可加载性，并在打包阶段阻止同类遗漏。

## 范围与非目标

- 修复生产依赖声明、保持现有版本和 `.vscodeignore` 放行约定。
- 在现有通用包与平台包审计中检查解析器的包描述和 CommonJS 入口，并补回归测试。
- 同步打包运行手册、功能清单与已有 ontology 规则。
- 不修改模型导入业务逻辑，不升级框架或其他依赖，不发布市场版本，不改动用户已有 README 和版本号修改。
- 当前工作区继续修复，不创建分支或 worktree；锁文件按仓库规则仅本地更新，不纳入交付。

## 验收标准

- [ ] `jsonc-parser` 是显式生产依赖，版本沿用本机已有的 3.3.1。
- [ ] 通用包及所有支持的平台包均保留并审计解析器；缺少入口或包描述时拒绝导出。
- [ ] 最小打包回归、模型导入回归、Python 脚本测试与构建通过。
- [ ] 实际导出 VSIX，并在仓库外隔离目录加载其解析器与模型导入模块。

## 影响面与风险

- 配置：`package.json`、`.vscodeignore`。
- 脚本与测试：`scripts/vsix_target.js`、`src/test/shared/vsixPackaging.test.ts`。
- 文档：打包运行手册、功能清单、已有 VSIX ontology 规则。
- 风险：开发机依赖可能掩盖打包缺失；通过最终 ZIP 审计和隔离加载验证规避。
- 平台：纯 JavaScript 依赖不改变平台支持范围；Windows 原生扩展宿主验证留给实际 Windows 环境。

## 验证计划

- 先添加回归测试并验证其在修复前失败。
- `npm run build`
- `node --test dist/test/shared/vsixPackaging.test.js dist/test/config/modelimport.test.js dist/test/config/modelimportui.test.js`
- `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
- `python3 scripts/export_vscode_extension.py`，再从导出包提取文件到系统临时目录进行 Node 加载验证。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- `git diff --check`

## 任务列表

- [x] 确认根因和既有用户修改。
- [x] 添加回归测试并修复生产依赖与打包护栏。
- [ ] 完成构建、测试、真实打包和隔离验证。
- [ ] 同步文档并归档计划。

## 测试与清单同步

- 单元测试：增加生产依赖声明和所有打包目标的解析器资源检查。
- 功能清单：同步既有 VSIX 运行时完整性保证，不新增产品能力。
- 记忆：可复用原因与处理方式写入既有打包 runbook；无需重复写入滚动摘要。
- 修复前打包回归：16 项中 14 项通过、新增 2 项如预期失败，分别暴露生产依赖缺失与资源审计遗漏。
- 测试实现调整：首次构建因测试使用 ES2022 的 `Object.hasOwn` 失败，已按项目 ES2020 目标改为既有 `Object.prototype.hasOwnProperty.call` 写法，重跑构建通过；未调整编译配置。
- 修复后结果：待验证。

## 当前结论

CodeGraph 定位到现有 VSIX 审计与回归入口；直接读取源码、生产依赖声明和本地锁文件确认：解析器仅作为开发工具的传递依赖存在，生产依赖收集不会包含它。
