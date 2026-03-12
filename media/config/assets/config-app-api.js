// Config API
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
    delete: (e, t) => requestConfigApi(`/${e}/${t}`, { method: "DELETE" }),
    getCurrent: (e) => requestConfigApi(`/current/${e}`),
    apply: (e, t) =>
      requestConfigApi(`/apply/${e}`, { method: "POST", body: JSON.stringify(t) }),
    backup: (e) => requestConfigApi(`/backup/${e}`, { method: "POST" }),
    getBackups: async (e) => (await requestConfigApi(`/backups/${e}`)).backups,
    initDefault: (e) => requestConfigApi(`/init/${e}`, { method: "POST" }),
    getMcpMarketplaceList: () =>
      fetch(`${CONFIG_API_BASE}/config/mcp/marketplace`).then(async (e) => {
        if (!e.ok) throw new Error(`获取 MCP 市场失败(${e.status})`);
        const t = await e.json();
        if (t?.success === !1)
          throw new Error(t.message ?? "获取 MCP 市场失败");
        return t?.data ?? [];
      }),
    getClaudeSkillsList: () => requestConfigApi("/claude/skills"),
    getCodexSkillsList: () => requestConfigApi("/codex/skills"),
    getGeminiSkillsList: () => requestConfigApi("/gemini/skills"),
    getOfficialSkillsCatalog: async () => {
      throw new Error("当前模式不支持读取内置官方 Skills");
    },
    installOfficialSkill: async () => {
      throw new Error("当前模式不支持安装内置官方 Skills");
    },
    getCodexMcpServerIds: async () => {
      throw new Error("当前模式不支持读取 Codex MCP");
    },
    getCodexMcpHealth: async () => {
      throw new Error("当前模式不支持检测 Codex MCP 健康状态");
    },
    getMcpHealth: async () => {
      throw new Error("当前模式不支持检测 MCP 健康状态");
    },
    installMcp: async () => {
      throw new Error("当前模式不支持安装 MCP");
    },
    installCodexMcp: async () => {
      throw new Error("当前模式不支持安装 Codex MCP");
    },
    uninstallMcp: async () => {
      throw new Error("当前模式不支持卸载 MCP");
    },
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
  fetchMcpMarketplaceList = async () => {
    try {
      return configApi.getMcpMarketplaceList();
    } catch (e) {
      throw (console.error("获取 MCP 市场列表失败:", e), e);
    }
  },
  fetchClaudeSkillsList = async () => {
    try {
      return configApi.getClaudeSkillsList();
    } catch (e) {
      throw (console.error("获取 Claude Skills 失败:", e), e);
    }
  },
  fetchCodexSkillsList = async () => {
    try {
      return configApi.getCodexSkillsList();
    } catch (e) {
      throw (console.error("获取 Codex Skills 失败:", e), e);
    }
  },
  fetchGeminiSkillsList = async () => {
    try {
      return configApi.getGeminiSkillsList();
    } catch (e) {
      throw (console.error("获取 Gemini Skills 失败:", e), e);
    }
  },
  fetchOfficialSkillsCatalog = async (e) => {
    if (!configApi.getOfficialSkillsCatalog) return [];
    try {
      return configApi.getOfficialSkillsCatalog(e);
    } catch (t) {
      throw (console.error("获取官方 Skills 失败:", t), t);
    }
  },
  installOfficialSkillById = async (e, t) => {
    if (!configApi.installOfficialSkill) throw new Error("当前模式不支持安装内置官方 Skills");
    try {
      return configApi.installOfficialSkill(e, t);
    } catch (n) {
      throw (console.error("安装 Skill 失败:", n), n);
    }
  },
  fetchCodexMcpServerIds = async () => {
    if (!configApi.getCodexMcpServerIds) return [];
    try {
      return configApi.getCodexMcpServerIds();
    } catch (e) {
      throw (console.error("获取 Codex MCP 列表失败:", e), e);
    }
  },
  fetchCodexMcpHealth = async () => {
    if (!configApi.getCodexMcpHealth) return [];
    try {
      return configApi.getCodexMcpHealth();
    } catch (e) {
      throw (console.error("获取 Codex MCP 健康状态失败:", e), e);
    }
  },
  fetchMcpHealth = async (e) => {
    if (!configApi.getMcpHealth) return [];
    try {
      return configApi.getMcpHealth(e);
    } catch (t) {
      throw (console.error("获取 MCP 健康状态失败:", t), t);
    }
  },
  installMcpById = async (e, t, n) => {
    if (!configApi.installMcp) throw new Error("当前模式不支持安装 MCP");
    try {
      return configApi.installMcp(e, t, n);
    } catch (r) {
      throw (console.error("安装 MCP 失败:", r), r);
    }
  },
  installCodexMcpById = async (e) => {
    if (!configApi.installCodexMcp)
      throw new Error("当前模式不支持安装 Codex MCP");
    try {
      return configApi.installCodexMcp(e);
    } catch (t) {
      throw (console.error("安装 Codex MCP 失败:", t), t);
    }
  },
  uninstallMcpById = async (e, t) => {
    if (!configApi.uninstallMcp) throw new Error("当前模式不支持卸载 MCP");
    try {
      return configApi.uninstallMcp(e, t);
    } catch (n) {
      throw (console.error("卸载 MCP 失败:", n), n);
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
      return configApi.save(e);
    } catch (t) {
      throw (console.error("保存配置失败:", t), t);
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
