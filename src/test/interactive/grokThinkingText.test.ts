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

test("serialized Grok thinking helper runs without module scope", () => {
  const serializedJoin = new Function(
    `return (${joinGrokThinkingSoftBreaks.toString()});`,
  )() as typeof joinGrokThinkingSoftBreaks;
  const stored = "First paragraph\r\n continues here.\r\n\r\n# Heading\n- first\n* second\n+ third\n1. fourth\n## Next heading";

  assert.equal(
    serializedJoin(stored),
    "First paragraph continues here.\n\n# Heading\n- first\n* second\n+ third\n1. fourth\n## Next heading",
  );
  assert.equal(serializedJoin(""), "");
});
