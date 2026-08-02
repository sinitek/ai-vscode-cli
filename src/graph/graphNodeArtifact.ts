import * as fs from "fs";

import type {
  GraphAcceptanceCheck,
  GraphFailureClassification,
  GraphFinalAnswer,
} from "./types";
import { normalizeGraphFailureClassification } from "./graphFailureClassification";
import { normalizeGraphPlannedGraphSpec } from "./graphPlanner";
import type {
  GraphNodeExecutionResult,
  GraphNodeExecutionResultStatus,
} from "./graphNodeLifecycle";

const GRAPH_NODE_RESULT_STATUSES = new Set<GraphNodeExecutionResultStatus>([
  "passed",
  "failed",
  "blocked",
  "sleeping",
]);

export function readGraphNodeExecutionResultArtifact(
  communicationFile: string,
): GraphNodeExecutionResult | null {
  if (!fs.existsSync(communicationFile)) {
    return null;
  }
  const content = fs.readFileSync(communicationFile, "utf8");
  const jsonText = extractLastJsonBlock(content);
  if (!jsonText) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  return normalizeGraphNodeExecutionResult(parsed);
}

function extractLastJsonBlock(content: string): string | null {
  const sectionMatch = /## JSON\s*([\s\S]*)$/u.exec(content);
  const source = sectionMatch?.[1] ?? content;
  const blocks = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  const block = blocks.at(-1)?.[1]?.trim();
  if (block) {
    return block;
  }
  const trimmed = source.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed : null;
}

function normalizeGraphNodeExecutionResult(value: unknown): GraphNodeExecutionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphNodeExecutionResult>;
  if (!GRAPH_NODE_RESULT_STATUSES.has(raw.status as GraphNodeExecutionResultStatus)) {
    return null;
  }
  return {
    status: raw.status as GraphNodeExecutionResultStatus,
    ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    ...(typeof raw.artifactRef === "string" && raw.artifactRef.trim() ? { artifactRef: raw.artifactRef } : {}),
    ...(normalizeAcceptance(raw.acceptance).length > 0 ? { acceptance: normalizeAcceptance(raw.acceptance) } : {}),
    ...(normalizeGraphFailureClassification(raw.failure) ? { failure: normalizeGraphFailureClassification(raw.failure) as GraphFailureClassification } : {}),
    ...(normalizeFinalAnswer(raw.finalAnswer) ? { finalAnswer: normalizeFinalAnswer(raw.finalAnswer) as GraphFinalAnswer } : {}),
    ...(normalizeGraphPlannedGraphSpec(raw.plannedGraph) ? { plannedGraph: normalizeGraphPlannedGraphSpec(raw.plannedGraph) as NonNullable<GraphNodeExecutionResult["plannedGraph"]> } : {}),
    ...(typeof raw.wakeAt === "number" && Number.isFinite(raw.wakeAt) ? { wakeAt: raw.wakeAt } : {}),
  };
}

function normalizeAcceptance(value: unknown): GraphAcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const raw = item as Partial<GraphAcceptanceCheck>;
      if (typeof raw.name !== "string" || !raw.name.trim()) {
        return null;
      }
      return {
        ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
        name: raw.name.trim(),
        ...(typeof raw.passed === "boolean" ? { passed: raw.passed } : {}),
        ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
        ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
        ...(typeof raw.evidenceRef === "string" && raw.evidenceRef.trim() ? { evidenceRef: raw.evidenceRef.trim() } : {}),
      };
    })
    .filter((item): item is GraphAcceptanceCheck => Boolean(item));
}

function normalizeFinalAnswer(value: unknown): GraphFinalAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<GraphFinalAnswer>;
  if (typeof raw.conclusion !== "string" || typeof raw.summary !== "string") {
    return null;
  }
  return {
    conclusion: raw.conclusion,
    summary: raw.summary,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string") : [],
    unresolved: Array.isArray(raw.unresolved) ? raw.unresolved.filter((item): item is string => typeof item === "string") : [],
    ...(typeof raw.completedAt === "number" && Number.isFinite(raw.completedAt) ? { completedAt: raw.completedAt } : {}),
  };
}
