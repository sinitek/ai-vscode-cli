import test = require("node:test");
import assert = require("node:assert/strict");

import { extractJsonObjectText, extractJsonObjectTexts } from "../../shared/jsonObjectText";

test("returns every complete top-level object and the first object alone", () => {
  const content = 'alpha {"first":1} beta {"second":2} gamma';

  assert.deepEqual(extractJsonObjectTexts(content), ['{"first":1}', '{"second":2}']);
  assert.equal(extractJsonObjectText(content), '{"first":1}');
});

test("keeps nested objects inside the surrounding object", () => {
  const content = 'prefix {"outer":{"inner":{"n":1}},"ok":true} suffix {"tail":2}';

  assert.deepEqual(extractJsonObjectTexts(content), [
    '{"outer":{"inner":{"n":1}},"ok":true}',
    '{"tail":2}',
  ]);
});

test("ignores braces that appear inside JSON strings", () => {
  const content = '{"text":"keep { braces } inside","n":1} {"next":true}';

  assert.deepEqual(extractJsonObjectTexts(content), [
    '{"text":"keep { braces } inside","n":1}',
    '{"next":true}',
  ]);
  assert.deepEqual(extractJsonObjectTexts('{"text":"{ } { }"}'), ['{"text":"{ } { }"}']);
});

test("treats escaped quotes as part of the string instead of ending it", () => {
  const content = '{"a":"x\\"}","b":1} {"text":"say \\"hi\\" }","ok":true}';

  assert.deepEqual(extractJsonObjectTexts(content), [
    '{"a":"x\\"}","b":1}',
    '{"text":"say \\"hi\\" }","ok":true}',
  ]);
});

test("skips incomplete objects and continues scanning for later complete objects", () => {
  assert.deepEqual(extractJsonObjectTexts('{"open": true'), []);
  assert.equal(extractJsonObjectText('{"open": true'), null);
  assert.deepEqual(
    extractJsonObjectTexts('{"unclosed": {"nested": 1} {"done":true}'),
    ['{"nested": 1}', '{"done":true}'],
  );
  assert.deepEqual(extractJsonObjectTexts('{"done":true} {"still":'), ['{"done":true}']);
  assert.equal(extractJsonObjectText('{"done":true} {"still":'), '{"done":true}');
});

test("returns no objects for empty input", () => {
  assert.deepEqual(extractJsonObjectTexts(""), []);
  assert.equal(extractJsonObjectText(""), null);
});
