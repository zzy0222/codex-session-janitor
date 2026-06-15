import fs from 'node:fs/promises';
import path from 'node:path';
import trash from 'trash';
import {isInside, sessionRoots} from './paths.js';
import type {CleanPlan, CleanResult, CleanupCandidate, ExecuteOptions} from './types.js';

export async function executeCleanPlan(plan: CleanPlan, options: ExecuteOptions = {}): Promise<CleanResult> {
  const dryRun = options.dryRun ?? true;
  const mode = options.mode ?? 'trash';

  if (dryRun) {
    return {
      dryRun: true,
      removed: [],
      wouldRemove: plan.candidates,
      failures: [],
      freedBytes: plan.totalBytes
    };
  }

  const removed: CleanupCandidate[] = [];
  const failures: CleanResult['failures'] = [];
  const roots = sessionRoots(plan.codexHome, true).map(({root}) => root);

  for (const entry of plan.candidates) {
    try {
      assertSafeSessionPath(roots, entry.path);
      if (mode === 'trash') {
        await trash([entry.path]);
      } else {
        await fs.rm(entry.path, {force: true});
      }
      removed.push(entry);
      await pruneEmptyParents(entry.path, roots);
    } catch (error) {
      failures.push({
        entry,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    dryRun: false,
    removed,
    wouldRemove: [],
    failures,
    freedBytes: removed.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  };
}

function assertSafeSessionPath(roots: string[], target: string): void {
  if (!roots.some((root) => isInside(root, target))) {
    throw new Error(`Refusing to remove path outside Codex session roots: ${target}`);
  }
}

async function pruneEmptyParents(filePath: string, roots: string[]): Promise<void> {
  let current = path.dirname(filePath);

  while (roots.some((root) => isInside(root, current)) && !roots.includes(path.resolve(current))) {
    try {
      await fs.rmdir(current);
      current = path.dirname(current);
    } catch {
      return;
    }
  }
}
