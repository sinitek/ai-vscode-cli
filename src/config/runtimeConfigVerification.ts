import * as TOML from "@iarna/toml";
import { isDeepStrictEqual } from "util";
import { isPlainObject, normalizeJsonObjectText } from "../shared/jsonObject";

type RuntimeConfigVerificationOptions = {
  cli: string;
  file: string;
  format: "JSON" | "JSONC" | "TOML";
  patch?: boolean;
};

const RUNTIME_CONFIG_APPLY_ATTEMPTS = 3;

export class RuntimeConfigVerificationError extends Error {
  constructor(cli: string, file: string) {
    super(`未成功更新配置（${cli}：${file}）：写入后读回的配置内容不一致，可能正被其他窗口或 CLI 修改。请停止其他配置写入后重试。`);
    this.name = "RuntimeConfigVerificationError";
  }
}

export function assertRuntimeConfigApplied(
  expected: string,
  actual: string,
  options: RuntimeConfigVerificationOptions,
): void {
  if (expected === actual) {
    return;
  }
  try {
    const parse = (content: string): unknown => options.format === "TOML"
      ? TOML.parse(content.replace(/^\uFEFF/, ""))
      : JSON.parse(normalizeJsonObjectText(content, options.format === "JSONC" ? "jsonc" : "strict"));
    const expectedValue = parse(expected);
    const actualValue = parse(actual);
    const matches = options.patch && isPlainObject(expectedValue) && isPlainObject(actualValue)
      ? Object.entries(expectedValue).every(([key, value]) => (
          Object.prototype.hasOwnProperty.call(actualValue, key) && isDeepStrictEqual(value, actualValue[key])
        ))
      : isDeepStrictEqual(expectedValue, actualValue);
    if (matches) {
      return;
    }
  } catch {}
  throw new RuntimeConfigVerificationError(options.cli, options.file);
}

export async function retryRuntimeConfigApply<Result>(operation: () => Promise<Result>): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RuntimeConfigVerificationError) || attempt >= RUNTIME_CONFIG_APPLY_ATTEMPTS) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}
