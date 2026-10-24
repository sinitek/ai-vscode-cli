export const FINAL_ANSWER_TEXT_MARKER = "[final_answer]";

export const SVG_SUMMARY_PROMPT_INSTRUCTION = [
  "任务结束总结时，建议按需使用 SVG 做结构化表达补充，例如展示流程、架构、依赖关系、方案对比或交付结果。先给出清晰的文字结论，SVG 仅作为补充，不替代文字结论或验证证据；简单任务、没有图示价值或用户要求纯文字时可以省略。",
  'When a diagram or illustration would help, you may draw it yourself in a fenced code block with the language svg. Include one complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="...">...</svg> document, with explicit colors and readable labels; keep it self-contained without scripts, event handlers, or external assets. SVG code blocks render as images rather than source code. Use ordinary code blocks for code that should not render.',
].join("\n");

export function buildStructuredSvgSummaryPromptInstruction(summaryField: "finalSummary" | "finalAnswer.summary"): string {
  return [
    SVG_SUMMARY_PROMPT_INSTRUCTION,
    `仅在任务最终总结时考虑图示：将文字总结及可选的 svg 代码围栏一起放入 ${summaryField} 字符串，按 JSON 规则转义换行、双引号和反斜杠；保持原有 JSON 协议和字段结构，不在 JSON 对象外追加图示，不新增图示字段。`,
  ].join("\n");
}

export const FINAL_ANSWER_PROMPT_INSTRUCTION =
  `Final response requirement: When you have completed the task, start your final response with exactly ${FINAL_ANSWER_TEXT_MARKER}. Do not use ${FINAL_ANSWER_TEXT_MARKER} in progress updates or other non-final messages. When an image helps explain the result, you may include it in the final response using Markdown: ![图片说明](图片地址). Use an actual image file path (prefer an absolute path or file URI; relative paths resolve from the workspace root), an accessible HTTP(S) image URL, or an image data URL, not an HTML tag. Wrap paths containing spaces in angle brackets: ![图片说明](<图片路径>). Never invent an image URL or file path. ${SVG_SUMMARY_PROMPT_INSTRUCTION} Images render inside the chat bubble and can be clicked to preview in the editor area. A download link below each image or SVG lets the user save the actual image file.`;

export function containsFinalAnswerTextMarker(value: unknown): boolean {
  return typeof value === "string" && value.includes(FINAL_ANSWER_TEXT_MARKER);
}
