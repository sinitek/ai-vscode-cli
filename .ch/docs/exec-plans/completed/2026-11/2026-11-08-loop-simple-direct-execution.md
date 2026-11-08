# Loop / Loop+ 简单任务直办

- 日期：2026-11-08
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop 与 Loop+ 当前强制将文件操作委派给子任务，Loop+ 还要求固定验收反馈。
对需求明确、操作特别简单且无需独立验收的任务，主任务应直接完成并收口，
不将用户举例的操作类型当作白名单，也不以文件数或行数替代复杂度与风险判断。

## 范围与非目标

- 调整两种模式的主任务提示规则，增加简单任务直办优先级。
- Loop+ 增加受宿主状态约束的直接完成协议，省略子任务验收字段。
- 保留复杂任务委派、已派发任务验收、角色配置失败不得回退主模型等约束。
- 不变更 CLI、模型配置、UI、依赖或并发调度算法。

## 验收标准

- 特别简单、明确、低风险、无独立验证要求的工作由主任务直办，不限操作类别。
- 不因行数少就绕过用户或项目的测试、构建、权限、安全和验收要求。
- 每一轮（含补充需求、继续、验收和收尾）都应用直办判断；既往委派历史不禁止直办。
- Loop+ 无开放子任务、未处理验收或额外审查要求时，可用精简 completed 收口。
- 有正在运行、排队或待验收任务时，可处理不冲突的简单补充事项，但不能提前结束原任务。
- 构建、相关回归测试与 ontology 校验通过。

## 影响面与风险

- 代码：Loop / Loop+ 主任务提示、Loop+ 决策解析与宿主接线。
- 文档：功能清单、调度设计、架构与运行时规格、ontology。
- 风险：把小范围高风险修改误判为简单；用直办协议跳过子任务验收。
- 缓解：明确语义条件，宿主仅为无开放工作、待验收事件且无额外审查的任务开放精简协议；保留既有完成门禁。

## 验证计划

- `npm run build`。
- `node --test dist/test/loop/loopPlusDecision.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/subtaskCliExecution.test.js`。
- 扩大相关验证：`node --test dist/test/loop/*.test.js dist/test/extensionHost/loop*.test.js dist/test/extensionHost/subtaskCliExecution.test.js`。
- 覆盖模式、所有提示阶段、精简完成成功、非法字段、开放工作及自定义审查拒绝、既往验收后直办、补充需求排队与最终收口。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`。
- 本次不修改页面，无需浏览器验收。真实 CLI 模型调用未执行；通过生产 runtime adapter、真实临时任务存储和文件写入验证七种 CLI 路由，不把模拟模型回复当作真实模型验收。

## 测试与清单同步

- 单元测试新增/更新：决策解析、两种模式的全部提示阶段、经典多轮主任务、Loop+ 调度宿主与七种 CLI 路由的生产适配器集成测试。验收夹具遇到 `directCompletion` 时不再补入验收字段。
- 单元自测结果：`npm run build` 通过；最小范围曾通过 160 项，最终扩大相关回归 653/653 通过；ontology 校验通过，ontology Python 测试 9/9 通过；`git diff --check` 通过。
- 失败处理记录：新增夹具沿用旧辅助函数自动补验收导致精简协议被拒，已更新辅助函数并回归；集成测试缺少 `PromptRunInput` 必填项导致编译失败，已补齐；同步模型回调内补充消息导致夹具重入，已使用异步边界模拟实际 CLI 等待，最终全部通过。没有修改无关实现或放宽验收断言。
- 功能清单：已同步简单任务例外、每轮与补充需求范围，以及保留的验收边界；调度设计、架构、运行时能力与 ontology 同步。
- 记忆：稳定规则进入设计与 ontology，不追加自动任务记录到热区摘要。

## 当前进展

Tasklist:
- [completed] 定位主任务禁止实现与强制验收约束
- [completed] 实现按复杂度判断的简单任务直办路径
- [completed] 执行回归验证并同步事实来源

## 决策与最终结论

- 直办是每轮语义规则，不做操作白名单或行数/文件数分类；简单事项不创建子任务或额外验收。
- 精简完成资格与直办操作权限分离：有其它开放工作时仍可处理独立简单补充事项，但不能提前完成父任务；历史子任务本身不取消资格。
- 保留用户/项目验证要求、已委派工作验收、附加审查及配置失败禁止回退主模型等边界。
- 不新增运行时依赖、UI、CLI 配置或模型调用；未验证真实模型遵循提示的表现，实际复杂度判断仍由模型结合上下文完成。
- 无需更新热区记忆、runbook 或 EVENT_MEMORY：稳定事实已归入设计、能力清单和 ontology，测试夹具注意事项保留在本计划及回归用例。
