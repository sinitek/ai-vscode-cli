# 原生 VS Code 压缩标签验收

入口：`node scripts/verify_vscode_compaction_routing.js`。需要已安装的 Windows VS Code、Node 22+ 内置 WebSocket、当前 `dist` 和现有 TypeScript 依赖；不下载 Electron 或浏览器，不修改依赖。可通过 `SINITEK_VSCODE_EXE` 指定已有可执行文件。

脚本使用 `--extensionTestsPath`、独立 user-data/extensions/HOME/工作区/任务存储，以内存追加导出访问当前 `dist/extension.js`，不写共享构建。测试宿主只控制 Codex runner 的文本完成、压缩拒绝和新执行失败；成功运行记录由产品执行路径生成，完成与 review 由产品 scheduler 持久化。产品 provider、完整 state/applyState、Loop 元数据合并、标签点击与 DOM 均由真实宿主执行，Chromium 调试协议只读取 DOM、点击产品标签并截图。

场景专门保留已完成子标签，使用生产 orchestration host 的调用端口组合实际 `runPrompt`；不覆盖生产 runtime adapter 的自动关标签行为。压缩调用真实扩展入口，五分钟自动资格门槛复用既有覆盖。计划断言包含活动/后台压缩、失败结束、父标签仍 review、切换与完整 state 刷新后完成状态不撤销，以及随后真实新执行的错误可见。不得将入口存在或编译成功计作这些断言通过。

2026-11-12 实际运行被安装更新锁阻止：已安装 Code.exe 文件及应用清单版本均为 **1.145.0**；日志 `checkInnoSetupMutex: vscode-updating still held after 31617ms, giving up`，随后 `Code is currently being updated. Please wait for the update to complete before launching.`，进程退出码 1。未进入 Extension Host；没有 `bridge.json`、`host-evidence.json`、DOM 快照或截图，原生验收仍未完成。

证据目录：`C:\Users\fangjiawei\AppData\Local\Temp\sinitek-native-compaction-tHECwQ`（`result.json`、`vscode.log`、`compile.log`、隔离配置和已编译测试）。本轮启动 PID 5824 已自行退出，未终止用户进程。入口后续补充了提前退出诊断及夹具取消处理，修改后仅作静态检查，未再次启动已知被锁阻止的宿主。

缺失前提是安装程序正常释放更新锁后能启动的 VS Code。不要删除锁、终止更新或操作用户窗口来绕过。入口尚须实际运行验证；Windows 证据不覆盖原生 macOS/Linux、真实模型或真实多窗口。产品没有行为变更，功能清单和 ontology 的归并由主任务/并行负责方处理。
