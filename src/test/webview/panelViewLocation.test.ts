import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

function readJson(fileName: string) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), fileName), "utf8"));
}

test("chat container is registered only in the secondary sidebar", () => {
  const manifest = readJson("package.json");
  const containers = manifest.contributes.viewsContainers;
  assert.deepEqual(Object.keys(containers), ["secondarySidebar"]);
  assert.deepEqual(containers.secondarySidebar, [{
    id: "sinitekCliBridgePanel",
    title: "%view.container.title%",
    icon: "media/logo.svg",
  }]);
  assert.equal(containers.activitybar, undefined);
  assert.equal(manifest.engines.vscode, "^1.104.0");
  assert.equal(readJson("package-lock.json").packages[""].engines.vscode, manifest.engines.vscode);
});

test("chat view identity and startup opening preference remain unchanged", () => {
  const manifest = readJson("package.json");
  assert.deepEqual(manifest.contributes.views.sinitekCliBridgePanel, [{
    id: "sinitek-cli-tools.panelView",
    name: "%view.panel.name%",
    type: "webview",
  }]);
  assert.ok(manifest.activationEvents.includes("onView:sinitek-cli-tools.panelView"));
  assert.ok(manifest.activationEvents.includes("onStartupFinished"));
  const autoOpenPanel = manifest.contributes.configuration.properties["sinitek-cli-tools.autoOpenPanel"];
  assert.equal(autoOpenPanel.default, true);
  assert.equal(autoOpenPanel.type, "boolean");
});

test("chat container and view reuse the existing localized labels", () => {
  for (const fileName of ["package.nls.json", "package.nls.zh-cn.json"]) {
    const strings = readJson(fileName);
    assert.equal(typeof strings["view.container.title"], "string");
    assert.ok(strings["view.container.title"].trim());
    assert.equal(typeof strings["view.panel.name"], "string");
    assert.ok(strings["view.panel.name"].trim());
  }
});
