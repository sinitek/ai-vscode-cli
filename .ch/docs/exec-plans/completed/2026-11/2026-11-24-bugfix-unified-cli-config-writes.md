# 统一 CLI 配置覆盖

- 日期：2026-11-24
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-24-bugfix-atomic-config-replace.md`（继承不先删除目标的约定）
- 状态：completed
- 负责人：Codex

## 目标与范围

核对 `CLI_LIST` 全部运行配置写入入口。业务序列化保持原样，文件覆盖统一复用公共原子写入，不按操作系统区分。不改显式删除、目录镜像语义或 CLI 自己的行为，不引入跨文件事务。

## 验收与验证计划

- 旧文件只在同目录临时文件准备完成后一次替换，失败不删除目标。
- 保留 Claude/OpenCode 现有文件符号链接和权限；覆盖新建、已有文件覆盖、替换失败和临时文件清理。
- 用 macOS 上的构建、配置/运行时归组测试和 Linux 环境验证；区分 Windows 错误注入与 Windows 原生实测。

## 实施与验证结果

- `writeFileAtomically` 是唯一共用覆盖机制；以 `followSymlinks` 策略选项支持 Claude/OpenCode 原有符号链接语义。沿用统一模式，未引入 OS 判定或逐 CLI writer。
- Claude settings/MCP、Codex config/auth、OpenCode config、Grok、DSH profile/isolated patch/rules、Kimi Code、ZCode、配置顺序均走公共写入。备份、用户选择的导出、技能安装与显式删除不属于原子替换运行配置。
- 原子替换默认保留已存在文件权限；显式 `mode` 继续优先。DSH 全局规则镜像、skills 目录按既有保留/回滚语义维护（非运行配置的单文件覆盖入口）。
- `npm run build` 通过；最终 macOS 构建后定向配置、原子写和 DSH 回归 82/82 通过；完整配置/Codex/Loop+ 集合 1079/1079 通过。Linux Alpine Node 24.22.3 在加入权限保留断言前，定向回归 81/81 通过。最终源码在 macOS 新增权限断言并全量通过；再次 Linux 复跑因容器内 `apk add nodejs` 网络下载停滞而中断，未报告为通过。
- Linux 覆盖的是公共写入和 CLI 行为测试，不是各 CLI 原生二进制；Linux 未执行完整 Loop+ 集合，最终权限保留断言未在 Linux 重跑。Windows 原生 `rename` 替换/占用行为未验证，Windows 失败路径由回归模拟。
