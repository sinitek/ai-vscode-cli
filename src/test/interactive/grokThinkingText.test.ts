import test = require("node:test");
import assert = require("node:assert/strict");

import { joinGrokThinkingSoftBreaks } from "../../interactive/grokThinkingText";

test("joins Grok thinking fragments that were stored as short lines", () => {
  const stored = [
    "Closeout is permitted.",
    " The acceptance batch",
    " is empty, so reviewEventId",
    " and reviewEventIds ",
    "will be omitted.",
    "",
  ].join("\n");

  assert.equal(
    joinGrokThinkingSoftBreaks(stored),
    "Closeout is permitted. The acceptance batch is empty, so reviewEventId and reviewEventIds will be omitted.",
  );
});

test("keeps paragraph breaks and list lines in Grok thinking", () => {
  const stored = "First paragraph.\n\n\n- keep this\n- and this\n\nNext paragraph\n continues here.";

  assert.equal(
    joinGrokThinkingSoftBreaks(stored),
    "First paragraph.\n\n- keep this\n- and this\n\nNext paragraph continues here.",
  );
});
