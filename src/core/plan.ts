import type {CleanPlan, CleanupCandidate, CleanupOptions, SessionEntry} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildCleanPlan(codexHome: string, sessions: SessionEntry[], options: CleanupOptions): CleanPlan {
  if (!Number.isFinite(options.retentionDays) || options.retentionDays < 1) {
    throw new Error('retentionDays must be a positive number');
  }

  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.retentionDays * MS_PER_DAY);
  const includeArchived = options.includeArchived ?? true;
  const candidates = sessions
    .filter((entry) => includeArchived || entry.area !== 'archived')
    .filter((entry) => entry.modifiedAt.getTime() < cutoff.getTime())
    .map((entry) => ({
      ...entry,
      reason: `${entry.area} session older than ${options.retentionDays} days`
    }));

  const candidatePaths = new Set(candidates.map((entry) => entry.path));
  const kept = sessions.filter((entry) => !candidatePaths.has(entry.path));

  return {
    codexHome,
    retentionDays: options.retentionDays,
    cutoff,
    candidates,
    kept,
    totalBytes: candidates.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  };
}

export function buildSelectedCleanPlan(codexHome: string, sessions: SessionEntry[]): CleanPlan {
  const candidates: CleanupCandidate[] = sessions.map((entry) => ({
    ...entry,
    reason: 'selected in session janitor'
  }));

  return {
    codexHome,
    retentionDays: 0,
    cutoff: new Date(0),
    candidates,
    kept: [],
    totalBytes: candidates.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  };
}
