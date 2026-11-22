import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import * as ts from "typescript";
import { CLI_LIST } from "../../cli/types";
import { FINAL_ANSWER_TEXT_MARKER } from "../../finalAnswerProtocol";
import { buildWebviewRuntimeScript } from "../../webview/viewContentScript";
import { getWebviewStrings } from "../../webview/viewContentStrings";

export const panelRuntimeScript = buildWebviewRuntimeScript({
  i18n: getWebviewStrings(), cliList: CLI_LIST, loopMaxRoundsDefault: 20,
  loopMaxRoundsMin: 1, loopMaxRoundsMax: 100, finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER,
});

export function createPanelSnapshotRunner(context: vm.Context, markers: string[]) {
  const syntax = ts.createSourceFile("webview.js", panelRuntimeScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = syntax.statements.filter(ts.isFunctionDeclaration);
  const helper = functions.find((node) => node.name?.text === "settingValueFromPanel");
  const panel = functions.find((node) => node.name?.text === "applyPanelState");
  assert.ok(helper && panel?.body, "Missing generated panel settings functions");

  const statements = panel.body.statements.map((statement) => statement.getText(syntax));
  const selected = new Set(markers.map((marker) => {
    const matches = statements.filter((statement) => statement.includes(marker));
    assert.equal(matches.length, 1, `Expected one panel statement containing ${marker}`);
    return matches[0];
  }));
  vm.runInContext(helper.getText(syntax), context);
  const runSnapshot = new vm.Script(statements.filter((statement) => selected.has(statement)).join("\n"));
  return (panelState: Record<string, unknown>) => {
    context.panelState = panelState;
    runSnapshot.runInContext(context);
  };
}

export function createCheckbox(checked: boolean) {
  return {
    checkedWrites: 0,
    get checked() { return checked; },
    set checked(value: boolean) { checked = value; this.checkedWrites += 1; },
  };
}
