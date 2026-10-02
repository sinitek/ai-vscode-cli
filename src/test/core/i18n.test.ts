import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  DEFAULT_LOCALE_SETTING,
  normalizeLocaleSetting,
} = require("../../i18n") as typeof import("../../i18n");

test("defaults an unset locale to Simplified Chinese", () => {
  assert.equal(DEFAULT_LOCALE_SETTING, "zh-CN");
  assert.equal(normalizeLocaleSetting(undefined), "zh-CN");
  assert.equal(normalizeLocaleSetting(null), "zh-CN");
});

test("preserves explicit locale selections", () => {
  assert.equal(normalizeLocaleSetting("auto"), "auto");
  assert.equal(normalizeLocaleSetting("en"), "en");
  assert.equal(normalizeLocaleSetting("zh-CN"), "zh-CN");
});
