import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { resolveLocale, t } from "../i18n";

const ASSETS_DIR = ["media", "config", "assets"];

const CONFIG_TRANSLATIONS_EN: Record<string, string> = {
  "携宁 CLI 配置": "Sinitek CLI Config",
  "添加配置": "Add Config",
  "更新配置": "Update Config",
  "激活": "Activate",
  "保存": "Save",
  "删除配置": "Delete Config",
  "重命名": "Rename",
  "重命名配置": "Rename Config",
  "确认删除": "Confirm Delete",
  "确认": "Confirm",
  "取消": "Cancel",
  "导出": "Export",
  "导入": "Import",
  "导出配置": "Export Configs",
  "导入配置": "Import Configs",
  "全选": "Select All",
  "一键导入": "Import All",
  "一键启用": "Enable All",
  "一键禁用": "Disable All",
  "删除成功": "Deleted successfully",
  "重命名成功": "Renamed successfully",
  "保存成功": "Saved successfully",
  "已更新当前激活的配置": "Updated the active config",
  "已添加": "Added",
  "添加": "Add",
  "复制配置": "Copy Config",
  "复制失败，请手动复制": "Copy failed. Please copy manually.",
  "启动命令": "Run Command",
  "安装命令": "Install Command",
  "MCP 市场": "MCP Marketplace",
  "发现并添加常用的 Model Context Protocol (MCP) 服务器到您的配置中。": "Discover and add common Model Context Protocol (MCP) servers to your configs.",
  "暂无配置": "No configs",
  "暂无配置可导出": "No configs to export",
  "请从左侧选择一个配置": "Select a config from the left.",
  "请先选择一个配置": "Please select a config first.",
  "请选择要导出的配置": "Select configs to export.",
  "请选择导出的 JSON 文件进行导入": "Select an exported JSON file to import.",
  "打开下载文件夹": "Open downloads folder",
  "导出已触发下载，请检查浏览器下载目录": "Export triggered. Check your downloads folder.",
  "没有可导入的配置": "No configs to import.",
  "配置名称不能为空": "Config name cannot be empty.",
  "配置名称未改变": "Config name unchanged.",
  "添加成功": "Added successfully.",
  "配置未填写": "Config is empty.",
  "需配置环境变量": "Environment variables required.",
  "查看范例": "View example",
  "请输入配置名称": "Enter config name",
  "请输入新的配置名称": "Enter new config name",
  "请输入JSON配置": "Enter JSON config",
  "请输入TOML配置": "Enter TOML config",
  "请输入 .env 配置": "Enter .env config",
  "请输入 MCP 配置（.claude.json）": "Enter MCP config (.claude.json)",
  "技能列表加载中...": "Loading skills list...",
  "未检测到 Skills，请先安装到 ~/.claude/skills": "No skills detected. Install to ~/.claude/skills first.",
  "未检测到 Skills，请先安装到 ~/.agents/skills 或工作区 .codex/skills": "No skills detected. Install to ~/.agents/skills or workspace .codex/skills first.",
  "未检测到 Skills，请先安装到 ~/.gemini/skills 或工作区 .gemini/skills": "No skills detected. Install to ~/.gemini/skills or workspace .gemini/skills first.",
  "获取 Claude Skills 失败": "Failed to fetch Claude skills.",
  "获取 Codex Skills 失败": "Failed to fetch Codex skills.",
  "获取 Gemini Skills 失败": "Failed to fetch Gemini skills.",
  "更新技能失败": "Failed to update skills.",
  "加载 MCP 市场数据失败": "Failed to load MCP marketplace data.",
  "添加 MCP 失败": "Failed to add MCP.",
  "安装 MCP 失败": "Failed to install MCP.",
  "JSON格式不正确": "Invalid JSON format.",
  "auth.json格式不正确": "Invalid auth.json format.",
  "当前配置不是有效的 JSON，无法自动添加 MCP": "Current config is not valid JSON; cannot auto-add MCP.",
  "当前配置不是有效的 TOML，无法自动添加 MCP": "Current config is not valid TOML; cannot auto-add MCP.",
  "AI与智能": "AI & Intelligence",
  "文件与数据": "Files & Data",
  "开发工具": "Developer Tools",
  "基础设施": "Infrastructure",
  "网络与浏览器": "Web & Browser",
  "生产力工具": "Productivity",
  "其他": "Other",
  "已导入范例内容，请确认后保存": "Example content imported. Please review and save.",
};

const CONFIG_TRANSLATION_PATTERNS_EN = [
  { pattern: "^已导出到[:：]?\\s*(.+)$", replace: "Exported to: $1" },
  { pattern: "^已导入\\s*(\\d+)\\s*项配置$", replace: "Imported $1 configs" },
  { pattern: "^准备导入\\s*(\\d+)\\s*项配置$", replace: "Ready to import $1 configs" },
  { pattern: "^导出\\s*\\((\\d+)\\)$", replace: "Export ($1)" },
  { pattern: "^导入\\s*\\((\\d+)\\)$", replace: "Import ($1)" },
  { pattern: "^已选择\\s*(\\d+)$", replace: "Selected $1" },
  { pattern: "^已应用配置[:：]?\\s*(.+)$", replace: "Applied config: $1" },
  { pattern: "^应用配置失败[:：]?\\s*(.+)$", replace: "Failed to apply config: $1" },
  { pattern: "^已复制配置[:：]?\\s*(.+)$", replace: "Copied config: $1" },
  { pattern: "^复制失败[:：]?\\s*(.+)$", replace: "Copy failed: $1" },
  { pattern: "^添加失败[:：]?\\s*(.+)$", replace: "Add failed: $1" },
  { pattern: "^删除失败[:：]?\\s*(.+)$", replace: "Delete failed: $1" },
  { pattern: "^重命名失败[:：]?\\s*(.+)$", replace: "Rename failed: $1" },
  { pattern: "^保存失败[:：]?\\s*(.+)$", replace: "Save failed: $1" },
  { pattern: "^导入失败[:：]?\\s*(.+)$", replace: "Import failed: $1" },
  { pattern: "^已添加 MCP[:：]?\\s*(.+)$", replace: "Added MCP: $1" },
  { pattern: "^已安装 MCP[:：]?\\s*(.+)$", replace: "Installed MCP: $1" },
  { pattern: "^MCP Server (.+) 已存在，将被覆盖$", replace: "MCP Server $1 already exists and will be overwritten." },
  { pattern: "^已保存，但更新激活配置失败[:：]?\\s*(.+)$", replace: "Saved, but failed to update active config: $1" },
  { pattern: "^配置文件路径[:：]?\\s*(.+)$", replace: "Config file path: $1" }
] as const;

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
  const locale = resolveLocale();
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
  const appUris = appFiles.map((file) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...ASSETS_DIR, file))
  );
  const configBaseUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "config"))
    .toString();

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t("config.appTitle")}</title>
    <link rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const configBase = ${JSON.stringify(configBaseUri)};
      const downloadsDir = ${JSON.stringify(downloadsDir)};
      const configLocale = ${JSON.stringify(locale)};
      const configTranslations = ${JSON.stringify(CONFIG_TRANSLATIONS_EN)};
      const configTranslationPatterns = ${JSON.stringify(CONFIG_TRANSLATION_PATTERNS_EN)};
      try {
        history.replaceState(null, "", configBase + "/index.html");
      } catch (error) {
        // ignore
      }

      function translateConfigText(value) {
        if (configLocale !== "en" || !value) {
          return value;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return value;
        }
        if (Object.prototype.hasOwnProperty.call(configTranslations, trimmed)) {
          const translated = configTranslations[trimmed];
          return value.replace(trimmed, translated);
        }
        for (const rule of configTranslationPatterns) {
          const regex = new RegExp(rule.pattern);
          if (regex.test(trimmed)) {
            const translated = trimmed.replace(regex, rule.replace);
            return value.replace(trimmed, translated);
          }
        }
        return value;
      }

      function translateConfigElement(element) {
        const attrNames = ["title", "placeholder", "aria-label"];
        attrNames.forEach((attr) => {
          const current = element.getAttribute(attr);
          if (!current) {
            return;
          }
          const translated = translateConfigText(current);
          if (translated !== current) {
            element.setAttribute(attr, translated);
          }
        });
      }

      function translateConfigNode(node) {
        if (!node) {
          return;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const current = node.nodeValue || "";
          const translated = translateConfigText(current);
          if (translated !== current) {
            node.nodeValue = translated;
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return;
        }
        const element = node;
        translateConfigElement(element);
        Array.from(element.childNodes).forEach(translateConfigNode);
      }

      function applyConfigTranslations() {
        if (configLocale !== "en") {
          return;
        }
        translateConfigNode(document.body);
        document.title = translateConfigText(document.title);
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
      };

      window.electronAPI = {
        config: {
          getList: (platform) => requestConfig("getList", { platform }),
          getOrder: (platform) => requestConfig("getOrder", { platform }),
          setOrder: (platform, order) => requestConfig("setOrder", { platform, order }),
          getById: (platform, id) => requestConfig("getById", { platform, id }),
          save: (config) => requestConfig("save", { config }),
          delete: (platform, id) => requestConfig("delete", { platform, id }),
          getCurrent: (platform) => requestConfig("getCurrent", { platform }),
          apply: (platform, payload) => requestConfig("apply", { platform, payload }),
          backup: (platform) => requestConfig("backup", { platform }),
          getBackups: (platform) => requestConfig("getBackups", { platform }),
          initDefault: (platform) => requestConfig("initDefault", { platform }),
          getMcpMarketplaceList: () => requestConfig("getMcpMarketplaceList", {}),
          getClaudeSkillsList: () => requestConfig("getClaudeSkillsList", {}),
          getCodexSkillsList: () => requestConfig("getCodexSkillsList", {}),
          getGeminiSkillsList: () => requestConfig("getGeminiSkillsList", {}),
          getCodexMcpServerIds: () => requestConfig("getCodexMcpServerIds", {}),
          installCodexMcp: (mcpId) => requestConfig("installCodexMcp", { mcpId }),
          exportConfigs: (payload) => requestConfig("exportConfigs", { payload }),
        },
      };

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

      if (configLocale === "en") {
        applyConfigTranslations();
        const i18nObserver = new MutationObserver(() => {
          applyConfigTranslations();
        });
        i18nObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }

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

      function collectManagedGeminiSkillNames(skills) {
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

      function stripManagedGeminiSkillRules(content, skills) {
        const managedNames = collectManagedGeminiSkillNames(skills);
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
          const contentMatch = configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(normalizedConfigContent) === normalizeJson(normalizedCurrentContent);
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
          const normalizedConfigContent = stripManagedGeminiSkillRules(config.content, config.geminiSkills);
          const normalizedCurrentContent = stripManagedGeminiSkillRules(current.content, config.geminiSkills);
          const configContentObj = parseJsonObject(normalizedConfigContent);
          const currentContentObj = parseJsonObject(normalizedCurrentContent);
          const contentMatch = configContentObj && currentContentObj
            ? isDeepEqualSubset(configContentObj, currentContentObj)
            : normalizeJson(normalizedConfigContent) === normalizeJson(normalizedCurrentContent);
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
