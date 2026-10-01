export type ChatSearchDomNode = {
  nodeType: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes?: ArrayLike<ChatSearchDomNode | null> | null;
};

export type ChatSearchPiece = {
  node: ChatSearchDomNode;
  text: string;
};

export type ChatSearchBlock = {
  pieces: ChatSearchPiece[];
};

export type ChatSearchRange = {
  node: ChatSearchDomNode;
  start: number;
  end: number;
};

export type ChatSearchHit = {
  ranges: ChatSearchRange[];
};

function chatSearchTagName(node: ChatSearchDomNode): string {
  return typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
}

function isChatSearchSkippedTag(tagName: string): boolean {
  return tagName === "BUTTON"
    || tagName === "INPUT"
    || tagName === "OPTION"
    || tagName === "SELECT"
    || tagName === "SCRIPT"
    || tagName === "STYLE"
    || tagName === "SVG"
    || tagName === "TEXTAREA"
    || tagName === "NOSCRIPT"
    || tagName === "CANVAS"
    || tagName === "IFRAME";
}

function isChatSearchBlockTag(tagName: string): boolean {
  switch (tagName) {
    case "ADDRESS":
    case "ARTICLE":
    case "ASIDE":
    case "BLOCKQUOTE":
    case "BR":
    case "DD":
    case "DETAILS":
    case "DIV":
    case "DL":
    case "DT":
    case "FIELDSET":
    case "FIGCAPTION":
    case "FIGURE":
    case "FOOTER":
    case "FORM":
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
    case "HEADER":
    case "HR":
    case "LI":
    case "MAIN":
    case "NAV":
    case "OL":
    case "P":
    case "PRE":
    case "SECTION":
    case "SUMMARY":
    case "TABLE":
    case "TBODY":
    case "TD":
    case "TFOOT":
    case "TH":
    case "THEAD":
    case "TR":
    case "UL":
      return true;
    default:
      return false;
  }
}

export function collectChatSearchBlocks(root: ChatSearchDomNode | null | undefined): ChatSearchBlock[] {
  const blocks: ChatSearchBlock[] = [];
  const pieces: ChatSearchPiece[] = [];

  function flush(): void {
    if (pieces.length === 0) {
      return;
    }
    let hasContent = false;
    for (let index = 0; index < pieces.length; index += 1) {
      if (pieces[index].text.trim()) {
        hasContent = true;
        break;
      }
    }
    if (hasContent) {
      blocks.push({ pieces: pieces.slice() });
    }
    pieces.length = 0;
  }

  function appendText(node: ChatSearchDomNode): void {
    const text = typeof node.nodeValue === "string" ? node.nodeValue : "";
    if (!text) {
      return;
    }
    pieces.push({ node, text });
  }

  function childList(node: ChatSearchDomNode): ArrayLike<ChatSearchDomNode | null> | null {
    if (!node.childNodes || typeof node.childNodes.length !== "number") {
      return null;
    }
    return node.childNodes;
  }

  function visitInline(node: ChatSearchDomNode): void {
    const children = childList(node);
    if (!children) {
      return;
    }
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) {
        continue;
      }
      if (child.nodeType === 3) {
        appendText(child);
        continue;
      }
      if (child.nodeType !== 1) {
        continue;
      }
      const tagName = chatSearchTagName(child);
      if (!tagName || isChatSearchSkippedTag(tagName)) {
        continue;
      }
      if (isChatSearchBlockTag(tagName)) {
        flush();
        visitBlockChildren(child);
        flush();
        continue;
      }
      visitInline(child);
    }
  }

  function visitBlockChildren(node: ChatSearchDomNode): void {
    const children = childList(node);
    if (!children) {
      return;
    }
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) {
        continue;
      }
      if (child.nodeType === 3) {
        appendText(child);
        continue;
      }
      if (child.nodeType !== 1) {
        continue;
      }
      const tagName = chatSearchTagName(child);
      if (!tagName || isChatSearchSkippedTag(tagName)) {
        continue;
      }
      if (isChatSearchBlockTag(tagName)) {
        flush();
        visitBlockChildren(child);
        flush();
        continue;
      }
      visitInline(child);
    }
  }

  if (!root || root.nodeType !== 1) {
    return blocks;
  }
  const rootTag = chatSearchTagName(root);
  if (rootTag && isChatSearchSkippedTag(rootTag)) {
    return blocks;
  }
  if (!rootTag || isChatSearchBlockTag(rootTag)) {
    visitBlockChildren(root);
    flush();
    return blocks;
  }
  visitInline(root);
  flush();
  return blocks;
}

export function findChatSearchHits(
  blocks: ChatSearchBlock[] | null | undefined,
  query: unknown,
): ChatSearchHit[] {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!needle || !Array.isArray(blocks)) {
    return [];
  }
  const hits: ChatSearchHit[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (!block || !Array.isArray(block.pieces) || block.pieces.length === 0) {
      continue;
    }
    let combined = "";
    const spans: Array<{ piece: ChatSearchPiece; from: number; to: number }> = [];
    for (let pieceIndex = 0; pieceIndex < block.pieces.length; pieceIndex += 1) {
      const piece = block.pieces[pieceIndex];
      const text = piece && typeof piece.text === "string" ? piece.text : "";
      if (!piece || !text) {
        continue;
      }
      const from = combined.length;
      combined += text;
      spans.push({ piece, from, to: combined.length });
    }
    if (!combined) {
      continue;
    }
    const haystack = combined.toLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      const end = index + needle.length;
      const ranges: ChatSearchRange[] = [];
      for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
        const span = spans[spanIndex];
        const localStart = Math.max(index, span.from);
        const localEnd = Math.min(end, span.to);
        if (localStart < localEnd) {
          ranges.push({
            node: span.piece.node,
            start: localStart - span.from,
            end: localEnd - span.from,
          });
        }
      }
      if (ranges.length > 0) {
        hits.push({ ranges });
      }
      from = end;
    }
  }
  return hits;
}

export function moveChatSearchIndex(activeIndex: number, total: number, direction: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return -1;
  }
  const step = direction < 0 ? -1 : 1;
  if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= total) {
    return step > 0 ? 0 : total - 1;
  }
  return (activeIndex + step + total) % total;
}

export function formatChatSearchCounter(activeIndex: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) {
    return "0/0";
  }
  const current = Number.isFinite(activeIndex) && activeIndex >= 0 && activeIndex < total
    ? activeIndex + 1
    : 0;
  return String(current) + "/" + String(total);
}

export function buildChatTranscriptSearchRuntimeSource(): string {
  return [
    chatSearchTagName,
    isChatSearchSkippedTag,
    isChatSearchBlockTag,
    collectChatSearchBlocks,
    findChatSearchHits,
    moveChatSearchIndex,
    formatChatSearchCounter,
  ].map((fn) => fn.toString()).join("\n");
}
