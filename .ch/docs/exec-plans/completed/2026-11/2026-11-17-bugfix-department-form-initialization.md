# 产研部表单精简与首次模型加载修复

- 日期：2026-11-17
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-17-bugfix-department-model-form.md`（保留已验收成果，本次为用户后续反馈）

## 背景与目标

用户要求把并发性能提示移至员工人数配置说明，组长/员工一行选择体验与 Loop+ 子模型一致，去掉沿用档案力度选项和右侧过期提示。补充反馈首次点击模型无下拉，切换角色 CLI 才恢复。

## 范围与非目标

范围为 Webview 的说明、角色选择和初始化消息顺序，相关回归、浏览器验证及事实文档。不改变宿主绑定/修订/ABA 守卫、冻结任务配置、持久化契约或既有用户修改，不发布扩展。

## 验收标准

- 面板和模式开关不显示黄色性能警告；全局/工作区员工人数说明保留性能指导。
- 角色一行仅保留 CLI、模型及适用的具体力度，所见力度与保存值一致，无沿用档案选项或指定右侧文案。
- 首次加载及从编码切入产研部均无需切换 CLI/重试即可获得可选择的模型；初始化自动修正力度不得使候选失效。
- 现有过期响应和保存门禁保持有效，构建、相关回归与生成页面浏览器验证通过。

## 影响面、风险与缓解

涉及 `src/webview/`、`src/test/webview/`、现有 `scripts/department_role_model_form_smoke.cjs` 和设计/清单/ontology。风险是模式与配置状态投影中提前发出候选请求；先发宿主设置消息，批量应用面板时延后部门投影，复用真实宿主处理器验证交错。修改前已在系统临时目录备份受影响原文件，回滚仅撤销本次增量。

## 验证计划与测试记录

- `npm run build` 后执行部门 Webview、模式可用性和模式进入相关 Node 测试。
- 增加实际模式事件和真实 `handlePanelMessageWithDeps` 的消息交错回归，保留宿主守卫。
- `DEPARTMENT_ROLE_FORM_EVIDENCE=<临时目录> node scripts/department_role_model_form_smoke.cjs`：生成页面 Chromium，检查首次加载、保存、窄屏和明暗主题。
- ontology validate 与其工具测试，范围空白与文档链接检查。
- 清理阶段构建通过；14 项单测中 13 通过、1 个夹具未恢复角色 CLI，修正夹具后最终相关用例通过。浏览器清理阶段报告 `passed=true/errors=[]`，未当作新增初始化缺陷的覆盖证据。
- 最终 `npm run build` 退出 0。`node --test dist/test/webview/departmentconfigurationwebview.test.js dist/test/webview/departmentmodelselectors.test.js dist/test/webview/modeavailability.test.js dist/test/webview/loopPlusModeEntry.test.js` 为 25/25；包括真实模式事件与宿主候选异步读取交错，无角色 CLI 切换、重试或第二条 panel。
- 共享面板入口拆为批量应用及投影收尾后，原 Loop 队列静态连线断言同步核对新的调用链。新增影响面验证 `node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/loop/loopPromptQueue.test.js` 为 202/202，日志 `/tmp/department-initialization-runtime-tests.log`。最终复核再将队列自动续发放到部门最终投影之后，避免读旧角色状态；重新 `npm run build` 后，将上述六个测试文件在同一 `node --test` 命令执行，最终 227/227，0 失败/跳过/取消，日志 `/tmp/department-initialization-final-tests.log`，不累计重复用例。
- 最终 `DEPARTMENT_ROLE_FORM_EVIDENCE=/tmp/department-form-initialization-final-20261117 node scripts/department_role_model_form_smoke.cjs` 退出 0，`result.json` passed=true、errors=[]；三种首次入口的消息经过真实宿主处理器并发执行，组长/员工首次模型可选且发出保存载荷。1280 深色、280 浅色截图已查看，无横向溢出；错误/缺档案/空模型/保存失败重试/ABA 及节点恢复仍通过。初次新增键盘步骤 `ArrowDown/Enter` 没有产生选项变更，属于原生 select 操作夹具不确定性，改用 Playwright `selectOption` 后通过，未据此改产品逻辑。
- ontology `--validate` 通过（2 domains / 160 rules），工具 9 项测试通过，`git diff --check` 通过，本次新增/调整的 3 个本地 Markdown 链接存在且大小写精确，归档检查通过。扩大到整份文档的粗扫描遇到已有示例“图片地址”和一个旧计划缺失链接，两者均确认已存在 HEAD，不属于本次新增，不扩大修复范围。
- 浏览器检查使用生成页面和隔离存储，不代表真实 VS Code EH、已安装扩展、真实 CLI 或其它操作系统验证。

## 决策与当前进展

- 用户澄清“和 Loop+ 子模型一行选项都一样”：保留具体力度，去掉沿用项，不整体删除力度选择器。
- 模式事件原来先渲染并请求候选、后发送模式设置，导致异步绑定读取期间上下文修订失效；面板初始化也可能在候选后自动归一化力度。修复发送与投影顺序，不削弱宿主校验。
- 表单精简和初始化修复已完成，设计/功能清单/ontology 已同步；复发原因上提既有 PITFALLS 条目。无新通用业务概念、无额外热区偏好，不更新 ROLLING_SUMMARY 或重复 EVENT_MEMORY；本次事实及验证由本计划承载。
