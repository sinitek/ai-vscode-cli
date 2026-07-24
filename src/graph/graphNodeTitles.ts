import type { GraphNodeKind } from "./types";

const CJK_PATTERN = /[\u3400-\u9fff]/u;

const GRAPH_NODE_KIND_TITLE_PREFIX: Record<GraphNodeKind, string> = {
  intake: "需求录入",
  plan: "规划",
  implement: "实现",
  test: "验证",
  review: "评审",
  debate: "辩论",
  human_gate: "人工确认",
  merge: "整合",
  sleep: "等待",
  summary: "总结",
};

const EXACT_TITLE_TRANSLATIONS = new Map<string, string>([
  ["Plan Graph DAG execution", "规划 Graph DAG 执行"],
  ["Summarize AI-planned Graph run", "总结 AI 规划的 Graph 运行"],
  ["Implement API changes", "实现 API 改动"],
  ["Validate API behavior", "验证 API 行为"],
  ["Review API result", "评审 API 结果"],
  ["Define static prototype contract", "定义静态原型契约"],
  ["Create employee management HTML shell", "创建员工管理 HTML 外壳"],
  ["Build black theme styling", "构建黑色主题样式"],
  ["Add employee management interactions", "添加员工管理交互"],
  ["Integrate static prototype files", "整合静态原型文件"],
  ["Plan work", "规划工作"],
  ["Implement panel", "实现面板"],
  ["Run tests", "运行测试"],
  ["Review merged result", "评审合并结果"],
  ["Fix failed node", "修复失败节点"],
  ["Approve deployment", "批准部署"],
  ["Final Graph summary", "总结 Graph 运行结果"],
].map(([source, target]) => [normalizeTitleKey(source), target]));

const PHRASE_TRANSLATIONS: readonly [string, string][] = [
  ["AI-planned", "AI 规划的"],
  ["DAG execution", "DAG 执行"],
  ["Graph run", "Graph 运行"],
  ["static prototype", "静态原型"],
  ["employee management", "员工管理"],
  ["black theme", "黑色主题"],
  ["HTML shell", "HTML 外壳"],
  ["API changes", "API 改动"],
  ["API behavior", "API 行为"],
  ["API result", "API 结果"],
  ["merged result", "合并结果"],
  ["failed node", "失败节点"],
  ["final summary", "最终总结"],
  ["Plan", "规划"],
  ["Define", "定义"],
  ["Create", "创建"],
  ["Build", "构建"],
  ["Add", "添加"],
  ["Integrate", "整合"],
  ["Validate", "验证"],
  ["Review", "评审"],
  ["Implement", "实现"],
  ["Test", "测试"],
  ["Run", "运行"],
  ["Summarize", "总结"],
  ["Fix", "修复"],
  ["Approve", "批准"],
  ["changes", "改动"],
  ["behavior", "行为"],
  ["result", "结果"],
  ["contract", "契约"],
  ["files", "文件"],
  ["file", "文件"],
  ["styling", "样式"],
  ["interactions", "交互"],
  ["management", "管理"],
  ["employee", "员工"],
  ["prototype", "原型"],
  ["static", "静态"],
  ["tests", "测试"],
  ["test", "测试"],
  ["work", "工作"],
  ["panel", "面板"],
  ["deployment", "部署"],
  ["node", "节点"],
  ["summary", "总结"],
];

export function formatGraphNodeTitleInChinese(node: Pick<{ title: string; kind: GraphNodeKind }, "title" | "kind">): string {
  const title = node.title.trim();
  if (!title) {
    return `${GRAPH_NODE_KIND_TITLE_PREFIX[node.kind]}节点`;
  }
  if (CJK_PATTERN.test(title)) {
    return title;
  }

  const exact = EXACT_TITLE_TRANSLATIONS.get(normalizeTitleKey(title));
  if (exact) {
    return exact;
  }

  const translated = translateKnownEnglishTitleTerms(title);
  if (CJK_PATTERN.test(translated)) {
    return translated;
  }

  return `${GRAPH_NODE_KIND_TITLE_PREFIX[node.kind]}节点`;
}

function translateKnownEnglishTitleTerms(title: string): string {
  let result = title;
  for (const [source, target] of PHRASE_TRANSLATIONS) {
    result = result.replace(buildTermPattern(source), target);
  }
  return cleanTranslatedTitle(result);
}

function buildTermPattern(source: string): RegExp {
  const escaped = source.split(/\s+/u).map(escapeRegExp).join("\\s+");
  return new RegExp(`\\b${escaped}\\b`, "giu");
}

function cleanTranslatedTitle(title: string): string {
  return title
    .replace(/\s+([，。、：；])/gu, "$1")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/gu, "$1$2")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function normalizeTitleKey(title: string): string {
  return title.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
