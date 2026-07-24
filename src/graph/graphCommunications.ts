import * as fs from "fs";
import * as path from "path";

import {
  getGraphDataDir,
  sanitizeGraphPathSegment,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "./types";

export const GRAPH_COMMUNICATIONS_DIR_NAME = "graph-communications";
export const GRAPH_SNAPSHOT_FILENAME = "graph.json";
export const GRAPH_EVENTS_FILENAME = "events.jsonl";
export const GRAPH_MAIN_COMMUNICATION_FILENAME = "main.md";
export const GRAPH_NODE_COMMUNICATIONS_DIR_NAME = "nodes";

export type GraphCommunicationPathOptions = {
  baseDir?: string;
};

export type GraphCommunicationPaths = {
  dir: string;
  mainFile: string;
  graphFile: string;
  eventsFile: string;
  nodesDir: string;
};

export function getGraphCommunicationsRoot(options: GraphCommunicationPathOptions = {}): string {
  return path.join(getGraphDataDir(options.baseDir), GRAPH_COMMUNICATIONS_DIR_NAME);
}

export function getGraphCommunicationPaths(
  graphRunId: string,
  options: GraphCommunicationPathOptions = {},
): GraphCommunicationPaths {
  const runSegment = sanitizeGraphPathSegment(graphRunId, "graph-run");
  const dir = path.join(getGraphCommunicationsRoot(options), runSegment);
  return {
    dir,
    mainFile: path.join(dir, GRAPH_MAIN_COMMUNICATION_FILENAME),
    graphFile: path.join(dir, GRAPH_SNAPSHOT_FILENAME),
    eventsFile: path.join(dir, GRAPH_EVENTS_FILENAME),
    nodesDir: path.join(dir, GRAPH_NODE_COMMUNICATIONS_DIR_NAME),
  };
}

export function buildGraphNodeCommunicationFile(
  graphRunId: string,
  nodeId: string,
  options: GraphCommunicationPathOptions = {},
): string {
  const nodeSegment = sanitizeGraphPathSegment(nodeId, "node");
  return path.join(getGraphCommunicationPaths(graphRunId, options).nodesDir, `${nodeSegment}.md`);
}

export function ensureGraphCommunicationFiles(
  run: GraphRunRecord,
  options: GraphCommunicationPathOptions = {},
): GraphCommunicationPaths {
  const paths = getGraphCommunicationPaths(run.id, options);
  fs.mkdirSync(paths.nodesDir, { recursive: true });
  if (!fs.existsSync(paths.mainFile)) {
    fs.writeFileSync(paths.mainFile, buildGraphMainCommunicationContent(run), "utf8");
  }
  if (!fs.existsSync(paths.eventsFile)) {
    fs.writeFileSync(paths.eventsFile, "", "utf8");
  }
  run.nodes.forEach((node) => ensureGraphNodeCommunicationFile(run.id, node, options));
  writeGraphSnapshot(run, options);
  return paths;
}

export function writeGraphSnapshot(
  run: GraphRunRecord,
  options: GraphCommunicationPathOptions = {},
): string {
  const paths = getGraphCommunicationPaths(run.id, options);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.graphFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return paths.graphFile;
}

function ensureGraphNodeCommunicationFile(
  graphRunId: string,
  node: GraphNodeRecord,
  options: GraphCommunicationPathOptions,
): void {
  const filePath = buildGraphNodeCommunicationFile(graphRunId, node.id, options);
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildGraphNodeCommunicationContent(node), "utf8");
}

function buildGraphMainCommunicationContent(run: GraphRunRecord): string {
  return [
    "# Graph 任务沟通文件",
    "",
    `- Graph Run ID：${run.id}`,
    `- CLI：${run.cli}`,
    `- Workspace Key：${run.workspaceKey}`,
    `- 创建时间：${new Date(run.createdAt).toISOString()}`,
    "",
    "## 原始目标",
    run.rootPrompt,
    "",
    "## 运行记录",
  ].join("\n");
}

function buildGraphNodeCommunicationContent(node: GraphNodeRecord): string {
  return [
    `# Graph 节点：${node.title}`,
    "",
    `- 节点 ID：${node.id}`,
    `- 节点类型：${node.kind}`,
    `- 节点状态：${node.status}`,
    `- Owner：${node.ownerRole}`,
    "",
    "## 输入与执行记录",
    "",
    "## 验证证据",
  ].join("\n");
}
