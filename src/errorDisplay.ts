import * as vscode from "vscode";
import { t } from "./i18n";

type ErrorWithCode = Error & {
  code?: unknown;
  cause?: unknown;
};

function extractMessageFromObject(error: Record<string, unknown>): string {
  const message = error.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return "";
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Error) {
    return buildErrorDetail(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.message?.trim() || t("common.unknownError");
  }
  if (typeof error === "string") {
    return error.trim() || t("common.unknownError");
  }
  if (error && typeof error === "object") {
    const message = extractMessageFromObject(error as Record<string, unknown>);
    if (message) {
      return message;
    }
  }
  const fallback = stringifyUnknown(error).trim();
  return fallback || t("common.unknownError");
}

export function buildErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const lines: string[] = [];
    const errorWithCode = error as ErrorWithCode;
    const summary = error.message?.trim() || t("common.unknownError");
    lines.push(summary);
    if (errorWithCode.code !== undefined && errorWithCode.code !== null) {
      lines.push(`code: ${String(errorWithCode.code)}`);
    }
    if (error.stack && error.stack.trim()) {
      lines.push("", error.stack.trim());
    }
    if (errorWithCode.cause !== undefined) {
      lines.push("", "cause:", stringifyUnknown(errorWithCode.cause));
    }
    return lines.join("\n").trim();
  }
  return stringifyUnknown(error).trim() || t("common.unknownError");
}

async function openDetailDocument(title: string, message: string, detail: string): Promise<void> {
  const body = [title, "", message, "", detail].join("\n");
  const document = await vscode.workspace.openTextDocument({
    language: "text",
    content: body,
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

export async function showErrorWithActions(
  title: string,
  error: unknown,
  options: { detailTitle?: string } = {}
): Promise<void> {
  const detail = buildErrorDetail(error);
  const detailTitle = options.detailTitle || title;
  const selection = await vscode.window.showErrorMessage(
    `${title} ${buildErrorSummary(error)}`,
    t("common.viewDetails"),
    t("common.copyDetails")
  );

  if (selection === t("common.copyDetails")) {
    await vscode.env.clipboard.writeText(detail);
    return;
  }
  if (selection === t("common.viewDetails")) {
    await openDetailDocument(detailTitle, title, detail);
  }
}
