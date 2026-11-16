# 部门成员树固定角色头像验证

本补充要求仅改变部门成员树头像文字：总监为“总”、组长为“组”、员工为“员”。角色来自 `renderDepartmentRosterPanel` 的局部层级角色参数，其类型限制为这三类；不从任务标题或 participant.role 的 main/subtask 推断。初始 HTML 与 contentPatch 使用相同渲染路径，总监页及组长 iframe 均生效，包括空标题、同名任务、任意标题首字及待创建组长。

保留嵌套结构、标题左侧头像、28px 圆形、12px 居中文字、成员间距 8px、行内边距 4px 和 badge 主题变量。标题、角色文字、状态、额度行、群聊入口、可访问名称和交互位置保持原设计。普通 Loop/Loop+ 成员头像、时间线头像、Tab 原名及 👴🏻👨🏻👶🏻 不变。没有修改授权、额度消息、执行逻辑或 opaque iframe 安全边界。

## 可复用有界入口

在从已接受 `da47ec72295416fd4a7ff7c877bc483d658e77ff` 建立的独立物理树中先执行标准构建；不要在冻结来源或共享树清理 dist。

```sh
npm run build
node --test --test-name-pattern='initial HTML and content patch|ordinary Loop and Loop' dist/test/loop/departmentGroupChatPanel.test.js
node --check scripts/department_group_chat_smoke.cjs
node --check scripts/department_member_role_avatar_scenario.cjs
```

本轮物理树：`/private/tmp/department-role-avatar-round441-20261116`。本轮浏览器实际命令（从该树运行）：

```sh
NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules \
DEPARTMENT_UI_DIST=/private/tmp/department-role-avatar-round441-20261116/dist \
DEPARTMENT_UI_EVIDENCE=/private/tmp/department-role-avatar-round441-evidence/browser-confirmed \
DEPARTMENT_UI_ROLE_AVATAR_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH='/Users/fangjiawei/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
node scripts/department_group_chat_smoke.cjs
```

该模式复用原入口创建的独立 headless Chromium、动态端口、真实编译 Webview 生成器、departmentState、主题和 iframe 注入机制；不复制生产页面。只运行 1440 深色和 280 浅色。无登录、用户会话、凭据或外部模型请求。普通入口与旧模式保留；此次不执行旧全矩阵。

## 实际结果与证据

证据根为 `/private/tmp/department-role-avatar-round441-evidence/`。

- `build.log`：标准 `npm run build` exit0。
- `render-tests.log`：既有初始 HTML/contentPatch 两角色用例及普通 Loop/Loop+ 用例，3/3 通过；未为静态字形另建单元套件。
- `browser-first/result.json`：首轮两视口均通过，动态端口 63410，browserErrors 均为空。截图复查发现窄屏截图停在成员树上方；该结果仅保留为首轮证据，不作为最终代表截图。
- 只调整 helper 截图前的滚动位置，再执行同一有界模式，输出 `browser-confirmed/`：两视口通过，端口 63646，browserErrors 均为 `[]`。未修改生产 TS，因此未重复有效构建或渲染测试。
- 最终断言覆盖总监、三个组长（含未创建任务）和两个员工的“总/组/员”；非角色首字、同名、空标题；总监与组长初始树及真实 contentPatch 后稳定字符，且页面/iframe 不重载；28px/12px/圆形/居中/8px/4px；根、sidebar、iframe 无横向溢出；打开组长、员工验收定位、返回总监及入口归焦。没有额度写请求。
- 保存每视口四张成员树截图、初始生成 HTML、patch 后 DOM HTML、inputs.json 与 result.json；最终桌面/窄屏代表截图已人工查看。pageerror、console error、requestfailed、HTTP>=400 均严格采集并失败，不添加错误忽略项。
- 完整最终输入及产物 SHA-256 清单见证据根 `final-hashes.json`；提交身份和命令/结果以 round441 attempt 报告为准。源码及脚本在最终浏览器后未改；后续仅新增本 runbook、检查、提交和报告。

## 复用与交接边界

round431 标准 build、相关单测、1440 深色/280 浅色额度浏览器结果仅按未变范围复用，不能覆盖本次固定角色头像；本轮新增证据只关闭显示字符缺口。原额度、弹窗焦点、消息授权及生产测试在未变范围复用。未重跑 tabs、旧主题/队列矩阵、冷恢复、额度真实宿主、真实 EH/CLI、生产调度、Windows/Linux 或最终合并树全量回归。本轮是显示 fixture 验证，不是新的生产 EH/CLI 通过证明。

中央 FEATURE_INVENTORY 由并行冷恢复任务拥有，本轮不竞争写入；统一整合时应汇入“部门成员树头像按层级固定为总/组/员”这一既有角色显示补充要求。没有新增业务概念、关系、权限、生命周期或事实来源变化，无需修改 ontology；没有修改中央 active 计划或历史材料。仍需主审及统一产品整合，不发布。
