import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { t } from "../i18n";

const ASSETS_DIR = ["media", "config", "assets"];

const CONFIG_VSCODE_THEME_STYLES = `
:root {
  color-scheme: var(--vscode-color-scheme, normal);
  --clay-canvas: var(--vscode-editor-background);
  --clay-surface: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --clay-surface-muted: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-border: var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-editor-foreground)));
  --clay-border-soft: var(--vscode-widget-border, var(--vscode-panel-border, var(--vscode-editor-foreground)));
  --clay-text: var(--vscode-foreground);
  --clay-text-secondary: var(--vscode-descriptionForeground, var(--vscode-foreground));
  --clay-text-muted: var(--vscode-disabledForeground, var(--vscode-descriptionForeground, var(--vscode-foreground)));
  --clay-inverse: var(--vscode-editor-background);
  --clay-focus: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
  --clay-matcha: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-matcha-strong: var(--vscode-testing-iconPassed, var(--vscode-charts-green, var(--vscode-foreground)));
  --clay-slushie: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-lemon: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-lemon-strong: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, var(--vscode-foreground)));
  --clay-ube: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-ube-strong: var(--vscode-charts-purple, var(--vscode-textLink-foreground));
  --clay-pomegranate: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  --clay-pomegranate-strong: var(--vscode-testing-iconFailed, var(--vscode-editorError-foreground, var(--vscode-foreground)));
  --clay-blueberry: var(--vscode-textLink-foreground, var(--vscode-foreground));
  --clay-badge-bg: var(--vscode-textBlockQuote-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  --clay-badge-text: var(--vscode-textLink-foreground, var(--vscode-foreground));
  --clay-info-border: var(--vscode-textLink-foreground, var(--vscode-widget-border));
  --clay-success-soft: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-success-text: var(--vscode-testing-iconPassed, var(--vscode-foreground));
  --clay-warning-soft: var(--vscode-editorWarning-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  --clay-warning-text: var(--vscode-editorWarning-foreground, var(--vscode-foreground));
  --clay-error-soft: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  --clay-error-text: var(--vscode-editorError-foreground, var(--vscode-foreground));
  --clay-header-glass: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
  --clay-surface-glass: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --clay-focus-shadow: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
  --clay-overlay: var(--vscode-editorGroup-dropBackground, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
  --clay-floating-shadow: var(--vscode-widget-shadow, transparent);
  --clay-radius-control: 2px;
  --clay-radius-card: 2px;
  --clay-radius-panel: 0px;
  --clay-shadow: none;
  --clay-shadow-panel: none;
  --clay-shadow-floating: none;
  --clay-motion: 120ms ease-out;
  --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  --box-shadow-sm: none;
  --box-shadow: none;
  --box-shadow-lg: none;
}

html,
body,
#root,
.config-app-theme {
  display: flex !important;
  flex-direction: column !important;
  min-height: 100vh !important;
  min-width: 0 !important;
  max-width: none !important;
  width: 100% !important;
  height: 100% !important;
  background: var(--vscode-editor-background) !important;
  color: var(--vscode-foreground) !important;
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif) !important;
}

body {
  overflow: hidden !important;
}

.config-app-theme .ant-layout {
  flex: 1 1 auto !important;
  min-height: 0 !important;
}

.config-app-workspace {
  flex: 1 1 auto !important;
  height: calc(100vh - 72px) !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

.config-app-sidebar,
.config-app-content {
  height: 100% !important;
  min-height: 0 !important;
}

.config-app-content,
.config-editor-shell,
.config-editor-shell > .ant-card,
.skills-manager-modal .ant-modal-content {
  display: flex !important;
  flex-direction: column !important;
}

.config-app-content > div,
.config-editor-shell,
.config-editor-shell > .ant-card,
.skills-manager-content,
.skills-manager-content > div:last-child {
  flex: 1 1 auto !important;
  min-height: 0 !important;
}

.skills-manager-content {
  max-height: none !important;
}

.skills-manager-content > div:last-child {
  max-height: none !important;
}

.config-sidebar-panel {
  height: 100% !important;
  overflow: auto !important;
}

.config-editor-shell > .ant-card > .ant-card-body,
.skills-manager-modal .ant-modal-body {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow: auto !important;
}

.skills-manager-modal .ant-modal {
  width: min(1180px, calc(100vw - 24px)) !important;
  top: 12px !important;
  padding-bottom: 0 !important;
}

.skills-manager-modal .ant-modal-content {
  height: calc(100vh - 24px) !important;
  max-height: calc(100vh - 24px) !important;
}

.config-app-theme .ant-btn-primary {
  background: var(--vscode-button-background) !important;
  border-color: var(--vscode-button-border, transparent) !important;
  color: var(--vscode-button-foreground) !important;
  box-shadow: none !important;
}

.config-app-theme .ant-btn-primary:hover,
.config-app-theme .ant-btn-primary:focus-visible,
.config-app-theme .ant-btn-primary:active {
  background: var(--vscode-button-hoverBackground, var(--vscode-button-background)) !important;
  border-color: var(--vscode-focusBorder, var(--vscode-button-border, transparent)) !important;
  color: var(--vscode-button-foreground) !important;
  box-shadow: none !important;
}

.config-app-theme .ant-btn-default,
.config-app-theme .ant-input,
.config-app-theme .ant-input-affix-wrapper,
.config-app-theme .ant-input-number,
.config-app-theme .ant-select-selector,
.config-app-theme .ant-picker {
  background: var(--vscode-input-background, var(--vscode-editor-background)) !important;
  border-color: var(--vscode-input-border, var(--vscode-widget-border)) !important;
  color: var(--vscode-input-foreground, var(--vscode-foreground)) !important;
}

.config-app-theme .ant-btn-default:hover,
.config-app-theme .ant-btn-default:focus-visible,
.config-app-theme .ant-input:hover,
.config-app-theme .ant-input:focus,
.config-app-theme .ant-input-affix-wrapper:hover,
.config-app-theme .ant-input-affix-wrapper:focus-within,
.config-app-theme .ant-select-focused .ant-select-selector,
.config-app-theme .ant-select-selector:hover {
  border-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground)) !important;
}

.config-app-theme .ant-input::placeholder,
.config-app-theme .ant-select-selection-placeholder {
  color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground)) !important;
}

.config-app-theme .ant-tabs-tab-active .ant-tabs-tab-btn,
.config-app-theme .ant-tabs-tab:hover {
  color: var(--vscode-textLink-foreground, var(--vscode-foreground)) !important;
}

.config-app-theme .ant-tabs-ink-bar {
  background: var(--vscode-focusBorder, var(--vscode-textLink-foreground)) !important;
}

.config-app-theme .ant-checkbox-checked .ant-checkbox-inner,
.config-app-theme .ant-switch.ant-switch-checked {
  background: var(--vscode-button-background, var(--vscode-textLink-foreground)) !important;
  border-color: var(--vscode-button-background, var(--vscode-textLink-foreground)) !important;
}

.ant-modal-root .ant-modal-content,
.ant-drawer-root .ant-drawer-content,
.ant-dropdown,
.ant-select-dropdown,
.ant-popover .ant-popover-inner {
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background)) !important;
  color: var(--vscode-foreground) !important;
}

.ant-modal-root .ant-modal-mask,
.ant-drawer-root .ant-drawer-mask {
  background: var(--vscode-editorGroup-dropBackground, transparent) !important;
}

.config-app-theme,
.config-app-theme *,
.ant-modal-root,
.ant-modal-root *,
.ant-drawer-root,
.ant-drawer-root *,
.ant-popover,
.ant-popover *,
.ant-dropdown,
.ant-dropdown * {
  box-shadow: none !important;
}

.config-app-theme .ant-card,
.config-app-theme .ant-collapse,
.config-app-theme .ant-input,
.config-app-theme .ant-input-affix-wrapper,
.config-app-theme .ant-input-number,
.config-app-theme .ant-select-selector,
.config-app-theme .ant-picker,
.ant-modal-root .ant-modal-content,
.ant-drawer-root .ant-drawer-content,
.ant-popover .ant-popover-inner,
.ant-dropdown {
  border-radius: 2px !important;
}

.config-app-header,
.config-list-toolbar,
.ant-modal-mask,
.ant-drawer-mask {
  backdrop-filter: none !important;
}
`;

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
  const downloadsDir = path.join(os.homedir(), "Downloads");
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
  const appUris = appFiles.map((file) => {
    const appFsPath = path.join(assetsFsPath, file);
    const stat = fs.statSync(appFsPath);
    const version = `${Math.round(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}`;
    const uri = webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, ...ASSETS_DIR, file))
      .toString();
    return `${uri}${uri.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
  });
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
    <title>${t("config.appTitle")}</title>
    <link rel="stylesheet" href="${cssUri}" />
    <style nonce="${nonce}">
      ${CONFIG_VSCODE_THEME_STYLES}
      html,
      body,
      #root {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const configBase = ${JSON.stringify(configBaseUri)};
      const downloadsDir = ${JSON.stringify(downloadsDir)};
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

      window.sinitekConfigBridge = {
        downloadsDir,
        openPath: (path) => {
          try {
            vscode.postMessage({ type: "config:openPath", path });
          } catch (error) {
            // ignore
          }
        },
        openExternal: (url) => {
          try {
            vscode.postMessage({ type: "config:openExternal", url });
          } catch (error) {
            // ignore
          }
        },
        close: () => {
          try {
            vscode.postMessage({ type: "config:close" });
          } catch (error) {
            // ignore
          }
        },
      };

      window.electronAPI = {
        config: {
          getList: (platform) =>
            requestConfig("getList", { platform }).then((configs) => mapConfigListFromHost(configs, platform)),
          getOrder: (platform) => requestConfig("getOrder", { platform }),
          setOrder: (platform, order) => requestConfig("setOrder", { platform, order }),
          getById: (platform, id) =>
            requestConfig("getById", { platform, id }).then((config) => mapConfigFromHost(config, platform)),
          save: (config) => requestConfig("save", { config: mapConfigForHost(config) }),
          copy: (payload) =>
            requestConfig("copy", { payload }).then((config) =>
              mapConfigFromHost(config, payload && payload.targetPlatform)
            ),
          delete: (platform, id) => requestConfig("delete", { platform, id }),
          getCurrent: (platform) => requestConfig("getCurrent", { platform }),
          apply: (platform, payload) => requestConfig("apply", { platform, payload: mapApplyPayloadForHost(payload) }),
          backup: (platform) => requestConfig("backup", { platform }),
          getBackups: (platform) => requestConfig("getBackups", { platform }),
          initDefault: (platform) =>
            requestConfig("initDefault", { platform }).then((config) => mapConfigFromHost(config, platform)),
          getMcpMarketplaceList: () => requestConfig("getMcpMarketplaceList", {}),
          getClaudeSkillsList: () => requestConfig("getClaudeSkillsList", {}),
          getCodexSkillsList: () => requestConfig("getCodexSkillsList", {}),
          getOpenCodeSkillsList: () => requestConfig("getOpenCodeSkillsList", {}),
          getOfficialSkillsCatalog: (platform) =>
            platform === "opencode" ? Promise.resolve([]) : requestConfig("getOfficialSkillsCatalog", { platform }),
          installOfficialSkill: (platform, skillId) =>
            platform === "opencode"
              ? Promise.reject(new Error("OpenCode built-in official skills are not configured."))
              : requestConfig("installOfficialSkill", { platform, skillId }),
          updateOfficialSkill: (platform, skillId) =>
            platform === "opencode"
              ? Promise.reject(new Error("OpenCode built-in official skills are not configured."))
              : requestConfig("updateOfficialSkill", { platform, skillId }),
          uninstallOfficialSkill: (platform, skillId) =>
            platform === "opencode"
              ? Promise.reject(new Error("OpenCode built-in official skills are not configured."))
              : requestConfig("uninstallOfficialSkill", { platform, skillId }),
          getMcpInstalledServerIds: (platform) => requestConfig("getMcpInstalledServerIds", { platform }),
          getCodexMcpServerIds: () => requestConfig("getCodexMcpServerIds", {}),
          getCodexMcpHealth: () => requestConfig("getCodexMcpHealth", {}),
          getMcpHealth: (platform) => requestConfig("getMcpHealth", { platform }),
          installMcp: (platform, mcpId, envOverrides) =>
            requestConfig("installMcp", { platform, mcpId, envOverrides }),
          installCodexMcp: (mcpId) => requestConfig("installCodexMcp", { mcpId }),
          uninstallMcp: (platform, mcpId) => requestConfig("uninstallMcp", { platform, mcpId }),
          exportConfigs: (payload) => requestConfig("exportConfigs", { payload }),
        },
      };

      function mapConfigFromHost(config, requestedPlatform) {
        if (!config || requestedPlatform !== "opencode") {
          return config;
        }
        return {
          ...config,
          platform: "opencode",
          openCodeSkills: config.openCodeSkills ?? config.geminiSkills ?? [],
        };
      }

      function mapConfigListFromHost(configs, requestedPlatform) {
        if (!Array.isArray(configs)) {
          return [];
        }
        return configs.map((config) => mapConfigFromHost(config, requestedPlatform));
      }

      function mapConfigForHost(config) {
        if (!config || config.platform !== "opencode") {
          return config;
        }
        const { geminiSkills, ...rest } = config;
        return {
          ...rest,
          openCodeSkills: geminiSkills ?? config.openCodeSkills ?? [],
        };
      }

      function mapApplyPayloadForHost(payload) {
        if (!payload || !Object.prototype.hasOwnProperty.call(payload, "geminiSkills")) {
          return payload;
        }
        const { geminiSkills, ...rest } = payload;
        return {
          ...rest,
          openCodeSkills: geminiSkills ?? [],
        };
      }

      const updateConfigLabel = ${JSON.stringify(t("config.updateLabel"))};
      function disableReadonlyActions() {
        const hiddenAttr = "data-readonly-hidden";
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        buttons.forEach((button) => {
          const label = (button.textContent || "").trim();
          if (!label) {
            return;
          }
          // 只隐藏"更新配置"按钮，保留"激活"按钮
          if (label === updateConfigLabel) {
            button.style.display = "none";
            button.setAttribute(hiddenAttr, "true");
            return;
          }
          if (button.getAttribute(hiddenAttr) === "true") {
            button.style.display = "";
            button.removeAttribute(hiddenAttr);
          }
        });
      }

      const readonlyObserver = new MutationObserver(() => {
        disableReadonlyActions();
      });
      readonlyObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

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
          pending.reject(new Error(data.error || ${JSON.stringify(t("config.requestFailed"))}));
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

      function normalizeSkillRule(rule) {
        return typeof rule === "string" ? rule.trim() : "";
      }

      function collectManagedClaudeSkillRules(skills) {
        const managedRules = new Set();
        (Array.isArray(skills) ? skills : []).forEach((skill) => {
          if (!skill || typeof skill !== "object") {
            return;
          }
          const name = typeof skill.name === "string" ? skill.name.trim() : "";
          if (!name) {
            return;
          }
          managedRules.add("Skill(" + name + ")");
        });
        return managedRules;
      }

      function stripManagedClaudeSkillRules(content, skills) {
        const managedRules = collectManagedClaudeSkillRules(skills);
        if (!managedRules.size) {
          return content ?? "{}";
        }
        const parsed = parseJsonObject(content ?? "{}");
        if (!parsed || typeof parsed !== "object") {
          return content ?? "";
        }

        const next = { ...parsed };
        const permissions = next.permissions && typeof next.permissions === "object" && !Array.isArray(next.permissions)
          ? { ...next.permissions }
          : null;
        if (!permissions) {
          return JSON.stringify(next);
        }

        const deny = Array.isArray(permissions.deny)
          ? permissions.deny
              .filter((rule) => typeof rule === "string")
              .map((rule) => normalizeSkillRule(rule))
              .filter((rule) => rule && !managedRules.has(rule))
          : [];

        if (deny.length) {
          permissions.deny = deny;
        } else {
          delete permissions.deny;
        }

        if (Object.keys(permissions).length) {
          next.permissions = permissions;
        } else {
          delete next.permissions;
        }

        return JSON.stringify(next);
      }

      function collectManagedOpenCodeSkillNames(skills) {
        const managedNames = new Set();
        (Array.isArray(skills) ? skills : []).forEach((skill) => {
          if (!skill || typeof skill !== "object") {
            return;
          }
          const name = typeof skill.name === "string" ? skill.name.trim() : "";
          if (!name) {
            return;
          }
          managedNames.add(name);
        });
        return managedNames;
      }

      function stripManagedOpenCodeSkillRules(content, skills) {
        const managedNames = collectManagedOpenCodeSkillNames(skills);
        const parsed = parseJsonObject(content ?? "{}");
        if (!parsed || typeof parsed !== "object") {
          return content ?? "";
        }
        if (!managedNames.size) {
          return JSON.stringify(parsed);
        }

        const next = { ...parsed };
        const nextSkills = next.skills && typeof next.skills === "object" && !Array.isArray(next.skills)
          ? { ...next.skills }
          : null;
        if (!nextSkills) {
          return JSON.stringify(next);
        }

        if (nextSkills.enabled === true) {
          delete nextSkills.enabled;
        }

        const disabled = Array.isArray(nextSkills.disabled)
          ? nextSkills.disabled
              .filter((item) => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item && !managedNames.has(item))
          : [];

        if (disabled.length) {
          nextSkills.disabled = disabled;
        } else {
          delete nextSkills.disabled;
        }

        if (Object.keys(nextSkills).length) {
          next.skills = nextSkills;
        } else {
          delete next.skills;
        }

        return JSON.stringify(next);
      }

      function matchActiveConfig(platform, config, current) {
        if (!config || !current) {
          return false;
        }
        if (platform === "claude") {
          const normalizedConfigContent = stripManagedClaudeSkillRules(config.content, config.claudeSkills);
          const normalizedCurrentContent = stripManagedClaudeSkillRules(current.content, config.claudeSkills);
          const configContentObj = parseJsonObject(normalizedConfigContent);
          const currentContentObj = parseJsonObject(normalizedCurrentContent);
          return configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(normalizedConfigContent) === normalizeJson(normalizedCurrentContent);
        }
        if (platform === "opencode") {
          const normalizedConfigContent = stripManagedOpenCodeSkillRules(config.content, config.openCodeSkills);
          const normalizedCurrentContent = stripManagedOpenCodeSkillRules(current.content, config.openCodeSkills);
          const configContentObj = parseJsonObject(normalizedConfigContent);
          const currentContentObj = parseJsonObject(normalizedCurrentContent);
          const contentMatch = configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(normalizedConfigContent) === normalizeJson(normalizedCurrentContent);
          return contentMatch;
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
        const platforms = ["claude", "codex", "opencode"];
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
        const appScripts = ${JSON.stringify(appUris)};
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
