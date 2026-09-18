#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOTS = ["src", "media"];
const CODE_EXTENSIONS = new Map([
  [".ts", "js"],
  [".tsx", "js"],
  [".js", "js"],
  [".jsx", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".css", "css"],
  [".scss", "css"],
  [".less", "css"],
  [".html", "html"],
  [".htm", "html"],
  [".vue", "html"],
  [".py", "python"],
]);
const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".codegraph",
  "dist",
  "node_modules",
  "monaco-editor",
  "official-skills",
  "workspace-scaffold",
  "__pycache__",
  "vendor",
]);
const MINIFIED_NAME_PATTERN = /\.min\.(js|css)$/iu;
const TEST_FILE_PATTERN = /\.(?:tests?|spec)\./iu;
const TEST_DIR_NAMES = new Set(["test", "tests", "__tests__", "spec", "__mocks__"]);
const PYTHON_TEST_NAME_PATTERN = /^test_.+\.py$/iu;
const REGEX_PREFIX_CHARS = "({[=,:;!&|?+-~*^%<>,";
const REGEX_PREFIX_KEYWORDS = new Set([
  "return",
  "case",
  "throw",
  "delete",
  "typeof",
  "void",
  "in",
  "of",
  "instanceof",
  "new",
  "await",
  "yield",
]);
const EMPTY_COUNTS = Object.freeze({
  files: 0,
  physical: 0,
  blank: 0,
  comment: 0,
  effective: 0,
});

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const rootPaths = (options.roots.length > 0 ? options.roots : DEFAULT_ROOTS)
    .map((root) => path.resolve(REPO_ROOT, root));
  const missing = rootPaths.filter((rootPath) => !fs.existsSync(rootPath));
  if (missing.length > 0) {
    missing.forEach((rootPath) => {
      console.error(`Root not found: ${rootPath}`);
    });
    return 1;
  }

  const report = collectReport(rootPaths);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  printReport(report, options.byFile);
  return 0;
}

function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
    byFile: false,
    roots: [],
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--by-file") {
      options.byFile = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.roots.push(arg);
  }
  return options;
}

function printHelp() {
  console.log(`用法: node scripts/count_effective_loc.js [--json] [--by-file] [目录 ...]

默认统计仓库内 src 与 media 的有效代码行数。
有效行 = 去掉空行和注释后的代码行；源码与单测分开汇总，最后再合计。
会跳过第三方目录、压缩/生成文件、二进制和非代码文件。

  --json      输出 JSON
  --by-file   同时列出每个计入文件
  --help      显示帮助
`);
}

function collectReport(rootPaths) {
  const groups = new Map();
  const files = [];
  const skippedReasons = {
    ignoredDir: 0,
    nonCode: 0,
    minified: 0,
    binary: 0,
  };

  for (const rootPath of rootPaths) {
    const label = rootLabel(rootPath);
    if (!groups.has(label)) {
      groups.set(label, {
        source: createCounts(),
        test: createCounts(),
      });
    }
    walkFiles(rootPath, (absolutePath) => {
      const relativeToRoot = path.relative(rootPath, absolutePath);
      const skipReason = classifySkipReason(absolutePath, relativeToRoot);
      if (skipReason) {
        skippedReasons[skipReason] += 1;
        return;
      }
      const buffer = fs.readFileSync(absolutePath);
      if (buffer.includes(0)) {
        skippedReasons.binary += 1;
        return;
      }
      const content = buffer.toString("utf8");
      if (isMinifiedContent(content)) {
        skippedReasons.minified += 1;
        return;
      }
      const extension = path.extname(absolutePath).toLowerCase();
      const language = CODE_EXTENSIONS.get(extension);
      const counts = analyzeContent(content, language, extension);
      const kind = isTestFile(relativeToRoot) ? "test" : "source";
      const group = groups.get(label);
      addCounts(group[kind], counts);
      files.push({
        root: label,
        kind,
        path: displayPath(absolutePath, rootPath),
        ...counts,
      });
    });
  }

  const orderedLabels = [];
  for (const rootPath of rootPaths) {
    const label = rootLabel(rootPath);
    if (!orderedLabels.includes(label)) {
      orderedLabels.push(label);
    }
  }

  const totals = {
    source: createCounts(),
    test: createCounts(),
  };
  const rootSummaries = {};
  for (const label of orderedLabels) {
    const group = groups.get(label);
    rootSummaries[label] = {
      source: { ...group.source },
      test: { ...group.test },
      subtotal: sumCounts(group.source, group.test),
    };
    addCounts(totals.source, group.source);
    addCounts(totals.test, group.test);
  }

  files.sort((left, right) => {
    if (right.effective !== left.effective) {
      return right.effective - left.effective;
    }
    return left.path.localeCompare(right.path);
  });

  const skippedTotal = Object.values(skippedReasons).reduce((sum, value) => sum + value, 0);
  return {
    roots: orderedLabels,
    groups: rootSummaries,
    totals: {
      source: totals.source,
      test: totals.test,
      all: sumCounts(totals.source, totals.test),
    },
    files,
    skipped: {
      total: skippedTotal,
      reasons: skippedReasons,
    },
  };
}

function walkFiles(rootPath, visit) {
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        visit(absolutePath);
      }
    }
  }
}

function classifySkipReason(absolutePath, relativeToRoot) {
  const segments = relativeToRoot.split(path.sep).filter(Boolean);
  if (segments.some((segment) => IGNORED_DIR_NAMES.has(segment))) {
    return "ignoredDir";
  }
  const fileName = path.basename(absolutePath);
  if (MINIFIED_NAME_PATTERN.test(fileName)) {
    return "minified";
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension)) {
    return "nonCode";
  }
  return null;
}

function isTestFile(relativePath) {
  const posixPath = toPosix(relativePath);
  const segments = posixPath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] || "";
  if (TEST_FILE_PATTERN.test(fileName) || PYTHON_TEST_NAME_PATTERN.test(fileName)) {
    return true;
  }
  return segments.some((segment) => TEST_DIR_NAMES.has(segment));
}

function analyzeContent(content, language, extension) {
  if (language === "python") {
    return summarizeLineKinds(analyzePythonLines(content));
  }
  if (language === "html") {
    return summarizeLineKinds(analyzeHtmlLines(content));
  }
  const lineComments = language === "js" || extension === ".scss" || extension === ".less";
  return summarizeLineKinds(analyzeCStyleLines(content, { lineComments }));
}

function summarizeLineKinds(kinds) {
  const counts = createCounts();
  counts.files = 1;
  counts.physical = kinds.length;
  for (const kind of kinds) {
    if (kind === "code") {
      counts.effective += 1;
    } else if (kind === "blank" || kind === "comment") {
      counts[kind] += 1;
    }
  }
  return counts;
}

function analyzeCStyleLines(content, { lineComments }) {
  const lines = splitLines(content);
  const kinds = [];
  const state = {
    mode: "normal",
    returnMode: "normal",
    templateStack: [],
    prevChar: "",
    prevWord: "",
    regexCharClass: false,
  };

  lines.forEach((line, lineIndex) => {
    if (lineIndex === 0 && line.startsWith("#!") && state.mode === "normal") {
      kinds.push(classifyLineFlags({
        hasCode: false,
        hasComment: line.trim().length > 0,
        hasNonWhitespace: line.trim().length > 0,
      }));
      state.prevChar = "";
      state.prevWord = "";
      return;
    }
    const flags = scanCStyleLine(line, state, lineComments);
    kinds.push(classifyLineFlags(flags));
  });
  return kinds;
}

function scanCStyleLine(line, state, lineComments) {
  let hasCode = false;
  let hasComment = false;
  let hasNonWhitespace = false;
  let index = 0;
  let escaped = false;

  const markCode = (character) => {
    if (!isWhitespace(character)) {
      hasNonWhitespace = true;
      hasCode = true;
    }
  };
  const markComment = (character) => {
    if (!isWhitespace(character)) {
      hasNonWhitespace = true;
    }
    hasComment = true;
  };

  while (index < line.length) {
    const character = line[index];
    const next = line[index + 1] || "";

    if (state.mode === "blockComment") {
      markComment(character);
      if (character === "*" && next === "/") {
        markComment(next);
        leaveInterrupt(state);
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state.mode === "single" || state.mode === "double") {
      markCode(character);
      if (!escaped && character === (state.mode === "single" ? "'" : "\"")) {
        leaveInterrupt(state);
        state.prevChar = character;
        state.prevWord = "";
        escaped = false;
        index += 1;
        continue;
      }
      escaped = !escaped && character === "\\";
      index += 1;
      continue;
    }

    if (state.mode === "template") {
      markCode(character);
      if (!escaped && character === "`") {
        state.templateStack.pop();
        state.mode = state.templateStack.length > 0
          ? state.templateStack[state.templateStack.length - 1].mode
          : "normal";
        state.prevChar = character;
        state.prevWord = "";
        escaped = false;
        index += 1;
        continue;
      }
      if (!escaped && character === "$" && next === "{") {
        markCode(next);
        state.templateStack.push({ mode: "expr", braces: 0 });
        state.mode = "expr";
        state.prevChar = "{";
        state.prevWord = "";
        escaped = false;
        index += 2;
        continue;
      }
      escaped = !escaped && character === "\\";
      index += 1;
      continue;
    }

    if (state.mode === "regex") {
      markCode(character);
      if (!escaped && character === "[" && !state.regexCharClass) {
        state.regexCharClass = true;
      } else if (!escaped && character === "]" && state.regexCharClass) {
        state.regexCharClass = false;
      } else if (!escaped && character === "/" && !state.regexCharClass) {
        leaveInterrupt(state);
        state.prevChar = "/";
        state.prevWord = "";
        state.regexCharClass = false;
      }
      escaped = !escaped && character === "\\";
      index += 1;
      continue;
    }

    if (state.mode === "expr") {
      if (character === "`") {
        markCode(character);
        state.templateStack.push({ mode: "template", braces: 0 });
        state.mode = "template";
        state.prevChar = character;
        state.prevWord = "";
        escaped = false;
        index += 1;
        continue;
      }
      if (lineComments && character === "/" && next === "/") {
        markComment(character);
        markCommentRest(line, index + 1, markComment);
        break;
      }
      if (character === "/" && next === "*") {
        markComment(character);
        markComment(next);
        enterInterrupt(state, "blockComment");
        index += 2;
        continue;
      }
      if (character === "'" || character === "\"") {
        markCode(character);
        enterInterrupt(state, character === "'" ? "single" : "double");
        escaped = false;
        index += 1;
        continue;
      }
      if (character === "/" && canStartRegex(state.prevChar, state.prevWord)) {
        markCode(character);
        enterInterrupt(state, "regex");
        state.regexCharClass = false;
        escaped = false;
        index += 1;
        continue;
      }
      if (character === "{") {
        markCode(character);
        state.templateStack[state.templateStack.length - 1].braces += 1;
        rememberCodeChar(state, character);
        index += 1;
        continue;
      }
      if (character === "}") {
        const frame = state.templateStack[state.templateStack.length - 1];
        if (frame.braces === 0) {
          markCode(character);
          state.templateStack.pop();
          state.mode = "template";
          state.prevChar = character;
          state.prevWord = "";
          index += 1;
          continue;
        }
        markCode(character);
        frame.braces -= 1;
        rememberCodeChar(state, character);
        index += 1;
        continue;
      }
      if (isWhitespace(character)) {
        index += 1;
        continue;
      }
      markCode(character);
      rememberCodeChar(state, character);
      index += 1;
      continue;
    }

    if (lineComments && character === "/" && next === "/") {
      markComment(character);
      markCommentRest(line, index + 1, markComment);
      break;
    }
    if (character === "/" && next === "*") {
      markComment(character);
      markComment(next);
      enterInterrupt(state, "blockComment");
      index += 2;
      continue;
    }
    if (character === "'" || character === "\"") {
      markCode(character);
      enterInterrupt(state, character === "'" ? "single" : "double");
      escaped = false;
      index += 1;
      continue;
    }
    if (character === "`") {
      markCode(character);
      state.templateStack.push({ mode: "template", braces: 0 });
      state.mode = "template";
      state.prevChar = character;
      state.prevWord = "";
      escaped = false;
      index += 1;
      continue;
    }
    if (character === "/" && canStartRegex(state.prevChar, state.prevWord)) {
      markCode(character);
      enterInterrupt(state, "regex");
      state.regexCharClass = false;
      escaped = false;
      index += 1;
      continue;
    }
    if (isWhitespace(character)) {
      index += 1;
      continue;
    }
    markCode(character);
    rememberCodeChar(state, character);
    index += 1;
  }

  return { hasCode, hasComment, hasNonWhitespace };
}


function enterInterrupt(state, nextMode) {
  state.returnMode = state.mode;
  state.mode = nextMode;
}

function leaveInterrupt(state) {
  state.mode = state.returnMode || "normal";
  state.returnMode = "normal";
}

function markCommentRest(line, startIndex, markComment) {
  for (let index = startIndex; index < line.length; index += 1) {
    markComment(line[index]);
  }
}

function rememberCodeChar(state, character) {
  if (/[A-Za-z0-9_$]/u.test(character)) {
    if (/[A-Za-z0-9_$]/u.test(state.prevChar)) {
      state.prevWord += character;
    } else {
      state.prevWord = character;
    }
  } else {
    state.prevWord = "";
  }
  state.prevChar = character;
}

function canStartRegex(prevChar, prevWord) {
  if (REGEX_PREFIX_KEYWORDS.has(prevWord)) {
    return true;
  }
  if (!prevChar) {
    return true;
  }
  return REGEX_PREFIX_CHARS.includes(prevChar);
}

function analyzeHtmlLines(content) {
  const lines = splitLines(content);
  const kinds = [];
  let inComment = false;
  for (const line of lines) {
    let hasCode = false;
    let hasComment = false;
    let hasNonWhitespace = false;
    let index = 0;
    while (index < line.length) {
      const character = line[index];
      const remaining = line.slice(index);
      if (inComment) {
        if (!isWhitespace(character)) {
          hasNonWhitespace = true;
        }
        hasComment = true;
        const endIndex = remaining.indexOf("-->");
        if (endIndex === 0) {
          inComment = false;
          index += 3;
          continue;
        }
        if (endIndex > 0) {
          inComment = false;
          index += endIndex + 3;
          continue;
        }
        break;
      }
      if (remaining.startsWith("<!--")) {
        hasComment = true;
        hasNonWhitespace = true;
        inComment = true;
        index += 4;
        continue;
      }
      if (!isWhitespace(character)) {
        hasNonWhitespace = true;
        hasCode = true;
      }
      index += 1;
    }
    kinds.push(classifyLineFlags({ hasCode, hasComment, hasNonWhitespace }));
  }
  return kinds;
}

function analyzePythonLines(content) {
  const lines = splitLines(content);
  const kinds = [];
  const state = { mode: "normal", quote: "", triple: false };

  lines.forEach((line, lineIndex) => {
    if (lineIndex === 0 && line.startsWith("#!") && state.mode === "normal") {
      kinds.push(classifyLineFlags({
        hasCode: false,
        hasComment: line.trim().length > 0,
        hasNonWhitespace: line.trim().length > 0,
      }));
      return;
    }
    let hasCode = false;
    let hasComment = false;
    let hasNonWhitespace = false;
    let escaped = false;
    let index = 0;
    while (index < line.length) {
      const character = line[index];
      const nextTwo = line.slice(index, index + 3);
      if (state.mode === "string") {
        if (!isWhitespace(character)) {
          hasNonWhitespace = true;
          hasCode = true;
        }
        if (!escaped && state.triple && nextTwo === state.quote.repeat(3)) {
          state.mode = "normal";
          state.quote = "";
          state.triple = false;
          index += 3;
          escaped = false;
          continue;
        }
        if (!escaped && !state.triple && character === state.quote) {
          state.mode = "normal";
          state.quote = "";
          escaped = false;
          index += 1;
          continue;
        }
        escaped = !escaped && character === "\\";
        index += 1;
        continue;
      }
      if (character === "#") {
        hasComment = true;
        if (!isWhitespace(character)) {
          hasNonWhitespace = true;
        }
        break;
      }
      if (nextTwo === "'''" || nextTwo === "\"\"\"") {
        hasCode = true;
        hasNonWhitespace = true;
        state.mode = "string";
        state.quote = nextTwo[0];
        state.triple = true;
        index += 3;
        continue;
      }
      if (character === "'" || character === "\"") {
        hasCode = true;
        hasNonWhitespace = true;
        state.mode = "string";
        state.quote = character;
        state.triple = false;
        index += 1;
        continue;
      }
      if (!isWhitespace(character)) {
        hasNonWhitespace = true;
        hasCode = true;
      }
      index += 1;
    }
    kinds.push(classifyLineFlags({ hasCode, hasComment, hasNonWhitespace }));
  });
  return kinds;
}

function classifyLineFlags({ hasCode, hasComment, hasNonWhitespace }) {
  if (!hasNonWhitespace) {
    return "blank";
  }
  if (hasCode) {
    return "code";
  }
  if (hasComment) {
    return "comment";
  }
  return "blank";
}

function isMinifiedContent(content) {
  const lines = splitLines(content).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return false;
  }
  const lengths = lines.map((line) => line.length);
  const maxLength = Math.max(...lengths);
  if (maxLength >= 10000) {
    return true;
  }
  const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const longLineCount = lengths.filter((length) => length > 500).length;
  return average > 200 && (maxLength > 1000 || longLineCount / lengths.length > 0.2);
}

function splitLines(content) {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split(/\r?\n/u);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function isWhitespace(character) {
  return character === " "
    || character === "\t"
    || character === "\f"
    || character === "\v"
    || character === "\u00a0";
}

function createCounts() {
  return { ...EMPTY_COUNTS };
}

function addCounts(target, source) {
  target.files += source.files;
  target.physical += source.physical;
  target.blank += source.blank;
  target.comment += source.comment;
  target.effective += source.effective;
}

function sumCounts(left, right) {
  const total = createCounts();
  addCounts(total, left);
  addCounts(total, right);
  return total;
}

function rootLabel(rootPath) {
  const relative = path.relative(REPO_ROOT, rootPath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return toPosix(relative);
  }
  return path.basename(rootPath);
}

function displayPath(absolutePath, rootPath) {
  const fromRepo = path.relative(REPO_ROOT, absolutePath);
  if (fromRepo && !fromRepo.startsWith("..") && !path.isAbsolute(fromRepo)) {
    return toPosix(fromRepo);
  }
  const fromRoot = path.relative(rootPath, absolutePath);
  const rootName = path.basename(rootPath);
  if (!fromRoot) {
    return rootName;
  }
  if (!fromRoot.startsWith("..") && !path.isAbsolute(fromRoot)) {
    return toPosix(path.join(rootName, fromRoot));
  }
  return toPosix(absolutePath);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function printReport(report, byFile) {
  console.log("有效代码行数（已排除空行、注释、第三方与压缩文件）");
  console.log("");
  const rows = [
    ["范围", "分类", "文件", "物理行", "空行", "注释", "有效行"],
  ];
  for (const root of report.roots) {
    const group = report.groups[root];
    rows.push(formatCountRow(root, "源码", group.source));
    rows.push(formatCountRow(root, "单测", group.test));
    rows.push(formatCountRow(root, "小计", group.subtotal));
  }
  rows.push(formatCountRow("合计", "源码", report.totals.source));
  rows.push(formatCountRow("合计", "单测", report.totals.test));
  rows.push(formatCountRow("合计", "总计", report.totals.all));
  console.log(renderTable(rows));
  console.log("");
  console.log(formatSkipped(report.skipped));
  if (byFile) {
    console.log("");
    printFileTable(report.files);
  }
}

function formatCountRow(scope, kind, counts) {
  return [
    scope,
    kind,
    String(counts.files),
    String(counts.physical),
    String(counts.blank),
    String(counts.comment),
    String(counts.effective),
  ];
}

function formatSkipped(skipped) {
  return [
    `跳过文件: ${skipped.total}`,
    `  第三方/模板目录: ${skipped.reasons.ignoredDir}`,
    `  非代码文件: ${skipped.reasons.nonCode}`,
    `  压缩/生成文件: ${skipped.reasons.minified}`,
    `  二进制文件: ${skipped.reasons.binary}`,
  ].join("\n");
}

function printFileTable(files) {
  if (files.length === 0) {
    console.log("没有计入的代码文件。");
    return;
  }
  const rows = [
    ["有效行", "物理行", "范围", "分类", "路径"],
  ];
  for (const file of files) {
    rows.push([
      String(file.effective),
      String(file.physical),
      file.root,
      file.kind === "test" ? "单测" : "源码",
      file.path,
    ]);
  }
  console.log(renderTable(rows));
}

function renderTable(rows) {
  const widths = rows[0].map((_, column) => (
    Math.max(...rows.map((row) => visualWidth(row[column])))
  ));
  return rows.map((row, rowIndex) => {
    const cells = row.map((cell, column) => {
      const align = column >= 2 && rowIndex > 0 ? "right" : "left";
      return padVisual(cell, widths[column], align);
    });
    return cells.join("  ");
  }).join("\n");
}

function visualWidth(text) {
  let width = 0;
  for (const character of String(text)) {
    width += character.charCodeAt(0) > 127 ? 2 : 1;
  }
  return width;
}

function padVisual(text, width, align) {
  const extra = Math.max(0, width - visualWidth(text));
  const spaces = " ".repeat(extra);
  return align === "right" ? spaces + text : text + spaces;
}

module.exports = {
  analyzeContent,
  collectReport,
  isMinifiedContent,
  isTestFile,
  main,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
