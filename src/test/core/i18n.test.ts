import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { t } = require("../../i18n") as typeof import("../../i18n");

test("returns fixed Simplified Chinese messages", () => {
  assert.equal(t("common.save"), "保存");
  assert.equal(t("common.currentFileWithRange", { file: "src/app.ts", range: "1-2" }), "当前文件: src/app.ts [1-2]");
});
