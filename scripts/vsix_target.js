const fs = require("node:fs");
const path = require("node:path");

const SDK_ROOT = "node_modules/@anthropic-ai/claude-agent-sdk";
const TARGETS = {
  "darwin-arm64": "arm64-darwin",
  "darwin-x64": "x64-darwin",
  "linux-arm64": "arm64-linux",
  "linux-x64": "x64-linux",
  "win32-x64": "x64-win32",
};

function resolveTarget(value, platform = process.platform, arch = process.arch) {
  const target = value === "current" ? `${platform}-${arch}` : value;
  if (target === "universal" || Object.hasOwn(TARGETS, target)) {
    return target;
  }
  throw new Error(`不支持的打包平台：${target}。可用值：universal、current、${Object.keys(TARGETS).join("、")}`);
}

function nativePackages(target) {
  resolveTarget(target);
  if (target === "universal") {
    return [];
  }
  return [
    `@img/sharp-${target}`,
    ...(target.startsWith("win32-") ? [] : [`@img/sharp-libvips-${target}`]),
  ];
}

function requiredEntries(target) {
  resolveTarget(target);
  const targets = target === "universal" ? Object.keys(TARGETS) : [target];
  return [
    ...["package.json", "sdk.mjs", "cli.js", "resvg.wasm", "tree-sitter.wasm", "tree-sitter-bash.wasm"]
      .map((file) => `${SDK_ROOT}/${file}`),
    ...targets.flatMap((entry) => [
      `${SDK_ROOT}/vendor/ripgrep/${TARGETS[entry]}/${entry.startsWith("win32-") ? "rg.exe" : "rg"}`,
      `${SDK_ROOT}/vendor/ripgrep/${TARGETS[entry]}/ripgrep.node`,
    ]),
    ...nativePackages(target).map((name) => `node_modules/${name}/package.json`),
    ...(target === "universal" ? [] : [`node_modules/@img/sharp-${target}/lib/sharp-${target}.node`]),
  ];
}

function buildIgnoreRules(baseRules, target) {
  resolveTarget(target);
  if (target === "universal") {
    return baseRules;
  }
  return [
    baseRules.trimEnd(),
    `${SDK_ROOT}/vendor/ripgrep/**`,
    `!${SDK_ROOT}/vendor/ripgrep/${TARGETS[target]}/**`,
    "node_modules/@img/**",
    ...nativePackages(target).map((name) => `!node_modules/${name}/**`),
    "",
  ].join("\n");
}

function validateEntries(entries, target) {
  const files = new Set(entries);
  const missing = requiredEntries(target).filter((entry) => !files.has(entry));
  if (missing.length > 0) {
    throw new Error(`缺少 ${target} 运行时资源：\n${missing.join("\n")}\n请在目标平台安装完整依赖后重新打包。`);
  }
  if (target === "universal") {
    return;
  }
  const allowedNativeRoots = nativePackages(target).map((name) => `node_modules/${name}/`);
  const foreignFiles = entries.filter((entry) => (
    entry.startsWith(`${SDK_ROOT}/vendor/ripgrep/`) && !entry.startsWith(`${SDK_ROOT}/vendor/ripgrep/${TARGETS[target]}/`)
  ) || (
    entry.startsWith("node_modules/@img/") && !allowedNativeRoots.some((root) => entry.startsWith(root))
  ));
  if (foreignFiles.length > 0) {
    throw new Error(`定向包包含其他平台资源：\n${foreignFiles.join("\n")}`);
  }
}

function prepareIgnoreFile(target, outputFile, cwd = process.cwd()) {
  const entries = requiredEntries(target).filter((entry) => fs.existsSync(path.join(cwd, entry)));
  validateEntries(entries, target);
  const baseRules = fs.readFileSync(path.join(cwd, ".vscodeignore"), "utf8");
  fs.writeFileSync(outputFile, buildIgnoreRules(baseRules, target));
}

function main() {
  const [command, input, outputFile] = process.argv.slice(2);
  const target = resolveTarget(input);
  if (command === "resolve") {
    console.log(target);
  } else if (command === "prepare") {
    prepareIgnoreFile(target, outputFile);
  } else if (command === "audit") {
    const entries = fs.readFileSync(0, "utf8").split(/\r?\n/u)
      .filter((entry) => entry.startsWith("extension/"))
      .map((entry) => entry.slice("extension/".length));
    validateEntries(entries, target);
    console.log(`Claude SDK 与平台资源检查通过（${target}）。`);
  } else {
    throw new Error(`未知打包操作：${command}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resolveTarget, nativePackages, requiredEntries, buildIgnoreRules, validateEntries, prepareIgnoreFile };
