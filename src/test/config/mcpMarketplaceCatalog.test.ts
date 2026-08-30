import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";

type MarketplaceItem = {
  id: string;
  name: string;
  description: string;
  homepage: string;
  category: string;
  signupUrl?: string;
  config: {
    command?: string;
    args?: string[];
    type?: string;
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
};

const marketplacePath = path.join(__dirname, "..", "..", "..", "media", "mcp_marketplace.json");
const oldMonorepoPath = "github.com/modelcontextprotocol/servers/tree/main/src/";
const oldPackagePattern = /^@modelcontextprotocol\/server-/;

function readMarketplace(): MarketplaceItem[] {
  return JSON.parse(fs.readFileSync(marketplacePath, "utf8")) as MarketplaceItem[];
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

test("MCP marketplace catalog has stable structure and unique ids", () => {
  const items = readMarketplace();

  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 12 && items.length <= 17);

  const ids = new Set<string>();
  for (const item of items) {
    assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.equal(ids.has(item.id), false, `duplicate id: ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.homepage, "string");
    assert.equal(typeof item.category, "string");
    assert.equal(typeof item.config, "object");
    assert.ok(item.config.command || item.config.url, `${item.id} must have local or remote config`);
  }
});

test("MCP marketplace descriptions are Chinese", () => {
  for (const item of readMarketplace()) {
    assert.ok(containsChinese(item.description), `${item.id} description must be Chinese`);
  }
});

test("MCP marketplace does not reintroduce deprecated monorepo paths or old packages", () => {
  for (const item of readMarketplace()) {
    assert.equal(item.homepage.includes(oldMonorepoPath), false, `${item.id} uses deprecated homepage`);
    for (const arg of item.config.args ?? []) {
      assert.equal(oldPackagePattern.test(arg), false, `${item.id} uses deprecated package ${arg}`);
    }
  }
});

test("MCP marketplace includes key official or authoritative entries", () => {
  const ids = new Set(readMarketplace().map((item) => item.id));
  for (const id of [
    "github",
    "microsoft-learn",
    "playwright",
    "docker-mcp-gateway",
    "cloudflare-docs",
    "stripe",
    "sentry",
    "mongodb",
    "grafana",
    "elasticsearch",
    "slack",
    "notion",
    "linear",
    "brave-search",
  ]) {
    assert.equal(ids.has(id), true, `missing official MCP entry: ${id}`);
  }
});
