import { createChatSvgImageSource, normalizeChatImageSource } from "./chatImagePreview";

export const CHAT_MARKDOWN_SCRIPT = `
      ${createChatSvgImageSource.toString()}

      ${normalizeChatImageSource.toString()}

      function parseJsonContainerText(text) {
        if (!text || (text[0] !== "{" && text[0] !== "[")) {
          return null;
        }
        try {
          const value = JSON.parse(text);
          if (!value || typeof value !== "object") {
            return null;
          }
          return value;
        } catch (error) {
          return null;
        }
      }

      function unwrapSingleMarkdownFence(content) {
        const trimmed = String(content || "").replace(new RegExp("^" + String.fromCharCode(65279)), "").trim();
        const fence = String.fromCharCode(96);
        const match = trimmed.match(new RegExp("^(" + fence + "{3,}|~{3,})[^\\\\n\\\\r]*\\\\r?\\\\n([\\\\s\\\\S]*?)\\\\r?\\\\n\\\\1[ \\\\t]*$"));
        if (!match) {
          return trimmed;
        }
        return match[2];
      }

      function parseCompleteJsonContainer(content) {
        const trimmed = String(content || "").replace(new RegExp("^" + String.fromCharCode(65279)), "").trim();
        if (!trimmed) {
          return null;
        }
        const direct = parseJsonContainerText(trimmed);
        if (direct) {
          return direct;
        }
        const unwrapped = unwrapSingleMarkdownFence(trimmed);
        if (unwrapped === trimmed) {
          return null;
        }
        return parseJsonContainerText(String(unwrapped || "").trim());
      }

      function serializeJsonTreeSource(value) {
        return JSON.stringify(value)
          .replace(/</g, "\\\\u003c")
          .replace(/>/g, "\\\\u003e")
          .replace(/&/g, "\\\\u0026")
          .replace(new RegExp(String.fromCharCode(8232), "g"), "\\\\u2028")
          .replace(new RegExp(String.fromCharCode(8233), "g"), "\\\\u2029");
      }

      function renderJsonTreeHost(value) {
        return '<div class="json-tree-host"><script type="application/json" class="json-tree-source">' +
          serializeJsonTreeSource(value) +
          "</script></div>";
      }

      function createJsonTreeElement(value) {
        if (typeof JSONFormatter === "function" && typeof document !== "undefined" && document.createElement) {
          try {
            const formatter = new JSONFormatter(value, 2, {
              hoverPreviewEnabled: false,
              hoverPreviewArrayCount: 100,
              hoverPreviewFieldCount: 5,
              animateOpen: true,
              animateClose: true,
              useToJSON: false,
              maxArrayItems: 100,
            });
            return formatter.render();
          } catch {
          }
        }
        if (typeof document === "undefined" || !document.createElement) {
          return null;
        }
        const fallback = document.createElement("pre");
        fallback.className = "json-tree-fallback";
        fallback.textContent = JSON.stringify(value, null, 2);
        return fallback;
      }

      function mountJsonTreeHosts(root) {
        if (!root || typeof root.querySelectorAll !== "function") {
          return;
        }
        const hosts = Array.from(root.querySelectorAll(".json-tree-host"));
        hosts.forEach((host) => {
          if (!host || host.getAttribute("data-json-tree-mounted") === "true") {
            return;
          }
          const source = typeof host.querySelector === "function"
            ? host.querySelector(".json-tree-source")
            : null;
          const raw = source && typeof source.textContent === "string" ? source.textContent : "";
          let value = null;
          try {
            value = raw ? JSON.parse(raw) : null;
          } catch (error) {
            value = null;
          }
          if (!value || typeof value !== "object") {
            return;
          }
          host.setAttribute("data-json-tree-mounted", "true");
          if (host.style && typeof host.style.setProperty === "function") {
            host.style.setProperty("--json-tree-empty-object-label", JSON.stringify(typeof t === "function" ? t("jsonTreeEmptyObject") : "无属性"));
          }
          const rendered = createJsonTreeElement(value);
          if (rendered && typeof host.appendChild === "function") {
            host.appendChild(rendered);
          }
        });
      }

      function handleChatImageClick(event) {
        const target = event.target && typeof event.target.closest === "function"
          ? event.target.closest(".chat-image-preview, .chat-image-download") : null;
        if (!target) {
          return false;
        }
        event.preventDefault();
        const source = normalizeChatImageSource(target.getAttribute("data-image-src"));
        if (source) {
          const type = target.getAttribute("data-image-action") === "download" ? "downloadChatImage" : "previewChatImage";
          vscode.postMessage({ type, source, alt: target.getAttribute("data-image-alt") || "图片" });
        }
        return true;
      }

      function renderChatImage(token) {
        const source = normalizeChatImageSource(token.href);
        const alt = String(token.text || "图片");
        if (!source) {
          return escapeHtml(alt);
        }
        const local = !/^https?:|^data:/i.test(source);
        const sources = renderChatImage.sources || (renderChatImage.sources = new Map());
        if (local && !sources.has(source) && typeof vscode !== "undefined") {
          sources.set(source, { pending: true });
          vscode.postMessage({ type: "resolveChatImage", source });
        }
        const resolved = sources.get(source);
        const displaySource = local ? (resolved && resolved.resolvedSource || "") : source;
        const escapeAttribute = (value) => escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        const label = "点击在内容区预览：" + alt;
        const downloadLabel = /^data:image\\/svg\\+xml/i.test(source) || /\\.svg$/i.test(source) ? "下载 SVG" : "下载图片";
        const status = local ? (resolved && resolved.error || (!displaySource ? "正在加载本地图片…" : "")) : "";
        return '<span class="chat-image"><button type="button" class="chat-image-preview" data-image-src="' + escapeAttribute(source)
          + '" data-image-alt="' + escapeAttribute(alt) + '" aria-label="' + escapeAttribute(label)
          + '" title="' + escapeAttribute(token.title || label) + '"><img'
          + (displaySource ? ' src="' + escapeAttribute(displaySource) + '"' : '')
          + ' alt="' + escapeAttribute(alt) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>'
          + '<span class="chat-image-status" role="status">' + escapeHtml(status) + '</span>'
          + '<a href="#" class="chat-image-download" data-image-action="download" data-image-src="' + escapeAttribute(source)
          + '" data-image-alt="' + escapeAttribute(alt) + '" aria-label="' + escapeAttribute(downloadLabel + "：" + alt)
          + '">' + downloadLabel + '</a></span>';
      }

      function applyChatImageSource(data) {
        const sources = renderChatImage.sources;
        if (!sources || !sources.has(data.source)) {
          return;
        }
        const resolvedSource = normalizeChatImageSource(data.resolvedSource);
        const result = resolvedSource && resolvedSource.startsWith("data:")
          ? { resolvedSource } : { error: String(data.error || "图片加载失败") };
        sources.set(data.source, result);
        if (sources.size > 32) {
          sources.delete(sources.keys().next().value);
        }
        document.querySelectorAll(".chat-image-preview").forEach((button) => {
          if (button.getAttribute("data-image-src") !== data.source) {
            return;
          }
          const image = button.querySelector("img");
          if (image && result.resolvedSource) {
            image.src = result.resolvedSource;
          }
          const status = button.parentElement && button.parentElement.querySelector(".chat-image-status");
          if (status) {
            status.textContent = result.error || "";
          }
        });
      }

      function renderMarkdown(content) {
        if (!content) {
          return "";
        }
        const jsonValue = parseCompleteJsonContainer(content);
        if (jsonValue) {
          return renderJsonTreeHost(jsonValue);
        }
        const trimmed = String(content).trim();
        const fence = String.fromCharCode(96).repeat(3);
        const markdown = /^<svg(?=[\\s>])/i.test(trimmed) && /<\\/svg\\s*>$/i.test(trimmed)
          ? fence + "svg\\n" + trimmed + "\\n" + fence
          : content;
        const normalized = wrapLineNumberedBlocks(markdown);
        if (typeof marked === "undefined" || !marked.parse) {
          return escapeHtml(normalized);
        }
        const renderer = new marked.Renderer();
        renderer.image = renderChatImage;
        const renderTable = (token) => {
          const header = token.header.map((cell) => renderer.tablecell(cell)).join("");
          const body = token.rows.map((row) => renderer.tablerow({ text: row.map((cell) => renderer.tablecell(cell)).join("") })).join("");
          return '<div class="markdown-table-wrap"><table><thead>' + renderer.tablerow({ text: header }) + "</thead><tbody>" + body + "</tbody></table></div>";
        };
        renderer.table = renderTable;
        const renderCode = renderer.code.bind(renderer);
        renderer.code = (token) => {
          if (String(token.lang || "").trim().split(/\\s+/)[0].toLowerCase() === "svg") {
            const source = createChatSvgImageSource(token.text);
            if (source) {
              return renderChatImage({ href: source, text: "SVG 图示" });
            }
          }
          return renderCode(token);
        };
        renderer.html = (html) => escapeHtml(html);
        return marked.parse(normalized, { breaks: true, renderer });
      }

      function isLineNumberedLine(value) {
        return /^\\s*\\d+\\s*(?:→|->)\\s*/.test(value);
      }

      function wrapLineNumberedBlocks(content) {
        const lines = String(content).split(/\\r?\\n/);
        const output = [];
        let inFence = false;
        let inNumberBlock = false;
        let numberBlock = [];
        const flushNumberBlock = () => {
          if (!inNumberBlock) {
            return;
          }
          output.push("\`\`\`text", ...numberBlock, "\`\`\`");
          numberBlock = [];
          inNumberBlock = false;
        };
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("\`\`\`")) {
            flushNumberBlock();
            inFence = !inFence;
            output.push(line);
            return;
          }
          if (!inFence && isLineNumberedLine(line)) {
            inNumberBlock = true;
            numberBlock.push(line);
            return;
          }
          flushNumberBlock();
          output.push(line);
        });
        flushNumberBlock();
        return output.join("\\n");
      }

`;
