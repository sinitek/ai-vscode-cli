const STANDALONE_EMPTY_HTML_COMMENT_PATTERN = /^[\t ]*<!--[\t ]*-->[\t ]*$/;
const EXCESS_BLANK_LINES_PATTERN = /\n(?:[\t ]*\n){2,}/g;

/**
 * Removes the empty HTML-comment separator emitted by some Codex models.
 * Only standalone empty comments are removed; inline and non-empty comments stay intact.
 */
export function sanitizeCodexReasoningContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let removedMarker = false;
  const retainedLines = lines.filter((line) => {
    if (!STANDALONE_EMPTY_HTML_COMMENT_PATTERN.test(line)) {
      return true;
    }
    removedMarker = true;
    return false;
  });

  if (!removedMarker) {
    return content;
  }

  return retainedLines
    .join("\n")
    .replace(EXCESS_BLANK_LINES_PATTERN, "\n\n")
    .trim();
}
