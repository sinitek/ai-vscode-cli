export type LoopParallelCandidate = {
  id: string;
  title?: string;
  conflictGroup?: string;
  writeFiles?: string[];
};

export type LoopParallelConflictReason = "conflictGroup" | "writeFiles";

export type LoopParallelConflict = {
  leftId: string;
  rightId: string;
  reason: LoopParallelConflictReason;
  value: string;
};

export type LoopSubtaskExecutionPlan<T extends LoopParallelCandidate> = {
  groups: T[][];
  conflicts: LoopParallelConflict[];
};

export function normalizeLoopWriteFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => normalizeLoopWriteFilePath(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

export function buildLoopSubtaskExecutionPlan<T extends LoopParallelCandidate>(
  subtasks: T[],
): LoopSubtaskExecutionPlan<T> {
  const groups: T[][] = [];
  const conflicts: LoopParallelConflict[] = [];

  subtasks.forEach((subtask) => {
    for (const group of groups) {
      const groupConflict = findFirstLoopSubtaskConflict(subtask, group);
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
      const conflict = getLoopSubtaskConflict(left, right);
      if (conflict) {
        conflicts.push(conflict);
      }
    }
  }

  return { groups, conflicts };
}

export function describeLoopExecutionPlan<T extends LoopParallelCandidate>(
  plan: LoopSubtaskExecutionPlan<T>,
): string[] {
  return plan.groups.map((group, index) => {
    const titles = group.map((item) => item.title || item.id).join("、");
    return `第 ${index + 1} 组：${titles}`;
  });
}

function findFirstLoopSubtaskConflict<T extends LoopParallelCandidate>(
  subtask: T,
  group: T[],
): LoopParallelConflict | null {
  for (const existing of group) {
    const conflict = getLoopSubtaskConflict(subtask, existing);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}

function getLoopSubtaskConflict(
  left: LoopParallelCandidate,
  right: LoopParallelCandidate,
): LoopParallelConflict | null {
  const leftConflictGroup = normalizeLoopConflictGroup(left.conflictGroup);
  const rightConflictGroup = normalizeLoopConflictGroup(right.conflictGroup);
  if (leftConflictGroup && rightConflictGroup && leftConflictGroup === rightConflictGroup) {
    return {
      leftId: left.id,
      rightId: right.id,
      reason: "conflictGroup",
      value: leftConflictGroup,
    };
  }

  const leftFiles = normalizeLoopWriteFiles(left.writeFiles);
  const rightFiles = normalizeLoopWriteFiles(right.writeFiles);
  for (const leftFile of leftFiles) {
    for (const rightFile of rightFiles) {
      if (loopWriteFilePathsOverlap(leftFile, rightFile)) {
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

function normalizeLoopConflictGroup(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
}

function normalizeLoopWriteFilePath(value: unknown): string | null {
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

function loopWriteFilePathsOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return isLoopPathAncestor(left, right) || isLoopPathAncestor(right, left);
}

function isLoopPathAncestor(parent: string, child: string): boolean {
  return Boolean(parent && child.startsWith(`${parent}/`));
}
