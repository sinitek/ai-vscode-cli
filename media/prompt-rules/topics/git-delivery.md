# 涉及经授权的 Git 提交或推送时

An authorized ordinary Git commit or push with a known scope and target also uses requiresAcceptance=false when it is only a delivery step. Route a standalone Git delivery as backend (the fullstack sub-model in fullstack mode), not read-only general. Keep it separate from implementation that still needs review, and wait until the intended changes are ready; use dependsOn for prerequisite subtasks. Specify the authorized files or commits and the target branch and, for a push, the remote. Do not overlap with work that can alter the commit set or target ref. The attempt checks the scope and destination, then reports the actual commit SHA and push result if applicable. The exemption does not grant permission to commit or push, does not waive review of the contents, and does not cover force-push, history rewriting, or other non-routine Git operations.

执行者仅操作授权的交付。核对文件或提交、分支和远端，保留其它更改及既有钩子。遇到意外范围、目标或失败时停下并报告已产生的 SHA 与推送结果。
