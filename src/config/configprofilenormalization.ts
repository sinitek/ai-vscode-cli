import type { ConfigItem, CurrentConfigPlatform } from "./types";

export type ConfigProfileNormalizationPhase = "list" | "read" | "save";

type LegacyConfigProfile = ConfigItem & { geminiSkills?: ConfigItem["openCodeSkills"] };
type Strategy = (profile: LegacyConfigProfile, phase: ConfigProfileNormalizationPhase) => void;

export function getCanonicalConfigContent(profile: Pick<ConfigItem, "content" | "configContent">): string {
  return profile.configContent ?? profile.content ?? "";
}

function synchronizeContent(profile: ConfigItem): void {
  const content = getCanonicalConfigContent(profile);
  profile.content = content;
  profile.configContent = content;
}

function removeSeparateConfigFields(profile: ConfigItem): void {
  delete profile.authContent;
  delete profile.mcpContent;
  delete profile.envContent;
}

function normalizeSingleDocumentProfile(profile: ConfigItem): void {
  synchronizeContent(profile);
  removeSeparateConfigFields(profile);
  delete profile.claudeSkills;
  delete profile.codexSkills;
  delete profile.openCodeSkills;
  delete profile.grokSkills;
}

const strategies: Record<CurrentConfigPlatform, Strategy> = {
  claude: (profile, phase) => {
    if (phase === "save") return;
    if (profile.mcpContent === undefined) profile.mcpContent = "{}";
    if (profile.claudeSkills === undefined) profile.claudeSkills = [];
  },
  codex: (profile) => {
    synchronizeContent(profile);
    delete profile.envContent;
    profile.authContent = profile.authContent ?? "{}";
    profile.codexSkills = profile.codexSkills ?? [];
  },
  opencode: (profile, phase) => {
    delete profile.envContent;
    if (profile.openCodeSkills === undefined) {
      profile.openCodeSkills = phase === "list" ? [] : profile.geminiSkills ?? [];
    }
  },
  grok: (profile, phase) => {
    if (phase === "read") return;
    synchronizeContent(profile);
    removeSeparateConfigFields(profile);
    profile.grokSkills = profile.grokSkills ?? [];
  },
  dsh: normalizeSingleDocumentProfile,
  "kimi-code": normalizeSingleDocumentProfile,
  zcode: normalizeSingleDocumentProfile,
};

export function normalizeConfigProfileFields(
  profile: ConfigItem,
  normalizedPlatform: CurrentConfigPlatform,
  phase: ConfigProfileNormalizationPhase,
): void {
  strategies[normalizedPlatform](profile, phase);
  if (phase !== "list") delete (profile as LegacyConfigProfile).geminiSkills;
}
