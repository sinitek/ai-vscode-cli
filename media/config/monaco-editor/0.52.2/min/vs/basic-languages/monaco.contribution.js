define("vs/basic-languages/monaco.contribution", ["require", "vs/editor/editor.api"], function (require) {
  "use strict";
  const monaco = require("vs/editor/editor.api");

  // 精简版：仅保持空贡献，实际语言在前端代码里按需注册
  return { monaco };
});
