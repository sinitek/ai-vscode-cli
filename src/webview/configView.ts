import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const ASSETS_DIR = ["media", "config", "assets"];

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function findAssetFile(assetsPath: string, extension: string): string {
  const entries = fs.readdirSync(assetsPath);
  const match = entries.find((file) => file.startsWith("index-") && file.endsWith(extension));
  if (!match) {
    throw new Error(`Missing config manager asset: ${extension}`);
  }
  return match;
}

export function getConfigViewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();
  const assetsFsPath = path.join(extensionUri.fsPath, ...ASSETS_DIR);
  const jsFile = findAssetFile(assetsFsPath, ".js");
  const cssFile = findAssetFile(assetsFsPath, ".css");
  const appFiles = ["config-app-api.js", "config-app-store.js", "config-app-ui.js"];
  appFiles.forEach((file) => {
    const appFsPath = path.join(assetsFsPath, file);
    if (!fs.existsSync(appFsPath)) {
      throw new Error(`Missing config manager asset: ${file}`);
    }
  });
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, ...ASSETS_DIR, cssFile)
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, ...ASSETS_DIR, jsFile)
  );
  const appUris = appFiles.map((file) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...ASSETS_DIR, file))
  );
  const configBaseUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "config"))
    .toString();

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>携宁 CLI 助手</title>
    <link rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const configBase = ${JSON.stringify(configBaseUri)};
      try {
        history.replaceState(null, "", configBase + "/index.html");
      } catch (error) {
        // ignore
      }

      const pendingRequests = new Map();

      function createRequestId() {
        return "config_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      }

      function requestConfig(action, payload) {
        const requestId = createRequestId();
        return new Promise((resolve, reject) => {
          pendingRequests.set(requestId, { resolve, reject });
          vscode.postMessage({
            type: "config:request",
            requestId,
            action,
            ...payload,
          });
        });
      }

      function postConfigDebug(payload) {
        try {
          vscode.postMessage({ type: "config:debug", payload });
        } catch (error) {
          // ignore
        }
      }

      window.electronAPI = {
        config: {
          getList: (platform) => requestConfig("getList", { platform }),
          getById: (platform, id) => requestConfig("getById", { platform, id }),
          save: (config) => requestConfig("save", { config }),
          delete: (platform, id) => requestConfig("delete", { platform, id }),
          getCurrent: (platform) => requestConfig("getCurrent", { platform }),
          apply: (platform, payload) => requestConfig("apply", { platform, payload }),
          backup: (platform) => requestConfig("backup", { platform }),
          getBackups: (platform) => requestConfig("getBackups", { platform }),
          initDefault: (platform) => requestConfig("initDefault", { platform }),
          getMcpMarketplaceList: () => requestConfig("getMcpMarketplaceList", {}),
          getCodexSkillsList: () => requestConfig("getCodexSkillsList", {}),
        },
      };

      function disableReadonlyActions() {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        buttons.forEach((button) => {
          const label = (button.textContent || "").trim();
          if (!label) {
            return;
          }
          // 只隐藏"更新配置"按钮，保留"激活配置"按钮
          if (label === "更新配置") {
            button.style.display = "none";
            return;
          }
        });
      }

      const readonlyObserver = new MutationObserver(() => {
        disableReadonlyActions();
      });
      readonlyObserver.observe(document.body, { childList: true, subtree: true });

      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.type !== "config:response") {
          return;
        }
        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
          return;
        }
        pendingRequests.delete(data.requestId);
        if (data.success) {
          pending.resolve(data.data);
        } else {
          pending.reject(new Error(data.error || "请求失败"));
        }
      });

      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.type !== "config:syncActive") {
          return;
        }
        syncActiveConfigIds();
      });

      const ACTIVE_CONFIG_KEY_PREFIX = "ai_cli_active_config_id_";

      function normalizeLineEndings(value) {
        return (value ?? "").replace(/\\r\\n/g, "\\n").trim();
      }

      function stableStringify(value) {
        if (Array.isArray(value)) {
          return "[" + value.map(stableStringify).join(",") + "]";
        }
        if (value && typeof value === "object") {
          const keys = Object.keys(value).sort();
          return (
            "{" +
            keys
              .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key]))
              .join(",") +
            "}"
          );
        }
        return JSON.stringify(value);
      }

      function normalizeJson(value) {
        if (value === undefined || value === null) {
          return "{}";
        }
        const text = String(value);
        if (!text.trim()) {
          return "{}";
        }
        try {
          return stableStringify(JSON.parse(text));
        } catch (error) {
          return normalizeLineEndings(text);
        }
      }

      function parseJsonObject(value) {
        if (!value) {
          return null;
        }
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
          return null;
        } catch (error) {
          return null;
        }
      }

      function isDeepEqualSubset(expected, actual) {
        if (expected === actual) {
          return true;
        }
        if (typeof expected !== typeof actual) {
          return false;
        }
        if (Array.isArray(expected)) {
          if (!Array.isArray(actual) || expected.length !== actual.length) {
            return false;
          }
          return expected.every((item, index) => isDeepEqualSubset(item, actual[index]));
        }
        if (expected && typeof expected === "object") {
          if (!actual || typeof actual !== "object") {
            return false;
          }
          return Object.keys(expected).every((key) =>
            isDeepEqualSubset(expected[key], actual[key])
          );
        }
        return false;
      }

      function getStoredActiveId(platform, configs) {
        try {
          const raw = localStorage.getItem(ACTIVE_CONFIG_KEY_PREFIX + platform);
          if (!raw) {
            return null;
          }
          const parsed = JSON.parse(raw);
          if (typeof parsed !== "string") {
            return null;
          }
          return configs.some((config) => config.id === parsed) ? parsed : null;
        } catch (error) {
          return null;
        }
      }

      const CODEX_SKILLS_BLOCK_START = "# --- sinitek codex skills start ---";
      const CODEX_SKILLS_BLOCK_END = "# --- sinitek codex skills end ---";

      function escapeRegExp(value) {
        return value.replace(/[.*+?^$\\{}()|[\\]\\\\]/g, "\\\\$&");
      }

      function stripCodexSkillsBlock(content) {
        const start = escapeRegExp(CODEX_SKILLS_BLOCK_START);
        const end = escapeRegExp(CODEX_SKILLS_BLOCK_END);
        const regex = new RegExp(start + "[\\\\s\\\\S]*?" + end + "\\\\s*", "g");
        return content.replace(regex, "").trimEnd();
      }

      function normalizeConfigLines(value) {
        const normalized = stripCodexSkillsBlock(normalizeLineEndings(value ?? ""));
        return normalized
          .split("\\n")
          .map((line) => line.replace(/\\s+$/g, ""))
          .filter((line) => !/^\\s*#/.test(line))
          .map((line) => normalizeTomlLine(line))
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }

      function areLinesSubset(required, actual) {
        if (!required.length) {
          return true;
        }
        if (actual.length < required.length) {
          return false;
        }
        const counts = new Map();
        actual.forEach((line) => {
          counts.set(line, (counts.get(line) || 0) + 1);
        });
        for (const line of required) {
          const count = counts.get(line) || 0;
          if (count <= 0) {
            return false;
          }
          counts.set(line, count - 1);
        }
        return true;
      }

      function normalizeTomlLine(line) {
        if (!line) {
          return "";
        }
        let inDouble = false;
        let inSingle = false;
        let escaped = false;
        for (let i = 0; i < line.length; i += 1) {
          const char = line[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === "\\\\" && inDouble) {
            escaped = true;
            continue;
          }
          if (char === "\\\"" && !inSingle) {
            inDouble = !inDouble;
            continue;
          }
          if (char === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
          }
          if (char === "=" && !inDouble && !inSingle) {
            const left = line.slice(0, i).trimEnd();
            const right = line.slice(i + 1).trimStart();
            return (left + " = " + right).trim();
          }
        }
        return line.trim();
      }

      function matchActiveConfig(platform, config, current) {
        if (!config || !current) {
          return false;
        }
        if (platform === "claude") {
          const configContentObj = parseJsonObject(config.content);
          const currentContentObj = parseJsonObject(current.content);
          const contentMatch = configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(config.content) === normalizeJson(current.content);
          const configMcp = parseJsonObject(config.mcpContent);
          const currentMcp = parseJsonObject(current.mcpContent);
          const mcpMatch = configMcp && currentMcp
            ? isDeepEqualSubset(configMcp, currentMcp)
            : normalizeJson(config.mcpContent ?? "{}") === normalizeJson(current.mcpContent ?? "{}");
          return (
            contentMatch &&
            mcpMatch
          );
        }
        if (platform === "gemini") {
          const configContentObj = parseJsonObject(config.content);
          const currentContentObj = parseJsonObject(current.content);
          const contentMatch = configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(config.content) === normalizeJson(current.content);
          return (
            contentMatch &&
            normalizeLineEndings(config.envContent ?? "") ===
              normalizeLineEndings(current.envContent ?? "")
          );
        }
        return (
          areLinesSubset(
            normalizeConfigLines(config.configContent),
            normalizeConfigLines(current.configContent)
          ) &&
          normalizeJson(config.authContent ?? "{}") === normalizeJson(current.authContent ?? "{}")
        );
      }

      async function syncActiveConfigIds() {
        const platforms = ["claude", "codex", "gemini"];
        let updated = false;
        postConfigDebug({
          event: "syncActive:start",
          platforms,
          time: Date.now(),
        });
        await Promise.all(
          platforms.map(async (platform) => {
            let configs = [];
            try {
              configs = await requestConfig("getList", { platform });
            } catch (error) {
              postConfigDebug({
                event: "syncActive:error",
                platform,
                step: "getList",
                message: error && error.message ? String(error.message) : String(error),
              });
              return;
            }
            if (!Array.isArray(configs) || configs.length === 0) {
              postConfigDebug({
                event: "syncActive:empty",
                platform,
                count: Array.isArray(configs) ? configs.length : 0,
              });
              return;
            }
            let current = null;
            try {
              current = await requestConfig("getCurrent", { platform });
            } catch (error) {
              postConfigDebug({
                event: "syncActive:error",
                platform,
                step: "getCurrent",
                message: error && error.message ? String(error.message) : String(error),
              });
              return;
            }
            const matched = configs.find((config) => matchActiveConfig(platform, config, current));
            const storedActiveId = getStoredActiveId(platform, configs);
            const matchMap = configs.map((config) => ({
              id: config.id,
              match: matchActiveConfig(platform, config, current),
            }));
            postConfigDebug({
              event: "syncActive:result",
              platform,
              count: configs.length,
              storedActiveId,
              matchedId: matched ? matched.id : null,
              matchMap,
            });
            if (matched) {
              if (storedActiveId !== matched.id) {
                try {
                  localStorage.setItem(
                    ACTIVE_CONFIG_KEY_PREFIX + platform,
                    JSON.stringify(matched.id)
                  );
                  updated = true;
                  postConfigDebug({
                    event: "syncActive:update",
                    platform,
                    activeId: matched.id,
                  });
                } catch (error) {
                  // ignore storage error
                }
              }
              return;
            }
            if (storedActiveId) {
              try {
                localStorage.removeItem(ACTIVE_CONFIG_KEY_PREFIX + platform);
                updated = true;
                postConfigDebug({
                  event: "syncActive:clear",
                  platform,
                  previousId: storedActiveId,
                });
              } catch (error) {
                // ignore storage error
              }
            }
          })
        );
        postConfigDebug({
          event: "syncActive:done",
          updated,
          time: Date.now(),
        });
        return updated;
      }

      function loadScript(src) {
        return new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = src;
          script.nonce = ${JSON.stringify(nonce)};
          script.async = false;
          script.onload = () => resolve();
          document.body.appendChild(script);
        });
      }

      function loadConfigManagerApp() {
        const appScripts = ${JSON.stringify(appUris.map((uri) => uri.toString()))};
        loadScript(${JSON.stringify(jsUri.toString())}).then(() =>
          appScripts.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
        );
      }

      syncActiveConfigIds().finally(() => {
        loadConfigManagerApp();
        disableReadonlyActions();
      });
    </script>
  </body>
</html>`;
}
