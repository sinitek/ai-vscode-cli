#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const marketplacePath = path.join(__dirname, "..", "media", "mcp_marketplace.json");
const oldMonorepoPath = "github.com/modelcontextprotocol/servers/tree/main/src/";
const oldPackagePattern = /^@modelcontextprotocol\/server-/;
const allowedCategories = new Set([
  "文件与数据",
  "开发工具",
  "基础设施",
  "网络与浏览器",
  "生产力工具",
  "AI与智能",
  "其他",
]);
const allowedHomepageHosts = new Set([
  "github.com",
  "docs.docker.com",
  "docs.stripe.com",
  "developers.notion.com",
  "linear.app",
  "docs.slack.dev",
  "www.atlassian.com",
]);
const allowedGithubOrgs = new Set([
  "brave",
  "cloudflare",
  "elastic",
  "getsentry",
  "github",
  "grafana",
  "microsoft",
  "MicrosoftDocs",
  "mongodb-js",
]);
const suspiciousSecretPatterns = [
  /sk_live_[A-Za-z0-9]{12,}/,
  /sk_test_[A-Za-z0-9]{12,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /sntrys_[A-Za-z0-9]{20,}/,
  /SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

function addError(errors, itemId, message) {
  errors.push(itemId ? `${itemId}: ${message}` : message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (_error) {
    return null;
  }
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/.test(value);
}

function isPlaceholderSecret(value) {
  const trimmed = value.trim();
  return /^<[^>]+>$/.test(trimmed) || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(trimmed);
}

function isSafeLiteral(value) {
  return ["true", "false"].includes(value.trim().toLowerCase())
    || /^\d+$/.test(value.trim())
    || /^[a-z0-9_,.-]+$/i.test(value.trim());
}

function looksLikeSecret(value) {
  const trimmed = value.trim();
  return suspiciousSecretPatterns.some((pattern) => pattern.test(trimmed))
    || (/^[A-Za-z0-9_-]{32,}$/.test(trimmed) && !isPlaceholderSecret(trimmed));
}

function validateEnvOrHeaders(errors, itemId, record, recordName) {
  if (record === undefined) {
    return;
  }
  if (!isRecord(record)) {
    addError(errors, itemId, `${recordName} must be an object when present.`);
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (!key || typeof value !== "string") {
      addError(errors, itemId, `${recordName}.${key || "<empty>"} must be a string value.`);
      continue;
    }
    if (looksLikeSecret(value)) {
      addError(errors, itemId, `${recordName}.${key} appears to contain a real secret; use an env placeholder.`);
    }
    if (/token|key|secret|password|authorization/i.test(key) && !isPlaceholderSecret(value) && !isSafeLiteral(value) && !/\$\{[A-Z][A-Z0-9_]*\}/.test(value)) {
      addError(errors, itemId, `${recordName}.${key} should use an environment placeholder.`);
    }
  }
}

function isAuthoritativeHomepage(homepage) {
  const url = parseUrl(homepage);
  if (!url || url.protocol !== "https:") {
    return false;
  }
  if (allowedHomepageHosts.has(url.hostname)) {
    return true;
  }
  if (url.hostname === "github.com") {
    const org = url.pathname.split("/").filter(Boolean)[0];
    return allowedGithubOrgs.has(org);
  }
  return false;
}

function validateMarketplace(items) {
  const errors = [];
  const ids = new Set();

  if (!Array.isArray(items)) {
    return ["media/mcp_marketplace.json must contain a top-level array."];
  }

  items.forEach((item, index) => {
    const itemId = isRecord(item) && typeof item.id === "string" ? item.id : `item[${index}]`;
    if (!isRecord(item)) {
      addError(errors, itemId, "must be an object.");
      return;
    }

    for (const field of ["id", "name", "description", "homepage", "category"]) {
      if (typeof item[field] !== "string" || item[field].trim().length === 0) {
        addError(errors, itemId, `${field} is required and must be a non-empty string.`);
      }
    }

    if (typeof item.id === "string") {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
        addError(errors, itemId, "id must be stable lowercase kebab-case.");
      }
      if (ids.has(item.id)) {
        addError(errors, itemId, "id must be unique.");
      }
      ids.add(item.id);
    }

    if (typeof item.description === "string" && !containsChinese(item.description)) {
      addError(errors, itemId, "description must contain Chinese text.");
    }

    if (typeof item.homepage === "string") {
      const homepage = parseUrl(item.homepage);
      if (!homepage || homepage.protocol !== "https:") {
        addError(errors, itemId, "homepage must be a valid https URL.");
      }
      if (item.homepage.includes(oldMonorepoPath)) {
        addError(errors, itemId, "homepage must not point to the deprecated modelcontextprotocol monorepo src path.");
      }
      if (!isAuthoritativeHomepage(item.homepage)) {
        addError(errors, itemId, "homepage must be an official or authoritative source URL.");
      }
    }

    if (typeof item.signupUrl === "string") {
      const signupUrl = parseUrl(item.signupUrl);
      if (!signupUrl || signupUrl.protocol !== "https:") {
        addError(errors, itemId, "signupUrl must be a valid https URL when present.");
      }
    }

    if (typeof item.category === "string" && !allowedCategories.has(item.category)) {
      addError(errors, itemId, `category must be one of: ${Array.from(allowedCategories).join(", ")}.`);
    }

    if (!isRecord(item.config)) {
      addError(errors, itemId, "config is required and must be an object.");
      return;
    }

    const config = item.config;
    const hasLocal = typeof config.command === "string" && config.command.trim().length > 0;
    const hasRemote = typeof config.url === "string" && config.url.trim().length > 0;
    if (!hasLocal && !hasRemote) {
      addError(errors, itemId, "config must provide either local command or remote url.");
    }
    if (hasLocal && hasRemote) {
      addError(errors, itemId, "config must not mix local command and remote url in one item.");
    }
    if (hasLocal && Array.isArray(config.args) === false && config.args !== undefined) {
      addError(errors, itemId, "config.args must be an array when present.");
    }
    if (Array.isArray(config.args)) {
      for (const arg of config.args) {
        if (typeof arg !== "string") {
          addError(errors, itemId, "config.args must contain only strings.");
          continue;
        }
        if (oldPackagePattern.test(arg)) {
          addError(errors, itemId, `config.args must not use deprecated package ${arg}.`);
        }
      }
    }
    if (hasRemote) {
      const remoteUrl = parseUrl(config.url);
      if (!remoteUrl || remoteUrl.protocol !== "https:") {
        addError(errors, itemId, "config.url must be a valid https URL.");
      }
      if (!["http", "sse", undefined].includes(config.type)) {
        addError(errors, itemId, "remote config.type must be http or sse when present.");
      }
    }
    if (hasLocal && config.type !== undefined) {
      addError(errors, itemId, "local config should not set config.type.");
    }

    validateEnvOrHeaders(errors, itemId, config.env, "config.env");
    validateEnvOrHeaders(errors, itemId, config.headers, "config.headers");
  });

  return errors;
}

function main() {
  let rawContent;
  try {
    rawContent = fs.readFileSync(marketplacePath, "utf8");
  } catch (error) {
    console.error(`Failed to read ${marketplacePath}: ${error.message}`);
    process.exit(1);
  }

  let items;
  try {
    items = JSON.parse(rawContent);
  } catch (error) {
    console.error(`Invalid JSON in ${marketplacePath}: ${error.message}`);
    process.exit(1);
  }

  const errors = validateMarketplace(items);
  if (errors.length > 0) {
    console.error("MCP marketplace validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`MCP marketplace validation passed (${items.length} entries).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateMarketplace,
};
