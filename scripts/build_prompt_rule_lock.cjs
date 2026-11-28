const fs = require("node:fs");
const path = require("node:path");
const { readPromptRuleLibrary } = require("../dist/promptRuleIndex");

const root = path.resolve(__dirname, "..");
const { version } = readPromptRuleLibrary(root);
fs.writeFileSync(path.join(root, "dist", "prompt-rule-version.json"), JSON.stringify({ version }) + "\n");
