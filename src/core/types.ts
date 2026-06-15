export type SessionArea = 'active' | 'archived';

export type DeleteMode = 'trash' | 'delete';

export interface SessionEntry {
  id: string;
  area: SessionArea;
  path: string;
  sizeBytes: number;
  modifiedAt: Date;
  ageDays: number;
}

export interface ScanOptions {
  codexHome: string;
  includeArchived?: boolean;
  now?: Date;
}

export interface CleanupOptions {
  retentionDays: number;
  includeArchived?: boolean;
  now?: Date;
}

export interface CleanupCandidate extends SessionEntry {
  reason: string;
}

export interface CleanPlan {
  codexHome: string;
  retentionDays: number;
  cutoff: Date;
  candidates: CleanupCandidate[];
  kept: SessionEntry[];
  totalBytes: number;
}

export interface CleanFailure {
  entry: CleanupCandidate;
  error: string;
}

export interface CleanResult {
  dryRun: boolean;
  removed: CleanupCandidate[];
  wouldRemove: CleanupCandidate[];
  failures: CleanFailure[];
  freedBytes: number;
}

export interface ExecuteOptions {
  dryRun?: boolean;
  mode?: DeleteMode;
}

export interface StartupCleanupOptions extends CleanupOptions {
  codexHome: string;
  dryRun?: boolean;
  mode?: DeleteMode;
  minIntervalHours?: number;
}
