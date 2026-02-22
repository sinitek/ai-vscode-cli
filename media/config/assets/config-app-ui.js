// Icons
const GH = (e, t) => c.createElement(Qr, ip({}, e, { ref: t, icon: UH })),
  KH = c.forwardRef(GH);

const DEFAULT_RUN_COMMANDS = {
    claude: "claude --dangerously-skip-permissions",
    codex: "codex --dangerously-bypass-approvals-and-sandbox",
    gemini: "gemini -y",
  };

const DEFAULT_INSTALL_COMMANDS = {
    claude: "npm install -g @anthropic-ai/claude-code",
    codex: "npm i -g @openai/codex",
    gemini: "npm install -g @google/gemini-cli",
  };

const { confirm: uk } = xr;

// Config list panel
const ConfigListPanel = () => {
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
      O = c.useMemo(() => e.filter((k) => k.platform === "gemini"), [e]),
      exportSelectedCount = c.useMemo(
        () => e.reduce((k, L) => k + (exportSelection[L.id] ? 1 : 0), 0),
        [e, exportSelection],
      ),
      exportAllChecked = e.length > 0 && exportSelectedCount === e.length,
      exportAnySelected = exportSelectedCount > 0,
      I = (k) => {
        const L =
          k === "claude" ? "Claude" : k === "codex" ? "Codex" : "Gemini";
        xr.confirm({
          title: `添加${L}配置`,
          content: be.jsx(zi, {
            id: "config-name-input",
            placeholder: "请输入配置名称",
            defaultValue: `${L} 配置 ${Date.now()}`,
          }),
          okButtonProps: {
            style: { backgroundColor: "#1f1f1f", borderColor: "#1f1f1f" },
          },
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
                  }))
                : k === "gemini"
                  ? (T = await l({
                      name: U,
                      platform: k,
                      content: "{}",
                      envContent: "",
                    }))
                  : (T = await l({
                      name: U,
                      platform: k,
                      configContent: "",
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
                })
              : L.platform === "gemini"
                ? await applyConfigItem(L.platform, {
                    content: L.content,
                    envContent: L.envContent ?? "",
                  })
                : await applyConfigItem(L.platform, {
                    configContent: L.configContent,
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
            okButtonProps: {
              style: {
                backgroundColor: "#ff4d4f",
                borderColor: "#ff4d4f",
                color: "#fff",
              },
            },
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
        try {
          const G = await f(L.id);
          (o(G.id, G.platform), Kt.success(`已复制配置: ${G.name}`));
        } catch (G) {
          Kt.error(`复制失败: ${G}`);
        }
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
            okButtonProps: {
              style: { backgroundColor: "#1f1f1f", borderColor: "#1f1f1f" },
            },
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
            envContent: G.envContent,
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
        if (L === "gemini") {
          return {
            name: G,
            platform: L,
            content: k.content ?? "{}",
            envContent: k.envContent ?? "",
          };
        }
        if (L === "codex") {
          return {
            name: G,
            platform: L,
            configContent: k.configContent ?? "",
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
            k === "claude" ? "Claude" : k === "codex" ? "Codex" : "Gemini",
          U = DEFAULT_RUN_COMMANDS[k],
          T = DEFAULT_INSTALL_COMMANDS[k];
        return be.jsx(aa, {
          title: be.jsx("div", {
            style: { display: "flex", flexDirection: "column", gap: 4 },
            children: be.jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 8 },
              children: [
                be.jsx("span", { children: G }),
                be.jsxs($s, {
                  size: 4,
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
          headStyle: { paddingLeft: "8px", paddingRight: "8px" },
          bodyStyle: { paddingLeft: "8px", paddingRight: "8px" },
          style: { marginBottom: "16px" },
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
                  className: "config-list-item",
                  draggable: !0,
                  onClick: () => o(F.id, F.platform),
                  onDragStart: () => _(F.id),
                  onDragOver: (ae) => {
                    (ae.stopPropagation(), N(ae, F.id));
                  },
                  onDragEnd: M,
                  onDrop: (ae) => z(ae, k, F.id),
                  style: {
                    cursor: "pointer",
                    backgroundColor: K ? "rgba(31, 31, 31, 0.08)" : void 0,
                    padding: "0",
                    borderRadius: "6px",
                    transition: "all 0.2s ease-in-out",
                    border: J
                      ? "1px dashed var(--border-color)"
                      : "1px solid transparent",
                  },
                  extra: be.jsxs($s, {
                    size: 8,
                    children: [
                      be.jsx(xn, {
                        type: "default",
                        size: "small",
                        icon: be.jsx(KH, {}),
                        loading: Q,
                        onClick: (ae) => B(ae, F),
                        style: Y
                          ? {
                              backgroundColor: "#52c41a",
                              borderColor: "#52c41a",
                              color: "#fff",
                            }
                          : void 0,
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
                        style: { fontWeight: K ? 500 : 400, color: "#1f1f1f" },
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
      style: { height: "100%", padding: "8px", overflow: "auto" },
      children: [
        be.jsxs("div", {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            marginBottom: "8px",
          },
          children: [
            be.jsx(xn, { size: "small", onClick: openExportModal, children: "导出" }),
            be.jsx(xn, { size: "small", onClick: openImportModal, children: "导入" }),
          ],
        }),
        H("claude", $),
        H("codex", w),
        H("gemini", O),
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
                                            : "Gemini",
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
                                        : "Gemini",
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
const { Paragraph: p1, Text: _k, Title: Mk } = lc,
  jv = ({ onAdd: e, installedIds: t = [] }) => {
    const [n, r] = c.useState(!1),
      [o, l] = c.useState([]),
      s = c.useMemo(
        () => ({
          id: "zai-mcp-server",
          name: "Zhipu 图片识别",
          description: "调用智谱通用图像理解能力进行图片内容识别。",
          homepage: "https://www.zhipuai.cn/",
          category: "AI与智能",
          config: {
            command: "npx",
            args: ["-y", "@z_ai/mcp-server"],
            env: { Z_AI_API_KEY: "<YOUR_API_KEY>", Z_AI_MODE: "ZHIPU" },
          },
        }),
        [],
      );
    c.useEffect(() => {
      u();
    }, []);
    const u = async () => {
        r(!0);
        try {
          const p = await fetchMcpMarketplaceList(),
            h = p.some((b) => b.id === s.id);
          l(h ? p : [...p, s]);
        } catch {
          Kt.error("加载 MCP 市场数据失败");
        } finally {
          r(!1);
        }
      },
      f = c.useMemo(() => {
        const p = Array.from(new Set(o.map((b) => b.category || "其他"))),
          h = [
            "AI与智能",
            "文件与数据",
            "开发工具",
            "基础设施",
            "网络与浏览器",
            "生产力工具",
            "其他",
          ];
        return p.sort((b, x) => {
          const S = h.indexOf(b),
            y = h.indexOf(x);
          return S !== -1 && y !== -1
            ? S - y
            : S !== -1
              ? -1
              : y !== -1
                ? 1
                : b.localeCompare(x);
        });
      }, [o]),
      m = c.useMemo(() => {
        const p = {};
        return (
          o.forEach((h) => {
            const b = h.category || "其他";
            (p[b] || (p[b] = []), p[b].push(h));
          }),
          p
        );
      }, [o]);
    if (n && o.length === 0)
      return be.jsx("div", {
        style: { textAlign: "center", padding: "50px" },
        children: be.jsx(oh, { size: "large" }),
      });
    const v = f.map((p) => ({
      key: p,
      label: p,
      children: be.jsx(Bs, {
        grid: { gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3, xxl: 3 },
        dataSource: m[p],
        renderItem: (h) =>
          be.jsx(Bs.Item, {
            children: be.jsx(aa, {
              title: be.jsx($s, { children: h.name }),
              extra: t.includes(h.id)
                ? be.jsx(Wg, { color: "success", children: "已添加" })
                : be.jsx(xn, {
                    type: "primary",
                    size: "small",
                    icon: be.jsx(oO, {}),
                    onClick: () => e(h),
                    children: "添加",
                  }),
              size: "small",
              children: be.jsxs("div", {
                style: {
                  height: "120px",
                  display: "flex",
                  flexDirection: "column",
                },
                children: [
                  be.jsx(p1, {
                    ellipsis: { rows: 2 },
                    style: { marginBottom: "8px" },
                    children: h.description,
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
                          h.config.command
                            ? `${h.config.command}${h.config.args?.[0] ? ` ${h.config.args[0]}` : ""}`
                            : h.config.type && h.config.url
                              ? `${h.config.type} ${h.config.url}`
                              : "配置未填写",
                        ],
                      }),
                      h.config.env &&
                        be.jsx(Wg, {
                          color: "blue",
                          style: { fontSize: "10px", lineHeight: "18px" },
                          children: "需配置环境变量",
                        }),
                    ],
                  }),
                ],
              }),
            }),
          }),
      }),
    }));
    return be.jsxs("div", {
      style: { padding: "0 16px 16px 16px" },
      children: [
        be.jsxs("div", {
          style: { marginBottom: "16px" },
          children: [
            be.jsx(Mk, { level: 4, children: "MCP 市场" }),
            be.jsx(p1, {
              type: "secondary",
              children:
                "发现并添加常用的 Model Context Protocol (MCP) 服务器到您的配置中。",
            }),
          ],
        }),
        be.jsx(nh, { defaultActiveKey: f[0], items: v }),
      ],
    });
  };

const { TextArea: Qa } = zi;
const ps = {
    claude: {
      settings: `{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<你的 api key>",
    "ANTHROPIC_BASE_URL": "<供应商 url>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5-20251001",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-sonnet-4-5-20250929",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-20250929"
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

[model_providers.codex]
name = "codex"
base_url = "<供应商 url>"
wire_api = "responses"
requires_openai_auth = true`,
      auth: `{
  "OPENAI_API_KEY": "<你的 api key>"
}`,
    },
    gemini: {
      settings: `{
  "ide": {
    "enabled": true
  },
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  },
  "context": {
    "fileName": [
      "AGENT.md"
    ]
  },
  "general": {
    "previewFeatures": true
  }
}`,
      env: `GOOGLE_GEMINI_BASE_URL=<供应商 url>
GEMINI_API_KEY=<你的 api key>
GEMINI_MODEL=gemini-3-pro-preview`,
    },
  };

const Nk = {
    "claude-settings": {
      title: "Claude settings.json",
      content: ps.claude.settings,
    },
    "gemini-settings": {
      title: "Gemini settings.json",
      content: ps.gemini.settings,
    },
    "gemini-env": { title: "Gemini .env", content: ps.gemini.env },
    "codex-config": { title: "Codex config.toml", content: ps.codex.config },
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
      [C, Z] = c.useState([]),
      [j, q] = c.useState(!1),
      [S, y] = c.useState(null),
      [$, w] = c.useState(!1),
      O = e ? n(e, t || void 0) : null,
      I = S ? Nk[S] : null,
      R = c.useMemo(() => {
        if (t === "codex" && Array.isArray(codexMcpServerIds) && codexMcpServerIds.length > 0)
          return codexMcpServerIds;
        if (t === "codex") {
          try {
            const H = g1(m || "");
            if (H && H.mcp_servers) return Object.keys(H.mcp_servers);
          } catch {}
          return [];
        }
        const W = t === "claude" ? u : l;
        try {
          const H = JSON.parse(W || "{}");
          if (H && H.mcpServers) return Object.keys(H.mcpServers);
        } catch {}
        return [];
      }, [l, u, m, t, codexMcpServerIds]),
      P = async (W) => {
        try {
          if (t === "codex") {
            const U = await installCodexMcpById(W.id);
            const T = Array.isArray(U?.warnings) ? U.warnings : [];
            T.forEach((k) => Kt.warning(k));
            try {
              const k = await fetchCurrentConfig("codex");
              k?.configContent !== void 0 && v(k.configContent);
              k?.authContent !== void 0 && h(k.authContent);
            } catch (k) {
              console.error("刷新 Codex 配置失败:", k);
            }
            try {
              const k = await fetchCodexMcpServerIds();
              Array.isArray(k) && setCodexMcpServerIds(k);
            } catch (k) {
              console.error("刷新 Codex MCP 列表失败:", k);
            }
            Kt.success(`已安装 MCP: ${W.name}`);
            return;
          }
          const k = (t === "claude" ? u : l) || "{}";
          let L;
          try {
            L = JSON.parse(k);
          } catch {
            if (!k.trim()) L = {};
            else {
              Kt.error("当前配置不是有效的 JSON，无法自动添加 MCP");
              return;
            }
          }
          (L.mcpServers || (L.mcpServers = {}),
            L.mcpServers[W.id] &&
              Kt.warning(`MCP Server ${W.id} 已存在，将被覆盖`),
            (L.mcpServers[W.id] = W.config));
          const G = JSON.stringify(L, null, 2);
          (t === "claude" ? f(G) : s(G), Kt.success(`已添加 MCP: ${W.name}`));
        } catch (H) {
          console.error("添加 MCP 失败:", H),
            Kt.error(t === "codex" ? "安装 MCP 失败" : "添加 MCP 失败");
        }
      };
    c.useEffect(() => {
      if (!O) {
        (s(""), f(""), x(""), v(""), h(""), Z([]), setCodexMcpServerIds([]));
        return;
      }
      O.platform === "claude"
        ? (s(O.content || "{}"), f(O.mcpContent || "{}"), x(""), v(""), h(""))
        : O.platform === "gemini"
          ? (s(O.content || "{}"), x(O.envContent || ""), v(""), h(""))
          : (v(O.configContent || ""), h(O.authContent || "{}"), s(""), x(""));
    }, [O]);
    c.useEffect(() => {
      let W = !1;
      if (!O || O.platform !== "codex") {
        setCodexMcpServerIds([]);
        return;
      }
      (async () => {
        try {
          const H = await fetchCodexMcpServerIds();
          W || setCodexMcpServerIds(Array.isArray(H) ? H : []);
        } catch (H) {
          (console.error("获取 Codex MCP 列表失败:", H), W || setCodexMcpServerIds([]));
        }
      })();
      return () => {
        W = !0;
      };
    }, [O]);
    const G = c.useCallback((W, H) => {
      const k = new Map();
      (Array.isArray(H) ? H : []).forEach((L) => {
        if (L && L.name) k.set(L.name, L);
      });
      return (Array.isArray(W) ? W : []).map((L) => {
        const U = k.get(L.name);
        return {
          name: L.name,
          path: L.path,
          description: L.description,
          enabled: U ? U.enabled !== !1 : !1,
        };
      });
    }, []);
    c.useEffect(() => {
      let W = !1;
      if (!O || O.platform !== "codex") {
        Z([]);
        return;
      }
      (async () => {
        q(!0);
        try {
          const H = await fetchCodexSkillsList();
          if (!W) {
            const k = G(H, O.codexSkills);
            Z(k);
          }
        } catch (H) {
          console.error("获取 Codex Skills 失败:", H);
          Kt.error("获取 Codex Skills 失败");
        } finally {
          W || q(!1);
        }
      })();
      return () => {
        W = !0;
      };
    }, [O, G]);
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
      N = (W) => y(W),
      z = () => y(null),
      D = () => {
        if (!(!I || !S)) {
          switch (S) {
            case "claude-settings":
            case "gemini-settings":
              s(I.content);
              break;
            case "gemini-env":
              x(I.content);
              break;
            case "codex-config":
              v(I.content);
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
                      backgroundColor:
                        "var(--background-color-secondary, #f5f5f5)",
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
      V = async () => {
        if (!O) {
          Kt.warning("请先选择一个配置");
          return;
        }
        if (O.platform === "claude") {
          if (!_(l) || !_(u)) {
            Kt.error("JSON格式不正确");
            return;
          }
          try {
            const W = M(l),
              H = M(u);
            (await r(O.id, { content: W, mcpContent: H }),
              s(W),
              f(H),
              Kt.success("保存成功"),
              await A({ content: W, mcpContent: H }));
          } catch (W) {
            Kt.error("保存失败: " + W);
          }
        } else if (O.platform === "gemini") {
          if (!_(l)) {
            Kt.error("JSON格式不正确");
            return;
          }
          try {
            const W = M(l);
            (await r(O.id, { content: W, envContent: b }),
              s(W),
              Kt.success("保存成功"),
              await A({ content: W, envContent: b }));
          } catch (W) {
            Kt.error("保存失败: " + W);
          }
        } else {
          if (!_(p)) {
            Kt.error("auth.json格式不正确");
            return;
          }
          try {
            const W = M(p);
            (await r(O.id, { configContent: m, authContent: W, codexSkills: C }),
              h(W),
              Kt.success("保存成功"),
              await A({ configContent: m, authContent: W, codexSkills: C }));
          } catch (W) {
            Kt.error("保存失败: " + W);
          }
        }
      };
    const J = async (W, H) => {
        const k = C.map((L) => (L.name === W ? { ...L, enabled: H } : L));
        Z(k);
        try {
          if (O) {
            await r(O.id, { codexSkills: k });
            if (o(O.platform) === O.id) {
              if (!_(p)) {
                Kt.error("auth.json格式不正确");
                return;
              }
              const L = M(p);
              await applyConfigItem("codex", {
                configContent: m,
                authContent: L,
                codexSkills: k,
              });
              const U = await fetchCurrentConfig("codex");
              U?.configContent !== void 0 && v(U.configContent);
              U?.authContent !== void 0 && h(U.authContent);
              Kt.success("已更新当前激活的配置");
            }
          }
        } catch (L) {
          Kt.error("更新技能失败: " + L);
        }
      },
      K = async (W) => {
        const H = C.map((k) => ({ ...k, enabled: W }));
        Z(H);
        try {
          if (O) {
            await r(O.id, { codexSkills: H });
            if (o(O.platform) === O.id) {
              if (!_(p)) {
                Kt.error("auth.json格式不正确");
                return;
              }
              const k = M(p);
              await applyConfigItem("codex", {
                configContent: m,
                authContent: k,
                codexSkills: H,
              });
              const L = await fetchCurrentConfig("codex");
              L?.configContent !== void 0 && v(L.configContent);
              L?.authContent !== void 0 && h(L.authContent);
              Kt.success("已更新当前激活的配置");
            }
          }
        } catch (k) {
          Kt.error("更新技能失败: " + k);
        }
      },
      Q = c.useMemo(() => C.filter((W) => W.enabled !== !1).length, [C]);
    return O
      ? O.platform === "claude"
        ? be.jsxs("div", {
            style: {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              minHeight: 0,
            },
            children: [
              be.jsx(aa, {
                title: `编辑配置: ${O.name}`,
                extra: be.jsxs("div", {
                  style: { display: "flex", gap: "8px" },
                  children: [
                    be.jsx(xn, {
                      icon: be.jsx(Rv, {}),
                      onClick: () => w(!0),
                      children: "MCP 市场",
                    }),
                    be.jsx(xn, {
                      type: "primary",
                      icon: be.jsx(Pv, {}),
                      onClick: V,
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
                    gap: "16px",
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
                            marginBottom: "12px",
                            color: "var(--text-color-secondary)",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                          },
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
                        be.jsx(Qa, {
                          value: l,
                          onChange: (H) => s(H.target.value),
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
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "12px",
                            color: "var(--text-color-secondary)",
                          },
                          children: [
                            be.jsx(Ya, {}),
                            " 配置文件路径: ~/.claude.json（仅 MCP）",
                          ],
                        }),
                        be.jsx(Qa, {
                          value: u,
                          onChange: (H) => f(H.target.value),
                          placeholder: "请输入 MCP 配置（.claude.json）",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
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
                children: be.jsx(jv, { onAdd: P, installedIds: R }),
              }),
              B(),
            ],
          })
        : O.platform === "gemini"
          ? be.jsxs("div", {
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "16px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: `编辑配置: ${O.name}`,
                  extra: be.jsxs("div", {
                    style: { display: "flex", gap: "8px" },
                    children: [
                      be.jsx(xn, {
                        icon: be.jsx(Rv, {}),
                        onClick: () => w(!0),
                        children: "MCP 市场",
                      }),
                      be.jsx(xn, {
                        type: "primary",
                        icon: be.jsx(Pv, {}),
                        onClick: V,
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
                    padding: "16px",
                    gap: "16px",
                    overflow: "auto",
                    minHeight: 0,
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
                            marginBottom: "8px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " settings.json"],
                            }),
                            be.jsx(xn, {
                              size: "small",
                              onClick: () => N("gemini-settings"),
                              children: "查看范例",
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "8px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.gemini/settings.json",
                        }),
                        be.jsx(Qa, {
                          value: l,
                          onChange: (W) => s(W.target.value),
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
                    be.jsxs("div", {
                      style: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "8px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " .env"],
                            }),
                            be.jsx(xn, {
                              size: "small",
                              onClick: () => N("gemini-env"),
                              children: "查看范例",
                            }),
                          ],
                        }),
                        be.jsx("div", {
                          style: {
                            marginBottom: "8px",
                            color: "var(--text-color-secondary)",
                            fontSize: "12px",
                          },
                          children: "配置文件路径: ~/.gemini/.env",
                        }),
                        be.jsx(Qa, {
                          value: b,
                          onChange: (W) => x(W.target.value),
                          placeholder: "请输入 .env 配置",
                          rows: 10,
                          style: {
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "13px",
                          },
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
                  children: be.jsx(jv, { onAdd: P, installedIds: R }),
                }),
                B(),
              ],
            })
          : be.jsxs("div", {
              style: {
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "16px",
                minHeight: 0,
              },
              children: [
                be.jsxs(aa, {
                  title: `编辑配置: ${O.name}`,
                  extra: be.jsxs("div", {
                    style: { display: "flex", gap: "8px" },
                    children: [
                      be.jsx(xn, {
                        icon: be.jsx(Rv, {}),
                        onClick: () => w(!0),
                        children: "MCP 市场",
                      }),
                      be.jsx(xn, {
                        type: "primary",
                        icon: be.jsx(Pv, {}),
                        onClick: V,
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
                    padding: "16px",
                    gap: "16px",
                    overflow: "auto",
                    minHeight: 0,
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
                            marginBottom: "8px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          },
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
                        be.jsx("div", {
                          style: {
                            marginBottom: "8px",
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
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "8px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          },
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
                        be.jsx("div", {
                          style: {
                            marginBottom: "8px",
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
                    be.jsxs("div", {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                      },
                      children: [
                        be.jsxs("div", {
                          style: {
                            marginBottom: "8px",
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            justifyContent: "space-between",
                          },
                          children: [
                            be.jsxs("span", {
                              children: [be.jsx(Ya, {}), " Skills"],
                            }),
                            be.jsxs("div", {
                              style: { display: "flex", gap: "8px" },
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
                            marginBottom: "8px",
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
                            padding: "8px",
                            background:
                              "var(--background-color-secondary, #f5f5f5)",
                          },
                          children:
                            C.length === 0
                              ? be.jsx("div", {
                                  style: {
                                    color: "var(--text-color-secondary)",
                                    fontSize: "12px",
                                  },
                                  children: "未检测到 Skills，请先安装到 ~/.codex/skills",
                                })
                              : C.map((W) =>
                                  be.jsx(
                                    "label",
                                    {
                                      style: {
                                        display: "flex",
                                        gap: "10px",
                                        padding: "8px",
                                        borderRadius: "6px",
                                        background: "var(--background-color)",
                                        border: "1px solid var(--border-color)",
                                        marginBottom: "8px",
                                      },
                                      children: be.jsxs("div", {
                                        style: { display: "flex", gap: "8px", width: "100%" },
                                        children: [
                                          be.jsx("input", {
                                            type: "checkbox",
                                            checked: W.enabled !== !1,
                                            onChange: (H) => J(W.name, H.target.checked),
                                          }),
                                          be.jsxs("div", {
                                            style: {
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: "2px",
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
                  children: be.jsx(jv, { onAdd: P, installedIds: R }),
                }),
                B(),
              ],
            })
      : be.jsx("div", {
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

// Config manager layout
const ConfigManagerLayout = () => {
    const { loadConfigs: e, initDefaultConfigs: t } = useConfigStore();
    return (
      c.useEffect(() => {
        (async () => {
          (await e(), await t(), await e());
        })();
      }, [e, t]),
      be.jsxs(Li, {
        style: { height: "100vh" },
        children: [
          be.jsx(jk, {
            style: {
              background: "#001529",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              padding: "0 24px",
            },
            children: be.jsx("h2", {
              style: { margin: 0, color: "#fff" },
              children: "携宁 CLI 配置",
            }),
          }),
          be.jsxs(Li, {
            children: [
              be.jsx(zk, {
                width: 500,
                style: {
                  background: "#fff",
                  borderRight: "1px solid var(--border-color)",
                },
                children: be.jsx(ConfigListPanel, {}),
              }),
              be.jsx(Lk, {
                style: { background: "#fff" },
                children: be.jsx(ConfigEditorPanel, {}),
              }),
            ],
          }),
        ],
      })
    );
  };

// App root
const ConfigAppRoot = () =>
    be.jsx(Do, {
      locale: BB,
      theme: ZB,
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
