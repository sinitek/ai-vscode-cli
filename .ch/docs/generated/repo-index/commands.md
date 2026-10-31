# Commands Index

## dev

- 未检测到该类别命令

## test

| 命令 | 来源 | 说明 |
| --- | --- | --- |
| `npm run test` | `package.json` | npm run test:unit |

## build

| 命令 | 来源 | 说明 |
| --- | --- | --- |
| `npm run build` | `package.json` | npm run clean && tsc -p ./ |

## lint

- 未检测到该类别命令

## check

- 未检测到该类别命令

## cli

- 未检测到该类别命令

## other

| 命令 | 来源 | 说明 |
| --- | --- | --- |
| `npm run clean` | `package.json` | node -e "require('fs').rmSync('dist',{recursive:true,force:true})" |
| `npm run compile` | `package.json` | npm run build |
| `npm run stats:loc` | `package.json` | node scripts/count_effective_loc.js |
| `npm run test:core` | `package.json` | npm run build && node --test dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopMainFailure.test.js dist/test/loop/loopLegacyMigration.test.js dist/test/cli/opencodeCommandRunner.test.js dist/test/cli/commandRunnerCoreBranches.test.js dist/test/cli/commandRunnerCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js |
| `npm run test:core-coverage` | `package.json` | npm run build && c8 --all --check-coverage --statements 100 --lines 100 --functions 100 --branches 100 --reports-dir=node_modules/.cache/sinitek-cli-core-coverage --temp-directory=node_modules/.cache/sinitek-cli-core-coverage/tmp --include=dist/loopTaskStore.js --include=dist/loopMainFailure.js --include=dist/cli/commandRunner.js --include=dist/sessionStore.js --include=dist/sessionLifecycle.js --include=dist/sessionMessageActions.js --include=dist/sessionMessageHandlers.js --include=dist/sessionMessageRouter.js --include=dist/promptRuntime.js node --test dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopMainFailure.test.js dist/test/loop/loopLegacyMigration.test.js dist/test/cli/opencodeCommandRunner.test.js dist/test/cli/commandRunnerCoreBranches.test.js dist/test/cli/commandRunnerCoverage.test.js dist/test/extensionHost/opencodethinkingintegration.test.js dist/test/session/sessionStoreCoreCoverage.test.js dist/test/session/sessionLifecycleCoreCoverage.test.js dist/test/extensionHost/promptRuntime.test.js dist/test/extensionHost/promptRuntimeCoreCoverage.test.js dist/test/session/sessionMessageActions.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/session/sessionMessageHandlersCoreCoverage.test.js |
| `npm run test:page` | `package.json` | npm run build && node --test dist/test/loop/loopmaingroupchatbutton.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/session/conversationTabPagination.test.js dist/test/core/subagentProgress.test.js dist/test/session/historySessionLoop.test.js dist/test/session/conversationTabLock.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/webview/runPromptHistoryWebview.test.js dist/test/loop/opencodeloopmodewebview.test.js dist/test/loop/loopPromptQueue.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/traceToolTitleLocalization.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/config/configappcompactcontrols.test.js dist/test/config/configappcompactlayoutstyles.test.js dist/test/config/claudeConfigVisualEditor.test.js dist/test/config/codexConfigVisualEditor.test.js dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/opencodeconfigexample.test.js dist/test/config/opencodeAutoCommandUi.test.js dist/test/config/zcodeConfig.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/config/cliPageConfigCoverage.test.js |
| `npm run test:page-coverage` | `package.json` | npm run build && c8 --all --check-coverage --statements 100 --lines 100 --functions 100 --branches 100 --reports-dir=node_modules/.cache/sinitek-cli-page-coverage --temp-directory=node_modules/.cache/sinitek-cli-page-coverage/tmp --include=dist/webview/viewContent.js --include=dist/webview/viewContentHtml.js --include=dist/webview/viewContentStrings.js --include=dist/webview/viewContentScript.js --include=dist/webview/viewProvider.js --include=dist/webview/configPanel.js --include=dist/webview/configProtocol.js --include=dist/webview/configView.js --include=dist/webview/loopGroupChatPanel.js --include=dist/webview/loopGroupChatPanelRenderer.js --include=dist/webview/loopGroupChatPanelStyles.js --include=dist/webview/viewContentScript/attachmentsAndTime.js --include=dist/webview/viewContentScript/coreBootstrap.js --include=dist/webview/viewContentScript/coreRuntimeState.js --include=dist/webview/viewContentScript/eventBindings.js --include=dist/webview/viewContentScript/historyPanels.js --include=dist/webview/viewContentScript/messageRendering.js --include=dist/webview/viewContentScript/modelAndPanelState.js --include=dist/webview/viewContentScript/modelManager.js --include=dist/webview/viewContentScript/runStreamAndQueue.js --include=dist/webview/viewContentScript/settingsAndOverlays.js --include=dist/webview/viewContentScript/taskListAndUi.js --include=dist/webview/viewContentScript/traceRendering.js --include=dist/webview/viewContentScript/windowMessageDispatch.js --include=dist/webview/viewContentStyles.js --include=dist/webview/viewContentStyles/base.js --include=dist/webview/viewContentStyles/chatArea.js --include=dist/webview/viewContentStyles/headerTabs.js --include=dist/webview/viewContentStyles/inputControls.js --include=dist/webview/viewContentStyles/markdown.js --include=dist/webview/viewContentStyles/messages.js --include=dist/webview/viewContentStyles/overlaysModals.js --include=dist/webview/viewContentStyles/systemTrace.js --include=dist/webview/viewContentStyles/tasklist.js --include=dist/webview/viewContentStyles/toastMisc.js --include=dist/webview/viewContentStyles/typingStatus.js node --test dist/test/loop/loopmaingroupchatbutton.test.js dist/test/webview/opencodedualmodelwebview.test.js dist/test/webview/multiAgentSettingWebview.test.js dist/test/session/conversationTabPagination.test.js dist/test/core/subagentProgress.test.js dist/test/session/historySessionLoop.test.js dist/test/session/conversationTabLock.test.js dist/test/webview/openCodeThinkingWebview.test.js dist/test/webview/openCodeTaskListOverlay.test.js dist/test/webview/runPromptHistoryWebview.test.js dist/test/loop/opencodeloopmodewebview.test.js dist/test/loop/loopPromptQueue.test.js dist/test/webview/finalAnswerPolicy.test.js dist/test/webview/traceToolTitleLocalization.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/config/configappcompactcontrols.test.js dist/test/config/configappcompactlayoutstyles.test.js dist/test/config/claudeConfigVisualEditor.test.js dist/test/config/codexConfigVisualEditor.test.js dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/opencodeconfigexample.test.js dist/test/config/opencodeAutoCommandUi.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/config/cliPageConfigCoverage.test.js |
| `npm run test:unit` | `package.json` | npm run build && node scripts/run_unit_tests.js |
| `npm run validate:whitespace` | `package.json` | node scripts/check_trailing_whitespace.js |
| `npm run vscode:prepublish` | `package.json` | npm run build |
| `npm run watch` | `package.json` | tsc -watch -p ./ |

## 使用提醒

- 这里只列机械提取出来的命令，不保证所有命令都已可运行。
- 执行前仍应查看对应配置文件和局部说明，确认依赖、环境变量和工作目录。
