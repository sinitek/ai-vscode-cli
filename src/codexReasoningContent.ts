import { FINAL_ANSWER_TEXT_MARKER } from "./finalAnswerProtocol";
import { stripThinkingWrapperTags } from "./thinkingMarkup";

const STANDALONE_EMPTY_HTML_COMMENT_PATTERN = /^[\t ]*<!--[\t ]*-->[\t ]*$/;
const EXCESS_BLANK_LINES_PATTERN = /\n(?:[\t ]*\n){2,}/g;
const TRAILING_WHITESPACE_PATTERN = /[ \t\r\n]+$/u;

/**
 * Grok and some Codex reasoning summaries append a leaked `[final_answer]` draft
 * after truncated thinking. Keep the thinking prefix only.
 */
export function stripLeakedFinalAnswerFromReasoning(content: string): string {
  const index = content.indexOf(FINAL_ANSWER_TEXT_MARKER);
  if (index < 0) {
    return content;
  }
  return content.slice(0, index).replace(TRAILING_WHITESPACE_PATTERN, "");
}

/**
 * Removes the empty HTML-comment separator emitted by some Codex models.
 * Only standalone empty comments are removed; inline and non-empty comments stay intact.
 */
export function sanitizeCodexReasoningContent(content: string): string {
  const withoutThinkingTags = stripThinkingWrapperTags(content);
  const lines = withoutThinkingTags.split(/\r?\n/);
  let removedMarker = false;
  const retainedLines = lines.filter((line) => {
    if (!STANDALONE_EMPTY_HTML_COMMENT_PATTERN.test(line)) {
      return true;
    }
    removedMarker = true;
    return false;
  });

  const cleaned = removedMarker
    ? retainedLines
      .join("\n")
      .replace(EXCESS_BLANK_LINES_PATTERN, "\n\n")
      .trim()
    : withoutThinkingTags;
  return stripLeakedFinalAnswerFromReasoning(cleaned);
}
