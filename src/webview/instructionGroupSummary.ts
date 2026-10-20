export type TraceInstructionPresentation = {
  type?: string;
  title?: string;
  detail?: string;
};

export function getTraceInstructionSummary(
  content: string,
  presentation?: TraceInstructionPresentation | null,
): string {
  const summaryLimit = 96;
  const factPriority = [
    "command",
    "cmd",
    "script",
    "pattern",
    "query",
    "url",
    "file_path",
    "target_file",
    "path",
    "absolute_path",
    "filename",
    "update",
    "target_directory",
    "directory",
    "glob",
  ];
  const title = String(presentation?.title || "").trim();
  const type = String(presentation?.type || "").trim();
  const detail = String(presentation?.detail || "").trim();
  const source = String(content || "");
  let summary = "";

  if (type === "exec") {
    summary = formatCommandFact(detail || source);
  } else if (type === "web-search" || type === "warning" || type === "apply-patch") {
    summary = clipInstructionText(collapseInstructionText(detail), summaryLimit);
  } else if (type === "error" || type === "git-update") {
    summary = clipInstructionText(
      collapseInstructionText(detail || firstInstructionNarrative(source)),
      summaryLimit,
    );
  } else if (type === "file-update") {
    const update = detail || readInstructionFact(source, "update");
    summary = formatPathFact(update);
  } else if (type === "tool-result" || type.startsWith("tool-use")) {
    summary = summarizeToolInstruction(source, detail, title);
  } else if (detail && !isOpaqueInstructionToken(detail)) {
    summary = compactInstructionSentence(detail);
  }

  summary = summary.trim();
  if (!summary || summary === title) {
    return "";
  }
  return summary;

  function summarizeToolInstruction(toolSource: string, toolDetail: string, toolTitle: string): string {
    const fact = pickInstructionFact(collectInstructionFacts(toolSource));
    if (fact) {
      return formatInstructionFact(fact.key, fact.value);
    }
    if (toolDetail && toolDetail !== toolTitle && !isOpaqueInstructionToken(toolDetail)) {
      return compactInstructionSentence(toolDetail);
    }
    const narrative = firstInstructionNarrative(toolSource);
    if (!narrative || narrative === toolTitle || isOpaqueInstructionToken(narrative)) {
      return "";
    }
    return compactInstructionSentence(narrative);
  }

  function collectInstructionFacts(toolSource: string): Record<string, string> {
    const facts: Record<string, string> = {};
    const keyPattern = /^(command|cmd|script|pattern|query|url|file_path|target_file|path|absolute_path|filename|glob|target_directory|directory|update)\s*[:：]\s*(.+)$/i;
    String(toolSource || "").split(/\r?\n/).forEach((line) => {
      const match = line.trim().match(keyPattern);
      if (!match) {
        return;
      }
      rememberInstructionFact(facts, match[1] || "", match[2] || "");
    });
    const jsonPattern = /"(command|cmd|script|pattern|query|url|file_path|target_file|path|absolute_path|filename|glob|target_directory|directory|update)"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
    let jsonMatch = jsonPattern.exec(toolSource);
    while (jsonMatch) {
      rememberInstructionFact(facts, jsonMatch[1] || "", unescapeInstructionJson(jsonMatch[2] || ""));
      jsonMatch = jsonPattern.exec(toolSource);
    }
    return facts;
  }

  function rememberInstructionFact(facts: Record<string, string>, key: string, value: string): void {
    const normalizedKey = key.toLowerCase();
    const text = stripInstructionQuotes(String(value || "").trim());
    if (!normalizedKey || !text || text === "{" || text === "[" || facts[normalizedKey]) {
      return;
    }
    facts[normalizedKey] = text;
  }

  function pickInstructionFact(facts: Record<string, string>): { key: string; value: string } | null {
    for (let index = 0; index < factPriority.length; index += 1) {
      const key = factPriority[index];
      if (facts[key]) {
        return { key, value: facts[key] };
      }
    }
    return null;
  }

  function readInstructionFact(toolSource: string, key: string): string {
    return collectInstructionFacts(toolSource)[key] || "";
  }

  function formatInstructionFact(key: string, value: string): string {
    const normalized = key.toLowerCase();
    if (normalized === "command" || normalized === "cmd" || normalized === "script") {
      return formatCommandFact(value);
    }
    if (normalized === "url" || normalized === "query" || normalized === "pattern" || normalized === "glob") {
      return clipInstructionText(collapseInstructionText(value), summaryLimit);
    }
    if (isInstructionPath(value)) {
      return formatPathFact(value);
    }
    return compactInstructionSentence(value);
  }

  function formatCommandFact(value: string): string {
    const command = collapseInstructionText(unwrapInstructionShell(stripExecPrefix(value)));
    if (!command) {
      return "";
    }
    const compacted = command.replace(
      /(?:~\/|\/(?:Users|home|tmp|var|opt|private)\/)[^\s'"`;|&<>]+/g,
      (path) => compactInstructionPath(path),
    );
    return clipInstructionText(compacted, summaryLimit);
  }

  function formatPathFact(value: string): string {
    const text = stripInstructionQuotes(String(value || "").trim());
    if (!text) {
      return "";
    }
    return isInstructionPath(text)
      ? compactInstructionPath(text)
      : clipInstructionText(collapseInstructionText(text), summaryLimit);
  }

  function firstInstructionNarrative(toolSource: string): string {
    const lines = String(toolSource || "").split(/\r?\n/);
    const limit = Math.min(lines.length, 40);
    for (let index = 0; index < limit; index += 1) {
      const text = lines[index].trim();
      if (!text || isSkippableInstructionLine(text) || isInstructionDumpLine(text)) {
        continue;
      }
      return text;
    }
    return "";
  }

  function isSkippableInstructionLine(text: string): boolean {
    return /^[{}\[\],\s]+$/.test(text)
      || /^"(?:[^"\\]|\\.)*"\s*:/.test(text)
      || /^(?:status|exit_code|offset|limit)\b/i.test(text)
      || /^(?:input|output|输入|输出)\s*[:：]?\s*$/i.test(text)
      || /^(?:tool(?:\s*result)?|调用工具|工具结果|exec|【执行命令】|file\s+update|apply_patch|git\s+update|web\s*search|mcp|error|warning|错误|警告)(?=$|[\s:：])/i.test(text)
      || /^\d+$/.test(text);
  }

  function isInstructionDumpLine(text: string): boolean {
    return text.length > 180
      || /^(?:\d+→|[+-]{3}\s|@@|diff --git)/.test(text);
  }

  function compactInstructionSentence(value: string): string {
    const text = collapseInstructionText(value);
    if (!text) {
      return "";
    }
    if (isInstructionPath(text)) {
      return compactInstructionPath(text);
    }
    const withPaths = text.replace(
      /(?:~\/|\/(?:Users|home|tmp|var|opt|private)\/)[^\s，。,;）)]+/g,
      (path) => compactInstructionPath(path),
    );
    return clipInstructionText(withPaths, summaryLimit);
  }

  function compactInstructionPath(value: string): string {
    const text = String(value || "").trim().replace(/\\/g, "/");
    const parts = text.split("/").filter((part) => part.length > 0);
    if (parts.length <= 3 && text.length <= 64) {
      return text;
    }
    return `…/${parts.slice(-3).join("/")}`;
  }

  function isInstructionPath(value: string): boolean {
    const text = String(value || "").trim();
    if (!text || /\s/.test(text) || /^https?:\/\//i.test(text) || /[|*?<>"]/.test(text)) {
      return false;
    }
    return text.includes("/") || text.includes("\\") || /^[A-Za-z]:/.test(text);
  }

  function isOpaqueInstructionToken(value: string): boolean {
    const text = String(value || "").trim();
    if (!text) {
      return true;
    }
    if (/^call[-_]/i.test(text)) {
      return true;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      return true;
    }
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && text.length <= 64;
  }

  function stripExecPrefix(value: string): string {
    return String(value || "").replace(/^(?:exec\b|【执行命令】)\s*[:：]?\s*/i, "").trim();
  }

  function unwrapInstructionShell(value: string): string {
    const command = String(value || "").trim();
    const match = command.match(/^(?:(?:\/usr\/bin\/|\/bin\/)?(?:bash|zsh|sh))\s+-(?:lc|c)\s+([\s\S]+)$/i);
    if (!match) {
      return command;
    }
    return stripInstructionQuotes(String(match[1] || "").trim());
  }

  function stripInstructionQuotes(value: string): string {
    let text = String(value || "").trim();
    if (text.length >= 2) {
      const first = text[0];
      const last = text[text.length - 1];
      if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
        text = text.slice(1, -1).trim();
      }
    }
    return text;
  }

  function unescapeInstructionJson(value: string): string {
    return String(value || "")
      .replace(/\\n/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  function collapseInstructionText(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function clipInstructionText(value: string, limit: number): string {
    const text = String(value || "").trim();
    if (!text || text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}…`;
  }
}
