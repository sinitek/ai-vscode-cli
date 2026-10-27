const s1 = (e) => {
    let t;
    const n = new Set(),
      r = (m, v) => {
        const p = typeof m == "function" ? m(t) : m;
        if (!Object.is(p, t)) {
          const h = t;
          ((t =
            (v ?? (typeof p != "object" || p === null))
              ? p
              : Object.assign({}, t, p)),
            n.forEach((b) => b(t, h)));
        }
      },
      o = () => t,
      u = {
        setState: r,
        getState: o,
        getInitialState: () => f,
        subscribe: (m) => (n.add(m), () => n.delete(m)),
      },
      f = (t = e(r, o, u));
    return u;
  },
  qH = (e) => (e ? s1(e) : s1),
  XH = (e) => e;
function YH(e, t = XH) {
  const n = ee.useSyncExternalStore(
    e.subscribe,
    ee.useCallback(() => t(e.getState()), [e, t]),
    ee.useCallback(() => t(e.getInitialState()), [e, t]),
  );
  return (ee.useDebugValue(n), n);
}
const c1 = (e) => {
    const t = qH(e),
      n = (r) => YH(t, r);
    return (Object.assign(n, t), n);
  },
  QH = (e) => (e ? c1(e) : c1);

const CONFIG_STORAGE_KEYS = {
    ACTIVE_CONFIG_ID: "ai_cli_active_config_id",
    CONFIG_ORDER: "ai_cli_config_order",
  },
  storeJson = (e, t) => {
    try {
      const n = JSON.stringify(t);
      localStorage.setItem(e, n);
    } catch (n) {
      throw (console.error("存储数据失败:", n), n);
    }
  },
  readJson = (e, t) => {
    try {
      const n = localStorage.getItem(e);
      return n === null ? (t ?? null) : JSON.parse(n);
    } catch (n) {
      return (console.error("获取数据失败:", n), t ?? null);
    }
  },
  createConfigId = () => `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  createCopyName = (e, t) => {
    const n = `${e}_副本`;
    if (!t.includes(n)) return n;
    let r = 2,
      o = `${n}${r}`;
    for (; t.includes(o); ) ((r += 1), (o = `${n}${r}`));
    return o;
  },
  configManagerPlatforms = typeof CONFIG_MANAGER_PLATFORMS !== "undefined"
    ? CONFIG_MANAGER_PLATFORMS
    : ["claude", "codex", "opencode", "grok", "dsh", "kimi-code"],
  CONFIG_PLATFORM_SYNC_LABELS = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    grok: "Grok",
    dsh: "DSH",
    "kimi-code": "kimi",
  },
  createEmptyActiveIds = () => {
    const activeIds = {};
    configManagerPlatforms.forEach((platform) => {
      activeIds[platform] = null;
    });
    return activeIds;
  },
  createEmptyOrder = () => {
    const order = {};
    configManagerPlatforms.forEach((platform) => {
      order[platform] = [];
    });
    return order;
  },
  loadStoredOrder = () => {
    const stored = readJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER);
    const order = createEmptyOrder();
    if (!stored || typeof stored !== "object") return order;
    configManagerPlatforms.forEach((platform) => {
      order[platform] = Array.isArray(stored[platform]) ? stored[platform] : [];
    });
    return order;
  },
  mergeOrderWithConfigs = (e, t) => {
    const n = new Set(t),
      r = [];
    t.forEach((s) => {
      const u = e.find((f) => f.id === s);
      u && r.push(u);
    });
    const o = e.filter((s) => !n.has(s.id)),
      l = [...r, ...o];
    return { configs: l, order: l.map((s) => s.id) };
  },
  appendOrderForConfigs = (e, t) => {
    const n = createEmptyOrder();
    configManagerPlatforms.forEach((platform) => {
      n[platform] = [...((t && t[platform]) || [])];
    });
    return (
      e.forEach((r) => {
        const o = n[r.platform];
        o && (o.includes(r.id) || o.push(r.id));
      }),
      n
    );
  },
  createConfigFromExample = (name, platform) => {
    const base = { name, platform };
    if (platform === "claude") {
      return { ...base, content: ps.claude.settings, mcpContent: "{}", claudeSkills: [] };
    }
    if (platform === "codex") {
      return { ...base, configContent: ps.codex.config, authContent: ps.codex.auth, codexSkills: [] };
    }
    if (platform === "opencode") {
      return { ...base, content: ps.opencode.settings, openCodeSkills: [] };
    }
    if (platform === "grok") {
      return { ...base, content: ps.grok.config, configContent: ps.grok.config };
    }
    if (platform === "dsh") {
      return { ...base, content: ps.dsh.config, configContent: ps.dsh.config };
    }
    if (platform === "kimi-code") {
      const content = ps["kimi-code"].config;
      return { ...base, content, configContent: content };
    }
    throw new Error(`不支持的配置平台: ${platform}`);
  },

// Config store
  useConfigStore = QH((e, t) => ({
    configs: [],
    activeConfigIds: createEmptyActiveIds(),
    configOrders: loadStoredOrder(),
    selectedConfigId: null,
    selectedConfigPlatform: null,
    isLoading: !1,
    loadConfigs: async () => {
      try {
        e({ isLoading: !0 });
        const platforms = configManagerPlatforms,
          lists = await Promise.all(platforms.map((platform) => fetchConfigList(platform))),
          orders = await Promise.all(
            platforms.map((platform) => fetchConfigOrder(platform).catch(() => null)),
          ),
          stored = loadStoredOrder(),
          preferred = {},
          merged = [],
          nextOrders = {},
          configs = [],
          activeConfigIds = {};
        platforms.forEach((platform, index) => {
          const remoteOrder = orders[index] && Array.isArray(orders[index][platform]) ? orders[index][platform] : [];
          preferred[platform] = remoteOrder.length ? remoteOrder : stored[platform] || [];
          merged[index] = mergeOrderWithConfigs(lists[index], preferred[platform]);
          nextOrders[platform] = merged[index].order;
          configs.push(...merged[index].configs);
          activeConfigIds[platform] = readJson(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_${platform}`) || null;
        });
        (e({
          configs,
          activeConfigIds,
          configOrders: nextOrders,
          isLoading: !1,
        }),
          storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, nextOrders));
        platforms.forEach((platform, index) => {
          const remoteOrder = orders[index] && Array.isArray(orders[index][platform]) ? orders[index][platform] : [];
          !remoteOrder.length &&
            (stored[platform] || []).length > 0 &&
            saveConfigOrder(platform, nextOrders).catch((error) =>
              console.error(`同步 ${CONFIG_PLATFORM_SYNC_LABELS[platform] || platform} 配置顺序失败:`, error)
            );
        });
      } catch (n) {
        throw (console.error("加载配置失败:", n), e({ isLoading: !1 }), n);
      }
    },
    initDefaultConfigs: async () => {
      try {
        const platforms = configManagerPlatforms,
          created = await Promise.all(platforms.map((platform) => initDefaultConfigItem(platform))),
          items = created.filter(Boolean);
        if (items.length > 0) {
          const nextOrders = appendOrderForConfigs(items, t().configOrders),
            configs = [...t().configs, ...items];
          (e({ configs, configOrders: nextOrders }), storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, nextOrders));
          platforms.forEach((platform, index) => {
            created[index] &&
              saveConfigOrder(platform, nextOrders).catch((error) =>
                console.error(`同步 ${CONFIG_PLATFORM_SYNC_LABELS[platform] || platform} 配置顺序失败:`, error)
              );
          });
        }
      } catch (n) {
        throw (console.error("初始化默认配置失败:", n), n);
      }
    },
    addConfig: async (n) => {
      try {
        const r = {
          ...n,
          id: createConfigId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveConfigItem(r);
        const o = [...t().configs, r],
          l = appendOrderForConfigs([r], t().configOrders);
        return (
          e({ configs: o, configOrders: l }),
          storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, l),
          saveConfigOrder(r.platform, l).catch((s) =>
            console.error("同步配置顺序失败:", s)
          ),
          r
        );
      } catch (r) {
        throw (console.error("添加配置失败:", r), r);
      }
    },
    updateConfig: async (n, r) => {
      try {
        const o = t().configs.find((u) => u.id === n);
        if (!o) throw new Error("配置不存在");
        const l = { ...o, ...r, updatedAt: Date.now() };
        await saveConfigItem(l);
        const s = t().configs.map((u) => (u.id === n ? l : u));
        e({ configs: s });
      } catch (o) {
        throw (console.error("更新配置失败:", o), o);
      }
    },
    deleteConfig: async (n, r) => {
      try {
        await deleteConfigItem(n, r);
        const o = t().configs.filter((p) => p.id !== r),
          l = t().configOrders,
          s = l[n].filter((p) => p !== r),
          u = { ...l, [n]: s };
        (e({ configs: o, configOrders: u }), storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, u));
        saveConfigOrder(n, u).catch((f) =>
          console.error("同步配置顺序失败:", f)
        );
        const f = t().activeConfigIds;
        f[n] === r &&
          (e({ activeConfigIds: { ...f, [n]: null } }),
          localStorage.removeItem(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_${n}`));
        const { selectedConfigId: m, selectedConfigPlatform: v } = t();
        m === r &&
          v === n &&
          e({ selectedConfigId: null, selectedConfigPlatform: null });
      } catch (o) {
        throw (console.error("删除配置失败:", o), o);
      }
    },
    duplicateConfig: async (n, r) => {
      const o = t(),
        l = o.configs.find((v) => v.id === n);
      if (!l) throw new Error("配置不存在");
      const s = r ?? l.platform,
        u = o.configs
          .filter((v) => v.platform === s)
          .map((v) => v.name),
        f = createCopyName(l.name, u);
      let m;
      if (s === l.platform) {
        const v = Date.now();
        m = { ...l, id: createConfigId(), name: f, createdAt: v, updatedAt: v };
        await saveConfigItem(m);
      } else {
        m = await copyConfigItem({
          sourcePlatform: l.platform,
          sourceId: l.id,
          targetPlatform: s,
          name: f,
        });
      }
      const v = [...o.configs, m],
        p = appendOrderForConfigs([m], o.configOrders);
      return (
        e({
          configs: v,
          configOrders: p,
          selectedConfigId: m.id,
          selectedConfigPlatform: m.platform,
        }),
        storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, p),
        saveConfigOrder(m.platform, p).catch((h) =>
          console.error("同步配置顺序失败:", h)
        ),
        m
      );
    },
    setActiveConfig: (n, r) => {
      const o = t().activeConfigIds;
      (e({ activeConfigIds: { ...o, [n]: r } }),
        r
          ? storeJson(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_${n}`, r)
          : localStorage.removeItem(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_${n}`));
    },
    setSelectedConfig: (n, r = null) => {
      e({
        selectedConfigId: n,
        selectedConfigPlatform: n ? (r ?? null) : null,
      });
    },
    reorderConfigs: (n, r, o) => {
      const l = t(),
        s = {};
      configManagerPlatforms.forEach((platform) => {
        s[platform] = l.configs.filter((h) => h.platform === platform);
      });
      const u = s[n];
      if (!u || r < 0 || r >= u.length || o < 0 || u.length === 0) return;
      const f = Math.min(o, u.length - 1);
      if (r === f) return;
      const m = [...u],
        [v] = m.splice(r, 1);
      (m.splice(f, 0, v), (s[n] = m));
      const p = {},
        flat = [];
      configManagerPlatforms.forEach((platform) => {
        p[platform] = s[platform].map((h) => h.id);
        flat.push(...s[platform]);
      });
      (e({ configs: flat, configOrders: p }),
        storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, p));
      saveConfigOrder(n, p).catch((h) =>
        console.error("同步配置顺序失败:", h)
      );
    },
    getConfigById: (n, r) => {
      const o = t().configs.filter((l) => l.id === n);
      return r ? o.find((l) => l.platform === r) : o[0];
    },
    getConfigsByPlatform: (n) => t().configs.filter((r) => r.platform === n),
    getActiveConfigId: (n) => t().activeConfigIds[n],
  }));
