import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

type Rule = { id: string; when: string; needs?: string[] };
type LoadedRule = Rule & { body: string };
type Library = { root: string; version: string; rules: Map<string, LoadedRule> };
export type PromptRuleDelivery = "indexed" | "inline" | "full";
let installed: { library: Library; delivery: PromptRuleDelivery; selections: Map<string, readonly string[]> } | undefined;

export function activePromptRuleDelivery(): PromptRuleDelivery {
  return installed?.delivery ?? "full";
}

function readInstalledFile(root: string, relative: string): string {
  const file = path.join(root, relative);
  if (fs.realpathSync(file) !== file) throw new Error(`规则资源路径不匹配 ${relative}`);
  return fs.readFileSync(file, "utf8");
}

export function readPromptRuleLibrary(extensionPath: string): Library {
  if (!path.isAbsolute(extensionPath)) throw new Error("规则库需要绝对安装路径");
  const root = path.join(fs.realpathSync(extensionPath), "media", "prompt-rules");
  const manifest = readInstalledFile(root, "manifest.json");
  const config = JSON.parse(manifest);
  if (config.version !== 1 || !Array.isArray(config.rules) || !config.rules.length) throw new Error("规则清单版本或格式无效");
  const hash = createHash("sha256").update(manifest);
  const rules = new Map<string, LoadedRule>();
  for (const rule of config.rules as Rule[]) {
    if (!rule || typeof rule.id !== "string" || !/^[a-z][a-z-]*\/[a-z][a-z-]*$/.test(rule.id) || rules.has(rule.id)
      || typeof rule.when !== "string" || !rule.when.trim() || (rule.needs !== undefined && !Array.isArray(rule.needs))) {
      throw new Error("规则条目无效或重复");
    }
    const body = readInstalledFile(root, `${rule.id}.md`);
    if (!body.trim()) throw new Error(`规则正文为空 ${rule.id}`);
    hash.update("\0").update(rule.id).update("\0").update(body);
    rules.set(rule.id, { ...rule, body });
  }
  const checked = new Set<string>();
  const visiting = new Set<string>();
  function validateDependencies(id: string): void {
    if (checked.has(id)) return;
    const rule = rules.get(id);
    if (!rule || visiting.has(id)) throw new Error(`规则依赖无效 ${id}`);
    visiting.add(id);
    rule.needs?.forEach(validateDependencies);
    visiting.delete(id);
    checked.add(id);
  }
  for (const id of rules.keys()) validateDependencies(id);
  return { root, version: hash.digest("hex"), rules };
}

export function configurePromptRuleIndex(extensionPath: string, delivery: PromptRuleDelivery): boolean {
  installed = undefined;
  if (delivery !== "indexed" && delivery !== "inline") return false;
  try {
    const library = readPromptRuleLibrary(extensionPath);
    const lock = readInstalledFile(fs.realpathSync(extensionPath), "dist/prompt-rule-version.json");
    if (JSON.parse(lock).version !== library.version) return false;
    installed = { library, delivery, selections: new Map() };
    return true;
  } catch {
    return false;
  }
}

export function renderPromptRuleIndex(
  role: string, required: readonly string[], conditional: readonly string[], forceInline = false,
): string | null {
  if (!installed) return null;
  const { library, delivery } = installed;
  const inline = forceInline || delivery === "inline";
  const selected = new Map<string, boolean>();
  function add(id: string, mandatory: boolean): boolean {
    const rule = library.rules.get(id);
    if (!rule) return false;
    if (selected.has(id) && (!mandatory || selected.get(id))) return true;
    selected.set(id, mandatory);
    return (rule.needs ?? []).every((dependency) => add(dependency, mandatory));
  }
  if (!required.every((id) => add(id, true)) || !conditional.every((id) => add(id, false))) return null;
  const lines = [`规则索引 ${library.version.slice(0, 12)} · ${role}`];
  if (!inline) {
    const ids = [...selected.keys()];
    const ticket = createHash("sha256").update(library.version).update(ids.join("\n")).digest("hex").slice(0, 16);
    installed.selections.set(ticket, ids);
    lines.push(`规则根目录 ${JSON.stringify(library.root)}`, "行动前用现有工具合并读取必读项、已命中的条件项和任务证据。随后发现新情况时，在作决定前补读对应条目。",
      `规则文件无法读取时先只回 RULES_UNREADABLE:${ticket}，等待宿主补充正文。`);
  }
  for (const [id, mandatory] of selected) {
    const rule = library.rules.get(id)!;
    lines.push(`${mandatory ? "必读" : "按需"} ${id}.md — ${rule.when}`);
    if (inline) lines.push(rule.body.trimEnd());
  }
  return lines.join("\n");
}

export function promptRuleSupplement(prompt: string, reply: string): string | null {
  if (!installed || installed.delivery !== "indexed") return null;
  const ticket = /^RULES_UNREADABLE:([a-f0-9]{16})$/.exec(reply.trim())?.[1];
  if (!ticket || !prompt.includes(`先只回 RULES_UNREADABLE:${ticket}，等待宿主补充正文。`)) return null;
  const ids = installed.selections.get(ticket);
  if (!ids) return null;
  const originalInstruction = `规则文件无法读取时先只回 RULES_UNREADABLE:${ticket}，等待宿主补充正文。`;
  return [prompt.replace(originalInstruction, "本轮规则正文已附，直接使用下列正文。复用已经生效的操作，继续核对任务证据。"),
    ...ids.map((id) => installed!.library.rules.get(id)!.body.trimEnd())].join("\n\n");
}

export function inlineSingleSendRules(prompt: string): string {
  const marker = prompt.match(/先只回 (RULES_UNREADABLE:[a-f0-9]{16})，等待宿主补充正文。/u)?.[1];
  return marker ? promptRuleSupplement(prompt, marker) ?? prompt : prompt;
}
