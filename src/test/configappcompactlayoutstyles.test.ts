import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const css = fs.readFileSync(
  path.join(process.cwd(), "media", "config", "assets", "index-Dl7d6WMN.css"),
  "utf8",
);

function rule(source: string, selector: string): string {
  const selectorStart = source.indexOf(`${selector} {`);
  assert.notEqual(selectorStart, -1, `Missing CSS rule for ${selector}`);
  const bodyStart = source.indexOf("{", selectorStart) + 1;
  const bodyEnd = source.indexOf("}", bodyStart);
  assert.notEqual(bodyEnd, -1, `Unclosed CSS rule for ${selector}`);
  return source.slice(bodyStart, bodyEnd);
}

function mediaSource(query: string): string {
  const mediaStart = css.indexOf(`@media ${query} {`);
  assert.notEqual(mediaStart, -1, `Missing media query ${query}`);
  const nextMediaStart = css.indexOf("@media ", mediaStart + 1);
  return css.slice(mediaStart, nextMediaStart === -1 ? css.length : nextMediaStart);
}

test("configuration workspace and panels use compact desktop spacing", () => {
  const workspace = rule(css, ".config-app-workspace");
  assert.match(workspace, /\bgap:\s*9px;/);
  assert.match(workspace, /\bpadding:\s*0;/);
  assert.doesNotMatch(workspace, /\bgap:\s*18px;|\bpadding:\s*18px;/);

  assert.match(rule(css, ".config-app-header"), /\bpadding:\s*0 14px !important;/);
  assert.match(rule(css, ".config-sidebar-panel"), /\bpadding:\s*8px !important;/);
  assert.match(rule(css, ".config-editor-shell"), /\bpadding:\s*9px !important;/);
  assert.match(rule(css, ".config-list-toolbar"), /\bpadding:\s*7px 8px 6px;/);
});

test("configuration cards and list items keep compact internal spacing", () => {
  assert.match(
    rule(css, ".config-sidebar-panel > .ant-card .ant-card-head"),
    /\bpadding:\s*0 4px !important;/,
  );
  assert.match(
    rule(css, ".config-sidebar-panel > .ant-card .ant-card-head-title"),
    /\bpadding:\s*3px 0;/,
  );
  assert.match(
    rule(css, ".config-sidebar-panel > .ant-card .ant-card-body"),
    /\bpadding:\s*3px !important;/,
  );
  assert.match(
    rule(css, ".config-app-content .ant-card-body"),
    /\bpadding:\s*12px !important;/,
  );
  assert.match(rule(css, ".config-list"), /\bfont-size:\s*80%;/);
  assert.match(rule(css, ".config-list .ant-list-item"), /\bmin-height:\s*34px;/);
  assert.match(rule(css, ".config-list .ant-list-item"), /\bmargin:\s*1px 0;/);
  assert.match(rule(css, ".config-list .ant-list-item"), /\bpadding:\s*2px !important;/);
  assert.match(rule(css, ".config-list .ant-btn-text"), /\bwidth:\s*24px;/);
  assert.match(rule(css, ".config-list .ant-btn-text"), /\bheight:\s*24px;/);
  assert.match(rule(css, ".config-active-tag"), /\bwidth:\s*16px;/);
  assert.match(rule(css, ".config-active-tag"), /\bfont-size:\s*9px;/);
});

test("configuration mobile overrides preserve zero workspace padding", () => {
  const tablet = mediaSource("(max-width: 920px)");
  assert.match(rule(tablet, ".config-app-workspace"), /\bpadding:\s*0;/);
  assert.match(rule(tablet, ".config-app-header"), /\bgap:\s*6px;/);
  assert.match(rule(tablet, ".config-app-sidebar"), /\btop:\s*6px;/);

  const phone = mediaSource("(max-width: 460px)");
  assert.match(rule(phone, ".config-sidebar-panel"), /\bpadding:\s*6px !important;/);
  assert.match(rule(phone, ".config-list-toolbar"), /\bpadding:\s*6px;/);
  assert.match(rule(phone, ".config-list .config-list-item"), /\bgap:\s*4px;/);
});

test("configuration activate button has a compact text-safe minimum width", () => {
  const activateButton = rule(
    css,
    ".config-list .config-activate-button,\n.config-list .config-list-item-selected .config-activate-button",
  );
  assert.match(activateButton, /\bmin-width:\s*45px;/);
  assert.match(activateButton, /\bheight:\s*24px;/);
  assert.match(activateButton, /\bpadding:\s*0 3px;/);
  assert.match(activateButton, /\bfont-size:\s*calc\(80% \+ 1px\);/);
  assert.doesNotMatch(activateButton, /\bmin-width:\s*76px;/);
});

test("configuration action buttons use compact square shared styling", () => {
  const topActionButton = rule(
    css,
    ".config-sidebar-panel > .ant-card .ant-card-extra .ant-btn,\n.config-editor-shell > .ant-card > .ant-card-head .ant-card-extra .ant-btn",
  );
  assert.match(topActionButton, /\bheight:\s*20px;/);
  assert.match(topActionButton, /\bpadding:\s*0 6px !important;/);
  assert.match(topActionButton, /\bbackground:\s*var\(--clay-text\) !important;/);
  assert.match(topActionButton, /\bcolor:\s*var\(--clay-inverse\) !important;/);
  assert.match(topActionButton, /\bfont-size:\s*80%;/);
  assert.match(topActionButton, /\bborder-radius:\s*0 !important;/);

  assert.match(css, /\.ant-btn \{\s+border-radius:\s*0;/);
  assert.match(rule(css, ".config-list .ant-btn-text"), /\bborder-radius:\s*0;/);
  assert.match(
    rule(
      css,
      ".config-app-theme button,\n.ant-modal-root button,\n.ant-drawer-root button,\n.ant-popover button,\n.ant-dropdown button",
    ),
    /\bborder-radius:\s*0 !important;/,
  );
});
