# ZCode 默认配置修复与精简

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈默认配置仍无法执行，要求实际跑通、同步精简配置文件、范例和可视化，并默认打开 JSON。
本机日志最新错误为 `ZCode model resolver is not configured.`；现有默认配置经 `zcode --json -p` 可返回结果，需验证插件完整启动链路，不能把终端成功当作插件成功。

## 范围与非目标

- 修复 ZCode 交互依赖接线及必要的模型选择参数。
- 依据本机官方 ZCode 0.17.0 实现与实际运行精简参数，不凭猜测删除必填字段。
- 范例模型保持 `glm-5.3-flash`，真实配置保持已验证可用的 `glm-5.3-flash_sub-coco` 与原有凭据；保存的默认档案同步到可用模型，修改前备份，权限保持 `0600`。
- 可视化沿用共享输入组件、主题和公共参数／左侧模型列表／右侧参数布局；非必要信息不要求填写，兼容保留未展示字段。
- JSON 默认显示，范例仍经共享抽屉查看与导入，导入不自动保存。
- 不同步 Git、不提交、不修改无关 CLI、运行任务记录或此前工作区改动。

## 验收标准

- 插件启动接入实际模型解析器，默认模型携带有效思考档位，不再触发缺依赖／缺参数错误。
- 默认配置、精简范例和可视化序列化配置均通过本机 ZCode Protocol 实际任务验证。
- JSON 首次打开及切换档案后均为默认模式；两种模式切换、抽屉、保存和非展示字段保留不回归。
- 范例无真实凭据；相关回归测试、构建、页面验证和结构检查通过。

## 影响面与风险

- `src/config/zcodeConfig.ts`、ZCode 启动与协议、`src/extension.ts`、配置页资产和对应单测。
- `docs/zcode-guide.md`、功能清单、运行时参考与必要 ontology 规则。
- 简化不能丢失其他供应商、模型能力覆写和未知字段；测试覆盖往返保留。
- 本机配置仅在实际验证精简形式可用后原子替换；备份不进入仓库、不输出密钥。

## 验证计划

- `npm run build` 和 ZCode 配置、协议、运行时、相关配置页测试。
- 临时工作目录运行真实 ZCode runner 写入算法文件并执行校验；验证原生默认配置与范例的安全副本。
- Headless Chromium 检查默认 JSON、精简表单及范例抽屉，记录宿主桥接隔离边界。
- `git diff --check`、ontology 校验、Impeccable 检测。

## 进度与证据

- 已脱敏检查本机默认配置；直接 CLI 返回 `ZCODE_CONFIG_CHECK`，日志 `/tmp/sinitek-zcode-config-before.log`。
- 已发现 `src/extension.ts` 未向交互宿主传递 ZCode 模型解析器。
- 已补齐宿主模型解析接线；创建会话先传配置档位，再根据快照决定是否应用用户思考偏好。不支持的继承 `medium` 不下发，ZCode `max` 不通用降级。
- 已精简默认配置、保存的默认档案及范例，删除冗余排序、名称、启用标记和能力覆写，保留原生必需的 `group` 与两个空规则数组。真实配置从 1326 字节缩为 884 字节，配置与档案均为 `0600`；档案 `content` 与 `configContent` 一致。
- 真实配置备份在 `~/.zcode/v2/provider_config.json.bak-*`，保存档案备份在 `~/.zcode/__config/*.bak-minimal-*`，不进入仓库。没有输出或复制真实密钥。
- 本机网关对范例模型名返回 HTTP 404，原因是未配置该 ID；保存档案原先误用范例名称，现已改为实际可用的 `glm-5.3-flash_sub-coco`。仓库范例按用户要求仍为 `glm-5.3-flash`，文档说明模型 ID 必须匹配实际服务。
- 可视化保留共享主题、公共参数顶置及模型双栏，去掉非必要能力和上下文字段；未展示字段与手动模型规则往返保留。非推理模型不强制填写或序列化思考参数。
- 首次打开、切换档案及导入均默认 JSON。范例使用共享抽屉，“一键导入”只在抽屉内；导入不自动保存或应用。
- 已同步用户指南、功能清单、运行时参考及 ontology。稳定排查结论已进入 `docs/zcode-guide.md`，不再重复写入热区或事件记忆。

## 验证结果

### 本机真实运行

- `node /tmp/sinitek-zcode-config-live.cjs`：临时精简配置经真实 ZCode Protocol 创建 `bubble-sort.cjs`，五组数组断言通过；范例替换为本机真实连接信息和可用模型后，经可视化序列化再运行，实际写出校验文件；持久化后的真实默认配置返回 `ZCODE_REAL_DEFAULT_OK`。日志 `/tmp/sinitek-zcode-config-live.log`。
- `node /tmp/sinitek-zcode-default-recheck.cjs`：使用真实默认配置路径和插件启动适配器，继承 `medium` 时保留配置 `max`，真实生成冒泡排序文件，通过空数组、单元素、乱序、重复值及负数五组断言，输出 `ZCODE_DEFAULT_BUBBLE_SORT_OK`；显式 `high` 启动保持 `high`。上下文计数有效，窗口为 200000。日志 `/tmp/sinitek-zcode-default-recheck.log`。
- 实际 ZCode 子进程、网络服务和写文件任务均真实；只使用项目 VS Code mock 加载宿主模块，不声称已在正在运行的 Extension Development Host 中点按验证。宿主依赖接线由源码契约测试和完整交互宿主单测覆盖。
- 任务临时目录已清理，未修改用户项目文件。更新后需要重新加载扩展宿主／VS Code 窗口，不能只重开配置 Webview。

### 构建与单元测试

- `npm run build`：通过，日志 `/tmp/sinitek-zcode-config-build.log`。
- `node --test dist/test/config/zcodeConfig.test.js dist/test/interactive/zcodeAppServerProtocol.test.js dist/test/interactive/zcodeRunner.test.js dist/test/interactive/zcodeTrace.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/extensionHost/cliModelSelectionStrategies.test.js dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/config/configService.test.js dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/configappcompactcontrols.test.js dist/test/config/configappcompactlayoutstyles.test.js`：155/155 通过，日志 `/tmp/sinitek-zcode-config-regression.log`。
- 新增／更新覆盖：默认档位优先、供应商规则快照替换、隐藏字段与重命名保留、必需结构、JSON 默认、范例抽屉、真实宿主接线、嵌套错误脱敏、未公布档位不下发、显式 high 延迟应用、max 不降级及非推理模型省略参数。
- 两项 OpenCode 全文件否定断言误匹配新 ZCode 思考字段，已限定到 OpenCode 片段；原 OpenCode 无思考控件的约束保留。新 runner 测试的初次失败为错误文案匹配写错，已修正后重跑。
- `npm run test:page`：313 项，308 通过，5 项范围外失败，日志 `/tmp/sinitek-zcode-config-page.log`。其中历史会话两项夹具缺 `formatCliDisplayName`、静态渲染一项旧 Grok option 断言、会话错误标签一项 `errored` 为 undefined，与先前记录的四项一致；另有静态帮助文案仍断言“加入到携宁 CLI 引用”，当前已有文案为“加入到携宁 CLI 引用”。该测试只依赖聊天 Webview，相关源文件在任务开始前已有改动，本轮未修改；未为使全量绿灯修复无关问题。

### 页面与结构

- 通用 `chromium-playwright-smoke` runner 在 1440×1000、760×1000 各执行 JSON 默认、精简可视化、范例抽屉、范例导入、切换档案五项场景，10/10 通过；无浏览器、HTTP 或网络错误。结果与截图在 `/tmp/sinitek-zcode-config-browser/<scene>-<width>/`，已查看桌面 JSON、桌面可视化及窄屏可视化截图。
- 额外 Playwright 断言：两个宽度下导入模型均为 `glm-5.3-flash`，合成桥接器未收到 save/apply 调用。日志 `/tmp/sinitek-zcode-config-import-guard.log`。
- 页面使用真实 `getConfigViewHtml` 与前端资产，但配置数据和 VS Code bridge 为隔离夹具，不接真实档案、无用户数据持久化。窄屏第一次失败是场景重复打开已展开目录；额外断言初次因隐藏的重复目录项造成 strict locator 冲突，改为可见目录项后通过，均不作为产品缺陷。
- `git diff --check`、`node --check media/config/assets/config-app-ui.js`、ontology `--validate` 均通过；ontology 测试 9/9 通过。
- Impeccable detector 检查配置页资产返回 `[]`，无检测项，记录 `/tmp/sinitek-zcode-config-design-check.json`。
- 保留既有工作区改动，不提交、不切分支、不同步 Git、不修改 Loop 调度或任务记录。测试启动的浏览器服务在收尾停止，日志和截图保留作为证据。

## 决策记录

- 2026-10-29：先修复插件依赖缺失，再以真实协议验证确定最小配置；保留可视化未展示的原有覆写。
- 2026-10-29：不通过复制能力目录解决必填档位；直接在默认模型选择中声明所选档位，待模型公布能力后再应用用户偏好。
- 2026-10-29：区分范例名称与网关实际模型，保留用户要求的范例名称，不冒称该名称已在本机服务上跑通。
