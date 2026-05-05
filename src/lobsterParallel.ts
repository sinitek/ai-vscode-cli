export type LobsterParallelCandidate = {
  id: string;
  title?: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

export type LobsterParallelConflictReason = "conflictGroup" | "writeFiles";

export type LobsterParallelConflict = {
  leftId: string;
  rightId: string;
  reason: LobsterParallelConflictReason;
  value: string;
};

export type LobsterSubtaskExecutionPlan<T extends LobsterParallelCandidate> = {
  groups: T[][];
  conflicts: LobsterParallelConflict[];
};

export function normalizeLobsterWriteFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => normalizeLobsterWriteFilePath(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

export function buildLobsterSubtaskExecutionPlan<T extends LobsterParallelCandidate>(
  subtasks: T[],
): LobsterSubtaskExecutionPlan<T> {
  const groups: T[][] = [];
  const conflicts: LobsterParallelConflict[] = [];

  subtasks.forEach((subtask) => {
    for (const group of groups) {
      const groupConflict = findFirstLobsterSubtaskConflict(subtask, group);
      if (!groupConflict) {
        group.push(subtask);
        return;
      }
    }
    groups.push([subtask]);
  });

  for (let leftIndex = 0; leftIndex < subtasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < subtasks.length; rightIndex += 1) {
      const left = subtasks[leftIndex];
      const right = subtasks[rightIndex];
      if (!left || !right) {
        continue;
      }
      const conflict = getLobsterSubtaskConflict(left, right);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
  }

  return { groups, conflicts };
}

export function describeLobsterExecutionPlan<T extends LobsterParallelCandidate>(
  plan: LobsterSubtaskExecutionPlan<T>,
): string[] {
  return plan.groups.map((group, index) => {
    const titles = group.map((item) => item.title || item.id).join("、");
    return `第 ${index + 1} 组：${titles}`;
  });
}

function findFirstLobsterSubtaskConflict<T extends LobsterParallelCandidate>(
  subtask: T,
  group: T[],
): LobsterParallelConflict | null {
  for (const existing of group) {
    const conflict = getLobsterSubtaskConflict(subtask, existing);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}

function getLobsterSubtaskConflict(
  left: LobsterParallelCandidate,
  right: LobsterParallelCandidate,
): LobsterParallelConflict | null {
  const leftConflictGroup = normalizeLobsterConflictGroup(left.conflictGroup);
  const rightConflictGroup = normalizeLobsterConflictGroup(right.conflictGroup);
  if (leftConflictGroup && rightConflictGroup && leftConflictGroup === rightConflictGroup) {
    return {
      leftId: left.id,
      rightId: right.id,
      reason: "conflictGroup",
      value: leftConflictGroup,
    };
  }

  const leftFiles = normalizeLobsterWriteFiles(left.writeFiles);
  const rightFiles = normalizeLobsterWriteFiles(right.writeFiles);
  for (const leftFile of leftFiles) {
    for (const rightFile of rightFiles) {
      if (lobsterWriteFilePathsOverlap(leftFile, rightFile)) {
        return {
          leftId: left.id,
          rightId: right.id,
          reason: "writeFiles",
          value: leftFile === rightFile ? leftFile : `${leftFile} <-> ${rightFile}`,
        };
      }
    }
  }

  return null;
}

function normalizeLobsterConflictGroup(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

function normalizeLobsterWriteFilePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/\.\//g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
  return normalized || null;
}

function lobsterWriteFilePathsOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return isLobsterPathAncestor(left, right) || isLobsterPathAncestor(right, left);
}

function isLobsterPathAncestor(parent: string, child: string): boolean {
  return Boolean(parent && child.startsWith(`${parent}/`));
}
