#!/usr/bin/env node
import {Command} from 'commander';
import {render} from 'ink';
import React from 'react';
import {
  buildCleanPlan,
  defaultCodexHome,
  executeCleanPlan,
  formatBytes,
  runStartupCleanup,
  scanSessions
} from './core/index.js';
import {App} from './tui/App.js';

const program = new Command();

program
  .name('codex-session-janitor')
  .description('Scan, preview, and clean old local Codex session transcripts.')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan Codex session files and print a summary.')
  .option('--codex-home <path>', 'Codex home directory', defaultCodexHome())
  .option('--retention-days <days>', 'Show reclaimable bytes older than this many days', parsePositiveInt, 30)
  .option('--no-archived', 'Exclude archived sessions')
  .action(async (options) => {
    const now = new Date();
    const sessions = await scanSessions({
      codexHome: options.codexHome,
      includeArchived: options.archived,
      now
    });
    const plan = buildCleanPlan(options.codexHome, sessions, {
      retentionDays: options.retentionDays,
      includeArchived: options.archived,
      now
    });

    printSummary(sessions.length, plan.candidates.length, plan.totalBytes);
  });

program
  .command('clean')
  .description('Clean sessions older than a retention window. Dry-run unless --confirm is passed.')
  .requiredOption('--retention-days <days>', 'Delete sessions older than this many days', parsePositiveInt)
  .option('--codex-home <path>', 'Codex home directory', defaultCodexHome())
  .option('--no-archived', 'Exclude archived sessions')
  .option('--confirm', 'Actually remove files. Without this flag, the command is a dry run.')
  .option('--mode <mode>', 'Removal mode: trash or delete', 'trash')
  .action(async (options) => {
    if (!['trash', 'delete'].includes(options.mode)) {
      throw new Error('--mode must be either trash or delete');
    }

    const now = new Date();
    const sessions = await scanSessions({
      codexHome: options.codexHome,
      includeArchived: options.archived,
      now
    });
    const plan = buildCleanPlan(options.codexHome, sessions, {
      retentionDays: options.retentionDays,
      includeArchived: options.archived,
      now
    });
    const result = await executeCleanPlan(plan, {
      dryRun: !options.confirm,
      mode: options.mode
    });

    printSummary(sessions.length, plan.candidates.length, plan.totalBytes);
    if (result.dryRun) {
      console.log('Dry run only. Re-run with --confirm to remove files.');
    } else {
      console.log(`Removed ${result.removed.length} file(s), freed ${formatBytes(result.freedBytes)}.`);
      if (result.failures.length > 0) {
        console.error(`${result.failures.length} failure(s):`);
        for (const failure of result.failures) {
          console.error(`- ${failure.entry.path}: ${failure.error}`);
        }
        process.exitCode = 1;
      }
    }
  });

program
  .command('startup-clean')
  .description('Run the startup-style cleanup once per interval, matching the proposed Codex integration point.')
  .requiredOption('--retention-days <days>', 'Delete sessions older than this many days', parsePositiveInt)
  .option('--codex-home <path>', 'Codex home directory', defaultCodexHome())
  .option('--no-archived', 'Exclude archived sessions')
  .option('--confirm', 'Actually remove files. Without this flag, the command is a dry run.')
  .option('--mode <mode>', 'Removal mode: trash or delete', 'trash')
  .option('--interval-hours <hours>', 'Minimum hours between startup cleanup runs', parsePositiveInt, 24)
  .action(async (options) => {
    const result = await runStartupCleanup({
      codexHome: options.codexHome,
      retentionDays: options.retentionDays,
      includeArchived: options.archived,
      dryRun: !options.confirm,
      mode: options.mode,
      minIntervalHours: options.intervalHours
    });

    if (result === null) {
      console.log('Skipped: startup cleanup already ran within the interval.');
      return;
    }

    const count = result.dryRun ? result.wouldRemove.length : result.removed.length;
    console.log(`${result.dryRun ? 'Would remove' : 'Removed'} ${count} file(s), ${formatBytes(result.freedBytes)}.`);
  });

program
  .command('tui', {isDefault: true})
  .description('Open the interactive terminal UI.')
  .option('--codex-home <path>', 'Codex home directory', defaultCodexHome())
  .action((options) => {
    render(React.createElement(App, {codexHome: options.codexHome}));
  });

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('Expected a positive integer');
  }
  return parsed;
}

function printSummary(totalSessions: number, candidateCount: number, candidateBytes: number): void {
  console.log(`Scanned ${totalSessions} session file(s).`);
  console.log(`Matched ${candidateCount} expired file(s), reclaimable ${formatBytes(candidateBytes)}.`);
}

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
