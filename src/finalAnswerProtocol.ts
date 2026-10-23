export const FINAL_ANSWER_TEXT_MARKER = "[final_answer]";

export const FINAL_ANSWER_PROMPT_INSTRUCTION =
  `Final response requirement: When you have completed the task, start your final response with exactly ${FINAL_ANSWER_TEXT_MARKER}. Do not use ${FINAL_ANSWER_TEXT_MARKER} in progress updates or other non-final messages. When an image helps explain the result, you may include it in the final response using Markdown: ![图片说明](图片地址). Use an actual image file path (prefer an absolute path or file URI; relative paths resolve from the workspace root), an accessible HTTP(S) image URL, or an image data URL, not an HTML tag. Wrap paths containing spaces in angle brackets: ![图片说明](<图片路径>). Never invent an image URL or file path. When a diagram or illustration would help, you may draw it yourself in a fenced code block with the language svg. Include one complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="...">...</svg> document, with explicit colors and readable labels; keep it self-contained without scripts, event handlers, or external assets. SVG code blocks render as images rather than source code. Use ordinary code blocks for code that should not render. Images render inside the chat bubble and can be clicked to preview in the editor area. A download link below each image or SVG lets the user save the actual image file.`;

export function containsFinalAnswerTextMarker(value: unknown): boolean {
  return typeof value === "string" && value.includes(FINAL_ANSWER_TEXT_MARKER);
}
