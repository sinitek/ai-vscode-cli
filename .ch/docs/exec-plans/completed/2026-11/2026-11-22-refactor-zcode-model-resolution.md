# 消除 ZCode 运行配置的重复解析

- 日期：2026-11-22
- 类型：refactor
- 状态：completed
- 关联计划：无

## 背景与目标

ZCode 仓储运行前生成模型摘要，文本 wire resolver 又生成摘要并重新解析 provider view。让一次解析生成两种选择依据，不改变运行结果。

## 范围与验收

- [x] 配置解析模块和仓储共享单次解析结果；仓储只保存摘要，不保存凭据、原文或 provider view，不做跨次解析缓存。
- [x] 保留公开文本入口、模型选择与推理规则、原错误文案，以及读取、身份识别、写缓存、返回或抛错的时序。
- [x] 更新 ZCode 运行设计，使用独立临时输出目录构建并运行两个配置测试文件。

## 风险与缓解

尤其区分原配置默认模型和摘要回退模型，避免后者误用默认推理力度。验证模型 ID、推理优先级、错误及缓存时序。变更限于 ZCode；回退时一并恢复该解析入口和仓储调用，不涉及配置迁移或其它 CLI。

## 验证与清单

- 构建：`npm run build -- --outDir /var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/zcode-model-resolution.gbts34`，通过；编译输出随后已清理。
- 单测：从上述临时输出目录执行 `NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules node --test test/config/zcodeConfig.test.js test/config/configuredModelRepository.test.js`，38 项通过、0 失败。该目录临时链接仓库 `media`，随后已清理。
- 没有针对真实 ZCode CLI 或真实用户配置做启动验证；不属于单次解析单元测试的覆盖范围。
- 无用户可见能力或行为变化，功能清单无需更新。设计依据是两种既有公开文本入口维持原规则及错误，改动仅在等价的单次求值和仓储内共享中间摘要/推理选择表。

## 任务列表

- [x] 提取一次解析生成模型摘要和推理选择依据。
- [x] 仓储读取当前 content 并在返回或抛错前更新摘要缓存。
- [x] 覆盖单次解析、缓存身份和选择边界，更新运行时设计。
- [x] 独立构建、运行相关测试并清理临时产物。

## 决策记录

- 2026-11-22：只在当前调用中携带 reasoning level 按模型索引的选择表，公共 wire 文本入口仍自行解析一次；仓储持久化的仅是 `ZcodeConfigModels` 摘要。

## 当前结论

同次运行使用同一份解析生成的模型摘要和推理依据，不增加配置读取，不缓存跨调用解析结果。构建与两份相关测试均通过。真实 CLI/用户配置启动未验证。
