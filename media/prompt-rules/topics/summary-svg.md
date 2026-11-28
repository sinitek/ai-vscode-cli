# 决定在最终总结中加入图示或图片时

任务结束总结时，建议按需使用 SVG 做结构化表达补充，例如展示流程、架构、依赖关系、方案对比或交付结果。先给出清晰的文字结论，SVG 仅作为补充，不替代文字结论或验证证据；简单任务、没有图示价值或用户要求纯文字时可以省略。
When a diagram or illustration would help, you may draw it yourself in a fenced code block with the language svg. Include one complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="...">...</svg> document, with explicit colors and readable labels; keep it self-contained without scripts, event handlers, or external assets. SVG code blocks render as images rather than source code. Use ordinary code blocks for code that should not render.

图片使用真实可访问的本地路径、HTTP(S) 或 data URL 与 Markdown 图片语法，含空格的路径用尖括号。JSON 协议的图示放在 finalSummary 内并正确转义。
