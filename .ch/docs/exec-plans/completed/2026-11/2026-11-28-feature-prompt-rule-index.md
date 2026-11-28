# 插件提示词规则索引

- 日期：2026-11-28
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 目标与范围

将 Vibe、经典 Loop、Loop+ 和产研部各角色的规则随插件发布。每轮传递角色、宿主事实、动作边界和分场景文件索引。保留用户原文、验收方案、冻结前缀、现有决策解析和回退入口。设计与基线见 `.ch/docs/design-docs/prompt-rule-index.md`。

## 实施与验收

- 从当前工作树实现可信资源清单、按角色选取、按需读取和完整提示词回退。保留并行开发中的调度、解析和角色变更。
- 首轮与纯报告对比相同输入下的规则及整轮字符数。验收覆盖未达标产物、失败原 ID 返工、全撤销、一次性派发窗口、免验报告、角色隔离和工具受限。
- 用 `npm run build`、相关 `node --test` 回归、成品 VSIX 资源核对和只读合成 CLI 场景验证。记录真实调用与静态测量各自的范围。
- 同步功能清单、设计和 ontology。缺包、版本不匹配或旧模式使用完整提示词。资源限于已加载的安装根，运行数据保持任务定向读取。

## 交付

插件从安装根加载 `media/prompt-rules/manifest.json` 和七个目录下的 29 份规则。构建时产生版本摘要，打包时校验正文。Vibe 和经典 Loop 使用各自的输入构造器，Loop+ 依宿主冻结的动作和事件选择条目，产研部按总监、组长或员工选择角色条款。

用户原始目标、补充需求、权限条件和已选验收要求随当轮传递。纯报告回执、验收前限一次派发、冻结顺序、失败留痕、原 ID 返工及独立任务归属均由宿主按原契约核验。局部低风险补充可直办，整个任务的 `completed` 仍须满足全部目标和收尾门禁。

## 回退与使用

本地默认 `indexed`。远程窗口采用 `inline`。工具受限时可选 `inline`，在首发中包含本轮条目。普通交互执行和 OpenCode 同次调用支持补发一次。一次授权的员工首发使用正文。设置 `sinitek-cli-tools.promptRuleDelivery` 为 `full` 并重载窗口可恢复完整构造器，包内摘要异常时自动走同一路径。

## 验证记录

- `npm run build` 通过。`node --test` 对提示词构造、交互/单次/并发入口、OpenCode 补发、经典 Loop 决策、Loop+ 协议/调度/完成门禁、产研部组装等 20 个相关测试文件执行 903 项，全部通过。
- `node scripts/verify_prompt_rule_index.cjs` 固定输入对照，首次决策 `Rules` 从 31,426 降至 2,055 字符，纯报告从 31,426 降至 365，单项验收从 32,986 降至 2,485。混合验收、冻结顺序、选中专项原文、全撤销及读失败补发各有回归断言。
- `node scripts/verify_prompt_rule_index.cjs --live` 对照同一合成需求和虚报的交付。两个输入版本独立检查产物并按原逻辑 ID 返工。精简正文后一次配对的累计输入为完整 218,944、索引 166,865，工具调用分别为 7、12。更早配对的累计输入方向相反。详细耗时、缓存与测量口径见[设计与实测](../../../design-docs/prompt-rule-index.md)。
- `python3 -m unittest discover -s scripts/tests -p 'test_export_vscode_extension.py'` 通过 22 项。隔离 staging 中 `vsce package` 生成 1.10.6 通用包。1,368 项归档条目通过成品审计，解包到中文含空格的路径成功加载全部规则。真实 CLI 从解包目录的助手按 FIFO 提交两条报告回执。
- `node scripts/verify_department_host_activation.js` 在隔离的 macOS Extension Host 激活当前插件，退出时进程和 Owner 标记已清理。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 和 `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 通过。功能入口已写入 `FEATURE_INVENTORY.md`，业务规则登记为 `plugin.rule.prompt_rule_index`。

## 范围与证据

真实模型检查覆盖本机 Loop+ 的产物验收、发现漏项后补读及纯报告回执。其它角色通过构造器、执行入口和调度回归验证。原生 Windows/Linux、远程窗口内的真实模型以及全模式端到端的统计质量属于后续对照场景。临时数据、构建包和原始计数保存在本次工作区忽略的 `.tmp/` 下。本机安装包位于 `.tmp/prompt-rule-delivery/sinitek-cli-tools-1.10.6-indexed.vsix`。
