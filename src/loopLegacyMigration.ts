import * as path from "path";

const LEGACY_LOOP_PROPERTY_PREFIX = "lobster";
const LEGACY_LOOP_TYPE_PREFIX = "Lobster";
const LOOP_PROPERTY_PREFIX = "loop";
const LOOP_TYPE_PREFIX = "Loop";

export const LEGACY_LOOP_TASK_STORE_DIR_NAME = "lobster-tasks";
export const LEGACY_LOOP_TASK_STORE_FILENAME = "lobster-tasks.json";
export const LEGACY_LOOP_COMMUNICATION_DIR_NAME = "lobster-communications";
export const LEGACY_LOOP_INTERACTIVE_MODE = "lobster";
export const LEGACY_LOOP_GROUP_CHAT_COMMAND_ID = "sinitek-cli-tools.openLobsterDebateChat";
export const LEGACY_LOOP_GROUP_CHAT_ACTION_TYPE = "openLobsterDebateChat";

export const LOOP_GROUP_CHAT_COMMAND_ID = "sinitek-cli-tools.openLoopGroupChat";
export const LOOP_GROUP_CHAT_ACTION_TYPE = "openLoopGroupChat";

export type LoopLegacyMigrationResult<T> = {
  value: T;
  changed: boolean;
};

export type LoopLegacyStoragePaths = {
  taskStoreDir: string;
  taskStoreFlatFile: string;
  communicationDir: string;
};

export function getLegacyLoopStoragePaths(dataDir: string): LoopLegacyStoragePaths {
  return {
    taskStoreDir: path.join(dataDir, LEGACY_LOOP_TASK_STORE_DIR_NAME),
    taskStoreFlatFile: path.join(dataDir, LEGACY_LOOP_TASK_STORE_FILENAME),
    communicationDir: path.join(dataDir, LEGACY_LOOP_COMMUNICATION_DIR_NAME),
  };
}

export function isLegacyLoopInteractiveMode(value: unknown): boolean {
  return value === LEGACY_LOOP_INTERACTIVE_MODE;
}

export function getLegacyLoopPropertyKey(loopKey: string): string {
  if (loopKey.startsWith(LOOP_PROPERTY_PREFIX)) {
    return `${LEGACY_LOOP_PROPERTY_PREFIX}${loopKey.slice(LOOP_PROPERTY_PREFIX.length)}`;
  }
  if (loopKey.startsWith(LOOP_TYPE_PREFIX)) {
    return `${LEGACY_LOOP_TYPE_PREFIX}${loopKey.slice(LOOP_TYPE_PREFIX.length)}`;
  }
  return loopKey;
}

export function isLegacyLoopTaskStorePath(filePath: string, dataDir: string): boolean {
  const legacy = getLegacyLoopStoragePaths(dataDir);
  return isPathAtOrWithin(filePath, legacy.taskStoreDir)
    || path.resolve(filePath) === path.resolve(legacy.taskStoreFlatFile);
}

export function migrateLegacyLoopStoragePath(value: string, dataDir: string): string {
  const legacy = getLegacyLoopStoragePaths(dataDir);
  const loopTaskStoreDir = path.join(dataDir, "loop-tasks");
  const loopCommunicationDir = path.join(dataDir, "loop-communications");
  const loopTaskStoreFlatFile = path.join(dataDir, "loop-tasks.json");

  const migratedCommunicationPath = replacePathRoot(value, legacy.communicationDir, loopCommunicationDir);
  if (migratedCommunicationPath !== value) {
    return migratedCommunicationPath;
  }
  const migratedTaskStorePath = replacePathRoot(value, legacy.taskStoreDir, loopTaskStoreDir);
  if (migratedTaskStorePath !== value) {
    return path.basename(migratedTaskStorePath) === LEGACY_LOOP_TASK_STORE_FILENAME
      ? path.join(path.dirname(migratedTaskStorePath), "loop-tasks.json")
      : migratedTaskStorePath;
  }
  if (path.resolve(value) === path.resolve(legacy.taskStoreFlatFile)) {
    return loopTaskStoreFlatFile;
  }
  return value;
}

export function migrateLegacyLoopJson<T>(value: T, dataDir?: string): LoopLegacyMigrationResult<T> {
  const migrated = migrateJsonValue(value, dataDir);
  return migrated as LoopLegacyMigrationResult<T>;
}

function migrateJsonValue(value: unknown, dataDir?: string): LoopLegacyMigrationResult<unknown> {
  if (typeof value === "string") {
    if (dataDir) {
      const migratedPath = migrateLegacyLoopStoragePath(value, dataDir);
      if (migratedPath !== value) {
        return { value: migratedPath, changed: true };
      }
    }
    return { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const migratedItems = value.map((item) => {
      const migrated = migrateJsonValue(item, dataDir);
      changed = changed || migrated.changed;
      return migrated.value;
    });
    return { value: changed ? migratedItems : value, changed };
  }
  if (!value || typeof value !== "object") {
    return { value, changed: false };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const migratedRecord: Record<string, unknown> = {};
  let changed = false;

  // Current keys win when a partially migrated record contains both spellings.
  for (const [key, item] of entries) {
    if (isLegacyLoopPropertyKey(key)) {
      continue;
    }
    const migrated = migrateJsonValue(item, dataDir);
    migratedRecord[key] = migrateKnownProtocolValue(key, migrated.value);
    changed = changed || migrated.changed || migratedRecord[key] !== migrated.value;
  }
  for (const [key, item] of entries) {
    if (!isLegacyLoopPropertyKey(key)) {
      continue;
    }
    const targetKey = migrateLegacyLoopPropertyKey(key);
    changed = true;
    if (Object.prototype.hasOwnProperty.call(migratedRecord, targetKey)) {
      continue;
    }
    const migrated = migrateJsonValue(item, dataDir);
    migratedRecord[targetKey] = migrateKnownProtocolValue(targetKey, migrated.value);
    changed = changed || migrated.changed || migratedRecord[targetKey] !== migrated.value;
  }

  return { value: changed ? migratedRecord : value, changed };
}

function isLegacyLoopPropertyKey(key: string): boolean {
  return key.startsWith(LEGACY_LOOP_PROPERTY_PREFIX) || key.startsWith(LEGACY_LOOP_TYPE_PREFIX);
}

function migrateLegacyLoopPropertyKey(key: string): string {
  if (key.startsWith(LEGACY_LOOP_PROPERTY_PREFIX)) {
    return `${LOOP_PROPERTY_PREFIX}${key.slice(LEGACY_LOOP_PROPERTY_PREFIX.length)}`;
  }
  if (key.startsWith(LEGACY_LOOP_TYPE_PREFIX)) {
    return `${LOOP_TYPE_PREFIX}${key.slice(LEGACY_LOOP_TYPE_PREFIX.length)}`;
  }
  return key;
}

function migrateKnownProtocolValue(key: string, value: unknown): unknown {
  if ((key === "interactiveMode" || key === "subagentProvider") && isLegacyLoopInteractiveMode(value)) {
    return "loop";
  }
  if (key === "type" && value === LEGACY_LOOP_GROUP_CHAT_ACTION_TYPE) {
    return LOOP_GROUP_CHAT_ACTION_TYPE;
  }
  return value;
}

function isPathAtOrWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function replacePathRoot(value: string, legacyRoot: string, loopRoot: string): string {
  if (!isPathAtOrWithin(value, legacyRoot)) {
    return value;
  }
  const relative = path.relative(path.resolve(legacyRoot), path.resolve(value));
  return relative ? path.join(loopRoot, relative) : loopRoot;
}
