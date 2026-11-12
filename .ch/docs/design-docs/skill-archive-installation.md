# 技能 ZIP 安装边界

## 目标与设计

这是行为保持重构，不新增用户能力，也不改变配置页、HTTP 策略或技能目录规则。原 `lobehubSkillMarket.ts` 同时负责市场 HTTP、本地输入/布局/命名、安全解压、多平台安装和临时目录；市场与本地还重复维护安装结果和 finally 清理。

保留旧文件作为兼容 **Facade**，用一个 typed 函数 `installSkillArchive` 作为函数式 **Template Method**：固定安全解压、来源发现、逐技能逐平台安装、结果组装和 finally 清理，把真实来源差异留给 `resolvePackages(tempRoot)`。不引入模式旗标、继承、容器、注册表或依赖。

## 责任与调用方向

```text
configService / 旧调用方
  → lobehubSkillMarket.ts（原公开入口，显式具名 re-export / type alias）
      → 市场输入、搜索响应、允许地址与下载、findSkillPackages
      → localSkillZip.ts（本地字节/路径输入、resolveLocalSkillPackage）
  两种来源 → skillArchiveInstaller.ts
               → 安全 ZIP 解压
               → resolvePackages(tempRoot) 返回 identifier 和有序 packages
               → installCliSkillDirectory（既有路径/替换/回滚/符号链接规则）
               → finally 删除临时目录
```

共享模块只依赖 Node、既有 yauzl、中文错误与 CLI 安装器，不反向依赖市场 Facade、本地入口、VS Code 或 HTTP。`SkillMarketError` 在共享模块只定义一次；平台规范化、共同结果类型和默认上限也在该层。来源在调用模板前完成原有预处理，下载成功后才创建临时目录。HOME 和临时根目录不在模块加载时捕获。

## 刻意保留的差异

| 来源 | 发现与命名 | 临时前缀 |
| --- | --- | --- |
| 本地 | 根有 `SKILL.md` 优先，名称取 ZIP 文件名去扩展；否则忽略隐藏顶层项及 `__MACOSX` 后必须唯一合法包装目录，名称取目录名。忽略项只参与布局检测，不是内容过滤器。拒绝非 portable 名称，不使用 frontmatter name。 | `sinitek-local-skill-` |
| 市场 | 递归跳过隐藏目录/符号链接，发现父技能后仍递归；合法 frontmatter name → 目录名 → identifier；按名称、目录排序，不去重同名技能。不套用本地 portable 规则，空包保留 noSkill 错误。 | `sinitek-lobehub-skill-` |

输入平台去重保留首次出现顺序；安装为有序技能外循环、平台内循环。单目标失败记录 `failed/message` 后继续，全部失败也返回结果；预处理、解压和发现错误仍拒绝。缺少描述时不生成 description 字段，清理错误仍传播并可覆盖原异常。

## 安全与兼容

- 原入口的四个 async 函数、`MAX_SKILL_ZIP_BYTES` 和六个已有导出类型保留；`configService.ts` 不改调用路径。市场 `fetchImpl` / `maxZipBytes` 注入不变。
- ZIP 默认 32 MiB、单条目 16 MiB、解压总量 64 MiB、500 条目；保留 yauzl 参数、文件名/边界校验、符号链接/加密/不可解码拒绝、实际流字节上限、stream.destroy 与 zipfile.close。仍然串行解压和安装。
- HTTP 的 HTTPS/主机白名单、手动重定向、三次跳转、20 秒超时、请求头、响应大小及错误转换代码原样保留。
- 路径输入仍先检查扩展名，再 stat/大小/read，最后进入本地平台校验；不统一两种来源原本不同的副作用顺序。

## 扩展与验证

以后若确有新 ZIP 来源，新增一个明确的输入/获取与发现适配器，传入字节、上限、原有前缀、已规范化平台和发现回调；不要往模板添加来源模式分支。下载、来源命名和 noSkill 等来源特定错误留在适配器。

`src/test/config/lobehubSkillMarket.test.ts` 保留原行为断言；`src/test/config/skillArchiveInstaller.test.ts` 覆盖公开导出、两种本地布局、市场嵌套/同名顺序、失败继续与全失败、临时目录成功/失败清理、清理错误传播、校验顺序及 ZIP 边界。共用造包和临时 HOME 夹具在 `src/test/config/skillArchiveFixtures.ts`，只使用隔离文件系统与注入 fetch。

重构实施记录见 `.ch/docs/exec-plans/completed/2026-11/2026-11-08-refactor-skill-archive-installation-refactor.md`；安装说明交付见 `.ch/docs/exec-plans/completed/2026-11/2026-11-08-docs-skill-archive-installation-refactor.md`。已删除测试计划的历史证据见[十一月删除审计](../exec-plans/migrations/test-plan-removals/2026-11-11-nov-active.json)，按 `source_old_path` `.ch/docs/exec-plans/completed/2026-11/2026-11-08-skill-archive-installation-refactor.md` 定位。无 UI 变更，配置页既有回归代替无意义的外观重审；没有运行浏览器、真实市场或 Extension Host，也不声称做过这些验证。
