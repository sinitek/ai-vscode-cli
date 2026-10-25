// Config API
const CONFIG_MANAGER_PLATFORMS = ["claude", "codex", "opencode", "grok", "dsh"];
const DSH_PROFILE_SECRET = /(?:^|[\s,{])(?:SINITEK_DSH_API_KEY|DEEPSEEK_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*\S+/i;
const DSH_PROFILE_TOKEN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/;
const stripDshDirectApiKey = (text) => {
  try {
    const profile = JSON.parse(String(text || ""));
    if (!profile || typeof profile !== "object" || Array.isArray(profile) || !Object.prototype.hasOwnProperty.call(profile, "apiKey")) {
      return String(text || "");
    }
    delete profile.apiKey;
    return JSON.stringify(profile);
  } catch {
    return String(text || "");
  }
};
const rejectDshSecretText = (text) => {
  const value = stripDshDirectApiKey(text);
  if (DSH_PROFILE_SECRET.test(value) || DSH_PROFILE_TOKEN.test(value)) {
    throw new Error("DSH profile contains a credential value. Reference SINITEK_DSH_API_KEY only.");
  }
};
const rejectDshConfigSecrets = (config) => {
  if (!config || config.platform !== "dsh") return;
  rejectDshSecretText(config.content);
  rejectDshSecretText(config.configContent);
};
const rejectDshApplySecrets = (platform, payload) => {
  if (platform !== "dsh" || !payload) return;
  rejectDshSecretText(payload.content);
  rejectDshSecretText(payload.configContent);
};
const detectConfigApiMode = () =>
    typeof window < "u" && window.electronAPI?.config ? "ipc" : "http",
  CONFIG_API_BASE = "http://127.0.0.1:9001/api",
  CONFIG_API_URL = `${CONFIG_API_BASE}/config`,
  requestConfigApi = async (e, t) => {
    const n = await fetch(`${CONFIG_API_URL}${e}`, {
        ...t,
        headers: { "Content-Type": "application/json", ...(t?.headers ?? {}) },
      }),
      r = await n.text();
    let o = null;
    try {
      o = r ? JSON.parse(r) : null;
    } catch {}
    if (!n.ok) {
      const l = o?.message ?? `请求失败(${n.status})`;
      throw new Error(l);
    }
    if (o && o.success === !1) throw new Error(o.message ?? "请求失败");
    if (o && o.success === !0) return o.data;
  },
  httpConfigApi = {
    getList: (e) => requestConfigApi(`/list/${e}`),
    getOrder: (e) => requestConfigApi(`/order/${e}`),
    setOrder: (e, t) =>
      requestConfigApi(`/order/${e}`, { method: "POST", body: JSON.stringify(t) }),
    getById: (e, t) => requestConfigApi(`/${e}/${t}`),
    save: async (e) => (
      await requestConfigApi("/save", { method: "POST", body: JSON.stringify(e) }),
      e
    ),
    copy: async (e) =>
      requestConfigApi("/copy", { method: "POST", body: JSON.stringify(e) }),
    delete: (e, t) => requestConfigApi(`/${e}/${t}`, { method: "DELETE" }),
    getCurrent: (e) => requestConfigApi(`/current/${e}`),
    apply: (e, t) =>
      requestConfigApi(`/apply/${e}`, { method: "POST", body: JSON.stringify(t) }),
    backup: (e) => requestConfigApi(`/backup/${e}`, { method: "POST" }),
    getBackups: async (e) => (await requestConfigApi(`/backups/${e}`)).backups,
    initDefault: (e) => requestConfigApi(`/init/${e}`, { method: "POST" }),
    getCliSkillsList: (platform) =>
      requestConfigApi(`/skills/${encodeURIComponent(platform)}`),
    openCliSkillsDirectory: (platform) =>
      requestConfigApi(`/skills/${encodeURIComponent(platform)}/open`, { method: "POST" }),
    deleteCliSkill: (platform, name) =>
      requestConfigApi(`/skills/${encodeURIComponent(platform)}/delete`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    copyCliSkill: (platform, name, targetPlatform) =>
      requestConfigApi(`/skills/${encodeURIComponent(platform)}/copy`, {
        method: "POST",
        body: JSON.stringify({ name, targetPlatform }),
      }),
    searchLobehubSkills: (payload) =>
      requestConfigApi("/skills/market/search", {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      }),
    installLobehubSkill: (payload) =>
      requestConfigApi("/skills/market/install", {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
      }),
        exportConfigs: async () => {
      throw new Error("当前模式不支持导出文件");
    },
  },
  getIpcConfigApi = () => {
    if (!window.electronAPI?.config) throw new Error("Electron API 未就绪");
    return window.electronAPI.config;
  },
  configApiMode = detectConfigApiMode(),
  configApi = configApiMode === "ipc" ? getIpcConfigApi() : httpConfigApi,
  fetchCliSkillsList = async (platform) => {
    if (!configApi.getCliSkillsList) throw new Error("当前模式不支持读取 Skills");
    try {
      return configApi.getCliSkillsList(platform);
    } catch (error) {
      throw (console.error("获取 Skills 失败:", error), error);
    }
  },
  openCliSkillsDirectory = async (platform) => {
    if (!configApi.openCliSkillsDirectory) throw new Error("当前模式不支持打开 Skills 目录");
    try {
      return configApi.openCliSkillsDirectory(platform);
    } catch (error) {
      throw (console.error("打开 Skills 目录失败:", error), error);
    }
  },
  deleteCliSkill = async (platform, name) => {
    if (!configApi.deleteCliSkill) throw new Error("当前模式不支持删除 Skills");
    try {
      return configApi.deleteCliSkill(platform, name);
    } catch (error) {
      throw (console.error("删除 Skill 失败:", error), error);
    }
  },
  copyCliSkill = async (platform, name, targetPlatform) => {
    if (!configApi.copyCliSkill) throw new Error("当前模式不支持复制 Skills");
    try {
      return configApi.copyCliSkill(platform, name, targetPlatform);
    } catch (error) {
      throw (console.error("复制 Skill 失败:", error), error);
    }
  },
  searchLobehubSkills = async (payload) => {
    if (!configApi.searchLobehubSkills) throw new Error("当前模式不支持 Skills 市场");
    try {
      return configApi.searchLobehubSkills(payload);
    } catch (error) {
      throw (console.error("搜索 Skills 市场失败:", error), error);
    }
  },
  installLobehubSkill = async (payload) => {
    if (!configApi.installLobehubSkill) throw new Error("当前模式不支持安装 Skills");
    try {
      return configApi.installLobehubSkill(payload);
    } catch (error) {
      throw (console.error("安装 Skill 失败:", error), error);
    }
  },
    fetchConfigList = async (e) => {
    try {
      return configApi.getList(e);
    } catch (t) {
      throw (console.error("获取配置列表失败:", t), t);
    }
  },
  fetchConfigOrder = async (e) => {
    try {
      return configApi.getOrder(e);
    } catch (t) {
      throw (console.error("获取配置顺序失败:", t), t);
    }
  },
  saveConfigOrder = async (e, t) => {
    try {
      return configApi.setOrder(e, t);
    } catch (t) {
      throw (console.error("保存配置顺序失败:", t), t);
    }
  },
  saveConfigItem = async (e) => {
    try {
      rejectDshConfigSecrets(e);
      return configApi.save(e);
    } catch (t) {
      throw (console.error("保存配置失败:", t), t);
    }
  },
  copyConfigItem = async (e) => {
    if (!configApi.copy) throw new Error("当前模式不支持复制配置");
    try {
      return configApi.copy(e);
    } catch (t) {
      throw (console.error("复制配置失败:", t), t);
    }
  },
  deleteConfigItem = async (e, t) => {
    try {
      await configApi.delete(e, t);
    } catch (n) {
      throw (console.error("删除配置失败:", n), n);
    }
  },
  applyConfigItem = async (e, t) => {
    try {
      rejectDshApplySecrets(e, t);
      return configApi.apply(e, t);
    } catch (n) {
      throw (console.error("应用配置失败:", n), n);
    }
  },
  backupConfigItem = async (e) => {
    try {
      return configApi.backup(e);
    } catch (t) {
      throw (console.error("备份配置失败:", t), t);
    }
  },
  initDefaultConfigItem = async (e) => {
    try {
      return configApi.initDefault(e);
    } catch (t) {
      throw (console.error("初始化默认配置失败:", t), t);
    }
  },
  fetchCurrentConfig = async (e) => {
    try {
      return configApi.getCurrent(e);
    } catch (t) {
      throw (console.error("获取当前配置失败:", t), t);
    }
  },
  exportConfigsItem = async (e) => {
    if (!configApi.exportConfigs) throw new Error("当前模式不支持导出文件");
    try {
      return configApi.exportConfigs(e);
    } catch (t) {
      throw (console.error("导出配置失败:", t), t);
    }
  };
