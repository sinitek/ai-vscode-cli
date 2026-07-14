export type OpenCodeModelRole = "primary" | "small";

export type OpenCodeConfigModelIssueCode =
  | "invalid-json"
  | "invalid-provider-filter"
  | "invalid-provider-config"
  | "invalid-model-filter"
  | "invalid-model-config"
  | "provider-disabled"
  | "provider-not-enabled"
  | "model-blacklisted"
  | "model-not-whitelisted"
  | "model-deprecated"
  | "model-disabled"
  | "model-resolution-conditional"
  | "role-model-missing"
  | "role-model-invalid-type"
  | "role-model-invalid-ref"
  | "role-provider-not-found"
  | "role-model-not-found"
  | "role-model-unavailable"
  | "override-model-invalid-ref"
  | "override-model-unavailable";

export type OpenCodeConfigModelIssue = {
  code: OpenCodeConfigModelIssueCode;
  severity: "error" | "warning";
  message: string;
  role?: OpenCodeModelRole;
  ref?: string;
  providerId?: string;
  modelId?: string;
};

export type OpenCodeModelReference = {
  ref: string;
  providerId: string;
  modelId: string;
};

export type OpenCodeConfigModelCandidate = OpenCodeModelReference & {
  value: string;
  label: string;
  providerLabel: string;
  modelLabel: string;
  resolution: "unverified" | "conditional";
};

export type ParsedOpenCodeConfigModels = {
  config: Record<string, unknown> | null;
  candidates: OpenCodeConfigModelCandidate[];
  primaryModelRef: string | null;
  smallModelRef: string | null;
  primaryModel: OpenCodeConfigModelCandidate | null;
  smallModel: OpenCodeConfigModelCandidate | null;
  issues: OpenCodeConfigModelIssue[];
};

export type OpenCodeModelOverrideValidation = {
  ok: boolean;
  role: OpenCodeModelRole;
  modelRef: string | null;
  issue: OpenCodeConfigModelIssue | null;
};

export type OpenCodeRuntimeConfigOverlayResult = {
  ok: boolean;
  config: Record<string, unknown> | null;
  issues: OpenCodeConfigModelIssue[];
};

type ModelDeclaration = {
  unavailableReason: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function applyOpenCodeRuntimeMultiAgentPermission(
  config: Readonly<Record<string, unknown>>,
  multiAgentEnabled: boolean
): Record<string, unknown> {
  const overlay: Record<string, unknown> = { ...config };
  if (multiAgentEnabled) {
    return overlay;
  }

  const permission = isPlainObject(config.permission)
    ? { ...config.permission }
    : {};
  overlay.permission = {
    ...permission,
    task: "deny",
  };
  return overlay;
}

export function applyOpenCodeRuntimeMultiAgentEnvOverrides(
  envOverrides: Readonly<Record<string, string>>,
  multiAgentEnabled: boolean
): Record<string, string> {
  const next = { ...envOverrides };
  if (!multiAgentEnabled) {
    // Inline config has higher OpenCode precedence than a project config.
    next.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { task: "deny" } });
  }
  return next;
}

function addIssue(issues: OpenCodeConfigModelIssue[], issue: OpenCodeConfigModelIssue): void {
  if (!issues.some((current) => (
    current.code === issue.code
    && current.role === issue.role
    && current.ref === issue.ref
    && current.providerId === issue.providerId
    && current.modelId === issue.modelId
  ))) {
    issues.push(issue);
  }
}

function readStringSet(
  value: unknown,
  fieldPath: string,
  issueCode: "invalid-provider-filter" | "invalid-model-filter",
  issues: OpenCodeConfigModelIssue[],
  providerId?: string
): Set<string> | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    addIssue(issues, {
      code: issueCode,
      severity: "error",
      message: `OpenCode ${fieldPath} must be an array of non-empty strings.`,
      ...(providerId ? { providerId } : {}),
    });
    return new Set<string>();
  }
  return new Set(value.map((item) => item.trim()));
}

export function parseOpenCodeModelReference(
  value: string | null | undefined
): OpenCodeModelReference | null {
  const normalized = value?.trim();
  if (!normalized || /\s/u.test(normalized)) {
    return null;
  }
  const separatorIndex = normalized.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return null;
  }
  const providerId = normalized.slice(0, separatorIndex);
  const modelId = normalized.slice(separatorIndex + 1);
  if (modelId.split("/").some((segment) => !segment)) {
    return null;
  }
  return { ref: normalized, providerId, modelId };
}

function readConfiguredRef(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validateConfiguredRole(
  role: OpenCodeModelRole,
  rawValue: unknown,
  config: Record<string, unknown>,
  candidatesByRef: Map<string, OpenCodeConfigModelCandidate>,
  declarationsByRef: Map<string, ModelDeclaration>,
  issues: OpenCodeConfigModelIssue[]
): OpenCodeConfigModelCandidate | null {
  if (rawValue === undefined || rawValue === null || (typeof rawValue === "string" && !rawValue.trim())) {
    if (role === "primary") {
      addIssue(issues, {
        code: "role-model-missing",
        severity: "error",
        role,
        message: "OpenCode primary model is missing; configure top-level model as an exact provider/model reference.",
      });
    }
    return null;
  }
  if (typeof rawValue !== "string") {
    addIssue(issues, {
      code: "role-model-invalid-type",
      severity: "error",
      role,
      message: `OpenCode ${role} model must be a string in provider/model format.`,
    });
    return null;
  }

  const target = parseOpenCodeModelReference(rawValue);
  const normalizedRef = rawValue.trim();
  if (!target) {
    addIssue(issues, {
      code: "role-model-invalid-ref",
      severity: "error",
      role,
      ref: normalizedRef,
      message: `OpenCode ${role} model "${normalizedRef}" must be an exact provider/model reference.`,
    });
    return null;
  }

  const providers = isPlainObject(config.provider) ? config.provider : {};
  const providerConfig = providers[target.providerId];
  if (!isPlainObject(providerConfig)) {
    addIssue(issues, {
      code: "role-provider-not-found",
      severity: "error",
      role,
      ref: target.ref,
      providerId: target.providerId,
      modelId: target.modelId,
      message: `OpenCode ${role} model "${target.ref}" references missing provider "${target.providerId}".`,
    });
    return null;
  }
  const models = isPlainObject(providerConfig.models) ? providerConfig.models : {};
  if (!Object.prototype.hasOwnProperty.call(models, target.modelId)) {
    addIssue(issues, {
      code: "role-model-not-found",
      severity: "error",
      role,
      ref: target.ref,
      providerId: target.providerId,
      modelId: target.modelId,
      message: `OpenCode ${role} model "${target.ref}" is not declared at provider.${target.providerId}.models.${target.modelId}.`,
    });
    return null;
  }

  const candidate = candidatesByRef.get(target.ref);
  if (candidate) {
    return candidate;
  }
  const declaration = declarationsByRef.get(target.ref);
  addIssue(issues, {
    code: "role-model-unavailable",
    severity: "error",
    role,
    ref: target.ref,
    providerId: target.providerId,
    modelId: target.modelId,
    message: `OpenCode ${role} model "${target.ref}" is unavailable${declaration?.unavailableReason ? `: ${declaration.unavailableReason}` : "."}`,
  });
  return null;
}

function parseOpenCodeConfigObject(config: Record<string, unknown>): ParsedOpenCodeConfigModels {
  const issues: OpenCodeConfigModelIssue[] = [];
  const candidates: OpenCodeConfigModelCandidate[] = [];
  const declarationsByRef = new Map<string, ModelDeclaration>();
  const enabledProviders = readStringSet(
    config.enabled_providers,
    "enabled_providers",
    "invalid-provider-filter",
    issues
  );
  const disabledProviders = readStringSet(
    config.disabled_providers,
    "disabled_providers",
    "invalid-provider-filter",
    issues
  ) ?? new Set<string>();
  const providers = isPlainObject(config.provider) ? config.provider : {};

  for (const [providerId, rawProviderConfig] of Object.entries(providers)) {
    if (!isPlainObject(rawProviderConfig)) {
      addIssue(issues, {
        code: "invalid-provider-config",
        severity: "error",
        providerId,
        message: `OpenCode provider.${providerId} must be an object.`,
      });
      continue;
    }

    const providerLabel = typeof rawProviderConfig.name === "string" && rawProviderConfig.name.trim()
      ? rawProviderConfig.name.trim()
      : providerId;
    const whitelist = readStringSet(
      rawProviderConfig.whitelist,
      `provider.${providerId}.whitelist`,
      "invalid-model-filter",
      issues,
      providerId
    );
    const blacklist = readStringSet(
      rawProviderConfig.blacklist,
      `provider.${providerId}.blacklist`,
      "invalid-model-filter",
      issues,
      providerId
    ) ?? new Set<string>();
    const providerDisabled = disabledProviders.has(providerId);
    const providerNotEnabled = enabledProviders !== null && !enabledProviders.has(providerId);
    const rawModels = rawProviderConfig.models;
    if (rawModels !== undefined && !isPlainObject(rawModels)) {
      addIssue(issues, {
        code: "invalid-model-config",
        severity: "error",
        providerId,
        message: `OpenCode provider.${providerId}.models must be an object.`,
      });
      continue;
    }

    for (const [modelId, rawModelConfig] of Object.entries(isPlainObject(rawModels) ? rawModels : {})) {
      const ref = `${providerId}/${modelId}`;
      let unavailableReason: string | null = null;
      let unavailableCode: OpenCodeConfigModelIssueCode | null = null;
      let unavailableMessage = "";
      if (!isPlainObject(rawModelConfig)) {
        unavailableReason = "its model declaration is not an object.";
        unavailableCode = "invalid-model-config";
        unavailableMessage = `OpenCode model declaration "${ref}" must be an object.`;
      } else if (providerDisabled) {
        unavailableReason = `provider "${providerId}" is listed in disabled_providers.`;
        unavailableCode = "provider-disabled";
        unavailableMessage = `OpenCode model "${ref}" is excluded because provider "${providerId}" is disabled.`;
      } else if (providerNotEnabled) {
        unavailableReason = `provider "${providerId}" is not listed in enabled_providers.`;
        unavailableCode = "provider-not-enabled";
        unavailableMessage = `OpenCode model "${ref}" is excluded because provider "${providerId}" is not enabled.`;
      } else if (blacklist.has(modelId)) {
        unavailableReason = `model "${modelId}" is listed in provider.${providerId}.blacklist.`;
        unavailableCode = "model-blacklisted";
        unavailableMessage = `OpenCode model "${ref}" is excluded by provider blacklist.`;
      } else if (whitelist !== null && !whitelist.has(modelId)) {
        unavailableReason = `model "${modelId}" is not listed in provider.${providerId}.whitelist.`;
        unavailableCode = "model-not-whitelisted";
        unavailableMessage = `OpenCode model "${ref}" is excluded because it is not whitelisted.`;
      } else if (rawModelConfig.disabled === true || rawModelConfig.status === "disabled") {
        unavailableReason = "the model declaration is disabled.";
        unavailableCode = "model-disabled";
        unavailableMessage = `OpenCode model "${ref}" is disabled.`;
      } else if (rawModelConfig.status === "deprecated") {
        unavailableReason = "deprecated models are removed from resolved OpenCode models.";
        unavailableCode = "model-deprecated";
        unavailableMessage = `OpenCode model "${ref}" is deprecated and unavailable.`;
      }

      declarationsByRef.set(ref, { unavailableReason });
      if (unavailableCode) {
        addIssue(issues, {
          code: unavailableCode,
          severity: unavailableCode === "invalid-model-config" ? "error" : "warning",
          ref,
          providerId,
          modelId,
          message: unavailableMessage,
        });
        continue;
      }
      if (!isPlainObject(rawModelConfig)) {
        continue;
      }

      const modelLabel = typeof rawModelConfig.name === "string" && rawModelConfig.name.trim()
        ? rawModelConfig.name.trim()
        : modelId;
      const resolution = rawModelConfig.status === "alpha" ? "conditional" : "unverified";
      if (resolution === "conditional") {
        addIssue(issues, {
          code: "model-resolution-conditional",
          severity: "warning",
          ref,
          providerId,
          modelId,
          message: `OpenCode model "${ref}" has alpha status; raw config cannot determine whether the active runtime experiment resolves it.`,
        });
      }
      candidates.push({
        ref,
        value: ref,
        providerId,
        modelId,
        providerLabel,
        modelLabel,
        label: modelLabel,
        resolution,
      });
    }
  }

  const candidatesByRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  return {
    config,
    candidates,
    primaryModelRef: readConfiguredRef(config.model),
    smallModelRef: readConfiguredRef(config.small_model),
    primaryModel: validateConfiguredRole(
      "primary",
      config.model,
      config,
      candidatesByRef,
      declarationsByRef,
      issues
    ),
    smallModel: validateConfiguredRole(
      "small",
      config.small_model,
      config,
      candidatesByRef,
      declarationsByRef,
      issues
    ),
    issues,
  };
}

export function parseOpenCodeConfigModels(
  content: string | null | undefined
): ParsedOpenCodeConfigModels {
  const text = typeof content === "string" && content.trim() ? content : "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return emptyParsedResult(`OpenCode config JSON is invalid: ${(error as Error).message}`);
  }
  if (!isPlainObject(parsed)) {
    return emptyParsedResult("OpenCode config must be a JSON object.");
  }
  return parseOpenCodeConfigObject(parsed);
}

function emptyParsedResult(message: string): ParsedOpenCodeConfigModels {
  return {
    config: null,
    candidates: [],
    primaryModelRef: null,
    smallModelRef: null,
    primaryModel: null,
    smallModel: null,
    issues: [{ code: "invalid-json", severity: "error", message }],
  };
}

export function validateOpenCodeModelOverride(
  parsed: ParsedOpenCodeConfigModels,
  role: OpenCodeModelRole,
  value: string | null | undefined
): OpenCodeModelOverrideValidation {
  if (value === null || value === undefined || !value.trim()) {
    return { ok: true, role, modelRef: null, issue: null };
  }
  const target = parseOpenCodeModelReference(value);
  if (!target) {
    const issue: OpenCodeConfigModelIssue = {
      code: "override-model-invalid-ref",
      severity: "error",
      role,
      ref: value.trim(),
      message: `OpenCode ${role} override "${value.trim()}" must be an exact provider/model reference from the active config.`,
    };
    return { ok: false, role, modelRef: null, issue };
  }
  if (!parsed.candidates.some((candidate) => candidate.ref === target.ref)) {
    const issue: OpenCodeConfigModelIssue = {
      code: "override-model-unavailable",
      severity: "error",
      role,
      ref: target.ref,
      providerId: target.providerId,
      modelId: target.modelId,
      message: `OpenCode ${role} override "${target.ref}" is not an available model declared by the active config.`,
    };
    return { ok: false, role, modelRef: null, issue };
  }
  return { ok: true, role, modelRef: target.ref, issue: null };
}

export function applyOpenCodeRuntimeModelOverlay(
  config: Readonly<Record<string, unknown>>,
  overrides: {
    primary?: string | null;
    small?: string | null;
    primaryVariant?: string | null;
    smallVariant?: string | null;
  }
): OpenCodeRuntimeConfigOverlayResult {
  const parsed = parseOpenCodeConfigObject(config as Record<string, unknown>);
  const primary = validateOpenCodeModelOverride(parsed, "primary", overrides.primary);
  const small = validateOpenCodeModelOverride(parsed, "small", overrides.small);
  const issues = [primary.issue, small.issue].filter(
    (issue): issue is OpenCodeConfigModelIssue => issue !== null
  );
  if (issues.length > 0) {
    return { ok: false, config: null, issues };
  }

  const overlay: Record<string, unknown> = { ...config };
  if (primary.modelRef !== null) {
    overlay.model = primary.modelRef;
  }
  if (small.modelRef !== null) {
    overlay.small_model = small.modelRef;
  }
  const applyVariant = (modelRef: string | null, variant: string | null | undefined): void => {
    const normalizedVariant = typeof variant === "string" ? variant.trim() : "";
    if (!modelRef || !normalizedVariant) {
      return;
    }
    const reference = parseOpenCodeModelReference(modelRef);
    if (!reference) {
      return;
    }
    const providers = isPlainObject(overlay.provider)
      ? { ...overlay.provider }
      : null;
    if (!providers) {
      return;
    }
    const provider = isPlainObject(providers[reference.providerId])
      ? { ...providers[reference.providerId] as Record<string, unknown> }
      : null;
    if (!provider) {
      return;
    }
    const models = isPlainObject(provider.models)
      ? { ...provider.models }
      : null;
    if (!models) {
      return;
    }
    const model = models[reference.modelId];
    const nextModel = isPlainObject(model) ? { ...model } : {};
    const options = isPlainObject(nextModel.options) ? { ...nextModel.options } : {};
    options.reasoningEffort = normalizedVariant;
    nextModel.options = options;
    models[reference.modelId] = nextModel;
    provider.models = models;
    providers[reference.providerId] = provider;
    overlay.provider = providers;
  };
  applyVariant(primary.modelRef, overrides.primaryVariant);
  applyVariant(small.modelRef, overrides.smallVariant);
  return { ok: true, config: overlay, issues: [] };
}
