import fs from 'node:fs/promises';
import {startupMarkerPath} from './paths.js';
import {scanSessions} from './scan.js';
import {buildCleanPlan} from './plan.js';
import {executeCleanPlan} from './clean.js';
import type {CleanResult, StartupCleanupOptions} from './types.js';

const DEFAULT_INTERVAL_HOURS = 24;

export async function shouldRunStartupCleanup(
  codexHome: string,
  minIntervalHours = DEFAULT_INTERVAL_HOURS,
  now = new Date()
): Promise<boolean> {
  const marker = startupMarkerPath(codexHome);

  try {
    const raw = await fs.readFile(marker, 'utf8');
    const lastRun = new Date(raw.trim());
    if (Number.isNaN(lastRun.getTime())) return true;
    const elapsedHours = (now.getTime() - lastRun.getTime()) / (60 * 60 * 1000);
    return elapsedHours >= minIntervalHours;
  } catch {
    return true;
  }
}

export async function runStartupCleanup(options: StartupCleanupOptions): Promise<CleanResult | null> {
  const now = options.now ?? new Date();
  const minIntervalHours = options.minIntervalHours ?? DEFAULT_INTERVAL_HOURS;
  if (!(await shouldRunStartupCleanup(options.codexHome, minIntervalHours, now))) {
    return null;
  }

  const sessions = await scanSessions({
    codexHome: options.codexHome,
    includeArchived: options.includeArchived,
    now
  });
  const plan = buildCleanPlan(options.codexHome, sessions, {
    retentionDays: options.retentionDays,
    includeArchived: options.includeArchived,
    now
  });
  const result = await executeCleanPlan(plan, {
    dryRun: options.dryRun,
    mode: options.mode
  });

  await fs.mkdir(options.codexHome, {recursive: true});
  await fs.writeFile(startupMarkerPath(options.codexHome), now.toISOString(), 'utf8');
  return result;
}
