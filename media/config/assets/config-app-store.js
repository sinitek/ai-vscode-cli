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
  createEmptyOrder = () => ({ claude: [], codex: [], gemini: [] }),
  loadStoredOrder = () => {
    const e = readJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER);
    return e
      ? { claude: e.claude ?? [], codex: e.codex ?? [], gemini: e.gemini ?? [] }
      : createEmptyOrder();
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
    const n = {
      claude: [...t.claude],
      codex: [...t.codex],
      gemini: [...t.gemini],
    };
    return (
      e.forEach((r) => {
        const o = n[r.platform];
        o.includes(r.id) || o.push(r.id);
      }),
      n
    );
  },

// Config store
  useConfigStore = QH((e, t) => ({
    configs: [],
    activeConfigIds: { claude: null, codex: null, gemini: null },
    configOrders: loadStoredOrder(),
    selectedConfigId: null,
    selectedConfigPlatform: null,
    isLoading: !1,
    loadConfigs: async () => {
      try {
        e({ isLoading: !0 });
        const [n, r, o] = await Promise.all([
            fetchConfigList("claude"),
            fetchConfigList("codex"),
            fetchConfigList("gemini"),
          ]),
          l = loadStoredOrder(),
          s = mergeOrderWithConfigs(n, l.claude),
          u = mergeOrderWithConfigs(r, l.codex),
          f = mergeOrderWithConfigs(o, l.gemini),
          m = { claude: s.order, codex: u.order, gemini: f.order },
          v = [...s.configs, ...u.configs, ...f.configs],
          p = readJson(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_claude`) || null,
          h = readJson(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_codex`) || null,
          b = readJson(`${CONFIG_STORAGE_KEYS.ACTIVE_CONFIG_ID}_gemini`) || null;
        (e({
          configs: v,
          activeConfigIds: { claude: p, codex: h, gemini: b },
          configOrders: m,
          isLoading: !1,
        }),
          storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, m));
      } catch (n) {
        throw (console.error("加载配置失败:", n), e({ isLoading: !1 }), n);
      }
    },
    initDefaultConfigs: async () => {
      try {
        const [n, r, o] = await Promise.all([
            initDefaultConfigItem("claude"),
            initDefaultConfigItem("codex"),
            initDefaultConfigItem("gemini"),
          ]),
          l = [];
        if ((n && l.push(n), r && l.push(r), o && l.push(o), l.length > 0)) {
          const s = t().configOrders,
            u = appendOrderForConfigs(l, s),
            f = [...t().configs, ...l];
          (e({ configs: f, configOrders: u }), storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, u));
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
        return (e({ configs: o, configOrders: l }), storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, l), r);
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
    duplicateConfig: async (n) => {
      const r = t(),
        o = r.configs.find((p) => p.id === n);
      if (!o) throw new Error("配置不存在");
      const l = r.configs
          .filter((p) => p.platform === o.platform)
          .map((p) => p.name),
        s = createCopyName(o.name, l),
        u = Date.now(),
        f = { ...o, id: createConfigId(), name: s, createdAt: u, updatedAt: u };
      await saveConfigItem(f);
      const m = [...r.configs, f],
        v = appendOrderForConfigs([f], r.configOrders);
      return (
        e({
          configs: m,
          configOrders: v,
          selectedConfigId: f.id,
          selectedConfigPlatform: f.platform,
        }),
        storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, v),
        f
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
        s = {
          claude: l.configs.filter((h) => h.platform === "claude"),
          codex: l.configs.filter((h) => h.platform === "codex"),
          gemini: l.configs.filter((h) => h.platform === "gemini"),
        },
        u = s[n];
      if (r < 0 || r >= u.length || o < 0 || u.length === 0) return;
      const f = Math.min(o, u.length - 1);
      if (r === f) return;
      const m = [...u],
        [v] = m.splice(r, 1);
      (m.splice(f, 0, v), (s[n] = m));
      const p = {
        claude: s.claude.map((h) => h.id),
        codex: s.codex.map((h) => h.id),
        gemini: s.gemini.map((h) => h.id),
      };
      (e({ configs: [...s.claude, ...s.codex, ...s.gemini], configOrders: p }),
        storeJson(CONFIG_STORAGE_KEYS.CONFIG_ORDER, p));
    },
    getConfigById: (n, r) => {
      const o = t().configs.filter((l) => l.id === n);
      return r ? o.find((l) => l.platform === r) : o[0];
    },
    getConfigsByPlatform: (n) => t().configs.filter((r) => r.platform === n),
    getActiveConfigId: (n) => t().activeConfigIds[n],
  }));
