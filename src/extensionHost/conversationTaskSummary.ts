import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildCliArgs, parseOpenCodeRunOutput, runCliStream, type RunProcess } from "../cli/commandRunner";
import { getCliCommand, getKimiAgentArgs, readExplicitKimiAcpArgs } from "../cli/config";
import type { CliName, ThinkingMode } from "../cli/types";
import { createConfigPaths } from "../config/configPaths";
import { commitDshDocument, serializeDshPatchYaml } from "../cli/dshConfigModels";
import { resolveZcodeProviderConfigPath, resolveZcodeModelWireForRun } from "../config/zcodeConfig";
import { parseKimiCodeConfigModels } from "../config/kimiCodeConfig";
import { parseGrokConfigModels, resolveGrokConfigModel } from "../cli/grokConfigModels";
import { parseDshConfigModels, resolveDshConfigModel, readDshModelWireForRun } from "../cli/dshConfigModels";
import { parseGrokToml, serializeGrokToml } from "../config/grokToml";
import { buildDshChildEnv, isDshCompletedStopReason } from "../interactive/dshAppServerProtocol";
import { buildKimiChildEnv, isKimiCompletedStopReason } from "../interactive/kimiAppServerProtocol";
import { buildZcodeChildEnv, ZCODE_PLAN_MODE } from "../interactive/zcodeAppServerProtocol";
import { isGrokCompletedStopReason } from "../interactive/grokAppServerProtocol";
import { CodexInteractiveRunner } from "../interactive/codexRunner";
import { ClaudeInteractiveRunner } from "../interactive/claudeRunner";
import { DshInteractiveRunner } from "../interactive/dshRunner";
import { KimiInteractiveRunner } from "../interactive/kimiRunner";
import { ZcodeInteractiveRunner } from "../interactive/zcodeRunner";
import { GrokInteractiveRunner } from "../interactive/grokRunner";
import { parseJsonObjectText } from "../shared/jsonObject";
import { buildConversationTaskSummaryPrompt, TASK_SUMMARY_OUTPUT_LIMIT } from "../conversationTaskSummary";
import { resolveKimiThinkingValue } from "./kimiInteractiveLaunch";
import { resolveZcodeThinkingRequest } from "./zcodeInteractiveLaunch";

function readConfig(filePath: string): string {
  try {
    if (fs.statSync(filePath).size > 512 * 1024) throw new Error("Summary configuration too large.");
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function providerToml(content: string, keys: readonly string[]): string {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) throw new Error("Invalid summary provider configuration.");
  const selected = Object.fromEntries(Object.entries(parsed.value).filter(([key]) => keys.includes(key)));
  const serialized = serializeGrokToml(selected);
  if (!serialized.ok) throw new Error("Invalid summary provider snapshot.");
  return serialized.content;
}

export function captureConversationTaskSummaryExecution(input: {
  cli: CliName;
  requirement: string;
  model: string | null;
  thinkingMode: ThinkingMode;
  command?: string;
  parentEnv?: NodeJS.ProcessEnv;
  claudeEntrypoint?: string;
  homeDir?: string;
  args?: readonly string[];
  openCodeVariant?: string | null;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-task-summary-"));
  fs.chmodSync(root, 0o700);
  let runner: { dispose: () => void } | undefined;
  let process: RunProcess | undefined;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try { runner?.dispose(); } finally {
      try { process?.kill(); } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  };
  try {
    const parentEnv = { ...(input.parentEnv ?? global.process.env) };
    const sourceHome = input.homeDir ?? os.homedir();
    const source = createConfigPaths(sourceHome, parentEnv);
    const command = input.command ?? getCliCommand(input.cli);
    const prompt = buildConversationTaskSummaryPrompt(input.requirement);
    const cwd = path.join(root, "workspace");
    const home = path.join(root, "home");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    const isolatedEnv: NodeJS.ProcessEnv = {
      HOME: home, USERPROFILE: home,
      PWD: cwd,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      CODEX_HOME: path.join(home, ".codex"), CODEX_HOME_DIR: path.join(home, ".codex"),
      GROK_HOME: path.join(home, ".grok"), DSH_HOME: path.join(home, ".dsh"),
      KIMI_CODE_HOME: path.join(home, ".kimi-code"),
      ZCODE_DATA_BASE_DIR: home,
    };
    const env: NodeJS.ProcessEnv = { ...parentEnv, ...isolatedEnv };
    delete env.OPENCODE_CONFIG_DIR;
    const write = (relativePath: string, content: string): string => {
      const target = path.join(home, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { mode: 0o600 });
      return target;
    };
    let model = input.model;
    let kimiArgs: string[] = [];
    let kimiThinking: string | null = null;
    let openCodeConfig = "";
    let openCodeArgs: string[] = [];
    let dshPatch = "";
    if (input.cli === "codex") {
      const config = providerToml(readConfig(source.codex.config), [
        "model", "model_provider", "model_providers", "preferred_auth_method", "forced_login_method",
      ]);
      write(".codex/config.toml", config);
      const auth = readConfig(source.codex.auth);
      if (auth) write(".codex/auth.json", auth);
    } else if (input.cli === "claude") {
      const settings = JSON.parse(readConfig(source.claude.settings) || "{}");
      if (settings.env && typeof settings.env === "object") {
        for (const [key, value] of Object.entries(settings.env)) {
          if (typeof value === "string") env[key] = value;
        }
      }
      Object.assign(env, isolatedEnv);
      if (env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN;
    } else if (input.cli === "grok") {
      const config = readConfig(source.grok.config);
      write(".grok/config.toml", providerToml(config, ["models", "model"]));
      model = resolveGrokConfigModel(parseGrokConfigModels(config), model);
      if (!model) throw new Error("No configured Grok summary model.");
    } else if (input.cli === "dsh") {
      const profile = commitDshDocument(readConfig(path.join(source.dsh.configDir, "active-profile.json")));
      if (!profile.ok) throw new Error("Invalid DSH summary configuration.");
      const models = parseDshConfigModels(profile.content);
      const selected = resolveDshConfigModel(models, model);
      model = readDshModelWireForRun(models, selected);
      dshPatch = write(".dsh/summary-patch.yaml", serializeDshPatchYaml(profile.document));
      if (profile.document.apiKey) env.SINITEK_DSH_API_KEY = profile.document.apiKey;
      env.DSH_PERMISSION_MODE = "read-only";
    } else if (input.cli === "kimi-code") {
      const config = readConfig(source["kimi-code"].config);
      write(".kimi-code/config.toml", providerToml(config, ["models", "providers", "default_model", "thinking"]));
      const parsed = parseKimiCodeConfigModels(config);
      model = model ?? parsed.defaultModel;
      kimiThinking = resolveKimiThinkingValue(input.thinkingMode, parsed.thinkingEffort);
      kimiArgs = input.args ? readExplicitKimiAcpArgs(input.args) : [...getKimiAgentArgs()];
    } else if (input.cli === "zcode") {
      const config = readConfig(resolveZcodeProviderConfigPath(sourceHome, parentEnv));
      env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = write(".zcode/v2/provider_config.json", config);
      model = model?.includes("$") ? model : resolveZcodeModelWireForRun(config, model);
    } else {
      const config = parseJsonObjectText(readConfig(source.opencode.config), { mode: "jsonc", rootErrorMessage: "Invalid summary config." });
      delete config.agent;
      delete config.command;
      config.plugin = [];
      config.mcp = {};
      config.instructions = [];
      config.permission = { "*": "deny" };
      openCodeConfig = JSON.stringify(config);
      env.OPENCODE_CONFIG = write(".opencode/config.json", openCodeConfig);
      env.OPENCODE_CONFIG_CONTENT = openCodeConfig;
      openCodeArgs = buildCliArgs("opencode", { baseArgs: ["run"], model,
        openCodeVariant: input.openCodeVariant, openCodeConfigContent: openCodeConfig }, prompt);
    }
    return {
      root,
      dispose,
      async run(signal: AbortSignal): Promise<string | undefined> {
        if (disposed || signal.aborted) return undefined;
        const abort = (): void => { runner?.dispose(); process?.kill(); };
        signal.addEventListener("abort", abort, { once: true });
        let output = "";
        let outputTooLarge = false;
        const append = (text: string): void => {
          if (output.length + text.length > TASK_SUMMARY_OUTPUT_LIMIT) {
            outputTooLarge = true;
            runner?.dispose();
            return;
          }
          output += text;
        };
        try {
          if (input.cli === "codex") {
            const codex = new CodexInteractiveRunner({ command, args: [], cwd, env, readOnly: true,
              model, thinkingMode: input.thinkingMode, interactiveMode: "plan", threadId: null });
            runner = codex;
            const messages = new Map<string, string>();
            let finalMessageId: string | undefined;
            let bufferedSize = 0;
            await codex.runStreamed(prompt, {
              onAssistantDelta: (text, meta) => {
                if (meta?.kind === "thinking") return;
                bufferedSize += text.length;
                if (bufferedSize > TASK_SUMMARY_OUTPUT_LIMIT) { outputTooLarge = true; codex.dispose(); return; }
                const messageId = meta?.assistantItemId ?? "answer";
                messages.set(messageId, (messages.get(messageId) ?? "") + text);
                if (meta?.codexFinalAnswer) finalMessageId = messageId;
              },
              onTrace: () => undefined, onTaskListUpdate: () => undefined, onThreadId: () => undefined,
              onRequest: () => ({ error: { code: -32601, message: "Text-only summary." } }),
            });
            output = finalMessageId ? messages.get(finalMessageId) ?? "" : "";
          } else if (input.cli === "claude") {
            const claude = new ClaudeInteractiveRunner({ command, args: [], cwd, env, textOnly: true,
              model, thinkingMode: input.thinkingMode, interactiveMode: "plan", sessionId: null,
              entrypoint: input.claudeEntrypoint, isolateProjectInstructions: true });
            runner = claude;
            await claude.runStreamed(prompt, { onAssistantDelta: append, onTrace: () => undefined,
              onTaskListUpdate: () => undefined, onSessionId: () => undefined });
          } else if (input.cli === "grok") {
            const grok = new GrokInteractiveRunner({ command, agentArgs: [], cwd, env, model,
              thinkingMode: input.thinkingMode, textOnly: true, localSessionId: null });
            runner = grok;
            await grok.start();
            const result = await grok.prompt(prompt, { onAssistantDelta: append });
            if (!isGrokCompletedStopReason(result.stopReason)) return undefined;
          } else if (input.cli === "dsh") {
            const dsh = new DshInteractiveRunner({ command, agentArgs: ["--patch", dshPatch], cwd,
              env: buildDshChildEnv(undefined, env), model, thinkingMode: input.thinkingMode, localSessionId: null });
            runner = dsh;
            await dsh.start();
            const result = await dsh.prompt(prompt, { onAssistantDelta: append, onRequest: () => null });
            if (!isDshCompletedStopReason(result.stopReason)) return undefined;
          } else if (input.cli === "kimi-code") {
            const kimi = new KimiInteractiveRunner({ command, agentArgs: kimiArgs, cwd,
              env: buildKimiChildEnv(undefined, env), model, thinkingMode: kimiThinking, modeId: "plan",
              denyToolPermissions: true, localSessionId: null });
            runner = kimi;
            await kimi.start();
            const result = await kimi.prompt(prompt, { onAssistantDelta: append, onRequest: () => null });
            if (!isKimiCompletedStopReason(result.stopReason)) return undefined;
          } else if (input.cli === "zcode") {
            const zcode = new ZcodeInteractiveRunner({ command, agentArgs: [], cwd,
              env: buildZcodeChildEnv(env), model, thinkingMode: resolveZcodeThinkingRequest(input.thinkingMode),
              modeId: ZCODE_PLAN_MODE, denyToolPermissions: true, localSessionId: null });
            runner = zcode;
            await zcode.start();
            const result = await zcode.prompt(prompt, { onAssistantDelta: append });
            output = result.text;
          } else {
            output = await new Promise<string>((resolve, reject) => {
              let stdout = "";
              process = runCliStream("opencode", prompt, {
                onStdout: (text) => {
                  if (stdout.length + text.length > 128 * 1024) { process?.kill(); reject(new Error("Summary stream limit.")); }
                  else stdout += text;
                },
                onStderr: () => undefined, onError: reject,
                onExit: (code) => {
                  const result = parseOpenCodeRunOutput(stdout, "");
                  if (code !== 0 || !result.hasStructuredFinalAnswer) reject(new Error("Summary failed."));
                  else resolve(result.finalText ?? "");
                },
              }, { cwd, commandOverride: command, argsOverride: openCodeArgs, model,
                openCodeVariant: input.openCodeVariant, openCodeConfigContent: openCodeConfig, environment: env,
              });
            });
          }
          return signal.aborted || outputTooLarge ? undefined : output;
        } finally {
          signal.removeEventListener("abort", abort);
          runner?.dispose();
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
