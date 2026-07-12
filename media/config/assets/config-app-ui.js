// Icons
const GH = (e, t) => c.createElement(Qr, ip({}, e, { ref: t, icon: UH })),
  KH = c.forwardRef(GH);

const DEFAULT_RUN_COMMANDS = {
    claude: "claude --dangerously-skip-permissions",
    codex: "codex --dangerously-bypass-approvals-and-sandbox",
    opencode: "opencode --auto",
  };

const DEFAULT_INSTALL_COMMANDS = {
    claude: "npm install -g @anthropic-ai/claude-code",
    codex: "npm i -g @openai/codex",
    opencode: "npm install -g opencode-ai",
  };

const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS = 500;
const CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS = CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS / 2;
const CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX = 220;
const CONFIG_PROVIDER_CARD_ORIGINAL_MIN_WIDTH_PX = 190;
const CONFIG_PROVIDER_CARD_WIDTH_SCALE = 0.6;
const CONFIG_PROVIDER_CARD_WIDTH_PX = Math.round(
  CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX * CONFIG_PROVIDER_CARD_WIDTH_SCALE,
);
const CONFIG_PROVIDER_CARD_MIN_WIDTH_PX = Math.round(
  CONFIG_PROVIDER_CARD_ORIGINAL_MIN_WIDTH_PX * CONFIG_PROVIDER_CARD_WIDTH_SCALE,
);

const { confirm: uk } = xr;

// Config list panel
const ConfigListPanel = ({ onMobileClose } = {}) => {
    const {
        configs: e,
        activeConfigIds: t,
        selectedConfigId: n,
        selectedConfigPlatform: r,
        setSelectedConfig: o,
        addConfig: l,
        updateConfig: s,
        deleteConfig: u,
        duplicateConfig: f,
        setActiveConfig: m,
        reorderConfigs: v,
      } = useConfigStore(),
      [p, h] = c.useState(null),
      [b, x] = c.useState(null),
      [S, y] = c.useState(null),
      [exportOpen, setExportOpen] = c.useState(!1),
      [exportResult, setExportResult] = c.useState(""),
      [importOpen, setImportOpen] = c.useState(!1),
      [exportSelection, setExportSelection] = c.useState({}),
      [importItems, setImportItems] = c.useState(null),
      [importError, setImportError] = c.useState(""),
      [isImporting, setIsImporting] = c.useState(!1),
      $ = c.useMemo(() => e.filter((k) => k.platform === "claude"), [e]),
      w = c.useMemo(() => e.filter((k) => k.platform === "codex"), [e]),
      O = c.useMemo(() => e.filter((k) => k.platform === "opencode"), [e]),
      exportSelectedCount = c.useMemo(
        () => e.reduce((k, L) => k + (exportSelection[L.id] ? 1 : 0), 0),
        [e, exportSelection],
      ),
      exportAllChecked = e.length > 0 && exportSelectedCount === e.length,
      exportAnySelected = exportSelectedCount > 0,
      I = (k) => {
        const L =
          k === "claude" ? "Claude" : k === "codex" ? "Codex" : "OpenCode";
        xr.confirm({
          title: `添加${L}配置`,
          content: be.jsx(zi, {
            id: "config-name-input",
            placeholder: "请输入配置名称",
            defaultValue: `${L} 配置 ${Date.now()}`,
          }),
          onOk: async () => {
            const U = document
              .getElementById("config-name-input")
              ?.value?.trim();
            if (!U) return (Kt.error("配置名称不能为空"), Promise.reject());
            try {
              let T;
              (k === "claude"
                ? (T = await l({
                    name: U,
                    platform: k,
                    content: "{}",
                    mcpContent: "{}",
                    claudeSkills: [],
                  }))
                : k === "opencode"
	                  ? (T = await l({
	                      name: U,
	                      platform: k,
	                      content: "{}",
	                      openCodeSkills: [],
	                    }))
                  : (T = await l({
                      name: U,
                      platform: k,
                      configContent: "",
                      envContent: "",
                      authContent: "{}",
                      codexSkills: [],
                    })),
                o(T.id, T.platform),
                Kt.success("添加成功"));
            } catch (T) {
              return (Kt.error("添加失败: " + T), Promise.reject(T));
            }
          },
        });
      },
      R = async (k, L) => {
        try {
          if (navigator.clipboard?.writeText)
            await navigator.clipboard.writeText(k);
          else {
            const G = document.createElement("textarea");
            ((G.value = k),
              document.body.appendChild(G),
              G.select(),
              document.execCommand("copy"),
              document.body.removeChild(G));
          }
          Kt.success(`${L} 已复制: ${k}`);
        } catch {
          Kt.error("复制失败，请手动复制");
        }
      },
      P = (k) => (k === "claude" ? $ : k === "codex" ? w : O),
      _ = (k) => {
        x(k);
      },
      M = () => {
        (x(null), y(null));
      },
      N = (k, L) => {
        (k.preventDefault(), y(L));
      },
      z = (k, L, G) => {
        if ((k.preventDefault(), k.stopPropagation(), !b || b === G)) {
          M();
          return;
        }
        const U = P(L),
          T = U.findIndex((Y) => Y.id === b),
          F = U.findIndex((Y) => Y.id === G);
        if (T === -1 || F === -1) {
          M();
          return;
        }
        (v(L, T, F), M());
      },
      D = (k, L) => {
        if ((k.preventDefault(), k.stopPropagation(), !b)) {
          M();
          return;
        }
        const G = P(L),
          U = G.findIndex((T) => T.id === b);
        if (U === -1) {
          M();
          return;
        }
        (v(L, U, G.length - 1), M());
      },
      B = async (k, L) => {
        k.stopPropagation();
        try {
          (h(L.id),
            await backupConfigItem(L.platform),
            L.platform === "claude"
              ? await applyConfigItem(L.platform, {
                  content: L.content,
                  mcpContent: L.mcpContent,
                  claudeSkills: L.claudeSkills ?? [],
                })
              : L.platform === "opencode"
	                ? await applyConfigItem(L.platform, {
	                    content: L.content,
	                    openCodeSkills: L.openCodeSkills ?? [],
	                  })
                : await applyConfigItem(L.platform, {
                    configContent: L.configContent,
                    envContent: L.envContent,
                    authContent: L.authContent,
                    codexSkills: L.codexSkills ?? [],
                  }),
            m(L.platform, L.id),
            Kt.success(`已应用配置: ${L.name}`));
        } catch (G) {
          Kt.error(`应用配置失败: ${G}`);
        } finally {
          h(null);
        }
      },
      A = (k, L) => {
        (k.stopPropagation(),
          uk({
            title: "确认删除",
            content: `确定要删除配置"${L.name}"吗？`,
            okText: "确认",
            cancelText: "取消",
            okType: "danger",
            onOk: async () => {
              try {
                (await u(L.platform, L.id), Kt.success("删除成功"));
              } catch (G) {
                Kt.error("删除失败: " + G);
              }
            },
          }));
      },
      V = async (k, L) => {
        k.stopPropagation();
        const G = [
          { label: L.platform === "claude" ? "Claude" : L.platform === "codex" ? "Codex" : "OpenCode", value: L.platform },
        ];
        const Y = G[0].label;
        xr.confirm({
          title: "复制配置",
          content: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "8px" },
            children: [
              be.jsx("div", { children: `从 ${L.name} 复制到 ${Y}` }),
              be.jsx("select", {
                id: "copy-target-platform",
                defaultValue: G[G.length - 1].value,
                style: {
                  width: "100%",
                  padding: "6px 8px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  background: "var(--bg-color-container)",
                  color: "var(--text-color)",
                },
                children: G.map((K) =>
                  be.jsx("option", { value: K.value, children: K.label }, K.value),
                ),
              }),
            ],
          }),
          okText: "确认",
          cancelText: "取消",
          onOk: async () => {
            const K = document.getElementById("copy-target-platform")?.value || L.platform;
            try {
              const Q = await f(L.id, K);
              (o(Q.id, Q.platform), Kt.success(`已复制配置: ${Q.name}`));
            } catch (Q) {
              return (Kt.error(`复制失败: ${Q}`), Promise.reject(Q));
            }
          },
        });
      },
      W = (k, L) => {
        (k.stopPropagation(),
          xr.confirm({
            title: "重命名配置",
            content: be.jsx(zi, {
              id: "rename-input",
              placeholder: "请输入新的配置名称",
              defaultValue: L.name,
            }),
            onOk: async () => {
              const U = document.getElementById("rename-input")?.value?.trim();
              if (!U) return (Kt.error("配置名称不能为空"), Promise.reject());
              if (U === L.name) {
                Kt.info("配置名称未改变");
                return;
              }
              try {
                (await s(L.id, { name: U }), Kt.success("重命名成功"));
              } catch (T) {
                return (Kt.error("重命名失败: " + T), Promise.reject(T));
              }
            },
          }));
      },
      openExportModal = () => {
        setExportSelection((k) => {
          const L = {};
          e.forEach((G) => {
            L[G.id] = k[G.id] ?? !1;
          });
          return L;
        });
        setExportResult("");
        setExportOpen(!0);
      },
      openImportModal = () => {
        setImportOpen(!0);
        setImportItems(null);
        setImportError("");
      },
      toggleExportAll = (k) => {
        const L = {};
        e.forEach((G) => {
          L[G.id] = k;
        });
        setExportSelection(L);
      },
      toggleExportItem = (k, L) => {
        setExportSelection((G) => ({ ...G, [k]: L }));
      },
      doExport = async () => {
        const k = e.filter((L) => exportSelection[L.id]);
        if (k.length === 0) {
          Kt.warning("请选择要导出的配置");
          return;
        }
        const L = {
          version: 1,
          exportedAt: Date.now(),
	          configs: k.map((G) => ({
	            name: G.name,
	            platform: G.platform,
	            content: G.content,
	            mcpContent: G.mcpContent,
	            envContent: G.platform === "opencode" ? void 0 : G.envContent,
	            configContent: G.configContent,
	            authContent: G.authContent,
	          })),
        };
        const G = JSON.stringify(L, null, 2);
        const Y = `sinitek-cli-configs-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.json`;
        try {
          const U = await exportConfigsItem({ fileName: Y, content: G });
          const T = U?.path || U?.fileName || Y;
          setExportResult(T);
          if (U?.downloadsDir) {
            window.sinitekConfigBridge?.openPath?.(U.downloadsDir);
          }
          Kt.success(`已导出到: ${T}`);
        } catch (U) {
          const T = new Blob([G], { type: "application/json" });
          const F = URL.createObjectURL(T);
          const K = document.createElement("a");
          (K.href = F),
            (K.download = Y),
            document.body.appendChild(K),
            K.click(),
            document.body.removeChild(K),
            URL.revokeObjectURL(F);
          setExportResult(Y);
          Kt.warning("导出已触发下载，请检查浏览器下载目录");
        }
      },
      readFileText = (k) =>
        new Promise((L, G) => {
          const U = new FileReader();
          (U.onload = () => L(String(U.result || ""))),
            (U.onerror = () => G(U.error || new Error("读取文件失败"))),
            U.readAsText(k);
        }),
      normalizeImportItem = (k) => {
        if (!k || !k.platform) return null;
        const L = k.platform,
          G = k.name || `${L} 配置 ${Date.now()}`;
        if (L === "claude") {
          return {
            name: G,
            platform: L,
            content: k.content ?? "{}",
            mcpContent: k.mcpContent ?? "{}",
          };
        }
	        if (L === "opencode") {
	          return {
	            name: G,
	            platform: L,
	            content: k.content ?? "{}",
	          };
	        }
        if (L === "codex") {
          return {
            name: G,
            platform: L,
            configContent: k.configContent ?? "",
            envContent: k.envContent ?? "",
            authContent: k.authContent ?? "{}",
          };
        }
        return null;
      },
      handleImportFile = async (k) => {
        if (!k) return;
        setImportError("");
        setImportItems(null);
        try {
          const L = await readFileText(k),
            G = JSON.parse(L),
            U = Array.isArray(G) ? G : G?.configs;
          if (!Array.isArray(U)) throw new Error("导入文件格式不正确");
          const T = U.map(normalizeImportItem).filter(Boolean);
          if (T.length === 0) throw new Error("未找到可导入配置");
          setImportItems(T);
        } catch (L) {
          setImportError(`解析失败: ${L && L.message ? L.message : L}`);
        }
      },
      applyImport = async () => {
        if (!importItems || importItems.length === 0) {
          Kt.warning("没有可导入的配置");
          return;
        }
        setIsImporting(!0);
        try {
          const k = new Map(e.map((L) => [`${L.platform}::${L.name}`, L]));
          for (const L of importItems) {
            const G = k.get(`${L.platform}::${L.name}`);
            if (G) {
              await s(G.id, L);
            } else {
              const U = await l(L);
              k.set(`${U.platform}::${U.name}`, U);
            }
          }
          Kt.success(`已导入 ${importItems.length} 项配置`);
          setImportOpen(!1);
        } catch (k) {
          Kt.error("导入失败: " + k);
        } finally {
          setIsImporting(!1);
        }
      },
      H = (k, L) => {
        const G =
            k === "claude" ? "Claude" : k === "codex" ? "Codex" : "OpenCode",
          U = DEFAULT_RUN_COMMANDS[k],
          T = DEFAULT_INSTALL_COMMANDS[k];
        return be.jsx(aa, {
          title: be.jsx("div", {
            style: { display: "flex", flexDirection: "column", gap: 2 },
            children: be.jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 4 },
              children: [
                be.jsx("span", { children: G }),
                be.jsxs($s, {
                  size: 2,
                  children: [
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => R(T, "安装命令"),
                      children: "安装命令",
                    }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => R(U, "启动命令"),
                      children: "启动命令",
                    }),
                  ],
                }),
              ],
            }),
          }),
          extra: be.jsx(xn, {
            type: "primary",
            size: "small",
            icon: be.jsx(oO, {}),
            onClick: () => I(k),
            children: "添加配置",
          }),
          headStyle: { paddingLeft: "4px", paddingRight: "4px" },
          bodyStyle: { paddingLeft: "4px", paddingRight: "4px" },
          style: { marginBottom: "8px" },
          children: be.jsx("div", {
            onDragOver: (F) => N(F, ""),
            onDrop: (F) => D(F, k),
            children: be.jsx(Bs, {
              className: "config-list",
              dataSource: L,
              rowKey: (F) => F.id,
              locale: { emptyText: "暂无配置" },
              renderItem: (F) => {
                const Y = t[k] === F.id,
                  K = n === F.id && r === F.platform,
                  Q = p === F.id,
                  J = S === F.id;
                return be.jsx(Bs.Item, {
                  className: K ? "config-list-item config-list-item-selected" : "config-list-item",
                  draggable: !0,
                  onClick: () => {
                    (o(F.id, F.platform), onMobileClose?.());
                  },
                  onDragStart: () => _(F.id),
                  onDragOver: (ae) => {
                    (ae.stopPropagation(), N(ae, F.id));
                  },
                  onDragEnd: M,
                  onDrop: (ae) => z(ae, k, F.id),
                  style: {
                    cursor: "pointer",
                    padding: "0",
                    borderRadius: "6px",
                    transition: "all 0.2s ease-in-out",
                    border: J
                      ? "1px dashed var(--border-color)"
                      : "1px solid transparent",
                  },
                  extra: be.jsxs($s, {
                    className: "config-list-actions",
                    size: 4,
                    children: [
                      be.jsx(xn, {
                        type: "default",
                        size: "small",
                        className: Y
                          ? "config-activate-button config-activate-button-active"
                          : "config-activate-button",
                        loading: Q,
                        onClick: (ae) => B(ae, F),
                        children: Y ? "更新配置" : "激活",
                      }),
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        icon: be.jsx(zH, {}),
                        onClick: (ae) => V(ae, F),
                        title: "复制配置",
                      }),
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        icon: be.jsx(FH, {}),
                        onClick: (ae) => W(ae, F),
                        title: "重命名",
                      }),
                      be.jsx(xn, {
                        type: "text",
                        size: "small",
                        danger: !0,
                        icon: be.jsx(AH, {}),
                        onClick: (ae) => A(ae, F),
                        title: "删除配置",
                      }),
                    ],
                  }),
                  children: be.jsxs($s, {
                    children: [
                      be.jsx("span", {
                        className: "config-name",
                        style: { fontWeight: K ? 600 : 500 },
                        children: F.name,
                      }),
                      Y &&
                        be.jsx("span", {
                          className: "config-active-tag",
                          children: "✓",
                        }),
                    ],
                  }),
                });
              },
            }),
          }),
        });
      };
    return be.jsxs("div", {
      className: "config-sidebar-panel",
      style: { height: "100%", padding: "4px", overflow: "auto" },
      children: [
        be.jsxs("div", {
          className: "config-list-toolbar",
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "4px",
            marginBottom: "4px",
          },
          children: [
            be.jsx(xn, {
              type: "text",
              size: "small",
              className: "config-mobile-close-button",
              "aria-label": "关闭配置目录",
              onClick: onMobileClose,
              children: be.jsx("span", {
                className: "config-mobile-close-icon",
                "aria-hidden": "true",
                children: "×",
              }),
            }),
            be.jsx(xn, { size: "small", onClick: openExportModal, children: "导出" }),
            be.jsx(xn, { size: "small", onClick: openImportModal, children: "导入" }),
          ],
        }),
        H("claude", $),
        H("codex", w),
        H("opencode", O),
        be.jsx(xr, {
          title: "导出配置",
          open: exportOpen,
          onCancel: () => setExportOpen(!1),
          width: 720,
          footer: null,
          destroyOnClose: !0,
          children: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "12px" },
            children: [
              be.jsxs("div", {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                },
                children: [
                  be.jsxs("label", {
                    style: { display: "flex", alignItems: "center", gap: "8px" },
                    children: [
                      be.jsx("input", {
                        type: "checkbox",
                        checked: exportAllChecked,
                        disabled: e.length === 0,
                        onChange: (k) => toggleExportAll(k.target.checked),
                      }),
                      be.jsx("span", { children: "全选" }),
                    ],
                  }),
                  be.jsx("div", {
                    style: {
                      color: "var(--text-color-secondary)",
                      fontSize: "12px",
                    },
                    children: `已选择 ${exportSelectedCount} / ${e.length}`,
                  }),
                ],
              }),
              be.jsx("div", {
                style: {
                  border: "1px solid var(--border-color)",
                  borderRadius: "6px",
                  padding: "8px",
                  maxHeight: "360px",
                  overflow: "auto",
                  background: "var(--bg-color-layout)",
                },
                children:
                  e.length === 0
                    ? be.jsx("div", {
                        style: {
                          color: "var(--text-color-secondary)",
                          fontSize: "12px",
                        },
                        children: "暂无配置可导出",
                      })
                    : e.map((k) =>
                        be.jsx(
                          "div",
                          {
                            style: {
                              display: "flex",
                              gap: "10px",
                              padding: "8px",
                              borderRadius: "6px",
                              background: "var(--bg-color-container)",
                              border: "1px solid var(--border-color)",
                              marginBottom: "8px",
                            },
                            children: be.jsxs("div", {
                              style: { display: "flex", gap: "8px", width: "100%" },
                              children: [
                                be.jsx("input", {
                                  type: "checkbox",
                                  checked: exportSelection[k.id] === !0,
                                  onChange: (L) => toggleExportItem(k.id, L.target.checked),
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                    flex: 1,
                                  },
                                  children: [
                                    be.jsx("div", { children: k.name }),
                                    be.jsx("div", {
                                      style: {
                                        color: "var(--text-color-secondary)",
                                        fontSize: "12px",
                                      },
                                      children:
                                        k.platform === "claude"
                                          ? "Claude"
                                          : k.platform === "codex"
                                            ? "Codex"
                                            : "OpenCode",
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          },
                          k.id,
                        ),
                      ),
              }),
              exportResult
                ? be.jsxs("div", {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: "var(--bg-color-container)",
                      border: "1px solid var(--border-color)",
                    },
                    children: [
                      be.jsxs("div", {
                        style: {
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          minWidth: 0,
                        },
                        children: [
                          be.jsx("div", {
                            style: { fontSize: "12px", color: "var(--text-color-secondary)" },
                            children: "已导出到",
                          }),
                          be.jsx("div", {
                            style: {
                              fontSize: "12px",
                              wordBreak: "break-all",
                              color: "var(--text-color)",
                            },
                            children: exportResult,
                          }),
                        ],
                      }),
                      window.sinitekConfigBridge?.downloadsDir
                        ? be.jsx(xn, {
                            size: "small",
                            onClick: () =>
                              window.sinitekConfigBridge?.openPath?.(
                                window.sinitekConfigBridge?.downloadsDir,
                              ),
                            children: "打开下载文件夹",
                          })
                        : null,
                    ],
                  })
                : null,
              be.jsxs("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                children: [
                  be.jsx(xn, { onClick: () => setExportOpen(!1), children: "取消" }),
                  be.jsx(xn, {
                    type: "primary",
                    disabled: !exportAnySelected,
                    onClick: doExport,
                    children: `导出 (${exportSelectedCount})`,
                  }),
                ],
              }),
            ],
          }),
        }),
        be.jsx(xr, {
          title: "导入配置",
          open: importOpen,
          onCancel: () => {
            setImportOpen(!1);
            setImportItems(null);
            setImportError("");
          },
          width: 720,
          footer: null,
          destroyOnClose: !0,
          children: be.jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "12px" },
            children: [
              be.jsx("div", {
                style: { color: "var(--text-color-secondary)", fontSize: "12px" },
                children: "请选择导出的 JSON 文件进行导入",
              }),
              be.jsx("input", {
                type: "file",
                accept: "application/json",
                onChange: (k) => {
                  const L = k.target.files?.[0];
                  L && handleImportFile(L);
                  k.target.value = "";
                },
              }),
              importError
                ? be.jsx("div", {
                    style: { color: "var(--error-color)", fontSize: "12px" },
                    children: importError,
                  })
                : null,
              importItems
                ? be.jsxs("div", {
                    style: { display: "flex", flexDirection: "column", gap: "8px" },
                    children: [
                      be.jsx("div", {
                        style: {
                          color: "var(--text-color-secondary)",
                          fontSize: "12px",
                        },
                        children: `准备导入 ${importItems.length} 项配置`,
                      }),
                      be.jsx("div", {
                        style: {
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          padding: "8px",
                          maxHeight: "320px",
                          overflow: "auto",
                          background: "var(--bg-color-layout)",
                        },
                        children: importItems.map((k, L) =>
                          be.jsx(
                            "div",
                            {
                              style: {
                                display: "flex",
                                flexDirection: "column",
                                gap: "2px",
                                padding: "8px",
                                borderRadius: "6px",
                                background: "var(--bg-color-container)",
                                border: "1px solid var(--border-color)",
                                marginBottom: "8px",
                              },
                              children: [
                                be.jsx("div", { children: k.name }),
                                be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children:
                                    k.platform === "claude"
                                      ? "Claude"
                                      : k.platform === "codex"
                                        ? "Codex"
                                        : "OpenCode",
                                }),
                              ],
                            },
                            `${k.platform}_${k.name}_${L}`,
                          ),
                        ),
                      }),
                    ],
                  })
                : null,
              be.jsxs("div", {
                style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
                children: [
                  be.jsx(xn, {
                    onClick: () => {
                      setImportOpen(!1);
                      setImportItems(null);
                      setImportError("");
                    },
                    children: "取消",
                  }),
                  be.jsx(xn, {
                    type: "primary",
                    loading: isImporting,
                    disabled: !importItems || importItems.length === 0,
                    onClick: applyImport,
                    children: importItems ? `导入 (${importItems.length})` : "导入",
                  }),
                ],
              }),
            ],
          }),
        }),
      ],
    });
  };
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function fk(e, t) {
  let n = e.slice(0, t).split(/\r\n|\n|\r/g);
  return [n.length, n.pop().length + 1];
}
function mk(e, t, n) {
  let r = e.split(/\r\n|\n|\r/g),
    o = "",
    l = (Math.log10(t + 1) | 0) + 1;
  for (let s = t - 1; s <= t + 1; s++) {
    let u = r[s - 1];
    u &&
      ((o += s.toString().padEnd(l, " ")),
      (o += ":  "),
      (o += u),
      (o += `
`),
      s === t &&
        ((o += " ".repeat(l + n + 2)),
        (o += `^
`)));
  }
  return o;
}
class qt extends Error {
  line;
  column;
  codeblock;
  constructor(t, n) {
    const [r, o] = fk(n.toml, n.ptr),
      l = mk(n.toml, r, o);
    (super(
      `Invalid TOML document: ${t}

${l}`,
      n,
    ),
      (this.line = r),
      (this.column = o),
      (this.codeblock = l));
  }
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function vk(e, t) {
  let n = 0;
  for (; e[t - ++n] === "\\"; );
  return --n && n % 2;
}
function sd(e, t = 0, n = e.length) {
  let r = e.indexOf(
    `
`,
    t,
  );
  return (e[r - 1] === "\r" && r--, r <= n ? r : -1);
}
function fh(e, t) {
  for (let n = t; n < e.length; n++) {
    let r = e[n];
    if (
      r ===
      `
`
    )
      return n;
    if (
      r === "\r" &&
      e[n + 1] ===
        `
`
    )
      return n + 1;
    if ((r < " " && r !== "	") || r === "")
      throw new qt("control characters are not allowed in comments", {
        toml: e,
        ptr: t,
      });
  }
  return e.length;
}
function Zo(e, t, n, r) {
  let o;
  for (
    ;
    (o = e[t]) === " " ||
    o === "	" ||
    (!n &&
      (o ===
        `
` ||
        (o === "\r" &&
          e[t + 1] ===
            `
`)));
  )
    t++;
  return r || o !== "#" ? t : Zo(e, fh(e, t), n);
}
function f1(e, t, n, r, o = !1) {
  if (!r) return ((t = sd(e, t)), t < 0 ? e.length : t);
  for (let l = t; l < e.length; l++) {
    let s = e[l];
    if (s === "#") l = sd(e, l);
    else {
      if (s === n) return l + 1;
      if (
        s === r ||
        (o &&
          (s ===
            `
` ||
            (s === "\r" &&
              e[l + 1] ===
                `
`)))
      )
        return l;
    }
  }
  throw new qt("cannot find end of structure", { toml: e, ptr: t });
}
function aO(e, t) {
  let n = e[t],
    r = n === e[t + 1] && e[t + 1] === e[t + 2] ? e.slice(t, t + 3) : n;
  t += r.length - 1;
  do t = e.indexOf(r, ++t);
  while (t > -1 && n !== "'" && vk(e, t));
  return (
    t > -1 &&
      ((t += r.length), r.length > 1 && (e[t] === n && t++, e[t] === n && t++)),
    t
  );
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let gk =
  /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}:\d{2}(?:\.\d+)?)?(Z|[-+]\d{2}:\d{2})?$/i;
class nl extends Date {
  #t = !1;
  #n = !1;
  #e = null;
  constructor(t) {
    let n = !0,
      r = !0,
      o = "Z";
    if (typeof t == "string") {
      let l = t.match(gk);
      l
        ? (l[1] || ((n = !1), (t = `0000-01-01T${t}`)),
          (r = !!l[2]),
          r && t[10] === " " && (t = t.replace(" ", "T")),
          l[2] && +l[2] > 23
            ? (t = "")
            : ((o = l[3] || null),
              (t = t.toUpperCase()),
              !o && r && (t += "Z")))
        : (t = "");
    }
    (super(t),
      isNaN(this.getTime()) || ((this.#t = n), (this.#n = r), (this.#e = o)));
  }
  isDateTime() {
    return this.#t && this.#n;
  }
  isLocal() {
    return !this.#t || !this.#n || !this.#e;
  }
  isDate() {
    return this.#t && !this.#n;
  }
  isTime() {
    return this.#n && !this.#t;
  }
  isValid() {
    return this.#t || this.#n;
  }
  toISOString() {
    let t = super.toISOString();
    if (this.isDate()) return t.slice(0, 10);
    if (this.isTime()) return t.slice(11, 23);
    if (this.#e === null) return t.slice(0, -1);
    if (this.#e === "Z") return t;
    let n = +this.#e.slice(1, 3) * 60 + +this.#e.slice(4, 6);
    return (
      (n = this.#e[0] === "-" ? n : -n),
      new Date(this.getTime() - n * 6e4).toISOString().slice(0, -1) + this.#e
    );
  }
  static wrapAsOffsetDateTime(t, n = "Z") {
    let r = new nl(t);
    return ((r.#e = n), r);
  }
  static wrapAsLocalDateTime(t) {
    let n = new nl(t);
    return ((n.#e = null), n);
  }
  static wrapAsLocalDate(t) {
    let n = new nl(t);
    return ((n.#n = !1), (n.#e = null), n);
  }
  static wrapAsLocalTime(t) {
    let n = new nl(t);
    return ((n.#t = !1), (n.#e = null), n);
  }
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let pk = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/,
  hk = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/,
  yk = /^[+-]?0[0-9_]/,
  bk = /^[0-9a-f]{4,8}$/i,
  m1 = {
    b: "\b",
    t: "	",
    n: `
`,
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
function lO(e, t = 0, n = e.length) {
  let r = e[t] === "'",
    o = e[t++] === e[t] && e[t] === e[t + 1];
  o &&
    ((n -= 2),
    e[(t += 2)] === "\r" && t++,
    e[t] ===
      `
` && t++);
  let l = 0,
    s,
    u = "",
    f = t;
  for (; t < n - 1; ) {
    let m = e[t++];
    if (
      m ===
        `
` ||
      (m === "\r" &&
        e[t] ===
          `
`)
    ) {
      if (!o)
        throw new qt("newlines are not allowed in strings", {
          toml: e,
          ptr: t - 1,
        });
    } else if ((m < " " && m !== "	") || m === "")
      throw new qt("control characters are not allowed in strings", {
        toml: e,
        ptr: t - 1,
      });
    if (s) {
      if (((s = !1), m === "u" || m === "U")) {
        let v = e.slice(t, (t += m === "u" ? 4 : 8));
        if (!bk.test(v))
          throw new qt("invalid unicode escape", { toml: e, ptr: l });
        try {
          u += String.fromCodePoint(parseInt(v, 16));
        } catch {
          throw new qt("invalid unicode escape", { toml: e, ptr: l });
        }
      } else if (
        o &&
        (m ===
          `
` ||
          m === " " ||
          m === "	" ||
          m === "\r")
      ) {
        if (
          ((t = Zo(e, t - 1, !0)),
          e[t] !==
            `
` && e[t] !== "\r")
        )
          throw new qt(
            "invalid escape: only line-ending whitespace may be escaped",
            { toml: e, ptr: l },
          );
        t = Zo(e, t);
      } else if (m in m1) u += m1[m];
      else throw new qt("unrecognized escape sequence", { toml: e, ptr: l });
      f = t;
    } else !r && m === "\\" && ((l = t - 1), (s = !0), (u += e.slice(f, l)));
  }
  return u + e.slice(f, n - 1);
}
function Ck(e, t, n, r) {
  if (e === "true") return !0;
  if (e === "false") return !1;
  if (e === "-inf") return -1 / 0;
  if (e === "inf" || e === "+inf") return 1 / 0;
  if (e === "nan" || e === "+nan" || e === "-nan") return NaN;
  if (e === "-0") return r ? 0n : 0;
  let o = pk.test(e);
  if (o || hk.test(e)) {
    if (yk.test(e))
      throw new qt("leading zeroes are not allowed", { toml: t, ptr: n });
    e = e.replace(/_/g, "");
    let s = +e;
    if (isNaN(s)) throw new qt("invalid number", { toml: t, ptr: n });
    if (o) {
      if ((o = !Number.isSafeInteger(s)) && !r)
        throw new qt("integer value cannot be represented losslessly", {
          toml: t,
          ptr: n,
        });
      (o || r === !0) && (s = BigInt(e));
    }
    return s;
  }
  const l = new nl(e);
  if (!l.isValid()) throw new qt("invalid value", { toml: t, ptr: n });
  return l;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function Sk(e, t, n, r) {
  let o = e.slice(t, n),
    l = o.indexOf("#");
  l > -1 && (fh(e, l), (o = o.slice(0, l)));
  let s = o.trimEnd();
  if (!r) {
    let u = o.indexOf(
      `
`,
      s.length,
    );
    if (u > -1)
      throw new qt("newlines are not allowed in inline tables", {
        toml: e,
        ptr: t + u,
      });
  }
  return [s, l];
}
function mh(e, t, n, r, o) {
  if (r === 0)
    throw new qt("document contains excessively nested structures. aborting.", {
      toml: e,
      ptr: t,
    });
  let l = e[t];
  if (l === "[" || l === "{") {
    let [f, m] = l === "[" ? $k(e, t, r, o) : wk(e, t, r, o),
      v = n ? f1(e, m, ",", n) : m;
    if (m - v && n === "}") {
      let p = sd(e, m, v);
      if (p > -1)
        throw new qt("newlines are not allowed in inline tables", {
          toml: e,
          ptr: p,
        });
    }
    return [f, v];
  }
  let s;
  if (l === '"' || l === "'") {
    s = aO(e, t);
    let f = lO(e, t, s);
    if (n) {
      if (
        ((s = Zo(e, s, n !== "]")),
        e[s] &&
          e[s] !== "," &&
          e[s] !== n &&
          e[s] !==
            `
` &&
          e[s] !== "\r")
      )
        throw new qt("unexpected character encountered", { toml: e, ptr: s });
      s += +(e[s] === ",");
    }
    return [f, s];
  }
  s = f1(e, t, ",", n);
  let u = Sk(e, t, s - +(e[s - 1] === ","), n === "]");
  if (!u[0])
    throw new qt("incomplete key-value declaration: no value specified", {
      toml: e,
      ptr: t,
    });
  return (
    n && u[1] > -1 && ((s = Zo(e, t + u[1])), (s += +(e[s] === ","))),
    [Ck(u[0], e, t, o), s]
  );
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let xk = /^[a-zA-Z0-9-_]+[ \t]*$/;
function ap(e, t, n = "=") {
  let r = t - 1,
    o = [],
    l = e.indexOf(n, t);
  if (l < 0)
    throw new qt("incomplete key-value: cannot find end of key", {
      toml: e,
      ptr: t,
    });
  do {
    let s = e[(t = ++r)];
    if (s !== " " && s !== "	")
      if (s === '"' || s === "'") {
        if (s === e[t + 1] && s === e[t + 2])
          throw new qt("multiline strings are not allowed in keys", {
            toml: e,
            ptr: t,
          });
        let u = aO(e, t);
        if (u < 0)
          throw new qt("unfinished string encountered", { toml: e, ptr: t });
        r = e.indexOf(".", u);
        let f = e.slice(u, r < 0 || r > l ? l : r),
          m = sd(f);
        if (m > -1)
          throw new qt("newlines are not allowed in keys", {
            toml: e,
            ptr: t + r + m,
          });
        if (f.trimStart())
          throw new qt("found extra tokens after the string part", {
            toml: e,
            ptr: u,
          });
        if (l < u && ((l = e.indexOf(n, u)), l < 0))
          throw new qt("incomplete key-value: cannot find end of key", {
            toml: e,
            ptr: t,
          });
        o.push(lO(e, t, u));
      } else {
        r = e.indexOf(".", t);
        let u = e.slice(t, r < 0 || r > l ? l : r);
        if (!xk.test(u))
          throw new qt(
            "only letter, numbers, dashes and underscores are allowed in keys",
            { toml: e, ptr: t },
          );
        o.push(u.trimEnd());
      }
  } while (r + 1 && r < l);
  return [o, Zo(e, l + 1, !0, !0)];
}
function wk(e, t, n, r) {
  let o = {},
    l = new Set(),
    s,
    u = 0;
  for (t++; (s = e[t++]) !== "}" && s; ) {
    let f = { toml: e, ptr: t - 1 };
    if (
      s ===
      `
`
    )
      throw new qt("newlines are not allowed in inline tables", f);
    if (s === "#") throw new qt("inline tables cannot contain comments", f);
    if (s === ",") throw new qt("expected key-value, found comma", f);
    if (s !== " " && s !== "	") {
      let m,
        v = o,
        p = !1,
        [h, b] = ap(e, t - 1);
      for (let y = 0; y < h.length; y++) {
        if (
          (y && (v = p ? v[m] : (v[m] = {})),
          (m = h[y]),
          (p = Object.hasOwn(v, m)) && (typeof v[m] != "object" || l.has(v[m])))
        )
          throw new qt("trying to redefine an already defined value", {
            toml: e,
            ptr: t,
          });
        !p &&
          m === "__proto__" &&
          Object.defineProperty(v, m, {
            enumerable: !0,
            configurable: !0,
            writable: !0,
          });
      }
      if (p)
        throw new qt("trying to redefine an already defined value", {
          toml: e,
          ptr: t,
        });
      let [x, S] = mh(e, b, "}", n - 1, r);
      (l.add(x), (v[m] = x), (t = S), (u = e[t - 1] === "," ? t - 1 : 0));
    }
  }
  if (u)
    throw new qt("trailing commas are not allowed in inline tables", {
      toml: e,
      ptr: u,
    });
  if (!s) throw new qt("unfinished table encountered", { toml: e, ptr: t });
  return [o, t];
}
function $k(e, t, n, r) {
  let o = [],
    l;
  for (t++; (l = e[t++]) !== "]" && l; ) {
    if (l === ",")
      throw new qt("expected value, found comma", { toml: e, ptr: t - 1 });
    if (l === "#") t = fh(e, t);
    else if (
      l !== " " &&
      l !== "	" &&
      l !==
        `
` &&
      l !== "\r"
    ) {
      let s = mh(e, t - 1, "]", n - 1, r);
      (o.push(s[0]), (t = s[1]));
    }
  }
  if (!l) throw new qt("unfinished array encountered", { toml: e, ptr: t });
  return [o, t];
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ function v1(e, t, n, r) {
  let o = t,
    l = n,
    s,
    u = !1,
    f;
  for (let m = 0; m < e.length; m++) {
    if (m) {
      if (
        ((o = u ? o[s] : (o[s] = {})),
        (l = (f = l[s]).c),
        r === 0 && (f.t === 1 || f.t === 2))
      )
        return null;
      if (f.t === 2) {
        let v = o.length - 1;
        ((o = o[v]), (l = l[v].c));
      }
    }
    if (((s = e[m]), (u = Object.hasOwn(o, s)) && l[s]?.t === 0 && l[s]?.d))
      return null;
    u ||
      (s === "__proto__" &&
        (Object.defineProperty(o, s, {
          enumerable: !0,
          configurable: !0,
          writable: !0,
        }),
        Object.defineProperty(l, s, {
          enumerable: !0,
          configurable: !0,
          writable: !0,
        })),
      (l[s] = { t: m < e.length - 1 && r === 2 ? 3 : r, d: !1, i: 0, c: {} }));
  }
  if (
    ((f = l[s]),
    (f.t !== r && !(r === 1 && f.t === 3)) ||
      (r === 2 &&
        (f.d || ((f.d = !0), (o[s] = [])),
        o[s].push((o = {})),
        (f.c[f.i++] = f = { t: 1, d: !1, i: 0, c: {} })),
      f.d))
  )
    return null;
  if (((f.d = !0), r === 1)) o = u ? o[s] : (o[s] = {});
  else if (r === 0 && u) return null;
  return [s, o, f.c];
}
function g1(e, { maxDepth: t = 1e3, integersAsBigInt: n } = {}) {
  let r = {},
    o = {},
    l = r,
    s = o;
  for (let u = Zo(e, 0); u < e.length; ) {
    if (e[u] === "[") {
      let f = e[++u] === "[",
        m = ap(e, (u += +f), "]");
      if (f) {
        if (e[m[1] - 1] !== "]")
          throw new qt("expected end of table declaration", {
            toml: e,
            ptr: m[1] - 1,
          });
        m[1]++;
      }
      let v = v1(m[0], r, o, f ? 2 : 1);
      if (!v)
        throw new qt("trying to redefine an already defined table or value", {
          toml: e,
          ptr: u,
        });
      ((s = v[2]), (l = v[1]), (u = m[1]));
    } else {
      let f = ap(e, u),
        m = v1(f[0], l, s, 0);
      if (!m)
        throw new qt("trying to redefine an already defined table or value", {
          toml: e,
          ptr: u,
        });
      let v = mh(e, f[1], void 0, t, n);
      ((m[1][m[0]] = v[0]), (u = v[1]));
    }
    if (
      ((u = Zo(e, u, !0)),
      e[u] &&
        e[u] !==
          `
` &&
        e[u] !== "\r")
    )
      throw new qt(
        "each key-value declaration must be followed by an end-of-line",
        { toml: e, ptr: u },
      );
    u = Zo(e, u);
  }
  return r;
}
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */ let sO = /^[a-z0-9-_]+$/i;
function sc(e) {
  let t = typeof e;
  if (t === "object") {
    if (Array.isArray(e)) return "array";
    if (e instanceof Date) return "date";
  }
  return t;
}
function Ek(e) {
  for (let t = 0; t < e.length; t++) if (sc(e[t]) !== "object") return !1;
  return e.length != 0;
}
function vh(e) {
  return JSON.stringify(e).replace(/\x7f/g, "\\u007f");
}
function gh(e, t, n, r) {
  if (n === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  if (t === "number")
    return isNaN(e)
      ? "nan"
      : e === 1 / 0
        ? "inf"
        : e === -1 / 0
          ? "-inf"
          : r && Number.isInteger(e)
            ? e.toFixed(1)
            : e.toString();
  if (t === "bigint" || t === "boolean") return e.toString();
  if (t === "string") return vh(e);
  if (t === "date") {
    if (isNaN(e.getTime()))
      throw new TypeError("cannot serialize invalid date");
    return e.toISOString();
  }
  if (t === "object") return Ok(e, n, r);
  if (t === "array") return Rk(e, n, r);
}
function Ok(e, t, n) {
  let r = Object.keys(e);
  if (r.length === 0) return "{}";
  let o = "{ ";
  for (let l = 0; l < r.length; l++) {
    let s = r[l];
    (l && (o += ", "),
      (o += sO.test(s) ? s : vh(s)),
      (o += " = "),
      (o += gh(e[s], sc(e[s]), t - 1, n)));
  }
  return o + " }";
}
function Rk(e, t, n) {
  if (e.length === 0) return "[]";
  let r = "[ ";
  for (let o = 0; o < e.length; o++) {
    if ((o && (r += ", "), e[o] === null || e[o] === void 0))
      throw new TypeError("arrays cannot contain null or undefined values");
    r += gh(e[o], sc(e[o]), t - 1, n);
  }
  return r + " ]";
}
function Pk(e, t, n, r) {
  if (n === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  let o = "";
  for (let l = 0; l < e.length; l++)
    ((o += `${
      o &&
      `
`
    }[[${t}]]
`),
      (o += ph(0, e[l], t, n, r)));
  return o;
}
function ph(e, t, n, r, o) {
  if (r === 0)
    throw new Error(
      "Could not stringify the object: maximum object depth exceeded",
    );
  let l = "",
    s = "",
    u = Object.keys(t);
  for (let f = 0; f < u.length; f++) {
    let m = u[f];
    if (t[m] !== null && t[m] !== void 0) {
      let v = sc(t[m]);
      if (v === "symbol" || v === "function")
        throw new TypeError(`cannot serialize values of type '${v}'`);
      let p = sO.test(m) ? m : vh(m);
      if (v === "array" && Ek(t[m]))
        s +=
          (s &&
            `
`) + Pk(t[m], n ? `${n}.${p}` : p, r - 1, o);
      else if (v === "object") {
        let h = n ? `${n}.${p}` : p;
        s +=
          (s &&
            `
`) + ph(h, t[m], h, r - 1, o);
      } else
        ((l += p),
          (l += " = "),
          (l += gh(t[m], v, r, o)),
          (l += `
`));
    }
  }
  return (
    e &&
      (l || !s) &&
      (l = l
        ? `[${e}]
${l}`
        : `[${e}]`),
    l && s
      ? `${l}
${s}`
      : l || s
  );
}
function Ik(e, { maxDepth: t = 1e3, numbersAsFloat: n = !1 } = {}) {
  if (sc(e) !== "object")
    throw new TypeError("stringify can only be called with an object");
  let r = ph(0, e, "", t, n);
  return r[r.length - 1] !==
    `
`
    ? r +
        `
`
    : r;
}
const { Paragraph: p1, Text: _k, Title: Mk } = lc;

function p1HealthLabel(e) {
  if (!e) return "检测中";
  if (e.status === "healthy") return "健康";
  if (e.status === "unhealthy") return "不健康";
  return e.installed ? "未知" : "未安装";
}

function p1HealthColor(e) {
  if (!e) return "default";
  if (e.status === "healthy") return "success";
  if (e.status === "unhealthy") return "error";
  return "default";
}

const jv = ({
    onAdd: e,
    onRemove: t,
    onCheckHealth: n,
    onOpenHealthDetail: r0,
    installedIds: r = [],
    platform: o = "claude",
    healthItems: l = [],
    healthLoading: s = !1,
    addingId: a = "",
    removingId: u = "",
  }) => {
    const [f, m] = c.useState(!1),
      [marketItems, setMarketItems] = c.useState([]),
      extraItem = c.useMemo(
        () => ({
          id: "zai-mcp-server",
          name: "Zhipu 图片识别",
          description: "调用智谱通用图像理解能力进行图片内容识别。",
          homepage: "https://www.zhipuai.cn/",
          signupUrl: "https://open.bigmodel.cn/usercenter/apikeys",
          category: "AI与智能",
          config: {
            command: "npx",
            args: ["-y", "@z_ai/mcp-server"],
            env: { Z_AI_API_KEY: "<YOUR_API_KEY>", Z_AI_MODE: "ZHIPU" },
          },
        }),
        [],
      ),
      healthById = c.useMemo(() => new Map((Array.isArray(l) ? l : []).map((p) => [p.serverId, p])), [l]);
    c.useEffect(() => {
      p();
    }, []);
    const p = async () => {
        m(!0);
        try {
          const h = await fetchMcpMarketplaceList(),
            x = h.some((b) => b.id === extraItem.id);
          setMarketItems(x ? h : [...h, extraItem]);
        } catch {
          Kt.error("加载 MCP 市场数据失败");
        } finally {
          m(!1);
        }
      },
      h = c.useMemo(() => {
        const x = Array.from(new Set(marketItems.map((b) => b.category || "其他"))),
          S = [
            "AI与智能",
            "文件与数据",
            "开发工具",
            "基础设施",
            "网络与浏览器",
            "生产力工具",
            "其他",
          ];
        return x.sort((b, y) => {
          const W = S.indexOf(b),
            H = S.indexOf(y);
          return W !== -1 && H !== -1
            ? W - H
            : W !== -1
              ? -1
              : H !== -1
                ? 1
                : b.localeCompare(y);
        });
      }, [marketItems]),
      x = c.useMemo(() => {
        const b = {};
        return (
          marketItems.forEach((S) => {
            const y = S.category || "其他";
            (b[y] || (b[y] = []), b[y].push(S));
          }),
          b
        );
      }, [marketItems]);
    if (f && marketItems.length === 0)
      return be.jsx("div", {
        style: { textAlign: "center", padding: "50px" },
        children: be.jsx(oh, { size: "large" }),
      });
    const S = h.map((b) => ({
      key: b,
      label: b,
      children: be.jsx(Bs, {
        grid: { gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3, xxl: 3 },
        dataSource: x[b],
        renderItem: (y) => {
          const W = r.includes(y.id),
            H = healthById.get(y.id),
            k = W && !!H;
          return be.jsx(Bs.Item, {
            children: be.jsx(aa, {
              title: be.jsx($s, { children: y.name }),
              extra: W
                ? be.jsxs("div", {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: "6px",
                      flexWrap: "wrap",
                    },
                    children: [
                      be.jsx(Wg, { color: "success", children: "已添加" }),
                      k &&
                        be.jsx(Wg, {
                          color: p1HealthColor(H),
                          title: H?.details || "",
                          style: { cursor: H?.details ? "pointer" : void 0 },
                          onClick: () => H?.details && typeof r0 == "function" && r0(y, H),
                          children: p1HealthLabel(H),
                        }),
                      be.jsx(xn, {
                        size: "small",
                        danger: !0,
                        loading: u === y.id,
                        onClick: () => typeof t == "function" && t(y),
                        children: "卸载",
                      }),
                    ],
                  })
                : be.jsx(xn, {
                    type: "primary",
                    size: "small",
                    icon: be.jsx(oO, {}),
                    loading: a === y.id,
                    onClick: () => e(y),
                    children: "添加",
                  }),
              size: "small",
              children: be.jsxs("div", {
                style: {
                  minHeight: "144px",
                  display: "flex",
                  flexDirection: "column",
                },
                children: [
                  be.jsx(p1, {
                    ellipsis: { rows: 2 },
                    style: { marginBottom: "8px" },
                    children: y.description,
                  }),
                  be.jsxs("div", {
                    style: { marginTop: "auto" },
                    children: [
                      be.jsxs(_k, {
                        type: "secondary",
                        style: {
                          fontSize: "12px",
                          display: "block",
                          marginBottom: "4px",
                        },
                        children: [
                          be.jsx(TH, {}),
                          " ",
                          y.config.command
                            ? `${y.config.command}${y.config.args?.[0] ? ` ${y.config.args[0]}` : ""}`
                            : y.config.type && y.config.url
                              ? `${y.config.type} ${y.config.url}`
                              : "配置未填写",
                        ],
                      }),
                      y.config.env &&
                        be.jsx(Wg, {
                          className: "mcp-env-tag",
                          style: {
                            fontSize: "10px",
                            lineHeight: "18px",
                            marginBottom: "4px",
                          },
                          children: "需配置环境变量",
                        }),
                      k && H?.status === "unhealthy"
                        ? be.jsxs("div", {
                            style: {
                              marginTop: "4px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "8px",
                            },
                            children: [
                              be.jsxs(_k, {
                                type: "danger",
                                style: {
                                  fontSize: "12px",
                                  display: "block",
                                  margin: 0,
                                  flex: 1,
                                },
                                title: H.details,
                                children: ["健康检查：", H.details],
                              }),
                              be.jsx(xn, {
                                size: "small",
                                onClick: () => typeof r0 == "function" && r0(y, H),
                                children: "查看错误",
                              }),
                            ],
                          })
                        : null,
                    ],
                  }),
                ],
              }),
            }),
          }, y.id);
        },
      }),
    }));
    return be.jsxs("div", {
      style: { padding: "0 16px 16px 16px" },
      children: [
        be.jsxs("div", {
          style: {
            marginBottom: "16px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          },
          children: [
            be.jsxs("div", {
              children: [
                be.jsx(Mk, { level: 4, children: "MCP 市场" }),
                be.jsx(p1, {
                  type: "secondary",
                  children:
                    "发现并添加常用的 Model Context Protocol (MCP) 服务器到您的配置中。",
                }),
              ],
            }),
            be.jsx(xn, {
              onClick: () => typeof n == "function" && n(),
              loading: s,
              disabled: typeof n != "function",
              children: "一键检测健康",
            }),
          ],
        }),
        be.jsx(nh, { defaultActiveKey: h[0], items: S }),
      ],
    });
  };

function isMcpEnvPlaceholder(e) {
  const t = String(e || "").trim();
  return !t || /^<[^>]+>$/.test(t) || /^\$\{?YOUR_/i.test(t) || /^YOUR_/i.test(t);
}

function getMcpEnvEntries(e) {
  const t = e?.config?.env;
  return t && typeof t == "object"
    ? Object.entries(t).filter(([n, r]) => !!n && typeof r == "string")
    : [];
}

function createInitialMcpEnvDraft(e) {
  const t = {};
  return (
    getMcpEnvEntries(e).forEach(([n, r]) => {
      t[n] = isMcpEnvPlaceholder(r) ? "" : String(r || "");
    }),
    t
  );
}

function getMissingMcpEnvNames(e, t) {
  return getMcpEnvEntries(e)
    .map(([n]) => n)
    .filter((n) => !String(t?.[n] || "").trim());
}

const McpHealthDetailModal = ({ open: e, item: t, health: n, onClose: r }) =>
  be.jsx(xr, {
    title: "健康检查详情",
    open: e,
    onCancel: r,
    width: 680,
    footer: [be.jsx(xn, { onClick: r, children: "关闭" }, "close")],
    destroyOnClose: !0,
    children: n
      ? be.jsxs("div", {
          style: { display: "flex", flexDirection: "column", gap: "12px" },
          children: [
            be.jsxs("div", {
              children: [
                be.jsx("div", { style: { fontWeight: 600, marginBottom: "4px" }, children: t?.name || n.serverId }),
                be.jsx("div", {
                  style: { color: "var(--text-color-secondary)", fontSize: "12px" },
                  children: `${n.platform} / ${n.serverId}`,
                }),
              ],
            }),
            be.jsxs("div", {
              children: [
                be.jsx("div", { style: { fontWeight: 600, marginBottom: "6px" }, children: "失败原因" }),
                be.jsx("pre", {
                  style: {
                    margin: 0,
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    background: "var(--background-color)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    lineHeight: 1.6,
                  },
                  children: n.details || "未返回错误详情",
                }),
              ],
            }),
          ],
        })
      : null,
  });

const McpInstallEnvModal = ({
  open: e,
  item: t,
  envValues: n,
  onChange: r,
  onClose: o,
  onConfirm: l,
  loading: s,
}) => {
  const u = getMcpEnvEntries(t),
    f = t?.signupUrl || t?.homepage || "";
  return be.jsx(xr, {
    title: "环境变量配置",
    open: e,
    onCancel: o,
    width: 640,
    footer: null,
    destroyOnClose: !0,
    children: be.jsxs("div", {
      style: { display: "flex", flexDirection: "column", gap: "12px" },
      children: [
        be.jsxs("div", {
          style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
          children: [
            be.jsxs("div", {
              style: { minWidth: 0, flex: "1 1 320px" },
              children: [
                be.jsx("div", { style: { fontWeight: 600 }, children: t?.name || "MCP" }),
                t?.description
                  ? be.jsx("div", {
                      style: { color: "var(--text-color-secondary)", fontSize: "12px", marginTop: "4px" },
                      children: t.description,
                    })
                  : null,
                f
                  ? be.jsxs("div", {
                      style: {
                        color: "var(--text-color-secondary)",
                        fontSize: "12px",
                        marginTop: "6px",
                        wordBreak: "break-all",
                      },
                      children: ["注册地址: ", f],
                    })
                  : null,
              ],
            }),
            f
              ? be.jsx(xn, {
                  onClick: () => window.sinitekConfigBridge?.openExternal?.(f),
                  children: "官网/注册",
                })
              : null,
          ],
        }),
        be.jsx("div", {
          style: {
            color: "var(--text-color-secondary)",
            fontSize: "12px",
            lineHeight: 1.6,
            background: "var(--background-color)",
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "10px 12px",
          },
          children: "如未注册，请先前往官网完成注册或创建 API Key，再填写以下环境变量。",
        }),
        u.map(([m, v]) =>
          be.jsxs(
            "label",
            {
              style: { display: "flex", flexDirection: "column", gap: "6px" },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
                  children: [
                    be.jsx("span", { children: m }),
                    be.jsx("span", {
                      style: { color: "var(--text-color-secondary)", fontSize: "12px" },
                      children: isMcpEnvPlaceholder(v) ? "必填" : "可编辑默认值",
                    }),
                  ],
                }),
                be.jsx("input", {
                  value: n?.[m] ?? "",
                  onChange: (h) => r(m, h.target.value),
                  placeholder: String(v || ""),
                  type: /key|token|secret|password/i.test(m) ? "password" : "text",
                  style: {
                    width: "100%",
                    boxSizing: "border-box",
                    border: "1px solid var(--border-color)",
                    background: "var(--background-color)",
                    color: "var(--text-color)",
                    borderRadius: "6px",
                    padding: "8px 10px",
                  },
                }),
              ],
            },
            m,
          ),
        ),
        be.jsxs("div", {
          style: { display: "flex", justifyContent: "flex-end", gap: "8px" },
          children: [
            be.jsx(xn, { onClick: o, children: "取消" }),
            be.jsx(xn, { type: "primary", loading: s, onClick: l, children: "保存并安装" }),
          ],
        }),
      ],
    }),
  });
};

function skillsEmptyTextByPlatform(e) {
  return e === "claude"
    ? "未检测到 Skills，请先安装到 ~/.claude/skills"
    : e === "opencode"
      ? "未检测到 Skills，请先安装到 ~/.opencode/skills 或工作区 .opencode/skills"
      : "未检测到 Skills，请先安装到 ~/.agents/skills 或工作区 .codex/skills";
}

function skillsTitleByPlatform(e) {
  return e === "claude"
    ? "Claude Skills"
    : e === "opencode"
      ? "OpenCode Skills"
      : "Codex Skills";
}

function officialSkillInstallRootTextByPlatform(e) {
  return e === "claude" ? "~/.claude/skills" : e === "opencode" ? "~/.opencode/skills" : "~/.codex/skills";
}

function officialPackageLabelByPlatform(e) {
  return "Skills";
}

function officialPackageSingularByPlatform(e) {
  return "Skill";
}

function officialPackageLoadingTextByPlatform(e) {
  return `${officialPackageLabelByPlatform(e)} 加载中...`;
}

function officialPackageCountTextByPlatform(e, t) {
  return `官方 ${officialPackageLabelByPlatform(e)} ${t}`;
}

function officialPackageEmptyTextByPlatform(e) {
  return e === "opencode" ? "暂无内置官方 OpenCode Skills" : "暂无内置官方 Skills";
}

function officialPackageInstallHintByPlatform(e) {
  return e === "opencode"
    ? "当前未配置内置官方 OpenCode Skills，可管理本地 ~/.opencode/skills"
    : "内置官方 GitHub 快照，可直接安装到用户 Skills 目录";
}

function officialPackageTabTextByPlatform(e) {
  return "安装 Skills";
}

function shortOfficialSkillRef(e) {
  if (typeof e != "string" || !e.trim()) return "未知";
  const t = e.trim(),
    n = t.includes(":") ? t.split(":").pop() || t : t;
  return n.slice(0, 8);
}

function officialSkillStatusText(e) {
  switch (e) {
    case "installed":
      return "最新";
    case "update_available":
      return "可更新";
    case "unknown_source":
      return "版本未知";
    default:
      return "未安装";
  }
}

function officialSkillVersionValue(e, t, n, r) {
  return typeof e == "string" && e.trim()
    ? e.trim()
    : typeof t == "string" && t.trim()
      ? shortOfficialSkillRef(t)
      : typeof n == "string" && n.trim()
        ? shortOfficialSkillRef(n)
        : typeof r == "string" && r.trim()
          ? shortOfficialSkillRef(r)
          : "版本未知";
}

function officialSkillVersionLines(e) {
  const t = officialSkillVersionValue(
      e.version,
      e.contentHash,
      e.sourceCommit,
      e.sourceRef,
    ),
    n = [`最新版本：${t}`];
  if (e.installed) {
    const r = officialSkillVersionValue(
      e.installedVersion,
      e.installedContentHash,
      e.installedSourceCommit,
      e.installedSourceRef,
    );
    n.unshift(`当前版本：${r}`);
  }
  return n;
}

const renderSkillRows = (e, t, n, r, o, l) =>
  e.map((s) => {
    const u = (n || []).find((f) => f.installed && f.installedPath === s.path),
      m = u ? officialSkillStatusText(u.installState || (u.installed ? "unknown_source" : "not_installed")) : "",
      v = u && l && l.skillId === u.id ? l.action : "";
    return be.jsx(
      "div",
      {
        className: "skills-manager-item",
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "10px",
          padding: "8px",
          borderRadius: "6px",
          marginBottom: "8px",
          flexWrap: "wrap",
        },
        children: [
          be.jsxs("div", {
            style: { display: "flex", gap: "8px", flex: 1, minWidth: 0 },
            children: [
              be.jsx("input", {
                type: "checkbox",
                checked: s.enabled !== !1,
                onChange: (f) => t(s.name, f.target.checked, s.path),
              }),
              be.jsxs("div", {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  flex: 1,
                  minWidth: 0,
                },
                children: [
                  be.jsxs("div", {
                    style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
                    children: [
                      be.jsx("div", { children: s.name }),
                      u
                        ? be.jsx("span", {
                            className: "skills-manager-badge",
                            style: {
                              fontSize: "11px",
                              lineHeight: 1,
                              padding: "3px 8px",
                              borderRadius: "999px",
                            },
                            children: m,
                          })
                        : null,
                    ],
                  }),
                  be.jsx("div", {
                    className: "skills-manager-muted",
                    style: {
                      fontSize: "12px",
                      wordBreak: "break-all",
                    },
                    children: s.path,
                  }),
                  s.description
                    ? be.jsx("div", {
                        className: "skills-manager-muted",
                        style: {
                          fontSize: "12px",
                        },
                        children: s.description,
                      })
                    : null,
                ],
              }),
            ],
          }),
          u
            ? be.jsxs("div", {
                style: { display: "flex", gap: "8px", flexWrap: "wrap" },
                children: [
                  u.canUpdate
                    ? be.jsx(xn, {
                        size: "small",
                        type: "primary",
                        loading: v === "update",
                        onClick: () => r(u),
                        children: v === "update" ? "更新中..." : "更新",
                      })
                    : null,
                  u.canUninstall
                    ? be.jsx(xn, {
                        size: "small",
                        loading: v === "uninstall",
                        onClick: () => o(u),
                        children: v === "uninstall" ? "卸载中..." : "卸载",
                      })
                    : null,
                ],
              })
            : null,
        ],
      },
      `${s.name}:${s.path || ""}`,
    );
  });

const renderOfficialSkillRows = (e, t, n, r, o) =>
  e.map((l) => {
    const u = n && n.skillId === l.id ? n.action : "",
      f = l.installState || (l.installed ? "unknown_source" : "not_installed"),
      m = officialSkillStatusText(f),
      v = officialSkillVersionLines(l);
    return be.jsx(
      "div",
      {
        className: "skills-manager-item",
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          padding: "10px 12px",
          borderRadius: "6px",
          marginBottom: "8px",
        },
        children: [
          be.jsxs("div", {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "8px",
              flexWrap: "wrap",
            },
            children: [
              be.jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: 0 },
                children: [
                  be.jsxs("div", {
                    style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
                    children: [
                      be.jsx("div", { children: l.name }),
                      l.group
                        ? be.jsx("span", {
                            className: "skills-manager-badge",
                            style: {
                              fontSize: "11px",
                              lineHeight: 1,
                              padding: "3px 8px",
                              borderRadius: "999px",
                            },
                            children: l.group,
                          })
                        : null,
                      be.jsx("span", {
                        className: "skills-manager-badge",
                        style: {
                          fontSize: "11px",
                          lineHeight: 1,
                          padding: "3px 8px",
                          borderRadius: "999px",
                        },
                        children: m,
                      }),
                    ],
                  }),
                  l.description
                    ? be.jsx("div", {
                        className: "skills-manager-muted",
                        style: {
                          fontSize: "12px",
                        },
                        children: l.description,
                      })
                    : null,
                  be.jsx("div", {
                    className: "skills-manager-muted",
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      fontSize: "12px",
                    },
                    children: v.map((p) =>
                      be.jsx(
                        "div",
                        {
                          style: { wordBreak: "break-all" },
                          children: p,
                        },
                        p,
                      ),
                    ),
                  }),
                ],
              }),
              be.jsxs("div", {
                style: { display: "flex", gap: "8px", flexWrap: "wrap" },
                children: [
                  l.canInstall
                    ? be.jsx(xn, {
                        size: "small",
                        type: "primary",
                        loading: u === "install",
                        onClick: () => r(l),
                        children: u === "install" ? "安装中..." : "直接安装",
                      })
                    : null,
                  l.canUpdate
                    ? be.jsx(xn, {
                        size: "small",
                        type: "primary",
                        loading: u === "update",
                        onClick: () => o(l),
                        children: u === "update" ? "更新中..." : "更新",
                      })
                    : null,
                  l.canUninstall
                    ? be.jsx(xn, {
                        size: "small",
                        loading: u === "uninstall",
                        onClick: () => t(l),
                        children: u === "uninstall" ? "卸载中..." : "卸载",
                      })
                    : null,
                ],
              }),
            ],
          }),
        ],
      },
      l.id,
    );
  });

const SkillsManagerModal = ({
  open: e,
  onClose: t,
  platform: n,
  skills: r,
  enabledCount: o,
  loading: l,
  onToggle: s,
  onToggleAll: u,
  officialSkills: f,
  officialLoading: m,
  onInstallOfficialSkill: v,
  onUninstallOfficialSkill: p,
  onUpdateOfficialSkill: h,
  pendingOfficialSkillAction: b,
}) => {
  const x = skillsEmptyTextByPlatform(n),
    [g, C0] = c.useState("installed");
  c.useEffect(() => {
    e && C0("installed");
  }, [e, n]);
  const E0 = g === "installed",
    k0 = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "120px",
      borderRadius: "999px",
      padding: "7px 14px",
      fontSize: "12px",
      fontWeight: 600,
      cursor: "pointer",
      transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
    },
    T0 = l ? "Skills 加载中..." : `已启用 ${o} / ${r.length}`,
    A0 = m ? officialPackageLoadingTextByPlatform(n) : officialPackageCountTextByPlatform(n, f.length),
    P0 = E0
      ? r.length === 0
        ? be.jsx("div", {
            className: "skills-manager-empty",
            style: {
              fontSize: "12px",
              borderRadius: "6px",
              padding: "12px",
            },
            children: x,
          })
        : renderSkillRows(r, s, f, h, p, b)
      : m
        ? be.jsx("div", {
            className: "skills-manager-empty",
            style: {
              fontSize: "12px",
              borderRadius: "6px",
              padding: "12px",
            },
            children: officialPackageLoadingTextByPlatform(n),
          })
        : f.length === 0
          ? be.jsx("div", {
              className: "skills-manager-empty",
              style: {
                fontSize: "12px",
                borderRadius: "6px",
                padding: "12px",
              },
              children: officialPackageEmptyTextByPlatform(n),
            })
          : renderOfficialSkillRows(f, p, b, v, h);
  return be.jsx(xr, {
    title: skillsTitleByPlatform(n),
    open: e,
    onCancel: t,
    width: 760,
    footer: null,
    destroyOnClose: !0,
    rootClassName: "skills-manager-modal",
    children: be.jsxs("div", {
      className: "skills-manager-content",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxHeight: "70vh",
      },
      children: [
        be.jsxs("div", {
          className: "skills-manager-tabs",
          style: {
            display: "flex",
            gap: "8px",
            padding: "4px",
            paddingBottom: "12px",
            borderRadius: "10px",
          },
          children: [
            be.jsx("button", {
              type: "button",
              className: E0 ? "skills-manager-tab skills-manager-tab-active" : "skills-manager-tab",
              onClick: () => C0("installed"),
              style: k0,
              children: "已安装 Skills",
            }),
            be.jsx("button", {
              type: "button",
              className: !E0 ? "skills-manager-tab skills-manager-tab-active" : "skills-manager-tab",
              onClick: () => C0("market"),
              style: k0,
              children: officialPackageTabTextByPlatform(n),
            }),
          ],
        }),
        be.jsxs("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          },
          children: [
            E0
              ? be.jsx("div", {
                  className: "skills-manager-muted",
                  style: {
                    fontSize: "12px",
                  },
                  children: T0,
                })
              : be.jsxs("div", {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  },
                  children: [
                    be.jsx("div", {
                      className: "skills-manager-muted",
                      style: {
                        fontSize: "12px",
                      },
                      children: A0,
                    }),
                    be.jsx("div", {
                      className: "skills-manager-muted",
                      style: {
                        fontSize: "12px",
                      },
                      children: officialPackageInstallHintByPlatform(n),
                    }),
                  ],
                }),
            E0
              ? be.jsxs("div", {
                  style: { display: "flex", gap: "8px" },
                  children: [
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => u(!0),
                      disabled: r.length === 0,
                      children: "一键启用",
                    }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () => u(!1),
                      disabled: r.length === 0,
                      children: "一键禁用",
                    }),
                  ],
                })
              : null,
          ],
        }),
        be.jsx("div", {
          style: {
            overflow: "auto",
            maxHeight: "calc(70vh - 108px)",
            paddingRight: "4px",
          },
          children: P0,
        }),
      ],
    }),
  });
};

// OPENCODE_VISUAL_EDITOR_UTILS_START
const openCodeVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const openCodeVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const OPEN_CODE_PROVIDER_NPM_OPTIONS = Object.freeze([
  { value: "@ai-sdk/openai-compatible", label: "OpenAI Compatible (@ai-sdk/openai-compatible)" },
  { value: "@ai-sdk/openai", label: "OpenAI (@ai-sdk/openai)" },
  { value: "@ai-sdk/anthropic", label: "Anthropic (@ai-sdk/anthropic)" },
  { value: "@ai-sdk/google", label: "Google (@ai-sdk/google)" },
]);

const OPEN_CODE_REASONING_EFFORT_OPTIONS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const openCodeVisualNormalizeEfforts = (value) => {
  const values = Array.isArray(value) ? value : String(value || "").split(","),
    seen = new Set(),
    normalized = [];
  values.forEach((item) => {
    const effort = typeof item === "string" ? item.trim() : "";
    if (effort && !seen.has(effort)) {
      seen.add(effort), normalized.push(effort);
    }
  });
  return normalized;
};

const openCodeVisualReadEfforts = (model) => {
  const efforts = [],
    options = openCodeVisualIsRecord(model?.options) ? model.options : {},
    variants = openCodeVisualIsRecord(model?.variants) ? model.variants : {};
  typeof options.reasoningEffort === "string" && efforts.push(options.reasoningEffort);
  Object.values(variants).forEach((variant) => {
    openCodeVisualIsRecord(variant) &&
      typeof variant.reasoningEffort === "string" &&
      efforts.push(variant.reasoningEffort);
  });
  return openCodeVisualNormalizeEfforts(efforts).join(", ");
};

const openCodeVisualApplyEfforts = (model, value) => {
  const result = openCodeVisualClone(model) || {},
    efforts = openCodeVisualNormalizeEfforts(value),
    options = openCodeVisualIsRecord(result.options) ? { ...result.options } : {},
    variants = openCodeVisualIsRecord(result.variants) ? result.variants : {},
    preservedVariants = {};
  delete options.reasoningEffort;
  Object.entries(variants).forEach(([variantId, variant]) => {
    if (!openCodeVisualIsRecord(variant)) {
      preservedVariants[variantId] = openCodeVisualClone(variant);
      return;
    }
    const variantKeys = Object.keys(variant),
      isManagedSimpleVariant =
        variantKeys.length === 1 &&
        typeof variant.reasoningEffort === "string" &&
        variant.reasoningEffort === variantId;
    isManagedSimpleVariant || (preservedVariants[variantId] = openCodeVisualClone(variant));
  });
  if (efforts.length > 0) {
    options.reasoningEffort = efforts[0];
    efforts.forEach((effort) => {
      const existing = openCodeVisualIsRecord(preservedVariants[effort])
        ? preservedVariants[effort]
        : {};
      preservedVariants[effort] = { ...existing, reasoningEffort: effort };
    });
  }
  Object.keys(options).length > 0 ? (result.options = options) : delete result.options;
  Object.keys(preservedVariants).length > 0
    ? (result.variants = preservedVariants)
    : delete result.variants;
  return result;
};

const openCodeVisualCreateState = (config) => {
  const source = openCodeVisualIsRecord(config) ? openCodeVisualClone(config) : {},
    providerSource = openCodeVisualIsRecord(source.provider) ? source.provider : {},
    providers = Object.entries(providerSource).map(([providerId, providerValue]) => {
      const provider = openCodeVisualIsRecord(providerValue) ? providerValue : {},
        options = openCodeVisualIsRecord(provider.options) ? provider.options : {},
        modelSource = openCodeVisualIsRecord(provider.models) ? provider.models : {},
        models = Object.entries(modelSource).map(([modelId, modelValue]) => {
          const model = openCodeVisualIsRecord(modelValue) ? modelValue : {};
          return {
            id: modelId,
            name: typeof model.name === "string" ? model.name : "",
            reasoning: model.reasoning === !0,
            efforts: openCodeVisualReadEfforts(model),
            source: openCodeVisualClone(model),
          };
        });
      return {
        id: providerId,
        name: typeof provider.name === "string" ? provider.name : "",
        npm: typeof provider.npm === "string" ? provider.npm : "",
        baseURL: typeof options.baseURL === "string" ? options.baseURL : "",
        apiKey: typeof options.apiKey === "string" ? options.apiKey : "",
        models,
        source: openCodeVisualClone(provider),
      };
    });
  return {
    source,
    providers,
    primaryModel: typeof source.model === "string" ? source.model : "",
    smallModel: typeof source.small_model === "string" ? source.small_model : "",
    selectedProviderId: providers[0]?.id || "",
    selectedModelId: providers[0]?.models[0]?.id || "",
  };
};

const openCodeVisualParseContent = (content) => {
  try {
    const config = JSON.parse(content || "{}");
    if (!openCodeVisualIsRecord(config)) throw new Error("顶层配置必须是 JSON 对象");
    if (config.provider !== void 0 && !openCodeVisualIsRecord(config.provider))
      throw new Error("provider 必须是 JSON 对象");
    return { ok: !0, state: openCodeVisualCreateState(config), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `JSON 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}`,
    };
  }
};

const openCodeVisualModelRef = (providerId, modelId) => `${providerId}/${modelId}`;

const openCodeVisualValidateState = (state) => {
  const errors = [],
    providerIds = new Set(),
    modelRefs = new Set();
  (state?.providers || []).forEach((provider, providerIndex) => {
    const providerId = String(provider?.id || "").trim();
    if (!providerId) errors.push(`第 ${providerIndex + 1} 个 Provider 的 id 不能为空`);
    else if (providerId.includes("/")) errors.push(`Provider id “${providerId}” 不能包含 /`);
    else if (providerIds.has(providerId)) errors.push(`Provider id “${providerId}” 重复`);
    else providerIds.add(providerId);
    const modelIds = new Set();
    (provider?.models || []).forEach((model, modelIndex) => {
      const modelId = String(model?.id || "").trim();
      if (!modelId)
        errors.push(`Provider “${providerId || providerIndex + 1}” 的第 ${modelIndex + 1} 个模型 id 不能为空`);
      else if (modelId.includes("/")) errors.push(`模型 id “${modelId}” 不能包含 /`);
      else if (modelIds.has(modelId))
        errors.push(`Provider “${providerId}” 中的模型 id “${modelId}” 重复`);
      else {
        modelIds.add(modelId), providerId && modelRefs.add(openCodeVisualModelRef(providerId, modelId));
      }
    });
  });
  [
    ["主模型", state?.primaryModel],
    ["小模型", state?.smallModel],
  ].forEach(([label, ref]) => {
    ref && !modelRefs.has(ref) && errors.push(`${label}引用 “${ref}” 不存在，请重新选择模型`);
  });
  return { valid: errors.length === 0, errors, modelRefs: Array.from(modelRefs) };
};

const openCodeVisualSerializeState = (state) => {
  if (!state || !Array.isArray(state.providers))
    return {
      ok: !1,
      config: null,
      error: "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复",
      errors: ["当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复"],
    };
  const validation = openCodeVisualValidateState(state);
  if (!validation.valid) return { ok: !1, config: null, error: validation.errors[0], errors: validation.errors };
  const config = openCodeVisualClone(state?.source) || {},
    providerConfig = {};
  (state?.providers || []).forEach((provider) => {
    const providerId = provider.id.trim(),
      providerValue = openCodeVisualClone(provider.source) || {},
      providerOptions = openCodeVisualIsRecord(providerValue.options)
        ? { ...providerValue.options }
        : {},
      models = {};
    provider.name.trim() ? (providerValue.name = provider.name.trim()) : delete providerValue.name;
    provider.npm.trim() ? (providerValue.npm = provider.npm.trim()) : delete providerValue.npm;
    provider.baseURL.trim()
      ? (providerOptions.baseURL = provider.baseURL.trim())
      : delete providerOptions.baseURL;
    provider.apiKey.trim()
      ? (providerOptions.apiKey = provider.apiKey.trim())
      : delete providerOptions.apiKey;
    Object.keys(providerOptions).length > 0
      ? (providerValue.options = providerOptions)
      : delete providerValue.options;
    (provider.models || []).forEach((model) => {
      const modelValue = openCodeVisualApplyEfforts(model.source, model.efforts);
      model.name.trim() ? (modelValue.name = model.name.trim()) : delete modelValue.name;
      modelValue.reasoning = model.reasoning === !0;
      models[model.id.trim()] = modelValue;
    });
    providerValue.models = models;
    providerConfig[providerId] = providerValue;
  });
  config.provider = providerConfig;
  state.primaryModel ? (config.model = state.primaryModel) : delete config.model;
  state.smallModel ? (config.small_model = state.smallModel) : delete config.small_model;
  return { ok: !0, config, content: JSON.stringify(config, null, 2), error: "", errors: [] };
};

const openCodeVisualUniqueId = (items, prefix) => {
  const ids = new Set((items || []).map((item) => item.id));
  if (!ids.has(prefix)) return prefix;
  let index = 2;
  for (; ids.has(`${prefix}${index}`); index += 1);
  return `${prefix}${index}`;
};

const openCodeVisualAddProvider = (state) => {
  const id = openCodeVisualUniqueId(state.providers, "provider"),
    provider = {
      id,
      name: "新 Provider",
      npm: "@ai-sdk/openai-compatible",
      baseURL: "",
      apiKey: "",
      models: [],
      source: {},
    };
  return { ...state, providers: [...state.providers, provider], selectedProviderId: id, selectedModelId: "" };
};

const openCodeVisualUpdateProvider = (state, providerId, patch) => {
  const nextId = patch.id === void 0 ? providerId : String(patch.id),
    providers = state.providers.map((provider) =>
      provider.id === providerId ? { ...provider, ...patch, id: nextId } : provider,
    ),
    updateRef = (ref) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) return ref;
      const model = provider.models.find((item) => ref === openCodeVisualModelRef(providerId, item.id));
      return model ? openCodeVisualModelRef(nextId, model.id) : ref;
    };
  return {
    ...state,
    providers,
    primaryModel: updateRef(state.primaryModel),
    smallModel: updateRef(state.smallModel),
    selectedProviderId: state.selectedProviderId === providerId ? nextId : state.selectedProviderId,
  };
};

const openCodeVisualDeleteProvider = (state, providerId) => {
  const providers = state.providers.filter((provider) => provider.id !== providerId),
    selectedProvider = providers[0] || null;
  return {
    ...state,
    providers,
    selectedProviderId:
      state.selectedProviderId === providerId ? selectedProvider?.id || "" : state.selectedProviderId,
    selectedModelId:
      state.selectedProviderId === providerId ? selectedProvider?.models[0]?.id || "" : state.selectedModelId,
  };
};

const openCodeVisualAddModel = (state, providerId) => {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return state;
  const id = openCodeVisualUniqueId(provider.models, "model"),
    model = { id, name: "新模型", reasoning: !1, efforts: "", source: {} };
  return {
    ...state,
    providers: state.providers.map((item) =>
      item.id === providerId ? { ...item, models: [...item.models, model] } : item,
    ),
    selectedProviderId: providerId,
    selectedModelId: id,
  };
};

const openCodeVisualUpdateModel = (state, providerId, modelId, patch) => {
  const nextId = patch.id === void 0 ? modelId : String(patch.id),
    oldRef = openCodeVisualModelRef(providerId, modelId),
    nextRef = openCodeVisualModelRef(providerId, nextId);
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === modelId ? { ...model, ...patch, id: nextId } : model,
            ),
          }
        : provider,
    ),
    primaryModel: state.primaryModel === oldRef ? nextRef : state.primaryModel,
    smallModel: state.smallModel === oldRef ? nextRef : state.smallModel,
    selectedModelId: state.selectedModelId === modelId ? nextId : state.selectedModelId,
  };
};

const openCodeVisualDeleteModel = (state, providerId, modelId) => {
  let nextSelectedModelId = state.selectedModelId;
  const providers = state.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    const models = provider.models.filter((model) => model.id !== modelId);
    state.selectedModelId === modelId && (nextSelectedModelId = models[0]?.id || "");
    return { ...provider, models };
  });
  return { ...state, providers, selectedModelId: nextSelectedModelId };
};

const openCodeVisualSetRole = (state, providerId, modelId, role, enabled) => {
  const ref = openCodeVisualModelRef(providerId, modelId),
    key = role === "small" ? "smallModel" : "primaryModel";
  return { ...state, [key]: enabled ? ref : state[key] === ref ? "" : state[key] };
};

const openCodeVisualRunSaveFlow = async ({ content, saveConfig, applyActiveConfig }) => {
  await saveConfig(content);
  await applyActiveConfig(content);
  return content;
};

const OpenCodeConfigVisualEditorUtils = Object.freeze({
  providerNpmOptions: OPEN_CODE_PROVIDER_NPM_OPTIONS,
  reasoningEffortOptions: OPEN_CODE_REASONING_EFFORT_OPTIONS,
  normalizeEfforts: openCodeVisualNormalizeEfforts,
  readEfforts: openCodeVisualReadEfforts,
  applyEfforts: openCodeVisualApplyEfforts,
  createState: openCodeVisualCreateState,
  parseContent: openCodeVisualParseContent,
  validateState: openCodeVisualValidateState,
  serializeState: openCodeVisualSerializeState,
  addProvider: openCodeVisualAddProvider,
  updateProvider: openCodeVisualUpdateProvider,
  deleteProvider: openCodeVisualDeleteProvider,
  addModel: openCodeVisualAddModel,
  updateModel: openCodeVisualUpdateModel,
  deleteModel: openCodeVisualDeleteModel,
  setRole: openCodeVisualSetRole,
  runSaveFlow: openCodeVisualRunSaveFlow,
});
// OPENCODE_VISUAL_EDITOR_UTILS_END

// CLAUDE_VISUAL_EDITOR_UTILS_START
const claudeVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const claudeVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const claudeVisualManagedEnvKeys = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
]);

const claudeVisualNormalizeList = (value) => {
  const values = Array.isArray(value) ? value : String(value || "").split(/[\n,]/),
    seen = new Set(),
    normalized = [];
  values.forEach((item) => {
    const entry = typeof item === "string" ? item.trim() : "";
    if (entry && !seen.has(entry)) {
      seen.add(entry), normalized.push(entry);
    }
  });
  return normalized;
};

const claudeVisualReadList = (value) =>
  claudeVisualNormalizeList(value).join("\n");

const claudeVisualReadOptionalBoolean = (value) =>
  value === !0 ? "true" : value === !1 ? "false" : "";

const claudeVisualCreateState = (config) => {
  const source = claudeVisualIsRecord(config) ? claudeVisualClone(config) : {},
    env = claudeVisualIsRecord(source.env) ? source.env : {},
    permissions = claudeVisualIsRecord(source.permissions) ? source.permissions : {},
    managedEnv = {};
  claudeVisualManagedEnvKeys.forEach((key) => {
    managedEnv[key] = typeof env[key] === "string" ? env[key] : "";
  });
  return {
    source,
    model: typeof source.model === "string" ? source.model : "",
    fallbackModels: claudeVisualReadList(source.fallbackModel),
    availableModels: claudeVisualReadList(source.availableModels),
    effortLevel: typeof source.effortLevel === "string" ? source.effortLevel : "",
    language: typeof source.language === "string" ? source.language : "",
    outputStyle: typeof source.outputStyle === "string" ? source.outputStyle : "",
    autoUpdatesChannel:
      typeof source.autoUpdatesChannel === "string" ? source.autoUpdatesChannel : "",
    cleanupPeriodDays:
      typeof source.cleanupPeriodDays === "number" ? String(source.cleanupPeriodDays) : "",
    alwaysThinkingEnabled: claudeVisualReadOptionalBoolean(source.alwaysThinkingEnabled),
    includeCoAuthoredBy: claudeVisualReadOptionalBoolean(source.includeCoAuthoredBy),
    env: managedEnv,
    permissions: {
      defaultMode:
        typeof permissions.defaultMode === "string" ? permissions.defaultMode : "",
      allow: claudeVisualReadList(permissions.allow),
      ask: claudeVisualReadList(permissions.ask),
      deny: claudeVisualReadList(permissions.deny),
    },
  };
};

const claudeVisualParseContent = (content) => {
  try {
    const config = JSON.parse(content || "{}");
    if (!claudeVisualIsRecord(config)) throw new Error("顶层配置必须是 JSON 对象");
    if (config.env !== void 0 && !claudeVisualIsRecord(config.env))
      throw new Error("env 必须是 JSON 对象");
    if (config.permissions !== void 0 && !claudeVisualIsRecord(config.permissions))
      throw new Error("permissions 必须是 JSON 对象");
    return { ok: !0, state: claudeVisualCreateState(config), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `JSON 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}`,
    };
  }
};

const claudeVisualValidateState = (state) => {
  if (!state || !claudeVisualIsRecord(state)) return "Claude 可视化配置不可用";
  const fallbackModels = claudeVisualNormalizeList(state.fallbackModels);
  if (fallbackModels.length > 3) return "回退模型最多支持 3 个";
  if (
    state.effortLevel &&
    !["low", "medium", "high", "xhigh", "max"].includes(state.effortLevel)
  )
    return "推理强度必须是 low、medium、high、xhigh 或 max";
  if (
    state.autoUpdatesChannel &&
    !["stable", "latest"].includes(state.autoUpdatesChannel)
  )
    return "自动更新通道必须是 stable 或 latest";
  if (state.cleanupPeriodDays) {
    const cleanupPeriodDays = Number(state.cleanupPeriodDays);
    if (!Number.isInteger(cleanupPeriodDays) || cleanupPeriodDays < 1)
      return "会话保留天数必须是大于等于 1 的整数";
  }
  return "";
};

const claudeVisualSetString = (target, key, value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  normalized ? (target[key] = normalized) : delete target[key];
};

const claudeVisualSetOptionalBoolean = (target, key, value) => {
  value === "true" ? (target[key] = !0) : value === "false" ? (target[key] = !1) : delete target[key];
};

const claudeVisualSerializeState = (state) => {
  const validation = claudeVisualValidateState(state);
  if (validation) return { ok: !1, content: "", error: validation };
  const config = claudeVisualClone(state.source) || {},
    fallbackModels = claudeVisualNormalizeList(state.fallbackModels),
    availableModels = claudeVisualNormalizeList(state.availableModels),
    env = claudeVisualIsRecord(config.env) ? { ...config.env } : {},
    permissions = claudeVisualIsRecord(config.permissions) ? { ...config.permissions } : {};

  ["model", "effortLevel", "language", "outputStyle", "autoUpdatesChannel"].forEach(
    (key) => claudeVisualSetString(config, key, state[key]),
  );
  fallbackModels.length === 0
    ? delete config.fallbackModel
    : (config.fallbackModel = fallbackModels.length === 1 ? fallbackModels[0] : fallbackModels);
  availableModels.length === 0
    ? delete config.availableModels
    : (config.availableModels = availableModels);
  state.cleanupPeriodDays
    ? (config.cleanupPeriodDays = Number(state.cleanupPeriodDays))
    : delete config.cleanupPeriodDays;
  claudeVisualSetOptionalBoolean(
    config,
    "alwaysThinkingEnabled",
    state.alwaysThinkingEnabled,
  );
  claudeVisualSetOptionalBoolean(config, "includeCoAuthoredBy", state.includeCoAuthoredBy);

  claudeVisualManagedEnvKeys.forEach((key) =>
    claudeVisualSetString(env, key, state.env?.[key]),
  );
  Object.keys(env).length > 0 ? (config.env = env) : delete config.env;

  claudeVisualSetString(permissions, "defaultMode", state.permissions?.defaultMode);
  ["allow", "ask", "deny"].forEach((key) => {
    const values = claudeVisualNormalizeList(state.permissions?.[key]);
    values.length > 0 ? (permissions[key] = values) : delete permissions[key];
  });
  Object.keys(permissions).length > 0
    ? (config.permissions = permissions)
    : delete config.permissions;

  return { ok: !0, content: JSON.stringify(config, null, 2), error: "" };
};

const claudeVisualUpdateState = (state, patch) => ({ ...state, ...patch });

const claudeVisualUpdateEnv = (state, key, value) => ({
  ...state,
  env: { ...state.env, [key]: value },
});

const claudeVisualUpdatePermissions = (state, patch) => ({
  ...state,
  permissions: { ...state.permissions, ...patch },
});

const ClaudeConfigVisualEditorUtils = Object.freeze({
  managedEnvKeys: claudeVisualManagedEnvKeys,
  normalizeList: claudeVisualNormalizeList,
  createState: claudeVisualCreateState,
  parseContent: claudeVisualParseContent,
  validateState: claudeVisualValidateState,
  serializeState: claudeVisualSerializeState,
  updateState: claudeVisualUpdateState,
  updateEnv: claudeVisualUpdateEnv,
  updatePermissions: claudeVisualUpdatePermissions,
});
// CLAUDE_VISUAL_EDITOR_UTILS_END

// CODEX_VISUAL_EDITOR_UTILS_START
const codexVisualIsRecord = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const codexVisualClone = (value) =>
  value === void 0 ? void 0 : JSON.parse(JSON.stringify(value));

const codexVisualManagedRootKeys = Object.freeze([
  "model",
  "model_provider",
  "approval_policy",
  "sandbox_mode",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "model_verbosity",
  "web_search",
  "disable_response_storage",
  "hide_agent_reasoning",
  "model_supports_reasoning_summaries",
]);

const codexVisualManagedProviderKeys = Object.freeze([
  "name",
  "base_url",
  "env_key",
  "wire_api",
  "requires_openai_auth",
]);

const codexVisualManagedEnvKeys = Object.freeze([
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
]);

const codexVisualTomlBareKeyPattern = /^[A-Za-z0-9_-]+$/;

const codexVisualUnquoteTomlString = (value) => {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote)
    throw new Error("字符串没有正确闭合");
  const body = value.slice(1, -1);
  return quote === "'" ? body : body.replace(/\\(["\\nrt])/g, (_match, escaped) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    return escaped;
  });
};

const codexVisualSplitTomlPath = (value) =>
  String(value || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part[0] === '"' || part[0] === "'"
        ? codexVisualUnquoteTomlString(part)
        : part,
    );

const codexVisualStripTomlComment = (value) => {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && quote === '"') {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
};

const codexVisualSplitTomlArray = (value) => {
  const parts = [];
  let quote = "",
    start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && quote === '"') {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      parts.push(value.slice(start, index).trim()), (start = index + 1);
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const codexVisualParseTomlValue = (value) => {
  const normalized = codexVisualStripTomlComment(value);
  if (!normalized) throw new Error("缺少 TOML 值");
  if (normalized[0] === '"' || normalized[0] === "'")
    return codexVisualUnquoteTomlString(normalized);
  if (normalized === "true") return !0;
  if (normalized === "false") return !1;
  if (/^[+-]?\d+$/.test(normalized)) return Number(normalized);
  if (/^[+-]?\d+\.\d+$/.test(normalized)) return Number(normalized);
  if (normalized[0] === "[" && normalized[normalized.length - 1] === "]") {
    const body = normalized.slice(1, -1).trim();
    return body ? codexVisualSplitTomlArray(body).map(codexVisualParseTomlValue) : [];
  }
  if (normalized[0] === "{" || normalized.includes("\n"))
    throw new Error("复杂 TOML 请保留在源码模式编辑");
  return normalized;
};

const codexVisualSetDeepValue = (target, path, value) => {
  let cursor = target;
  path.slice(0, -1).forEach((part) => {
    if (!codexVisualIsRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[path[path.length - 1]] = value;
};

const codexVisualParseToml = (content) => {
  const root = {};
  let tablePath = [];
  String(content || "")
    .split(/\r?\n/)
    .forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;
      const tableMatch = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
      if (tableMatch) {
        tablePath = codexVisualSplitTomlPath(tableMatch[1]);
        if (tablePath.length === 0) throw new Error(`第 ${lineIndex + 1} 行表名为空`);
        codexVisualSetDeepValue(root, tablePath, codexVisualClone(codexVisualGetDeepValue(root, tablePath)) || {});
        return;
      }
      const eqIndex = line.indexOf("=");
      if (eqIndex <= 0) throw new Error(`第 ${lineIndex + 1} 行不是有效的 key = value`);
      const keyPath = codexVisualSplitTomlPath(line.slice(0, eqIndex));
      if (keyPath.length === 0) throw new Error(`第 ${lineIndex + 1} 行 key 为空`);
      codexVisualSetDeepValue(root, [...tablePath, ...keyPath], codexVisualParseTomlValue(line.slice(eqIndex + 1)));
    });
  return root;
};

function codexVisualGetDeepValue(target, path) {
  let cursor = target;
  for (const part of path) {
    if (!codexVisualIsRecord(cursor) || !(part in cursor)) return void 0;
    cursor = cursor[part];
  }
  return cursor;
}

const codexVisualTomlKey = (key) =>
  codexVisualTomlBareKeyPattern.test(String(key))
    ? String(key)
    : JSON.stringify(String(key));

const codexVisualTomlValue = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((item) => !codexVisualIsRecord(item)))
    return `[${value.map(codexVisualTomlValue).join(", ")}]`;
  return JSON.stringify(value);
};

const codexVisualStringifyTomlBlock = (record, path = []) => {
  const lines = [],
    nested = [];
  Object.entries(record || {}).forEach(([key, value]) => {
    if (codexVisualIsRecord(value) || (Array.isArray(value) && value.some(codexVisualIsRecord))) {
      nested.push([key, value]);
    } else if (value !== void 0) {
      lines.push(`${codexVisualTomlKey(key)} = ${codexVisualTomlValue(value)}`);
    }
  });
  nested.forEach(([key, value]) => {
    const nextPath = [...path, key].map(codexVisualTomlKey).join(".");
    if (Array.isArray(value)) {
      value.forEach((item) => {
        lines.push("", `[[${nextPath}]]`, ...codexVisualStringifyTomlBlock(item, [...path, key]));
      });
    } else {
      lines.push("", `[${nextPath}]`, ...codexVisualStringifyTomlBlock(value, [...path, key]));
    }
  });
  return lines;
};

const codexVisualStringifyToml = (record) =>
  `${codexVisualStringifyTomlBlock(record).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;

const codexVisualReadString = (value) => (typeof value === "string" ? value : "");

const codexVisualReadOptionalBoolean = (value) =>
  value === !0 ? "true" : value === !1 ? "false" : "";

const codexVisualSetString = (target, key, value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  normalized ? (target[key] = normalized) : delete target[key];
};

const codexVisualSetOptionalBoolean = (target, key, value) => {
  value === "true" ? (target[key] = !0) : value === "false" ? (target[key] = !1) : delete target[key];
};

const codexVisualParseEnv = (content) => {
  const env = {};
  String(content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) return;
      let value = match[2] || "";
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    });
  return env;
};

const codexVisualSerializeEnv = (content, env) => {
  const keys = new Set(codexVisualManagedEnvKeys),
    seen = new Set(),
    lines = String(content || "").split(/\r?\n/).filter((line, index, list) => index < list.length - 1 || line !== "");
  const nextLines = lines
    .map((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (!match || !keys.has(match[1])) return line;
      seen.add(match[1]);
      const value = codexVisualReadString(env?.[match[1]]).trim();
      return value ? `${match[1]}=${value}` : null;
    })
    .filter((line) => line !== null);
  codexVisualManagedEnvKeys.forEach((key) => {
    const value = codexVisualReadString(env?.[key]).trim();
    if (value && !seen.has(key)) nextLines.push(`${key}=${value}`);
  });
  return nextLines.join("\n");
};

const codexVisualCreateProvider = (id, value = {}) => ({
  id,
  name: codexVisualReadString(value.name),
  baseUrl: codexVisualReadString(value.base_url),
  envKey: codexVisualReadString(value.env_key),
  wireApi: codexVisualReadString(value.wire_api),
  requiresOpenaiAuth: codexVisualReadOptionalBoolean(value.requires_openai_auth),
  source: codexVisualClone(value) || {},
});

const codexVisualCreateState = (configContent, envContent = "") => {
  const source = codexVisualParseToml(configContent || ""),
    providersSource = codexVisualIsRecord(source.model_providers) ? source.model_providers : {},
    providers = Object.entries(providersSource)
      .filter(([, value]) => codexVisualIsRecord(value))
      .map(([id, value]) => codexVisualCreateProvider(id, value)),
    tools = codexVisualIsRecord(source.tools) ? source.tools : {},
    features = codexVisualIsRecord(source.features) ? source.features : {},
    envSource = codexVisualParseEnv(envContent),
    env = {};
  codexVisualManagedEnvKeys.forEach((key) => {
    env[key] = codexVisualReadString(envSource[key]);
  });
  return {
    source,
    envContent: envContent || "",
    model: codexVisualReadString(source.model),
    modelProvider: codexVisualReadString(source.model_provider),
    approvalPolicy: codexVisualReadString(source.approval_policy),
    sandboxMode: codexVisualReadString(source.sandbox_mode),
    reasoningEffort: codexVisualReadString(source.model_reasoning_effort),
    reasoningSummary: codexVisualReadString(source.model_reasoning_summary),
    verbosity: codexVisualReadString(source.model_verbosity),
    webSearch: codexVisualReadOptionalBoolean(source.web_search),
    toolsWebSearch: codexVisualReadOptionalBoolean(tools.web_search),
    featuresWebSearch: codexVisualReadOptionalBoolean(features.web_search),
    disableResponseStorage: codexVisualReadOptionalBoolean(source.disable_response_storage),
    hideAgentReasoning: codexVisualReadOptionalBoolean(source.hide_agent_reasoning),
    supportsReasoningSummaries: codexVisualReadOptionalBoolean(source.model_supports_reasoning_summaries),
    providers,
    selectedProviderId: codexVisualReadString(source.model_provider) || providers[0]?.id || "",
    env,
  };
};

const codexVisualParseContent = (configContent, envContent = "") => {
  try {
    return { ok: !0, state: codexVisualCreateState(configContent, envContent), error: "" };
  } catch (error) {
    return {
      ok: !1,
      state: null,
      error: `TOML 无法加载到可视化编辑器：${error instanceof Error ? error.message : error}。请切换到 TOML 源码修复。`,
    };
  }
};

const codexVisualValidateState = (state) => {
  if (!state || !codexVisualIsRecord(state)) return "Codex 可视化配置不可用，请切换到 TOML 源码修复";
  const providerIds = new Set();
  for (const [index, provider] of (state.providers || []).entries()) {
    const id = codexVisualReadString(provider.id).trim();
    if (!id) return `第 ${index + 1} 个 Provider 的 id 不能为空`;
    if (providerIds.has(id)) return `Provider id “${id}” 重复`;
    providerIds.add(id);
  }
  if (state.modelProvider && !providerIds.has(state.modelProvider))
    return `model_provider “${state.modelProvider}” 未在 model_providers 中定义`;
  return "";
};

const codexVisualSerializeState = (state) => {
  const validation = codexVisualValidateState(state);
  if (validation) return { ok: !1, content: "", envContent: state?.envContent || "", error: validation };
  const config = codexVisualClone(state.source) || {};
  [
    ["model", state.model],
    ["model_provider", state.modelProvider],
    ["approval_policy", state.approvalPolicy],
    ["sandbox_mode", state.sandboxMode],
    ["model_reasoning_effort", state.reasoningEffort],
    ["model_reasoning_summary", state.reasoningSummary],
    ["model_verbosity", state.verbosity],
  ].forEach(([key, value]) => codexVisualSetString(config, key, value));
  codexVisualSetOptionalBoolean(config, "web_search", state.webSearch);
  codexVisualSetOptionalBoolean(config, "disable_response_storage", state.disableResponseStorage);
  codexVisualSetOptionalBoolean(config, "hide_agent_reasoning", state.hideAgentReasoning);
  codexVisualSetOptionalBoolean(config, "model_supports_reasoning_summaries", state.supportsReasoningSummaries);

  const tools = codexVisualIsRecord(config.tools) ? { ...config.tools } : {};
  codexVisualSetOptionalBoolean(tools, "web_search", state.toolsWebSearch);
  Object.keys(tools).length > 0 ? (config.tools = tools) : delete config.tools;
  const features = codexVisualIsRecord(config.features) ? { ...config.features } : {};
  codexVisualSetOptionalBoolean(features, "web_search", state.featuresWebSearch);
  Object.keys(features).length > 0 ? (config.features = features) : delete config.features;

  const providers = {};
  (state.providers || []).forEach((provider) => {
    const value = codexVisualClone(provider.source) || {};
    codexVisualManagedProviderKeys.forEach((key) => delete value[key]);
    codexVisualSetString(value, "name", provider.name);
    codexVisualSetString(value, "base_url", provider.baseUrl);
    codexVisualSetString(value, "env_key", provider.envKey);
    codexVisualSetString(value, "wire_api", provider.wireApi);
    codexVisualSetOptionalBoolean(value, "requires_openai_auth", provider.requiresOpenaiAuth);
    providers[provider.id.trim()] = value;
  });
  Object.keys(providers).length > 0
    ? (config.model_providers = providers)
    : delete config.model_providers;
  return {
    ok: !0,
    content: codexVisualStringifyToml(config),
    envContent: codexVisualSerializeEnv(state.envContent, state.env),
    error: "",
  };
};

const codexVisualUpdateState = (state, patch) => ({ ...state, ...patch });

const codexVisualUpdateEnv = (state, key, value) => ({
  ...state,
  env: { ...state.env, [key]: value },
});

const codexVisualUniqueId = (items, prefix) => {
  const ids = new Set((items || []).map((item) => item.id));
  if (!ids.has(prefix)) return prefix;
  let index = 2;
  for (; ids.has(`${prefix}${index}`); index += 1);
  return `${prefix}${index}`;
};

const codexVisualAddProvider = (state) => {
  const id = codexVisualUniqueId(state.providers, "openai"),
    provider = codexVisualCreateProvider(id, {
      name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      env_key: "OPENAI_API_KEY",
      wire_api: "responses",
      requires_openai_auth: !0,
    });
  return {
    ...state,
    providers: [...state.providers, provider],
    selectedProviderId: id,
    modelProvider: state.modelProvider || id,
  };
};

const codexVisualUpdateProvider = (state, providerId, patch) => {
  const nextId = patch.id === void 0 ? providerId : String(patch.id);
  return {
    ...state,
    providers: state.providers.map((provider) =>
      provider.id === providerId ? { ...provider, ...patch, id: nextId } : provider,
    ),
    modelProvider: state.modelProvider === providerId ? nextId : state.modelProvider,
    selectedProviderId: state.selectedProviderId === providerId ? nextId : state.selectedProviderId,
  };
};

const codexVisualDeleteProvider = (state, providerId) => {
  const providers = state.providers.filter((provider) => provider.id !== providerId),
    selected = providers[0]?.id || "";
  return {
    ...state,
    providers,
    selectedProviderId: state.selectedProviderId === providerId ? selected : state.selectedProviderId,
    modelProvider: state.modelProvider === providerId ? selected : state.modelProvider,
  };
};

const CodexConfigVisualEditorUtils = Object.freeze({
  managedRootKeys: codexVisualManagedRootKeys,
  managedProviderKeys: codexVisualManagedProviderKeys,
  managedEnvKeys: codexVisualManagedEnvKeys,
  parseToml: codexVisualParseToml,
  stringifyToml: codexVisualStringifyToml,
  parseEnv: codexVisualParseEnv,
  createState: codexVisualCreateState,
  parseContent: codexVisualParseContent,
  validateState: codexVisualValidateState,
  serializeState: codexVisualSerializeState,
  updateState: codexVisualUpdateState,
  updateEnv: codexVisualUpdateEnv,
  addProvider: codexVisualAddProvider,
  updateProvider: codexVisualUpdateProvider,
  deleteProvider: codexVisualDeleteProvider,
});
// CODEX_VISUAL_EDITOR_UTILS_END

const { TextArea: Qa } = zi;
const ps = {
    claude: {
      settings: `{
  "model": "sonnet",
  "fallbackModel": [
    "opus",
    "haiku"
  ],
  "availableModels": [
    "sonnet",
    "opus",
    "haiku"
  ],
  "effortLevel": "high",
  "language": "zh-CN",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<你的 auth token>",
    "ANTHROPIC_BASE_URL": "<供应商 url>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<供应商 Haiku 模型名称>",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "<供应商 Sonnet 模型名称>",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "<供应商 Opus 模型名称>"
  },
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "Read",
      "Edit"
    ],
    "ask": [
      "Bash(git push:*)"
    ],
    "deny": [
      "Read(./.env)"
    ]
  }
}`,
    },
    codex: {
      config: `model_provider = "codex"
model = "gpt-5.1-codex"
model_reasoning_effort = "medium"
model_reasoning_summary = "detailed"
model_verbosity = "high"
model_supports_reasoning_summaries = true
disable_response_storage = true
hide_agent_reasoning = false
web_search = true

[model_providers.codex]
name = "codex"
base_url = "<供应商 url>"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = true`,
      env: `# ~/.codex/.env
OPENAI_API_KEY=<你的 api key>
OPENAI_BASE_URL=<可选供应商 url>`,
      auth: `{
  "OPENAI_API_KEY": "<你的 api key>"
}`,
    },
    opencode: {
      settings: `{
  "$schema": "https://opencode.ai/config.json",
  "model": "myAPI/main-chat-model",
  "small_model": "myAPI/small-task-model",
  "provider": {
    "myAPI": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "myAPI",
      "options": {
        "baseURL": "{env:MY_API_BASE_URL}",
        "apiKey": "{env:MY_API_KEY}"
      },
      "models": {
        "main-chat-model": {
          "name": "Main Chat Model",
          "reasoning": true,
          "options": {
            "reasoningEffort": "medium"
          },
          "variants": {
            "low": {
              "reasoningEffort": "low"
            },
            "high": {
              "reasoningEffort": "high"
            }
          }
        },
        "small-task-model": {
          "name": "Small Task Model",
          "reasoning": true,
          "options": {
            "reasoningEffort": "low"
          },
          "variants": {
            "low": {
              "reasoningEffort": "low"
            },
            "high": {
              "reasoningEffort": "high"
            }
          }
        }
      }
    }
  }
}`,
	    },
	  };

const Nk = {
    "claude-settings": {
      title: "Claude settings.json",
      content: ps.claude.settings,
    },
	    "opencode-settings": {
	      title: "OpenCode 模型配置 config.json（myAPI 双模型与思考力度范例）",
	      content: ps.opencode.settings,
	    },
	    "codex-config": { title: "Codex config.toml 与 .env", content: `${ps.codex.config}\n\n# ~/.codex/.env\n${ps.codex.env}` },
    "codex-env": { title: "Codex .env", content: ps.codex.env },
    "codex-auth": { title: "Codex auth.json", content: ps.codex.auth },
  };

// Config editor panel
const ConfigEditorPanel = () => {
    const {
        selectedConfigId: e,
        selectedConfigPlatform: t,
        getConfigById: n,
        updateConfig: r,
        getActiveConfigId: o,
      } = useConfigStore(),
      [l, s] = c.useState(""),
      [u, f] = c.useState(""),
      [m, v] = c.useState(""),
      [p, h] = c.useState(""),
      [b, x] = c.useState(""),
      [codexMcpServerIds, setCodexMcpServerIds] = c.useState([]),
      [mcpHealthItems, setMcpHealthItems] = c.useState([]),
      [mcpHealthLoading, setMcpHealthLoading] = c.useState(!1),
      [installingMcpId, setInstallingMcpId] = c.useState(""),
      [removingMcpId, setRemovingMcpId] = c.useState(""),
      [installEnvModalOpen, setInstallEnvModalOpen] = c.useState(!1),
      [pendingInstallMcpItem, setPendingInstallMcpItem] = c.useState(null),
      [installEnvDraft, setInstallEnvDraft] = c.useState({}),
      [healthDetailState, setHealthDetailState] = c.useState(null),
      [mcpInstalledServerIds, setMcpInstalledServerIds] = c.useState(null),
      [C, Z] = c.useState([]),
      [j, q] = c.useState(!1),
      [officialSkills, setOfficialSkills] = c.useState([]),
      [officialSkillsLoading, setOfficialSkillsLoading] = c.useState(!1),
      [officialSkillActionId, setOfficialSkillActionId] = c.useState(""),
      [officialSkillActionType, setOfficialSkillActionType] = c.useState(""),
      [S, y] = c.useState(null),
      [$, w] = c.useState(!1),
      [skillsModalOpen, setSkillsModalOpen] = c.useState(!1),
      [claudeEditorMode, setClaudeEditorMode] = c.useState("visual"),
      [claudeVisualState, setClaudeVisualState] = c.useState(() =>
        claudeVisualCreateState({}),
      ),
      [claudeVisualError, setClaudeVisualError] = c.useState(""),
      [openCodeEditorMode, setOpenCodeEditorMode] = c.useState("visual"),
      [openCodeVisualState, setOpenCodeVisualState] = c.useState(() =>
        openCodeVisualCreateState({}),
      ),
      [openCodeVisualError, setOpenCodeVisualError] = c.useState(""),
      [codexEditorMode, setCodexEditorMode] = c.useState("visual"),
      [codexVisualState, setCodexVisualState] = c.useState(() =>
        codexVisualCreateState("", ""),
      ),
      [codexVisualError, setCodexVisualError] = c.useState(""),
      [configFieldHelpTooltipKey, setConfigFieldHelpTooltipKey] = c.useState(""),
      configFieldHelpTooltipTimerRef = c.useRef(null),
      O = e ? n(e, t || void 0) : null,
      I = S ? Nk[S] : null,
      R = c.useMemo(() => {
        if (Array.isArray(mcpInstalledServerIds)) return mcpInstalledServerIds;
        if (t === "codex" && Array.isArray(codexMcpServerIds) && codexMcpServerIds.length > 0)
          return codexMcpServerIds;
        if (t === "codex") {
          try {
            const H = g1(m || "");
            if (H && H.mcp_servers) return Object.keys(H.mcp_servers);
          } catch {}
          return [];
        }
        const H = t === "claude" ? u : l;
        try {
          const k = JSON.parse(H || "{}"),
            L = k && (k.mcp || k.mcpServers || k.mcp_servers);
          if (L) return Object.keys(L);
        } catch {}
        return [];
      }, [l, u, m, t, codexMcpServerIds, mcpInstalledServerIds]),
      refreshMcpInstalledIds = c.useCallback(async (W = t) => {
        if (!W) return;
        try {
          const H = await fetchMcpInstalledServerIds(W);
          Array.isArray(H) ? setMcpInstalledServerIds(H) : setMcpInstalledServerIds([]);
          W === "codex" && (Array.isArray(H) ? setCodexMcpServerIds(H) : setCodexMcpServerIds([]));
        } catch (H) {
          console.error("刷新 MCP 安装状态失败:", H), setMcpInstalledServerIds(null);
        }
      }, [t]),
      checkMcpHealth = c.useCallback(
        async (W = t, H = !1) => {
          if (!W) return;
          setMcpHealthLoading(!0);
          try {
            const k = await fetchMcpHealth(W);
            Array.isArray(k) ? setMcpHealthItems(k) : setMcpHealthItems([]);
            if (W === "codex" || H) {
              try {
                const L = await fetchMcpInstalledServerIds("codex");
                Array.isArray(L)
                  ? (setMcpInstalledServerIds(L), setCodexMcpServerIds(L))
                  : (setMcpInstalledServerIds([]), setCodexMcpServerIds([]));
              } catch (L) {
                console.error("刷新 Codex MCP 列表失败:", L), setCodexMcpServerIds([]);
              }
            }
            Kt.success("MCP 健康检测完成");
          } catch (k) {
            const L = k instanceof Error ? k.message : String(k);
            console.error("检测 MCP 健康状态失败:", k), Kt.error(`检测 MCP 健康状态失败: ${L}`);
          } finally {
            setMcpHealthLoading(!1);
          }
        },
        [t],
      ),
      refreshCurrentMcpConfig = c.useCallback(async (W) => {
        if (W === "claude") {
          const H = await fetchCurrentConfig("claude");
          H?.content !== void 0 && s(H.content);
          f("");
          return;
        }
	        if (W === "opencode") {
	          const H = await fetchCurrentConfig("opencode");
	          H?.content !== void 0 && s(H.content);
	          return;
        }
        const H = await fetchCurrentConfig("codex");
        H?.configContent !== void 0 && v(H.configContent);
        H?.envContent !== void 0 && x(H.envContent);
        H?.authContent !== void 0 && h(H.authContent);
      }, []),
      refreshMcpInstalledIdsInBackground = c.useCallback((W) => {
        if (!W) return;
        setTimeout(() => {
          void refreshMcpInstalledIds(W);
        }, 0);
      }, [refreshMcpInstalledIds]),
      installMcpItem = async (W, H = {}) => {
        try {
          if (!t) return;
          setInstallingMcpId(W.id);
          const U = await installMcpById(t, W.id, H);
          const T = Array.isArray(U?.warnings) ? U.warnings : [];
          T.forEach((k) => Kt.warning(k));
          try {
            await refreshCurrentMcpConfig(t);
          } catch (k) {
            console.error("刷新 MCP 配置失败:", k);
          }
          Kt.success(`已安装 MCP: ${W.name}`);
          refreshMcpInstalledIdsInBackground(t);
          return !0;
        } catch (H) {
          console.error("安装 MCP 失败:", H), Kt.error("安装 MCP 失败");
          return !1;
        } finally {
          setInstallingMcpId("");
        }
      },
      P = async (W) => {
        const H = getMcpEnvEntries(W);
        if (H.length > 0) {
          setPendingInstallMcpItem(W), setInstallEnvDraft(createInitialMcpEnvDraft(W)), setInstallEnvModalOpen(!0);
          return;
        }
        await installMcpItem(W, {});
      },
      U = async (W) => {
        if (!t) return;
        setRemovingMcpId(W.id);
        try {
          await uninstallMcpById(t, W.id);
          try {
            await refreshCurrentMcpConfig(t);
          } catch (H) {
            console.error("刷新 MCP 配置失败:", H);
          }
          Kt.success(`已卸载 MCP: ${W.name}`);
          refreshMcpInstalledIdsInBackground(t);
        } catch (H) {
          console.error("卸载 MCP 失败:", H), Kt.error("卸载 MCP 失败");
        } finally {
          setRemovingMcpId("");
        }
      },
      V0 = (W, H) => {
        setInstallEnvDraft((k) => ({ ...k, [W]: H }));
      },
      openHealthDetail = (W, H) => {
        setHealthDetailState({ item: W, health: H });
      },
      Q0 = async () => {
        const W = pendingInstallMcpItem;
        if (!W) return;
        const H = getMissingMcpEnvNames(W, installEnvDraft);
        if (H.length > 0) {
          Kt.error(`请填写环境变量: ${H.join(", ")}`);
          return;
        }
        const k = await installMcpItem(W, installEnvDraft);
        k && (setInstallEnvModalOpen(!1), setPendingInstallMcpItem(null), setInstallEnvDraft({}));
      },
      te = async (W, H) => {
        if (!O || (O.platform !== "claude" && O.platform !== "codex" && O.platform !== "opencode")) return;
        const k0 = officialPackageSingularByPlatform(O.platform);
        setOfficialSkillActionId(W.id), setOfficialSkillActionType(H);
        try {
          const k =
            H === "install"
              ? await installOfficialSkillById(O.platform, W.id)
              : H === "update"
                ? await updateOfficialSkillById(O.platform, W.id)
                : await uninstallOfficialSkillById(O.platform, W.id);
          await loadSkillsState(O);
          H === "install"
            ? Kt.success(`已安装 ${k0}: ${k.skillName || W.name}`)
            : H === "update"
              ? Kt.success(`已更新 ${k0}: ${k.skillName || W.name}`)
              : Kt.success(`已卸载 ${k0}: ${k.skillName || W.name}`);
        } catch (k) {
          const L = k instanceof Error ? k.message : String(k);
          console.error(`${H === "install" ? "安装" : H === "update" ? "更新" : "卸载"} ${k0} 失败:`, k),
            H === "install" && (L.includes("Skill 已存在") || L.includes("already exists") || L.includes("Extension already exists"))
              ? Kt.error(`${k0} 已存在: ${W.name}`)
              : Kt.error(`${H === "install" ? "安装" : H === "update" ? "更新" : "卸载"} ${k0} 失败: ${L}`);
        } finally {
          setOfficialSkillActionId(""), setOfficialSkillActionType("");
        }
      },
      X0 = async (W) => te(W, "install"),
      ee = async (W) => te(W, "update"),
      ne = async (W) => te(W, "uninstall");
    c.useEffect(() => {
      return () => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
      };
    }, []);
    c.useEffect(() => {
      if (!O) {
        (s(""),
          f(""),
          x(""),
          v(""),
          h(""),
          Z([]),
          setCodexMcpServerIds([]),
          setMcpHealthItems([]),
          setMcpHealthLoading(!1),
          setInstallingMcpId(""),
          setInstallEnvModalOpen(!1),
          setPendingInstallMcpItem(null),
          setInstallEnvDraft({}),
          setHealthDetailState(null),
          setMcpInstalledServerIds(null),
          setOfficialSkills([]),
          setOfficialSkillsLoading(!1),
          setOfficialSkillActionId(""),
          setOfficialSkillActionType(""),
          setSkillsModalOpen(!1),
          setClaudeEditorMode("visual"),
          setClaudeVisualState(claudeVisualCreateState({})),
          setClaudeVisualError(""),
          setOpenCodeEditorMode("visual"),
          setOpenCodeVisualState(openCodeVisualCreateState({})),
          setOpenCodeVisualError(""),
          setCodexEditorMode("visual"),
          setCodexVisualState(codexVisualCreateState("", "")),
          setCodexVisualError(""));
        return;
      }
      if (O.platform === "claude") {
        const W = O.content || "{}",
          H = claudeVisualParseContent(W);
        s(W), f(""), x(""), v(""), h(""), setClaudeEditorMode("visual");
        H.ok
          ? (setClaudeVisualState(H.state), setClaudeVisualError(""))
          : (setClaudeVisualState(null), setClaudeVisualError(H.error));
      } else if (O.platform === "opencode") {
        const W = O.content || "{}",
          H = openCodeVisualParseContent(W);
        s(W), x(""), v(""), h(""), setOpenCodeEditorMode("visual");
        H.ok
          ? (setOpenCodeVisualState(H.state), setOpenCodeVisualError(""))
          : (setOpenCodeVisualState(null), setOpenCodeVisualError(H.error));
      } else {
        const W = O.configContent || "",
          H = O.envContent || "",
          k = codexVisualParseContent(W, H);
        v(W), x(H), h(O.authContent || "{}"), s(""), setCodexEditorMode("visual");
        k.ok
          ? (setCodexVisualState(k.state), setCodexVisualError(""))
          : (setCodexVisualState(null), setCodexVisualError(k.error));
      }
    }, [O]);
    c.useEffect(() => {
      if (claudeEditorMode !== "visual" || !claudeVisualState) return;
      const W = claudeVisualSerializeState(claudeVisualState);
      W.ok ? (s(W.content), setClaudeVisualError("")) : setClaudeVisualError(W.error);
    }, [claudeEditorMode, claudeVisualState]);
    c.useEffect(() => {
      if (openCodeEditorMode !== "visual" || !openCodeVisualState) return;
      const W = openCodeVisualSerializeState(openCodeVisualState);
      W.ok ? (s(W.content), setOpenCodeVisualError("")) : setOpenCodeVisualError(W.error);
    }, [openCodeEditorMode, openCodeVisualState]);
    c.useEffect(() => {
      if (codexEditorMode !== "visual" || !codexVisualState) return;
      const W = codexVisualSerializeState(codexVisualState);
      W.ok
        ? (v(W.content), x(W.envContent || ""), setCodexVisualError(""))
        : setCodexVisualError(W.error);
    }, [codexEditorMode, codexVisualState]);
    c.useEffect(() => {
        setMcpHealthItems([]),
        setMcpHealthLoading(!1),
        setMcpInstalledServerIds(null),
        O?.platform !== "codex" && setCodexMcpServerIds([]),
        O?.platform && void refreshMcpInstalledIds(O.platform);
    }, [O, refreshMcpInstalledIds]);
    const tt = c.useCallback((W) => {
      const H = new Set();
      try {
        const k = JSON.parse(W || "{}");
        const L = k && typeof k === "object" ? k.permissions : null;
        const U = L && typeof L === "object" && Array.isArray(L.deny) ? L.deny : [];
        U.forEach((T) => {
          if (typeof T !== "string") {
            return;
          }
          const F = T.trim().match(/^Skill\((.+)\)$/);
          if (!F || !F[1]) {
            return;
          }
          const Y = F[1].trim();
          if (Y) {
            H.add(Y);
          }
        });
      } catch {
        // ignore parse errors
      }
      return H;
    }, []);
    const nt = c.useCallback((W) => {
      const H = new Set();
      let k = !1;
      try {
        const L = JSON.parse(W || "{}");
        const U = L && typeof L === "object" && !Array.isArray(L) ? L.skills : null;
        if (U && typeof U === "object" && !Array.isArray(U)) {
          U.enabled === !1 && (k = !0);
          const T = Array.isArray(U.disabled) ? U.disabled : [];
          T.forEach((F) => {
            if (typeof F !== "string") {
              return;
            }
            const Y = F.trim();
            if (Y) {
              H.add(Y);
            }
          });
        }
      } catch {
        // ignore parse errors
      }
      return { disabled: H, allDisabled: k };
    }, []);
    const G = c.useCallback((W, H, k, L) => {
      const U = new Map(),
        T = new Map();
      (Array.isArray(H) ? H : []).forEach((F) => {
        if (!F) {
          return;
        }
        F.path && T.set(F.path, F), F.name && U.set(F.name, F);
      });
      const F = k instanceof Set ? k : new Set(),
        Y = L === !0;
      return (Array.isArray(W) ? W : []).map((ie) => {
        const Le = (ie.path && T.get(ie.path)) || U.get(ie.name);
        return {
          name: ie.name,
          path: ie.path,
          description: ie.description,
          enabled: Le ? Le.enabled !== !1 : Y ? !1 : !F.has(ie.name),
        };
      });
    }, []);
    const loadSkillsState = c.useCallback(async (W, H = () => !1) => {
      if (!W || (W.platform !== "codex" && W.platform !== "claude" && W.platform !== "opencode")) {
        Z([]), setOfficialSkills([]), setOfficialSkillsLoading(!1);
        return;
      }
      q(!0), setOfficialSkillsLoading(!0);
      const k = W.platform === "claude"
          ? fetchClaudeSkillsList()
          : W.platform === "opencode"
            ? fetchOpenCodeSkillsList()
            : fetchCodexSkillsList(),
        L = fetchOfficialSkillsCatalog(W.platform),
        [U, T] = await Promise.allSettled([k, L]);
      if (H()) return;
      if (U.status === "fulfilled") {
        let F = new Set();
        let Y = !1;
        if (W.platform === "claude") {
          F = tt(W.content || "{}");
        } else if (W.platform === "opencode") {
          const ie = nt(W.content || "{}");
          F = ie.disabled;
          Y = ie.allDisabled;
        }
        const ie = W.platform === "claude" ? W.claudeSkills : W.platform === "opencode" ? W.openCodeSkills : W.codexSkills;
        Z(G(U.value, ie, F, Y));
      } else {
        const F =
          W.platform === "claude"
            ? "获取 Claude Skills 失败"
            : W.platform === "opencode"
              ? "获取 OpenCode Skills 失败"
              : "获取 Codex Skills 失败";
        console.error(F + ":", U.reason), Kt.error(F), Z([]);
      }
      if (T.status === "fulfilled") {
        setOfficialSkills(Array.isArray(T.value) ? T.value : []);
      } else {
        console.error("获取官方 Skills 失败:", T.reason), Kt.error("获取官方 Skills 失败"), setOfficialSkills([]);
      }
      q(!1), setOfficialSkillsLoading(!1);
    }, [G, tt, nt]);
    c.useEffect(() => {
      let W = !1;
      if (!O || (O.platform !== "codex" && O.platform !== "claude" && O.platform !== "opencode")) {
        Z([]), setOfficialSkills([]), setOfficialSkillsLoading(!1);
        return;
      }
      loadSkillsState(O, () => W);
      return () => {
        W = !0;
      };
    }, [O, loadSkillsState]);
    const _ = (W) => {
        try {
          return (JSON.parse(W), !0);
        } catch {
          return !1;
        }
      },
      M = (W) => {
        try {
          const H = JSON.parse(W);
          return JSON.stringify(H, null, 2);
        } catch {
          throw new Error("JSON格式不正确");
        }
      },
      syncClaudeVisualContent = (W, H = "visual", k = !1) => {
        const L = claudeVisualParseContent(W);
        if (!L.ok) {
          setClaudeVisualError(L.error), k && Kt.error(L.error);
          return !1;
        }
        return (
          s(W),
          setClaudeVisualState(L.state),
          setClaudeVisualError(""),
          setClaudeEditorMode(H),
          !0
        );
      },
      switchClaudeEditorMode = (W) => {
        if (W === claudeEditorMode) return;
        if (W === "visual") {
          syncClaudeVisualContent(l, "visual", !0);
          return;
        }
        if (!claudeVisualState) {
          setClaudeEditorMode("json");
          return;
        }
        const H = claudeVisualSerializeState(claudeVisualState);
        if (!H.ok) {
          setClaudeVisualError(H.error), Kt.error(H.error);
          return;
        }
        s(H.content), setClaudeVisualError(""), setClaudeEditorMode("json");
      },
      syncOpenCodeVisualContent = (W, H = "visual", k = !1) => {
        const L = openCodeVisualParseContent(W);
        if (!L.ok) {
          setOpenCodeVisualError(L.error), k && Kt.error(L.error);
          return !1;
        }
        return (
          s(W),
          setOpenCodeVisualState(L.state),
          setOpenCodeVisualError(""),
          setOpenCodeEditorMode(H),
          !0
        );
      },
      switchOpenCodeEditorMode = (W) => {
        if (W === openCodeEditorMode) return;
        if (W === "visual") {
          syncOpenCodeVisualContent(l, "visual", !0);
          return;
        }
        if (!openCodeVisualState) {
          setOpenCodeEditorMode("json");
          return;
        }
        const H = openCodeVisualSerializeState(openCodeVisualState);
        if (!H.ok) {
          setOpenCodeVisualError(H.error), Kt.error(H.error);
          return;
        }
        s(H.content), setOpenCodeVisualError(""), setOpenCodeEditorMode("json");
      },
      syncCodexVisualContent = (W, H = b, k = "visual", L = !1) => {
        const U = codexVisualParseContent(W, H);
        if (!U.ok) {
          setCodexVisualError(U.error), L && Kt.error(U.error);
          return !1;
        }
        return (
          v(W),
          x(H),
          setCodexVisualState(U.state),
          setCodexVisualError(""),
          setCodexEditorMode(k),
          !0
        );
      },
      switchCodexEditorMode = (W) => {
        if (W === codexEditorMode) return;
        if (W === "visual") {
          syncCodexVisualContent(m, b, "visual", !0);
          return;
        }
        if (!codexVisualState) {
          setCodexEditorMode("toml");
          return;
        }
        const H = codexVisualSerializeState(codexVisualState);
        if (!H.ok) {
          setCodexVisualError(H.error), Kt.error(H.error);
          return;
        }
        v(H.content), x(H.envContent || ""), setCodexVisualError(""), setCodexEditorMode("toml");
      },
      N = (W) => y(W),
      z = () => y(null),
      D = () => {
        if (!(!I || !S)) {
          switch (S) {
            case "claude-settings":
              syncClaudeVisualContent(I.content, "visual", !0);
              break;
		            case "opencode-settings":
			              syncOpenCodeVisualContent(I.content, "visual", !0);
			              break;
		            case "codex-config":
              syncCodexVisualContent(ps.codex.config, ps.codex.env, "visual", !0);
              break;
            case "codex-env":
              syncCodexVisualContent(m, I.content, codexEditorMode, !0);
	              break;
            case "codex-auth":
              h(I.content);
              break;
          }
          (Kt.success("已导入范例内容，请确认后保存"), z());
        }
      },
      B = () =>
        be.jsx(RE, {
          rootClassName: "config-example-drawer",
          title: I?.title || "配置范例",
          width: 560,
          open: !!I,
          onClose: z,
          destroyOnClose: !0,
          children: I
            ? be.jsxs(be.Fragment, {
                children: [
                  be.jsx("div", {
                    style: { marginBottom: 12, textAlign: "right" },
                    children: be.jsx(xn, {
                      type: "primary",
                      onClick: D,
                      children: "一键导入",
                    }),
                  }),
                  be.jsx("pre", {
                    style: {
                      margin: 0,
                      padding: "12px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background-color-secondary)",
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      lineHeight: 1.6,
                    },
                    children: I.content,
                  }),
                ],
              })
            : null,
        }),
      A = async (W) => {
        if (!(!O || !(o(O.platform) === O.id)))
          try {
            (await applyConfigItem(O.platform, W), Kt.success("已更新当前激活的配置"));
          } catch (k) {
            Kt.error("已保存，但更新激活配置失败: " + k);
          }
      },
      saveClaudeSettingsCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        let W;
        if (claudeEditorMode === "visual") {
          if (!claudeVisualState) {
            const H =
              claudeVisualError || "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复";
            setClaudeVisualError(H), Kt.error(H);
            return;
          }
          const H = claudeVisualSerializeState(claudeVisualState);
          if (!H.ok) {
            setClaudeVisualError(H.error), Kt.error(H.error);
            return;
          }
          W = H.content;
        } else {
          if (!_(l)) {
            Kt.error("JSON格式不正确");
            return;
          }
          W = M(l);
        }
        try {
          await r(O.id, { content: W });
          s(W);
          if (claudeEditorMode === "visual") {
            const H = claudeVisualParseContent(W);
            H.ok && setClaudeVisualState(H.state);
          }
          f("");
          Kt.success("保存成功");
          await A({ content: W, claudeSkills: C });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      saveOpenCodeSettingsCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        let W;
        if (openCodeEditorMode === "visual") {
          if (!openCodeVisualState) {
            const H =
              openCodeVisualError || "当前 JSON 尚未成功加载到可视化编辑器，请切换到 JSON 模式修复";
            setOpenCodeVisualError(H), Kt.error(H);
            return;
          }
          const H = openCodeVisualSerializeState(openCodeVisualState);
          if (!H.ok) {
            setOpenCodeVisualError(H.error), Kt.error(H.error);
            return;
          }
          W = H.content;
        } else {
          if (!_(l)) {
            Kt.error("JSON格式不正确");
            return;
          }
          W = M(l);
        }
        try {
          await openCodeVisualRunSaveFlow({
            content: W,
            saveConfig: async (H) => {
              await r(O.id, { content: H });
              s(H), Kt.success("保存成功");
              if (openCodeEditorMode === "visual") {
                const k = openCodeVisualParseContent(H);
                k.ok && setOpenCodeVisualState(k.state);
              }
            },
            applyActiveConfig: (H) => A({ content: H, openCodeSkills: C }),
          });
        } catch (H) {
          Kt.error("保存失败: " + H);
        }
      },
      saveCodexConfigCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        try {
          let W = m,
            H = b;
          if (codexEditorMode === "visual") {
            if (!codexVisualState) {
              const k =
                codexVisualError || "当前 TOML 尚未成功加载到可视化编辑器，请切换到 TOML 源码修复";
              setCodexVisualError(k), Kt.error(k);
              return;
            }
            const k = codexVisualSerializeState(codexVisualState);
            if (!k.ok) {
              setCodexVisualError(k.error), Kt.error(k.error);
              return;
            }
            W = k.content;
            H = k.envContent || "";
          } else {
            const k = codexVisualParseContent(m, b);
            if (!k.ok) {
              setCodexVisualError(k.error), Kt.error(k.error);
              return;
            }
          }
          if (!_(p)) {
            Kt.error("auth.json格式不正确");
            return;
          }
          const k = M(p);
          await r(O.id, { configContent: W, envContent: H, authContent: k });
          v(W), x(H), h(k);
          const L = codexVisualParseContent(W, H);
          L.ok && setCodexVisualState(L.state);
          Kt.success("保存成功");
          await A({ configContent: W, envContent: H, authContent: k, codexSkills: C });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      },
      saveCodexAuthCard = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        if (!_(p)) {
          Kt.error("auth.json格式不正确");
          return;
        }
        try {
          const W = M(p);
          await r(O.id, { configContent: m, envContent: b, authContent: W });
          h(W);
          Kt.success("保存成功");
          await A({ configContent: m, envContent: b, authContent: W, codexSkills: C });
        } catch (W) {
          Kt.error("保存失败: " + W);
        }
      };
    const J = async (W, H, k) => {
        const L = C.map((U) => (U.name === W && (k ? U.path === k : !0) ? { ...U, enabled: H } : U));
        Z(L);
        try {
          if (O) {
            const U =
              O.platform === "claude"
                ? { claudeSkills: L }
                : O.platform === "opencode"
                  ? { openCodeSkills: L }
                  : { codexSkills: L };
            await r(O.id, U);
            if (o(O.platform) === O.id) {
              if (O.platform === "claude") {
                if (!_(l)) {
                  Kt.error("JSON格式不正确");
                  return;
                }
                const T = M(l);
                await applyConfigItem("claude", {
                  content: T,
                  claudeSkills: L,
                });
                const Y = await fetchCurrentConfig("claude");
                Y?.content !== void 0 && s(Y.content);
                f("");
              } else if (O.platform === "opencode") {
                if (!_(l)) {
                  Kt.error("JSON格式不正确");
                  return;
                }
	                const T = M(l);
	                await applyConfigItem("opencode", {
	                  content: T,
	                  openCodeSkills: L,
	                });
	                const F = await fetchCurrentConfig("opencode");
	                F?.content !== void 0 && s(F.content);
	              } else {
                if (!_(p)) {
                  Kt.error("auth.json格式不正确");
                  return;
                }
                const T = M(p);
                await applyConfigItem("codex", {
                  configContent: m,
                  envContent: b,
                  authContent: T,
                  codexSkills: L,
                });
                const F = await fetchCurrentConfig("codex");
                F?.configContent !== void 0 && v(F.configContent);
                F?.envContent !== void 0 && x(F.envContent);
                F?.authContent !== void 0 && h(F.authContent);
              }
              Kt.success("已更新当前激活的配置");
            }
          }
        } catch (U) {
          Kt.error("更新技能失败: " + U);
        }
      },
      K = async (W) => {
        const H = C.map((k) => ({ ...k, enabled: W }));
        Z(H);
        try {
          if (O) {
            const k =
              O.platform === "claude"
                ? { claudeSkills: H }
                : O.platform === "opencode"
                  ? { openCodeSkills: H }
                  : { codexSkills: H };
            await r(O.id, k);
            if (o(O.platform) === O.id) {
              if (O.platform === "claude") {
                if (!_(l)) {
                  Kt.error("JSON格式不正确");
                  return;
                }
                const L = M(l);
                await applyConfigItem("claude", {
                  content: L,
                  claudeSkills: H,
                });
                const T = await fetchCurrentConfig("claude");
                T?.content !== void 0 && s(T.content);
                f("");
              } else if (O.platform === "opencode") {
                if (!_(l)) {
                  Kt.error("JSON格式不正确");
                  return;
                }
	                const L = M(l);
	                await applyConfigItem("opencode", {
	                  content: L,
	                  openCodeSkills: H,
	                });
	                const U = await fetchCurrentConfig("opencode");
	                U?.content !== void 0 && s(U.content);
	              } else {
                if (!_(p)) {
                  Kt.error("auth.json格式不正确");
                  return;
                }
                const L = M(p);
                await applyConfigItem("codex", {
                  configContent: m,
                  envContent: b,
                  authContent: L,
                  codexSkills: H,
                });
                const U = await fetchCurrentConfig("codex");
                U?.configContent !== void 0 && v(U.configContent);
                U?.envContent !== void 0 && x(U.envContent);
                U?.authContent !== void 0 && h(U.authContent);
              }
              Kt.success("已更新当前激活的配置");
            }
          }
        } catch (k) {
          Kt.error("更新技能失败: " + k);
        }
      },
      Q = c.useMemo(() => C.filter((W) => W.enabled !== !1).length, [C]);
    const configAppUsesChinese =
        typeof navigator === "undefined" ||
        !navigator.language ||
        navigator.language.toLowerCase().startsWith("zh"),
      claudeText = (W, H) => (configAppUsesChinese ? W : H),
      configFieldHelpMap = Object.freeze({
        "默认模型 model": "会话默认模型，可填写 sonnet、opus、haiku 或供应商模型 ID。",
        "Default model": "Default session model; use sonnet, opus, haiku, or a provider model ID.",
        "推理强度 effortLevel": "控制 Claude Code 的推理预算。",
        "Effort level": "Controls the Claude Code reasoning budget.",
        "回退模型 fallbackModel": "主模型不可用时按顺序尝试的回退模型，每行一个，最多 3 个。",
        "Fallback models": "Fallback models tried in order when the primary model is unavailable; one per line, up to 3.",
        "可选模型 availableModels": "限制 UI 或命令中可选择的模型范围，每行一个别名或完整模型名。",
        "Available models": "Restricts selectable models in UI or commands; one alias or full model name per line.",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "将 Claude Haiku 档映射到第三方供应商的实际模型名。",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "将 Claude Sonnet 档映射到第三方供应商的实际模型名。",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "将 Claude Opus 档映射到第三方供应商的实际模型名。",
        ANTHROPIC_BASE_URL: "Anthropic 或兼容网关的 API Base URL。",
        ANTHROPIC_API_KEY: "Anthropic 官方 API Key，敏感值仅保存在本机配置。",
        ANTHROPIC_AUTH_TOKEN: "第三方网关 Bearer Token，敏感值仅保存在本机配置。",
        "界面语言 language": "设置 Claude Code 界面或输出偏好的语言。",
        Language: "Sets the preferred language for Claude Code UI or output.",
        "输出风格 outputStyle": "设置 Claude Code 默认输出风格名称。",
        "Output style": "Sets the default Claude Code output style name.",
        自动更新通道: "选择 Claude Code 自动更新通道。",
        "Auto-update channel": "Selects the Claude Code auto-update channel.",
        会话保留天数: "会话清理保留天数，需为大于等于 1 的整数。",
        "Session retention days": "Session cleanup retention in days; must be an integer of at least 1.",
        默认启用扩展思考: "是否默认启用扩展思考。",
        "Extended thinking by default": "Whether extended thinking is enabled by default.",
        "提交信息附加 Co-Authored-By": "是否在提交信息中附加 Co-Authored-By。",
        "Include Co-Authored-By": "Whether to append Co-Authored-By to commit messages.",
        默认权限模式: "Claude Code 默认权限模式。可选值：default / acceptEdits / plan / dontAsk",
        "Default permission mode": "Default Claude Code permission mode. Options: default / acceptEdits / plan / dontAsk",
        allow: "始终允许的工具规则，每行一个 Tool 或 Tool(specifier)。",
        ask: "需要确认的工具规则，每行一个 Tool 或 Tool(specifier)。",
        deny: "始终拒绝的工具规则，每行一个 Tool 或 Tool(specifier)。",
        "Provider id": "Provider 唯一标识，会被模型引用使用。",
        名称: "Provider 展示名称，用于配置页列表识别。",
        npm: "OpenCode 加载的 provider npm 包名。",
        "Base URL": "兼容 OpenAI 协议的网关地址，可使用 {env:VAR} 引用环境变量。",
        "API Key": "Provider API Key，可使用 {env:VAR} 引用环境变量。",
        "模型 id": "Provider 下的模型唯一标识，会拼成 provider/model 引用。",
        模型名称: "模型在配置页中显示的人类可读名称。",
        思考力度: "该模型支持的 reasoning effort，可多选。可选值：low / medium / high / xhigh / max",
        model: "Codex CLI 默认模型名称。",
        model_provider: "Codex 使用的默认模型供应商。",
        approval_policy: "控制命令执行前的审批策略。",
        sandbox_mode: "控制 Codex CLI 文件系统沙箱范围。",
        model_reasoning_effort: "控制模型推理强度。",
        model_reasoning_summary: "控制推理摘要展示方式。",
        model_verbosity: "控制模型输出详略程度。",
        web_search: "是否启用 web_search。",
        "tools.web_search": "是否启用 tools.web_search。",
        "features.web_search": "是否启用 features.web_search。",
        disable_response_storage: "是否禁用响应存储。",
        hide_agent_reasoning: "是否隐藏 agent reasoning。",
        model_supports_reasoning_summaries: "声明当前模型是否支持 reasoning summaries。",
        name: "Provider 展示名称。",
        base_url: "Provider API Base URL。",
        env_key: "从 .env 读取 API Key 的环境变量名。",
        wire_api: "Provider 使用的 wire API。可选值：responses / chat",
        requires_openai_auth: "Provider 是否需要 OpenAI auth。",
        OPENAI_API_KEY: "OpenAI 或兼容服务 API Key。",
        OPENAI_BASE_URL: "通过环境变量覆盖 OpenAI Base URL。",
        OPENAI_ORG_ID: "OpenAI organization id。",
        OPENAI_ORGANIZATION: "OpenAI organization 名称或兼容变量。",
      }),
      getConfigLabelText = (W) => (typeof W === "string" ? W : String(W || "")),
      getConfigFieldHelp = (W, H) =>
        H || configFieldHelpMap[getConfigLabelText(W)] || `${getConfigLabelText(W)} 配置项。`,
      stripConfigHelpOption = (W = {}) => {
        const { help: H, ...k } = W;
        return k;
      },
      showConfigFieldHelpTooltip = (W) => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
        configFieldHelpTooltipTimerRef.current = setTimeout(() => {
          setConfigFieldHelpTooltipKey(W);
        }, CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS);
      },
      hideConfigFieldHelpTooltip = () => {
        configFieldHelpTooltipTimerRef.current && clearTimeout(configFieldHelpTooltipTimerRef.current);
        configFieldHelpTooltipTimerRef.current = null;
        setConfigFieldHelpTooltipKey("");
      },
      renderConfigFieldLabel = (W, H) =>
        be.jsxs("span", {
          style: {
            color: "var(--text-color-secondary)",
            fontSize: "12px",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            minWidth: 0,
          },
          children: [
            be.jsx("span", { children: W }),
            getConfigFieldHelp(W, H)
              ? be.jsxs("span", {
                  style: { position: "relative", display: "inline-flex", flex: "0 0 auto" },
                  children: [
                    be.jsx("span", {
                      title: getConfigFieldHelp(W, H),
                      "aria-label": getConfigFieldHelp(W, H),
                      role: "img",
                      onMouseEnter: () => showConfigFieldHelpTooltip(getConfigLabelText(W)),
                      onMouseLeave: hideConfigFieldHelpTooltip,
                      onFocus: () => showConfigFieldHelpTooltip(getConfigLabelText(W)),
                      onBlur: hideConfigFieldHelpTooltip,
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "14px",
                        height: "14px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "50%",
                        color: "var(--text-color-secondary)",
                        background: "var(--background-color)",
                        fontSize: "10px",
                        lineHeight: 1,
                        cursor: "help",
                        flex: "0 0 auto",
                      },
                      children: "?",
                    }),
                    configFieldHelpTooltipKey === getConfigLabelText(W)
                      ? be.jsx("span", {
                          role: "tooltip",
                          style: {
                            position: "absolute",
                            left: "50%",
                            bottom: "calc(100% + 6px)",
                            transform: "translateX(-50%)",
                            zIndex: 20,
                            width: "max-content",
                            maxWidth: "260px",
                            padding: "5px 7px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            background: "var(--background-color)",
                            color: "var(--text-color)",
                            boxShadow: "0 4px 14px var(--shadow-color)",
                            fontSize: "12px",
                            lineHeight: 1.45,
                            whiteSpace: "normal",
                            pointerEvents: "none",
                          },
                          children: getConfigFieldHelp(W, H),
                        })
                      : null,
                  ],
                })
              : null,
          ],
        }),
      formatConfigEnumHelp = (W, H) => `${W}${W ? " " : ""}可选值：${H.join(" / ")}`,
      updateClaudeVisualState = (W) =>
        setClaudeVisualState((H) => (H ? claudeVisualUpdateState(H, W) : H)),
      updateClaudeVisualEnv = (W, H) =>
        setClaudeVisualState((k) => (k ? claudeVisualUpdateEnv(k, W, H) : k)),
      updateClaudeVisualPermissions = (W) =>
        setClaudeVisualState((H) => (H ? claudeVisualUpdatePermissions(H, W) : H)),
      renderClaudeField = (W, H, k, L = "", U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(zi, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              type: U.type || "text",
              min: U.min,
              step: U.step,
            }),
          ],
        }),
      renderClaudeSelect = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(
              W,
              formatConfigEnumHelp(getConfigFieldHelp(W, U.help), L.map((T) => T.value || T.label)),
            ),
            be.jsx("select", {
              value: H || "",
              onChange: (U) => k(U.target.value),
              style: {
                width: "100%",
                minHeight: "30px",
                padding: "4px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-color)",
                background: "var(--background-color)",
              },
              children: L.map((U) =>
                be.jsx("option", { value: U.value, children: U.label }, U.value || "__default"),
              ),
            }),
          ],
        }),
      renderClaudeListField = (W, H, k, L, U = 3, T = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, T.help),
            be.jsx(Qa, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              rows: U,
              style: { fontFamily: "monospace", fontSize: "12px", resize: "vertical" },
            }),
          ],
        }),
      renderClaudeSection = (W, H, k) =>
        be.jsxs("section", {
          style: {
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "6px",
          },
          children: [
            be.jsx("div", { style: { fontWeight: 600, marginBottom: "2px" }, children: W }),
            H
              ? be.jsx("div", {
                  style: {
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                  },
                  children: H,
                })
              : null,
            k,
          ],
        }),
      renderClaudeVisualEditor = () => {
        if (!claudeVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children:
              claudeVisualError ||
              claudeText(
                "当前 JSON 无法加载到可视化编辑器，请切换到 JSON 模式修复。",
                "The current JSON cannot be loaded visually. Switch to JSON mode to fix it.",
              ),
          });
        const booleanOptions = [
            { value: "", label: claudeText("跟随默认", "Use default") },
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ],
          gridStyle = {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            gap: "5px",
          };
        return be.jsxs("div", {
          style: { display: "flex", flexDirection: "column", gap: "6px" },
          children: [
            be.jsx("div", {
              style: {
                padding: "7px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-color-secondary)",
                fontSize: "12px",
                lineHeight: 1.5,
              },
              children: claudeText(
                "依据 Claude Code 官方 settings.json 格式编辑常用核心字段；未展示字段、额外 env、hooks 与企业策略会原样保留。",
                "Edit common fields from the official Claude Code settings.json format. Hidden fields, extra env entries, hooks, and enterprise policies are preserved.",
              ),
            }),
            renderClaudeSection(
              claudeText("模型与推理", "Models and reasoning"),
              claudeText(
                "model 是会话默认模型；fallbackModel 最多三个；availableModels 限制可选择模型。",
                "model sets the session default; fallbackModel supports up to three entries; availableModels restricts selection.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    claudeText("默认模型 model", "Default model"),
                    claudeVisualState.model,
                    (W) => updateClaudeVisualState({ model: W }),
                    "sonnet / opus / haiku / vendor-model-id",
                  ),
                  renderClaudeSelect(
                    claudeText("推理强度 effortLevel", "Effort level"),
                    claudeVisualState.effortLevel,
                    (W) => updateClaudeVisualState({ effortLevel: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      ...["low", "medium", "high", "xhigh", "max"].map((W) => ({ value: W, label: W })),
                    ],
                  ),
                  renderClaudeListField(
                    claudeText("回退模型 fallbackModel", "Fallback models"),
                    claudeVisualState.fallbackModels,
                    (W) => updateClaudeVisualState({ fallbackModels: W }),
                    claudeText("每行一个，最多 3 个", "One per line, up to 3"),
                  ),
                  renderClaudeListField(
                    claudeText("可选模型 availableModels", "Available models"),
                    claudeVisualState.availableModels,
                    (W) => updateClaudeVisualState({ availableModels: W }),
                    claudeText("每行一个模型别名或完整名称", "One alias or full model name per line"),
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("三档默认模型映射", "Default model family mapping"),
              claudeText(
                "为第三方网关或云平台分别指定 Haiku、Sonnet、Opus 实际模型名称。",
                "Map Haiku, Sonnet, and Opus to provider-specific model names for gateways or cloud platforms.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_HAIKU_MODEL", W),
                    "provider-haiku-model",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_SONNET_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_SONNET_MODEL", W),
                    "provider-sonnet-model",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_DEFAULT_OPUS_MODEL",
                    claudeVisualState.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_DEFAULT_OPUS_MODEL", W),
                    "provider-opus-model",
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("API 与网关", "API and gateway"),
              claudeText(
                "按供应商要求选择 API Key 或 Auth Token；敏感值仍保存在本机配置文件。",
                "Use API Key or Auth Token as required by your provider. Secrets remain in the local settings file.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    "ANTHROPIC_BASE_URL",
                    claudeVisualState.env.ANTHROPIC_BASE_URL,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_BASE_URL", W),
                    "https://api.example.com",
                  ),
                  renderClaudeField(
                    "ANTHROPIC_API_KEY",
                    claudeVisualState.env.ANTHROPIC_API_KEY,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_API_KEY", W),
                    claudeText("官方 API Key", "Anthropic API key"),
                    { type: "password" },
                  ),
                  renderClaudeField(
                    "ANTHROPIC_AUTH_TOKEN",
                    claudeVisualState.env.ANTHROPIC_AUTH_TOKEN,
                    (W) => updateClaudeVisualEnv("ANTHROPIC_AUTH_TOKEN", W),
                    claudeText("网关 Bearer Token", "Gateway bearer token"),
                    { type: "password" },
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("常用行为", "Common behavior"),
              "",
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    claudeText("界面语言 language", "Language"),
                    claudeVisualState.language,
                    (W) => updateClaudeVisualState({ language: W }),
                    "zh-CN / English",
                  ),
                  renderClaudeField(
                    claudeText("输出风格 outputStyle", "Output style"),
                    claudeVisualState.outputStyle,
                    (W) => updateClaudeVisualState({ outputStyle: W }),
                    "Explanatory",
                  ),
                  renderClaudeSelect(
                    claudeText("自动更新通道", "Auto-update channel"),
                    claudeVisualState.autoUpdatesChannel,
                    (W) => updateClaudeVisualState({ autoUpdatesChannel: W }),
                    [
                      { value: "", label: claudeText("跟随默认", "Use default") },
                      { value: "stable", label: "stable" },
                      { value: "latest", label: "latest" },
                    ],
                  ),
                  renderClaudeField(
                    claudeText("会话保留天数", "Session retention days"),
                    claudeVisualState.cleanupPeriodDays,
                    (W) => updateClaudeVisualState({ cleanupPeriodDays: W }),
                    "30",
                    { type: "number", min: 1, step: 1 },
                  ),
                  renderClaudeSelect(
                    claudeText("默认启用扩展思考", "Extended thinking by default"),
                    claudeVisualState.alwaysThinkingEnabled,
                    (W) => updateClaudeVisualState({ alwaysThinkingEnabled: W }),
                    booleanOptions,
                  ),
                  renderClaudeSelect(
                    claudeText("提交信息附加 Co-Authored-By", "Include Co-Authored-By"),
                    claudeVisualState.includeCoAuthoredBy,
                    (W) => updateClaudeVisualState({ includeCoAuthoredBy: W }),
                    booleanOptions,
                  ),
                ],
              }),
            ),
            renderClaudeSection(
              claudeText("权限规则", "Permission rules"),
              claudeText(
                "规则每行一个；支持 Claude Code 的 Tool 或 Tool(specifier) 语法。",
                "Enter one rule per line using Claude Code Tool or Tool(specifier) syntax.",
              ),
              be.jsxs("div", {
                style: gridStyle,
                children: [
                  renderClaudeField(
                    claudeText("默认权限模式", "Default permission mode"),
                    claudeVisualState.permissions.defaultMode,
                    (W) => updateClaudeVisualPermissions({ defaultMode: W }),
                    "default / acceptEdits / plan / dontAsk",
                  ),
                  renderClaudeListField(
                    "allow",
                    claudeVisualState.permissions.allow,
                    (W) => updateClaudeVisualPermissions({ allow: W }),
                    "Read\nEdit",
                  ),
                  renderClaudeListField(
                    "ask",
                    claudeVisualState.permissions.ask,
                    (W) => updateClaudeVisualPermissions({ ask: W }),
                    "Bash(git push:*)",
                  ),
                  renderClaudeListField(
                    "deny",
                    claudeVisualState.permissions.deny,
                    (W) => updateClaudeVisualPermissions({ deny: W }),
                    "Read(./.env)\nBash(rm:*)",
                  ),
                ],
              }),
            ),
          ],
        });
      },
      selectedOpenCodeProvider = openCodeVisualState?.providers.find(
        (W) => W.id === openCodeVisualState.selectedProviderId,
      ),
      selectedOpenCodeModel = selectedOpenCodeProvider?.models.find(
        (W) => W.id === openCodeVisualState.selectedModelId,
      ),
      selectOpenCodeProvider = (W) => {
        setOpenCodeVisualState((H) => {
          if (!H) return H;
          const k = H.providers.find((L) => L.id === W);
          return { ...H, selectedProviderId: W, selectedModelId: k?.models[0]?.id || "" };
        });
      },
      updateSelectedOpenCodeProvider = (W) => {
        selectedOpenCodeProvider &&
          setOpenCodeVisualState((H) =>
            H ? openCodeVisualUpdateProvider(H, selectedOpenCodeProvider.id, W) : H,
          );
      },
      updateSelectedOpenCodeModel = (W) => {
        selectedOpenCodeProvider &&
          selectedOpenCodeModel &&
          setOpenCodeVisualState((H) =>
            H
              ? openCodeVisualUpdateModel(
                  H,
                  selectedOpenCodeProvider.id,
                  selectedOpenCodeModel.id,
                  W,
                )
              : H,
          );
      },
      confirmDeleteOpenCodeProvider = () => {
        if (!selectedOpenCodeProvider) return;
        xr.confirm({
          title: "删除 Provider",
          content: `确定删除 ${selectedOpenCodeProvider.name || selectedOpenCodeProvider.id} 及其全部模型吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setOpenCodeVisualState((W) =>
              W ? openCodeVisualDeleteProvider(W, selectedOpenCodeProvider.id) : W,
            ),
        });
      },
      confirmDeleteOpenCodeModel = () => {
        if (!selectedOpenCodeProvider || !selectedOpenCodeModel) return;
        xr.confirm({
          title: "删除模型",
          content: `确定删除 ${selectedOpenCodeModel.name || selectedOpenCodeModel.id} 吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setOpenCodeVisualState((W) =>
              W
                ? openCodeVisualDeleteModel(
                    W,
                    selectedOpenCodeProvider.id,
                    selectedOpenCodeModel.id,
                  )
                : W,
            ),
        });
      },
      renderOpenCodeField = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(zi, {
              value: H,
              onChange: (T) => k(T.target.value),
              placeholder: L,
              ...stripConfigHelpOption(U),
            }),
          ],
        }),
      renderOpenCodeSelect = (W, H, k, L, U = {}) => {
        const T = L.some((Z) => Z.value === H)
          ? L
          : H
            ? [...L, { value: H, label: H }]
            : L;
        return be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(
              W,
              formatConfigEnumHelp(getConfigFieldHelp(W, U.help), T.map((Z) => Z.value)),
            ),
            be.jsx($l, {
              value: H || void 0,
              onChange: (Z) => k(Z || ""),
              options: T,
              allowClear: !0,
              showSearch: !0,
              optionFilterProp: "label",
              placeholder: U.placeholder,
              style: { width: "100%" },
            }),
          ],
        });
      },
      renderOpenCodeMultiSelect = (W, H, k, L, U = {}) => {
        const T = openCodeVisualNormalizeEfforts(H),
          Z = new Set(L.map((Q) => Q.value)),
          ee = [...L, ...T.filter((Q) => !Z.has(Q)).map((Q) => ({ value: Q, label: Q }))];
        return be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(
              W,
              formatConfigEnumHelp(getConfigFieldHelp(W, U.help), ee.map((Q) => Q.value)),
            ),
            be.jsx($l, {
              mode: "multiple",
              value: T,
              onChange: (Q) => k(openCodeVisualNormalizeEfforts(Q).join(", ")),
              options: ee,
              allowClear: !0,
              maxTagCount: "responsive",
              placeholder: U.placeholder,
              style: { width: "100%" },
            }),
          ],
        });
      },
      renderOpenCodeVisualEditor = () => {
        if (!openCodeVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children: openCodeVisualError || "当前 JSON 无法加载到可视化编辑器",
          });
        const W = selectedOpenCodeProvider,
          H = selectedOpenCodeModel,
          k = W && H ? openCodeVisualModelRef(W.id, H.id) : "";
        return be.jsxs("div", {
          style: {
            display: "flex",
            gap: "6px",
            alignItems: "stretch",
            flexWrap: "wrap",
            minHeight: 420,
          },
          children: [
            be.jsxs("div", {
              style: {
                width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "5px",
              },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    be.jsx("strong", { children: "Provider" }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () =>
                        setOpenCodeVisualState((L) =>
                          L ? openCodeVisualAddProvider(L) : openCodeVisualCreateState({}),
                        ),
                      children: "新增",
                    }),
                  ],
                }),
                openCodeVisualState.providers.length > 0
                  ? openCodeVisualState.providers.map((L) =>
                      be.jsx(
                        xn,
                        {
                          type: L.id === openCodeVisualState.selectedProviderId ? "primary" : "default",
                          onClick: () => selectOpenCodeProvider(L.id),
                          style: { width: "100%", textAlign: "left", overflow: "hidden" },
                          children: L.name || L.id,
                        },
                        L.id,
                      ),
                    )
                  : be.jsx("div", {
                      style: {
                        padding: "10px 2px",
                        textAlign: "center",
                        color: "var(--text-color-secondary)",
                      },
                      children: "暂无 Provider，请新增",
                    }),
              ],
            }),
            be.jsxs("div", {
              style: {
                flex: "1 1 420px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              },
              children: W
                ? [
                    be.jsxs("div", {
                      style: {
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "6px",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "4px",
                            marginBottom: "5px",
                          },
                          children: [
                            be.jsx("strong", { children: "Provider 配置" }),
                            be.jsx(xn, {
                              size: "small",
                              danger: !0,
                              onClick: confirmDeleteOpenCodeProvider,
                              children: "删除 Provider",
                            }),
                          ],
                        }),
                        be.jsxs("div", {
                          style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
                            gap: "5px",
                          },
                          children: [
                            renderOpenCodeField("Provider id", W.id, (L) => updateSelectedOpenCodeProvider({ id: L }), "例如 myAPI"),
                            renderOpenCodeField("名称", W.name, (L) => updateSelectedOpenCodeProvider({ name: L }), "Provider 名称"),
                            renderOpenCodeSelect(
                              "npm",
                              W.npm,
                              (L) => updateSelectedOpenCodeProvider({ npm: L }),
                              OPEN_CODE_PROVIDER_NPM_OPTIONS,
                              {
                                placeholder: claudeText("选择 Provider npm 包", "Select a provider npm package"),
                              },
                            ),
                            renderOpenCodeField("Base URL", W.baseURL, (L) => updateSelectedOpenCodeProvider({ baseURL: L }), "例如 {env:MY_API_BASE_URL}"),
                            renderOpenCodeField("API Key", W.apiKey, (L) => updateSelectedOpenCodeProvider({ apiKey: L }), "例如 {env:MY_API_KEY}", { type: "password" }),
                          ],
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      style: {
                        display: "flex",
                        gap: "6px",
                        flexWrap: "wrap",
                        flex: 1,
                        minHeight: 260,
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                            minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                            maxWidth: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "5px",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                              children: [
                                be.jsx("strong", { children: "模型" }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () =>
                                    setOpenCodeVisualState((L) =>
                                      L ? openCodeVisualAddModel(L, W.id) : L,
                                    ),
                                  children: "新增",
                                }),
                              ],
                            }),
                            W.models.length > 0
                              ? W.models.map((L) =>
                                  be.jsx(
                                    xn,
                                    {
                                      type: L.id === openCodeVisualState.selectedModelId ? "primary" : "default",
                                      onClick: () =>
                                        setOpenCodeVisualState((U) =>
                                          U ? { ...U, selectedModelId: L.id } : U,
                                        ),
                                      title: L.id,
                                      style: { width: "100%", textAlign: "left", overflow: "hidden" },
                                      children: L.name || L.id,
                                    },
                                    L.id,
                                  ),
                                )
                              : be.jsx("div", {
                                  style: {
                                    padding: "10px 2px",
                                    textAlign: "center",
                                    color: "var(--text-color-secondary)",
                                  },
                                  children: "暂无模型，请新增",
                                }),
                          ],
                        }),
                        be.jsxs("div", {
                          style: {
                            flex: "1 1 360px",
                            minWidth: 0,
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "6px",
                          },
                          children: H
                            ? [
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    gap: "4px",
                                    marginBottom: "5px",
                                  },
                                  children: [
                                    be.jsx("strong", { children: H.name || H.id }),
                                    be.jsx(xn, {
                                      size: "small",
                                      danger: !0,
                                      onClick: confirmDeleteOpenCodeModel,
                                      children: "删除模型",
                                    }),
                                  ],
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
                                    gap: "5px",
                                  },
                                  children: [
                                    renderOpenCodeField("模型 id", H.id, (L) => updateSelectedOpenCodeModel({ id: L }), "模型标识"),
                                    renderOpenCodeField("模型名称", H.name, (L) => updateSelectedOpenCodeModel({ name: L }), "列表中显示的名称"),
                                    renderOpenCodeMultiSelect(
                                      "思考力度",
                                      H.efforts,
                                      (L) => updateSelectedOpenCodeModel({ efforts: L }),
                                      OPEN_CODE_REASONING_EFFORT_OPTIONS.map((L) => ({ value: L, label: L })),
                                      {
                                        placeholder: claudeText("选择一个或多个思考力度", "Select one or more efforts"),
                                      },
                                    ),
                                  ],
                                }),
                                be.jsxs("div", {
                                  style: {
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "8px",
                                    marginTop: "14px",
                                  },
                                  children: [
                                    be.jsxs("label", {
                                      style: { display: "inline-flex", alignItems: "center", gap: 3 },
                                      children: [
                                        be.jsx("input", {
                                          type: "checkbox",
                                          checked: H.reasoning,
                                          onChange: (L) => updateSelectedOpenCodeModel({ reasoning: L.target.checked }),
                                        }),
                                        "启用 reasoning",
                                      ],
                                    }),
                                    be.jsxs("label", {
                                      style: { display: "inline-flex", alignItems: "center", gap: 3 },
                                      children: [
                                        be.jsx("input", {
                                          type: "checkbox",
                                          checked: openCodeVisualState.primaryModel === k,
                                          onChange: (L) =>
                                            setOpenCodeVisualState((U) =>
                                              U ? openCodeVisualSetRole(U, W.id, H.id, "primary", L.target.checked) : U,
                                            ),
                                        }),
                                        "主模型",
                                      ],
                                    }),
                                    be.jsxs("label", {
                                      style: { display: "inline-flex", alignItems: "center", gap: 3 },
                                      children: [
                                        be.jsx("input", {
                                          type: "checkbox",
                                          checked: openCodeVisualState.smallModel === k,
                                          onChange: (L) =>
                                            setOpenCodeVisualState((U) =>
                                              U ? openCodeVisualSetRole(U, W.id, H.id, "small", L.target.checked) : U,
                                            ),
                                        }),
                                        "小模型",
                                      ],
                                    }),
                                  ],
                                }),
                                be.jsx("div", {
                                  style: {
                                    marginTop: "10px",
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children: claudeText(
                                    "可多选思考力度；首项作为默认 reasoningEffort。",
                                    "Select multiple efforts; the first is the default reasoningEffort.",
                                  ),
                                }),
                              ]
                            : [
                                be.jsx("div", {
                                  style: {
                                    padding: "20px 4px",
                                    textAlign: "center",
                                    color: "var(--text-color-secondary)",
                                  },
                                  children: "请选择或新增模型",
                                }),
                              ],
                        }),
                      ],
                    }),
                  ]
                : [
                    be.jsx("div", {
                      style: {
                        padding: "24px 8px",
                        textAlign: "center",
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        color: "var(--text-color-secondary)",
                      },
                      children: "请从左侧新增 Provider",
                    }),
              ],
            }),
          ],
        });
      },
      selectedCodexProvider = codexVisualState?.providers.find(
        (W) => W.id === codexVisualState.selectedProviderId,
      ),
      updateCodexVisualState = (W) =>
        setCodexVisualState((H) => (H ? codexVisualUpdateState(H, W) : H)),
      updateCodexVisualEnv = (W, H) =>
        setCodexVisualState((k) => (k ? codexVisualUpdateEnv(k, W, H) : k)),
      selectCodexProvider = (W) =>
        setCodexVisualState((H) => (H ? { ...H, selectedProviderId: W } : H)),
      updateSelectedCodexProvider = (W) => {
        selectedCodexProvider &&
          setCodexVisualState((H) =>
            H ? codexVisualUpdateProvider(H, selectedCodexProvider.id, W) : H,
          );
      },
      confirmDeleteCodexProvider = () => {
        if (!selectedCodexProvider) return;
        xr.confirm({
          title: "删除 Provider",
          content: `确定删除 ${selectedCodexProvider.name || selectedCodexProvider.id} 吗？`,
          okText: "删除",
          cancelText: "取消",
          onOk: () =>
            setCodexVisualState((W) =>
              W ? codexVisualDeleteProvider(W, selectedCodexProvider.id) : W,
            ),
        });
      },
      renderCodexField = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(W, U.help),
            be.jsx(zi, {
              value: H || "",
              onChange: (T) => k(T.target.value),
              placeholder: L,
              ...stripConfigHelpOption(U),
            }),
          ],
        }),
      renderCodexSelect = (W, H, k, L, U = {}) =>
        be.jsxs("label", {
          style: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
          children: [
            renderConfigFieldLabel(
              W,
              formatConfigEnumHelp(getConfigFieldHelp(W, U.help), L.map((T) => T.value || T.label)),
            ),
            be.jsx("select", {
              value: H || "",
              onChange: (U) => k(U.target.value),
              style: {
                width: "100%",
                minHeight: "30px",
                padding: "4px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                color: "var(--text-color)",
                background: "var(--background-color)",
              },
              children: L.map((U) =>
                be.jsx("option", { value: U.value, children: U.label }, U.value || "__default"),
              ),
            }),
          ],
        }),
      renderCodexSection = (W, H, k) =>
        be.jsxs("section", {
          style: {
            border: "1px solid var(--border-color)",
            borderRadius: "6px",
            padding: "6px",
          },
          children: [
            be.jsx("div", { style: { fontWeight: 600, marginBottom: "2px" }, children: W }),
            H
              ? be.jsx("div", {
                  style: {
                    color: "var(--text-color-secondary)",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    marginBottom: "6px",
                  },
                  children: H,
                })
              : null,
            k,
          ],
        }),
      renderCodexVisualEditor = () => {
        if (!codexVisualState)
          return be.jsx("div", {
            style: {
              padding: "8px",
              border: "1px solid var(--border-color)",
              borderRadius: "6px",
              color: "var(--error-color)",
            },
            children: codexVisualError || "当前 TOML 无法加载到可视化编辑器，请切换到 TOML 源码修复。",
          });
        const W = selectedCodexProvider,
          H = [
            { value: "", label: "跟随默认" },
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ],
          k = {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
            gap: "5px",
          };
        return be.jsxs("div", {
          style: {
            display: "flex",
            gap: "6px",
            alignItems: "stretch",
            flexWrap: "wrap",
            minHeight: 420,
          },
          children: [
            be.jsxs("div", {
              style: {
                width: `${CONFIG_PROVIDER_CARD_WIDTH_PX}px`,
                minWidth: `${CONFIG_PROVIDER_CARD_MIN_WIDTH_PX}px`,
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                padding: "5px",
              },
              children: [
                be.jsxs("div", {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    be.jsx("strong", { children: "Provider" }),
                    be.jsx(xn, {
                      size: "small",
                      onClick: () =>
                        setCodexVisualState((L) =>
                          L ? codexVisualAddProvider(L) : codexVisualCreateState("", ""),
                        ),
                      children: "新增",
                    }),
                  ],
                }),
                codexVisualState.providers.length > 0
                  ? codexVisualState.providers.map((L) =>
                      be.jsx(
                        xn,
                        {
                          type: L.id === codexVisualState.selectedProviderId ? "primary" : "default",
                          onClick: () => selectCodexProvider(L.id),
                          style: { width: "100%", textAlign: "left", overflow: "hidden" },
                          children: L.name || L.id,
                        },
                        L.id,
                      ),
                    )
                  : be.jsx("div", {
                      style: {
                        padding: "10px 2px",
                        textAlign: "center",
                        color: "var(--text-color-secondary)",
                      },
                      children: "暂无 Provider，请新增",
                    }),
              ],
            }),
            be.jsxs("div", {
              style: {
                flex: "1 1 420px",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              },
              children: [
                renderCodexSection(
                  "核心配置",
                  "编辑 ~/.codex/config.toml 中稳定常用字段；未展示的 TOML 字段会保留。",
                  be.jsxs("div", {
                    style: k,
                    children: [
                      renderCodexField("model", codexVisualState.model, (L) => updateCodexVisualState({ model: L }), "gpt-5.1-codex"),
                      renderCodexSelect(
                        "model_provider",
                        codexVisualState.modelProvider,
                        (L) => updateCodexVisualState({ modelProvider: L }),
                        [
                          { value: "", label: "未设置" },
                          ...codexVisualState.providers.map((L) => ({ value: L.id, label: L.id })),
                        ],
                      ),
                      renderCodexSelect(
                        "approval_policy",
                        codexVisualState.approvalPolicy,
                        (L) => updateCodexVisualState({ approvalPolicy: L }),
                        ["", "untrusted", "on-request", "on-failure", "never"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "sandbox_mode",
                        codexVisualState.sandboxMode,
                        (L) => updateCodexVisualState({ sandboxMode: L }),
                        ["", "read-only", "workspace-write", "danger-full-access"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "model_reasoning_effort",
                        codexVisualState.reasoningEffort,
                        (L) => updateCodexVisualState({ reasoningEffort: L }),
                        ["", "minimal", "low", "medium", "high", "xhigh", "max"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                      renderCodexSelect(
                        "model_reasoning_summary",
                        codexVisualState.reasoningSummary,
                        (L) => updateCodexVisualState({ reasoningSummary: L }),
                        ["", "auto", "concise", "detailed", "none"].map((L) => ({
                          value: L,
                          label: L || "跟随默认",
                        })),
                      ),
                    ],
                  }),
                ),
                renderCodexSection(
                  "开关与工具",
                  "",
                  be.jsxs("div", {
                    style: k,
                    children: [
                      renderCodexSelect("web_search", codexVisualState.webSearch, (L) => updateCodexVisualState({ webSearch: L }), H),
                      renderCodexSelect("tools.web_search", codexVisualState.toolsWebSearch, (L) => updateCodexVisualState({ toolsWebSearch: L }), H),
                      renderCodexSelect("features.web_search", codexVisualState.featuresWebSearch, (L) => updateCodexVisualState({ featuresWebSearch: L }), H),
                      renderCodexSelect("disable_response_storage", codexVisualState.disableResponseStorage, (L) => updateCodexVisualState({ disableResponseStorage: L }), H),
                      renderCodexSelect("hide_agent_reasoning", codexVisualState.hideAgentReasoning, (L) => updateCodexVisualState({ hideAgentReasoning: L }), H),
                      renderCodexSelect("model_supports_reasoning_summaries", codexVisualState.supportsReasoningSummaries, (L) => updateCodexVisualState({ supportsReasoningSummaries: L }), H),
                    ],
                  }),
                ),
                W
                  ? renderCodexSection(
                      "Provider 配置",
                      "Provider 写入 [model_providers.<id>]，env_key 对应 ~/.codex/.env 中的密钥名。",
                      be.jsxs(be.Fragment, {
                        children: [
                          be.jsxs("div", {
                            style: {
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "4px",
                              marginBottom: "5px",
                            },
                            children: [
                              be.jsx("strong", { children: W.name || W.id }),
                              be.jsx(xn, {
                                size: "small",
                                danger: !0,
                                onClick: confirmDeleteCodexProvider,
                                children: "删除 Provider",
                              }),
                            ],
                          }),
                          be.jsxs("div", {
                            style: k,
                            children: [
                              renderCodexField("Provider id", W.id, (L) => updateSelectedCodexProvider({ id: L }), "openai"),
                              renderCodexField("name", W.name, (L) => updateSelectedCodexProvider({ name: L }), "OpenAI"),
                              renderCodexField("base_url", W.baseUrl, (L) => updateSelectedCodexProvider({ baseUrl: L }), "https://api.openai.com/v1"),
                              renderCodexField("env_key", W.envKey, (L) => updateSelectedCodexProvider({ envKey: L }), "OPENAI_API_KEY"),
                              renderCodexField("wire_api", W.wireApi, (L) => updateSelectedCodexProvider({ wireApi: L }), "responses"),
                              renderCodexSelect("requires_openai_auth", W.requiresOpenaiAuth, (L) => updateSelectedCodexProvider({ requiresOpenaiAuth: L }), H),
                            ],
                          }),
                        ],
                      }),
                    )
                  : null,
                renderCodexSection(
                  "~/.codex/.env",
                  "主配置使用 env_key 引用这里的环境变量；长尾变量可在源码模式直接编辑。",
                  be.jsxs("div", {
                    style: k,
                    children: [
                      renderCodexField("OPENAI_API_KEY", codexVisualState.env.OPENAI_API_KEY, (L) => updateCodexVisualEnv("OPENAI_API_KEY", L), "sk-...", { type: "password" }),
                      renderCodexField("OPENAI_BASE_URL", codexVisualState.env.OPENAI_BASE_URL, (L) => updateCodexVisualEnv("OPENAI_BASE_URL", L), "https://api.example.com/v1"),
                      renderCodexField("OPENAI_ORG_ID", codexVisualState.env.OPENAI_ORG_ID, (L) => updateCodexVisualEnv("OPENAI_ORG_ID", L), "org_..."),
                      renderCodexField("OPENAI_ORGANIZATION", codexVisualState.env.OPENAI_ORGANIZATION, (L) => updateCodexVisualEnv("OPENAI_ORGANIZATION", L), "org_..."),
                    ],
                  }),
                ),
              ],
            }),
          ],
        });
      };
    return O
      ? O.platform === "claude"
        ? be.jsxs("div", {
            className: "config-editor-shell config-editor-claude",
            style: {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              minHeight: 0,
            },
            children: [
              be.jsx(aa, {
                title: `编辑配置: ${O.name}`,
                extra: be.jsxs("div", {
                  style: { display: "flex", gap: "4px" },
                  children: [
                    be.jsx(xn, {
                      onClick: () => w(!0),
                      children: "MCP(全局)",
                    }),
	                    be.jsx(xn, {
	                      onClick: () => setSkillsModalOpen(!0),
	                      children: "Skills",
	                    }),
	                    be.jsx(xn, {
	                      type: "primary",
	                      icon: be.jsx(Pv, {}),
	                      onClick: saveClaudeSettingsCard,
	                      children: "保存",
	                    }),
	                  ],
	                }),
                style: {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                },
                bodyStyle: {
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "auto",
                  minHeight: 0,
                },
                children: be.jsxs("div", {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    flex: 1,
                  },
                  children: [
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "6px",
                            color: "var(--text-color-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 6 },
                              children: [
                                be.jsxs("span", {
                                  children: [
                                    be.jsx(Ya, {}),
                                    " 配置文件路径: ",
                                    "~/.claude/settings.json",
                                  ],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("claude-settings"),
                                  children: "查看范例",
                                }),
                              ],
	                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "3px" },
                              children: [
                                be.jsx(xn, {
                                  size: "small",
                                  type: claudeEditorMode === "visual" ? "primary" : "default",
                                  onClick: () => switchClaudeEditorMode("visual"),
                                  children: claudeText("可视化", "Visual"),
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  type: claudeEditorMode === "json" ? "primary" : "default",
                                  onClick: () => switchClaudeEditorMode("json"),
                                  children: "JSON",
                                }),
                              ],
                            }),
	                          ],
	                        }),
                        claudeVisualError
                          ? be.jsx("div", {
                              style: {
                                marginBottom: "5px",
                                padding: "4px 5px",
                                border: "1px solid var(--error-color)",
                                borderRadius: "6px",
                                color: "var(--error-color)",
                              },
                              children: claudeVisualError,
                            })
                          : null,
                        claudeEditorMode === "visual"
                          ? renderClaudeVisualEditor()
                          : be.jsxs(be.Fragment, {
                              children: [
                                be.jsx("div", {
                                  style: {
                                    marginBottom: "4px",
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                    lineHeight: 1.5,
                                  },
                                  children: claudeText(
                                    "高级 JSON 模式会保留所有 Claude Code 字段；JSON 无效时不会覆盖最后一次有效的可视化状态。",
                                    "Advanced JSON mode preserves every Claude Code field. Invalid JSON does not overwrite the last valid visual state.",
                                  ),
                                }),
                                be.jsx(Qa, {
                                  value: l,
                                  onChange: (H) => (s(H.target.value), setClaudeVisualError("")),
                                  placeholder: claudeText("请输入 JSON 配置", "Enter JSON configuration"),
                                  rows: 18,
                                  style: {
                                    flex: 1,
                                    minHeight: 420,
                                    fontFamily: "monospace",
                                    fontSize: "13px",
                                  },
                                }),
                              ],
                            }),
                      ],
                    }),
                    !1 && be.jsxs("div", {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " Skills"],
                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "4px" },
                              children: [
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!0),
                                  disabled: C.length === 0,
                                  children: "一键启用",
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!1),
                                  disabled: C.length === 0,
                                  children: "一键禁用",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: j
                            ? "技能列表加载中..."
                            : `已启用 ${Q} / ${C.length}`,
                        }),
                        be.jsx("div", {
                          style: {
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "4px",
                            background: "var(--background-color-secondary)",
                          },
                          children:
                            C.length === 0
                              ? be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children: "未检测到 Skills，请先安装到 ~/.claude/skills",
                                })
                              : C.map((W) =>
                                  be.jsx(
                                    "label",
                                    {
                                      style: {
                                        display: "flex",
                                        gap: "5px",
                                        padding: "4px",
                                        borderRadius: "6px",
                                        background: "var(--background-color)",
                                        border: "1px solid var(--border-color)",
                                        marginBottom: "4px",
                                      },
                                      children: be.jsxs("div", {
                                        style: { display: "flex", gap: "4px", width: "100%" },
                                        children: [
                                          be.jsx("input", {
                                            type: "checkbox",
                                            checked: W.enabled !== !1,
                                            onChange: (H) => J(W.name, H.target.checked, W.path),
                                          }),
                                          be.jsxs("div", {
                                            style: {
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: "1px",
                                              flex: 1,
                                            },
                                            children: [
                                              be.jsx("div", { children: W.name }),
                                              be.jsx("div", {
                                                style: {
                                                  color: "var(--text-color-secondary)",
                                                  fontSize: "12px",
                                                },
                                                children: W.path,
                                              }),
                                              W.description &&
                                                be.jsx("div", {
                                                  style: {
                                                    color: "var(--text-color-secondary)",
                                                    fontSize: "12px",
                                                  },
                                                  children: W.description,
                                                }),
                                            ],
                                          }),
                                        ],
                                      }),
                                    },
                                    W.name,
                                  ),
                                ),
                        }),
                      ],
                    }),
                  ],
                }),
              }),
              be.jsx(xr, {
                title: "MCP 市场",
                open: $,
                onCancel: () => w(!1),
                width: 1e3,
                footer: null,
                destroyOnClose: !0,
                children: be.jsx(jv, {
                  onAdd: P,
                  onRemove: U,
                  onCheckHealth: () => checkMcpHealth(t),
                  onOpenHealthDetail: openHealthDetail,
                  installedIds: R,
                  platform: t,
                  healthItems: mcpHealthItems,
                  healthLoading: mcpHealthLoading,
                  addingId: installingMcpId,
                  removingId: removingMcpId,
                }),
              }),
              be.jsx(McpInstallEnvModal, {
                open: installEnvModalOpen,
                item: pendingInstallMcpItem,
                envValues: installEnvDraft,
                onChange: V0,
                onClose: () => {
                  setInstallEnvModalOpen(!1), setPendingInstallMcpItem(null), setInstallEnvDraft({});
                },
                onConfirm: Q0,
                loading: !!installingMcpId,
              }),
              be.jsx(McpHealthDetailModal, {
                open: !!healthDetailState,
                item: healthDetailState?.item || null,
                health: healthDetailState?.health || null,
                onClose: () => setHealthDetailState(null),
              }),
              be.jsx(SkillsManagerModal, {
                open: skillsModalOpen,
                onClose: () => setSkillsModalOpen(!1),
                platform: O.platform,
                skills: C,
                enabledCount: Q,
                loading: j,
                onToggle: J,
                onToggleAll: K,
                officialSkills,
                officialLoading: officialSkillsLoading,
                onInstallOfficialSkill: X0,
                onUninstallOfficialSkill: ne,
                onUpdateOfficialSkill: ee,
                pendingOfficialSkillAction: officialSkillActionId ? { skillId: officialSkillActionId, action: officialSkillActionType } : null,
              }),
              B(),
            ],
          })
        : O.platform === "opencode"
          ? be.jsxs("div", {
              className: "config-editor-shell config-editor-opencode",
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "8px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: `编辑配置: ${O.name}`,
                  extra: be.jsxs("div", {
                    style: { display: "flex", gap: "4px" },
                    children: [
                      be.jsx(xn, {
                        onClick: () => w(!0),
                        children: "MCP(全局)",
                      }),
	                    be.jsx(xn, {
	                      onClick: () => setSkillsModalOpen(!0),
	                      children: "Skills",
	                    }),
	                    be.jsx(xn, {
	                      type: "primary",
	                      icon: be.jsx(Pv, {}),
	                      onClick: saveOpenCodeSettingsCard,
	                      children: "保存",
	                    }),
	                    ],
	                  }),
                  style: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  },
                  bodyStyle: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px",
                    gap: "8px",
                    overflow: "auto",
                    minHeight: 0,
                  },
                  children: [
                    be.jsxs("div", {
                      style: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "5px",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", { children: [be.jsx(Ya, {}), " config.json"] }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("opencode-settings"),
                                  children: "查看范例",
                                }),
                              ],
                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "3px" },
                              children: [
                                be.jsx(xn, {
                                  size: "small",
                                  type: openCodeEditorMode === "visual" ? "primary" : "default",
                                  onClick: () => switchOpenCodeEditorMode("visual"),
                                  children: "可视化",
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  type: openCodeEditorMode === "json" ? "primary" : "default",
                                  onClick: () => switchOpenCodeEditorMode("json"),
                                  children: "JSON",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children:
                            "模型/Provider 配置: ~/.opencode/config.json；全局 MCP 配置: ${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json；不使用 ~/.opencode/.env",
                        }),
                        openCodeVisualError
                          ? be.jsx("div", {
                              style: {
                                marginBottom: "5px",
                                padding: "4px 5px",
                                border: "1px solid var(--error-color)",
                                borderRadius: "6px",
                                color: "var(--error-color)",
                              },
                              children: openCodeVisualError,
                            })
                          : null,
                        openCodeEditorMode === "visual"
                          ? renderOpenCodeVisualEditor()
                          : be.jsxs(be.Fragment, {
                              children: [
                                be.jsx("div", {
                                  style: {
                                    marginBottom: "4px",
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                    lineHeight: 1.5,
                                  },
                                  children:
                                    "高级 JSON 模式会保留所有 OpenCode 字段；修改完成后可切回可视化，JSON 无效时不会覆盖当前可视化状态。",
                                }),
                                be.jsx(Qa, {
                                  value: l,
                                  onChange: (W) => (s(W.target.value), setOpenCodeVisualError("")),
                                  placeholder: "请输入 JSON 配置",
                                  rows: 18,
                                  style: {
                                    flex: 1,
                                    minHeight: 420,
                                    fontFamily: "monospace",
                                    fontSize: "13px",
                                  },
                                }),
                              ],
                            }),
                      ],
                    }),
                    !1 && be.jsxs("div", {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " Skills"],
                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "4px" },
                              children: [
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!0),
                                  disabled: C.length === 0,
                                  children: "一键启用",
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!1),
                                  disabled: C.length === 0,
                                  children: "一键禁用",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: j
                            ? "技能列表加载中..."
                            : `已启用 ${Q} / ${C.length}`,
                        }),
                        be.jsx("div", {
                          style: {
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "4px",
                            background: "var(--background-color-secondary)",
                          },
                          children:
                            C.length === 0
                              ? be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children: "未检测到 Skills，请先安装到 ~/.opencode/skills 或工作区 .opencode/skills",
                                })
                              : C.map((W) =>
                                  be.jsx(
                                    "label",
                                    {
                                      style: {
                                        display: "flex",
                                        gap: "5px",
                                        padding: "4px",
                                        borderRadius: "6px",
                                        background: "var(--background-color)",
                                        border: "1px solid var(--border-color)",
                                        marginBottom: "4px",
                                      },
                                      children: be.jsxs("div", {
                                        style: { display: "flex", gap: "4px", width: "100%" },
                                        children: [
                                          be.jsx("input", {
                                            type: "checkbox",
                                            checked: W.enabled !== !1,
                                            onChange: (H) => J(W.name, H.target.checked, W.path),
                                          }),
                                          be.jsxs("div", {
                                            style: {
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: "1px",
                                              flex: 1,
                                            },
                                            children: [
                                              be.jsx("div", { children: W.name }),
                                              be.jsx("div", {
                                                style: {
                                                  fontSize: "11px",
                                                  color: "var(--text-color-secondary)",
                                                  wordBreak: "break-all",
                                                },
                                                children: W.path,
                                              }),
                                              W.description
                                                ? be.jsx("div", {
                                                    style: {
                                                      fontSize: "11px",
                                                      color: "var(--text-color-secondary)",
                                                    },
                                                    children: W.description,
                                                  })
                                                : null,
                                            ],
                                          }),
                                        ],
                                      }),
                                    },
                                    W.name,
                                  ),
                                ),
                        }),
                      ],
                    }),
                  ],
                }),
                be.jsx(xr, {
                  title: "MCP 市场",
                  open: $,
                  onCancel: () => w(!1),
                  width: 1e3,
                  footer: null,
                  destroyOnClose: !0,
                  children: be.jsx(jv, {
                    onAdd: P,
                    onRemove: U,
                    onCheckHealth: () => checkMcpHealth(t),
                    installedIds: R,
                    platform: t,
                    healthItems: mcpHealthItems,
                    healthLoading: mcpHealthLoading,
                    addingId: installingMcpId,
                    removingId: removingMcpId,
                  }),
                }),
                be.jsx(McpInstallEnvModal, {
                  open: installEnvModalOpen,
                  item: pendingInstallMcpItem,
                  envValues: installEnvDraft,
                  onChange: V0,
                  onClose: () => {
                    setInstallEnvModalOpen(!1), setPendingInstallMcpItem(null), setInstallEnvDraft({});
                  },
                  onConfirm: Q0,
                  loading: !!installingMcpId,
                }),
                be.jsx(McpHealthDetailModal, {
                open: !!healthDetailState,
                item: healthDetailState?.item || null,
                health: healthDetailState?.health || null,
                onClose: () => setHealthDetailState(null),
              }),
              be.jsx(SkillsManagerModal, {
                  open: skillsModalOpen,
                  onClose: () => setSkillsModalOpen(!1),
                  platform: O.platform,
                  skills: C,
                  enabledCount: Q,
                  loading: j,
                  onToggle: J,
                  onToggleAll: K,
                  officialSkills,
                  officialLoading: officialSkillsLoading,
                  onInstallOfficialSkill: X0,
                  onUninstallOfficialSkill: ne,
                  onUpdateOfficialSkill: ee,
                  pendingOfficialSkillAction: officialSkillActionId ? { skillId: officialSkillActionId, action: officialSkillActionType } : null,
                }),
                B(),
              ],
            })
          : be.jsxs("div", {
              className: "config-editor-shell config-editor-codex",
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "8px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: `编辑配置: ${O.name}`,
                  extra: be.jsxs("div", {
                    style: { display: "flex", gap: "4px" },
                    children: [
                      be.jsx(xn, {
                        onClick: () => w(!0),
                        children: "MCP(全局)",
                      }),
	                    be.jsx(xn, {
	                      onClick: () => setSkillsModalOpen(!0),
	                      children: "Skills",
	                    }),
	                    be.jsx(xn, {
	                      type: "primary",
	                      icon: be.jsx(Pv, {}),
	                      onClick: saveCodexConfigCard,
	                      children: "保存",
	                    }),
	                    ],
	                  }),
                  style: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  },
                  bodyStyle: {
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px",
                    gap: "8px",
                    overflow: "auto",
                    minHeight: 0,
                  },
                  children: [
                    be.jsxs("div", {
                      style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "6px",
                      },
                      children: [
                        be.jsxs("div", {
                          style: { display: "flex", flexDirection: "column", gap: "2px" },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
                              children: [
                                be.jsxs("strong", { children: [be.jsx(Ya, {}), " config.toml / .env"] }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-config"),
                                  children: "查看范例",
                                }),
                              ],
                            }),
                            be.jsx("span", {
                              style: {
                                color: "var(--text-color-secondary)",
                                fontSize: "12px",
                                lineHeight: 1.5,
                              },
                              children:
                                "主配置: ~/.codex/config.toml；密钥: ~/.codex/.env；auth.json 保持兼容显示，不是主配置。",
                            }),
                          ],
                        }),
                        be.jsxs("div", {
                          style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" },
                          children: [
                            be.jsx(xn, {
                              size: "small",
                              type: codexEditorMode === "visual" ? "primary" : "default",
                              onClick: () => switchCodexEditorMode("visual"),
                              children: "可视化",
                            }),
                            be.jsx(xn, {
                              size: "small",
                              type: codexEditorMode === "toml" ? "primary" : "default",
                              onClick: () => switchCodexEditorMode("toml"),
                              children: "TOML 源码",
                            }),
                          ],
                        }),
                      ],
                    }),
                    codexVisualError
                      ? be.jsx("div", {
                          style: {
                            padding: "8px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            color: "var(--error-color)",
                          },
                          children: codexVisualError,
                        })
                      : null,
                    codexEditorMode === "visual" ? renderCodexVisualEditor() : null,
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: codexEditorMode === "toml" ? "flex" : "none",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", {
                                  children: [be.jsx(Ya, {}), " config.toml"],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-config"),
                                  children: "查看范例",
                                }),
                              ],
	                            }),
	                          ],
	                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.codex/config.toml",
                        }),
                        be.jsx(Qa, {
                          value: m,
                          onChange: (W) => v(W.target.value),
                          placeholder: "请输入TOML配置",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: codexEditorMode === "toml" ? "flex" : "none",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", {
                                  children: [be.jsx(Ya, {}), " .env"],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-env"),
                                  children: "查看范例",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.codex/.env",
                        }),
                        be.jsx(Qa, {
                          value: b,
                          onChange: (W) => (x(W.target.value), setCodexVisualError("")),
                          placeholder: "请输入 .env 配置",
                          rows: 8,
                          style: {
                            flex: 1,
                            minHeight: 180,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
                        }),
                      ],
                    }),
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: codexEditorMode === "toml" ? "flex" : "none",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("div", {
                              style: { display: "flex", alignItems: "center", gap: 4 },
                              children: [
                                be.jsxs("span", {
                                  children: [be.jsx(Ya, {}), " auth.json"],
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => N("codex-auth"),
                                  children: "查看范例",
                                }),
                              ],
	                            }),
	                          ],
	                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.codex/auth.json",
                        }),
                        be.jsx(Qa, {
                          value: p,
                          onChange: (W) => h(W.target.value),
                          placeholder: "请输入JSON配置",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
                        }),
                      ],
                    }),
                    !1 && be.jsxs("div", {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "4px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " Skills"],
                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "4px" },
                              children: [
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!0),
                                  disabled: C.length === 0,
                                  children: "一键启用",
                                }),
                                be.jsx(xn, {
                                  size: "small",
                                  onClick: () => K(!1),
                                  disabled: C.length === 0,
                                  children: "一键禁用",
                                }),
                              ],
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "4px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: j
                            ? "技能列表加载中..."
                            : `已启用 ${Q} / ${C.length}`,
                        }),
                        be.jsx("div", {
                          style: {
                            border: "1px solid var(--border-color)",
                            borderRadius: "6px",
                            padding: "4px",
                            background: "var(--background-color-secondary)",
                          },
                          children:
                            C.length === 0
                              ? be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children: "未检测到 Skills，请先安装到 ~/.agents/skills 或工作区 .codex/skills",
                                })
                              : C.map((W) =>
                                  be.jsx(
                                    "label",
                                    {
                                      style: {
                                        display: "flex",
                                        gap: "5px",
                                        padding: "4px",
                                        borderRadius: "6px",
                                        background: "var(--background-color)",
                                        border: "1px solid var(--border-color)",
                                        marginBottom: "4px",
                                      },
                                      children: be.jsxs("div", {
                                        style: { display: "flex", gap: "4px", width: "100%" },
                                        children: [
                                          be.jsx("input", {
                                            type: "checkbox",
                                            checked: W.enabled !== !1,
                                            onChange: (H) => J(W.name, H.target.checked, W.path),
                                          }),
                                          be.jsxs("div", {
                                            style: {
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: "1px",
                                              flex: 1,
                                            },
                                            children: [
                                              be.jsx("div", { children: W.name }),
                                              be.jsx("div", {
                                                style: {
                                                  color: "var(--text-color-secondary)",
                                                  fontSize: "12px",
                                                },
                                                children: W.path,
                                              }),
                                              W.description &&
                                                be.jsx("div", {
                                                  style: {
                                                    color: "var(--text-color-secondary)",
                                                    fontSize: "12px",
                                                  },
                                                  children: W.description,
                                                }),
                                            ],
                                          }),
                                        ],
                                      }),
                                    },
                                    W.name,
                                  ),
                                ),
                        }),
                      ],
                    }),
                  ],
                }),
                be.jsx(xr, {
                  title: "MCP 市场",
                  open: $,
                  onCancel: () => w(!1),
                  width: 1e3,
                  footer: null,
                  destroyOnClose: !0,
                  children: be.jsx(jv, {
                    onAdd: P,
                    onRemove: U,
                    onCheckHealth: () => checkMcpHealth(t),
                    installedIds: R,
                    platform: t,
                    healthItems: mcpHealthItems,
                    healthLoading: mcpHealthLoading,
                    addingId: installingMcpId,
                    removingId: removingMcpId,
                  }),
                }),
                be.jsx(McpInstallEnvModal, {
                  open: installEnvModalOpen,
                  item: pendingInstallMcpItem,
                  envValues: installEnvDraft,
                  onChange: V0,
                  onClose: () => {
                    setInstallEnvModalOpen(!1), setPendingInstallMcpItem(null), setInstallEnvDraft({});
                  },
                  onConfirm: Q0,
                  loading: !!installingMcpId,
                }),
                be.jsx(McpHealthDetailModal, {
                open: !!healthDetailState,
                item: healthDetailState?.item || null,
                health: healthDetailState?.health || null,
                onClose: () => setHealthDetailState(null),
              }),
              be.jsx(SkillsManagerModal, {
                  open: skillsModalOpen,
                  onClose: () => setSkillsModalOpen(!1),
                  platform: O.platform,
                  skills: C,
                  enabledCount: Q,
                  loading: j,
                  onToggle: J,
                  onToggleAll: K,
                  officialSkills,
                  officialLoading: officialSkillsLoading,
                  onInstallOfficialSkill: X0,
                  onUninstallOfficialSkill: ne,
                  onUpdateOfficialSkill: ee,
                  pendingOfficialSkillAction: officialSkillActionId ? { skillId: officialSkillActionId, action: officialSkillActionType } : null,
                }),
                B(),
              ],
            })
      : be.jsx("div", {
          className: "config-empty-state",
          style: {
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-color-secondary)",
          },
          children: "请从左侧选择一个配置",
        });
  };

const { Header: jk, Sider: zk, Content: Lk } = Li;

const CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY = "(max-width: 920px)";

const shouldOpenConfigMobileNavigationInitially = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia(CONFIG_MOBILE_NAVIGATION_MEDIA_QUERY).matches;

// Config manager layout
const ConfigManagerLayout = () => {
    const { loadConfigs: e, initDefaultConfigs: t } = useConfigStore(),
      [mobileNavigationOpen, setMobileNavigationOpen] = c.useState(
        shouldOpenConfigMobileNavigationInitially,
      ),
      closeMobileNavigation = () => setMobileNavigationOpen(!1);

    c.useEffect(() => {
      (async () => {
        (await e(), await t(), await e());
      })();
    }, [e, t]);

    c.useEffect(() => {
      if (!mobileNavigationOpen) return;
      const handleKeyDown = (event) => {
        event.key === "Escape" && closeMobileNavigation();
      };
      return (
        window.addEventListener("keydown", handleKeyDown),
        () => window.removeEventListener("keydown", handleKeyDown)
      );
    }, [mobileNavigationOpen]);

    return be.jsxs(Li, {
      className: "config-app-theme",
      style: { height: "100vh" },
      children: [
        be.jsxs(jk, {
          className: "config-app-header",
          style: {
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
          },
          children: [
            be.jsx("button", {
              type: "button",
              className: "config-mobile-directory-button",
              "aria-label": "打开配置目录",
              "aria-controls": "config-directory-panel",
              "aria-expanded": mobileNavigationOpen,
              onClick: () => setMobileNavigationOpen(!0),
              children: be.jsxs("span", {
                className: "config-mobile-directory-icon",
                "aria-hidden": "true",
                children: [be.jsx("span", {}), be.jsx("span", {}), be.jsx("span", {})],
              }),
            }),
            be.jsx("h2", {
              className: "config-app-title",
              style: {
                margin: 0,
              },
              children: "携宁 CLI 配置",
            }),
          ],
        }),
        be.jsxs(Li, {
          className: "config-app-workspace",
          children: [
            mobileNavigationOpen &&
              be.jsx("button", {
                type: "button",
                className: "config-mobile-sidebar-backdrop",
                "aria-label": "关闭配置目录",
                onClick: closeMobileNavigation,
              }),
            be.jsx(zk, {
              id: "config-directory-panel",
              className: mobileNavigationOpen
                ? "config-app-sidebar config-app-sidebar-open"
                : "config-app-sidebar",
              width: 500,
              style: {
                background: "var(--bg-color-container)",
                borderRight: "1px solid var(--border-color)",
              },
              children: be.jsx(ConfigListPanel, {
                onMobileClose: closeMobileNavigation,
              }),
            }),
            be.jsx(Lk, {
              className: "config-app-content",
              style: { background: "var(--bg-color)" },
              children: be.jsx(ConfigEditorPanel, {}),
            }),
          ],
        }),
      ],
    });
  };

const configClayPalette = {
  canvas: "#faf9f7",
  surface: "#ffffff",
  border: "#dad4c8",
  borderSoft: "#eee9df",
  text: "#000000",
  textSecondary: "#55534e",
  textMuted: "#9f9b93",
  success: "#078a52",
  warning: "#d08a11",
  error: "#c94d58",
  info: "#01418d",
  focus: "#146ef5",
};

const configClayTheme = {
  ...ZB,
  token: {
    ...(ZB.token || {}),
    colorPrimary: configClayPalette.text,
    colorPrimaryHover: configClayPalette.textSecondary,
    colorPrimaryActive: configClayPalette.text,
    colorInfo: configClayPalette.info,
    colorSuccess: configClayPalette.success,
    colorWarning: configClayPalette.warning,
    colorError: configClayPalette.error,
    colorText: configClayPalette.text,
    colorTextSecondary: configClayPalette.textSecondary,
    colorTextTertiary: configClayPalette.textMuted,
    colorTextQuaternary: configClayPalette.textMuted,
    colorTextDisabled: configClayPalette.textMuted,
    colorTextLightSolid: configClayPalette.surface,
    colorBgBase: configClayPalette.canvas,
    colorBgContainer: configClayPalette.surface,
    colorBgElevated: configClayPalette.surface,
    colorBgLayout: configClayPalette.canvas,
    colorFill: configClayPalette.borderSoft,
    colorFillSecondary: configClayPalette.borderSoft,
    colorFillTertiary: configClayPalette.canvas,
    colorFillQuaternary: configClayPalette.canvas,
    colorBorder: configClayPalette.border,
    colorBorderSecondary: configClayPalette.borderSoft,
    colorLink: configClayPalette.text,
    colorLinkHover: configClayPalette.info,
    colorLinkActive: configClayPalette.text,
    controlOutline: configClayPalette.focus,
    borderRadius: 12,
    borderRadiusLG: 24,
    borderRadiusSM: 8,
    boxShadow: "0 1px 1px rgba(0, 0, 0, 0.1), 0 -1px 1px rgba(0, 0, 0, 0.04) inset, 0 -0.5px 1px rgba(0, 0, 0, 0.05)",
    boxShadowSecondary: "0 18px 48px rgba(0, 0, 0, 0.16)",
    fontFamily: '"DM Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    ...(ZB.components || {}),
    Button: {
      ...(ZB.components?.Button || {}),
      defaultBg: configClayPalette.surface,
      defaultColor: configClayPalette.text,
      defaultBorderColor: configClayPalette.border,
      defaultHoverBg: configClayPalette.text,
      defaultHoverColor: configClayPalette.surface,
      defaultHoverBorderColor: configClayPalette.text,
      primaryColor: configClayPalette.surface,
      dangerColor: configClayPalette.error,
      dangerBorderColor: configClayPalette.error,
      dangerBg: configClayPalette.surface,
      primaryShadow: "none",
      dangerShadow: "none",
      borderRadius: 12,
      controlHeight: 36,
    },
    Card: {
      ...(ZB.components?.Card || {}),
      headerBg: configClayPalette.surface,
      colorBorderSecondary: configClayPalette.borderSoft,
    },
    Form: {
      ...(ZB.components?.Form || {}),
      labelColor: configClayPalette.text,
    },
    Input: {
      ...(ZB.components?.Input || {}),
      activeBorderColor: configClayPalette.text,
      hoverBorderColor: configClayPalette.text,
      activeShadow: `0 0 0 2px ${configClayPalette.focus}24`,
    },
    Layout: {
      ...(ZB.components?.Layout || {}),
      headerBg: configClayPalette.canvas,
      siderBg: configClayPalette.surface,
      bodyBg: configClayPalette.canvas,
      triggerBg: configClayPalette.text,
      triggerColor: configClayPalette.surface,
    },
    Modal: {
      ...(ZB.components?.Modal || {}),
      headerBg: configClayPalette.surface,
      contentBg: configClayPalette.surface,
      titleColor: configClayPalette.text,
      borderRadiusLG: 24,
    },
    Drawer: {
      ...(ZB.components?.Drawer || {}),
      colorBgElevated: configClayPalette.surface,
    },
    Table: {
      ...(ZB.components?.Table || {}),
      headerBg: configClayPalette.borderSoft,
      headerColor: configClayPalette.text,
      rowHoverBg: configClayPalette.canvas,
    },
    Tree: {
      ...(ZB.components?.Tree || {}),
      nodeHoverBg: configClayPalette.canvas,
      nodeSelectedBg: configClayPalette.text,
      nodeSelectedColor: configClayPalette.surface,
    },
    Tabs: {
      ...(ZB.components?.Tabs || {}),
      inkBarColor: configClayPalette.text,
      itemActiveColor: configClayPalette.text,
      itemHoverColor: configClayPalette.text,
      itemSelectedColor: configClayPalette.text,
    },
  },
};

// App root
const ConfigAppRoot = () =>
    be.jsx(Do, {
      locale: BB,
      theme: configClayTheme,
      children: be.jsx(l$, {
        children: be.jsx(iP, {
          children: be.jsxs(LR, {
            children: [
              be.jsx(wu, {
                path: "/",
                element: be.jsx(Wy, { to: "/config", replace: !0 }),
              }),
              be.jsx(wu, { path: "/config", element: be.jsx(ConfigManagerLayout, {}) }),
              be.jsx(wu, {
                path: "*",
                element: be.jsx(Wy, { to: "/config", replace: !0 }),
              }),
            ],
          }),
        }),
      }),
    });
G2.createRoot(document.getElementById("root")).render(
  be.jsx(ee.StrictMode, { children: be.jsx(ConfigAppRoot, {}) }),
);
