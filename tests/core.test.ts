import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  buildCleanPlan,
  executeCleanPlan,
  runStartupCleanup,
  scanSessions,
  shouldRunStartupCleanup,
  startupMarkerPath
} from '../src/core/index.js';

const NOW = new Date('2026-06-16T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-session-janitor-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, {recursive: true, force: true});
});

describe('session scanning and planning', () => {
  it('scans active and archived session files recursively', async () => {
    const active = await writeSession('sessions/2026/06/active-a.jsonl', 5, 'active');
    const archived = await writeSession('archived_sessions/2026/05/archived-a.jsonl', 40, 'archived');

    const sessions = await scanSessions({codexHome: tmpRoot, now: NOW});

    expect(sessions).toHaveLength(2);
    expect(sessions.map((entry) => entry.path).sort()).toEqual([active, archived].sort());
    expect(sessions.find((entry) => entry.path === active)?.area).toBe('active');
    expect(sessions.find((entry) => entry.path === archived)?.area).toBe('archived');
  });

  it('extracts readable metadata from Codex JSONL transcripts', async () => {
    await writeJsonlSession('sessions/metadata.jsonl', 10, [
      {
        timestamp: '2026-06-01T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-with-metadata',
          timestamp: '2026-06-01T00:00:00.000Z',
          cwd: 'C:\\repo\\demo'
        }
      },
      {
        timestamp: '2026-06-01T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Build a cleanup tool\nThe tool should preview files before deleting them.'
            }
          ]
        }
      }
    ]);

    const [session] = await scanSessions({codexHome: tmpRoot, now: NOW});

    expect(session.id).toBe('session-with-metadata');
    expect(session.cwd).toBe('C:\\repo\\demo');
    expect(session.startedAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(session.title).toBe('Build a cleanup tool');
    expect(session.summary).toContain('preview files before deleting');
  });

  it('skips internal context when choosing a display title', async () => {
    await writeJsonlSession('sessions/context-noise.jsonl', 10, [
      {
        type: 'session_meta',
        payload: {
          id: 'session-with-context-noise',
          timestamp: '2026-06-01T00:00:00.000Z',
          cwd: 'C:\\repo\\demo'
        }
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text: '<environment_context>\n  <cwd>C:\\repo\\demo</cwd>\n</environment_context>'}]
        }
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text: '# AGENTS.md instructions for C:\\repo\\demo\n<INSTRUCTIONS>...</INSTRUCTIONS>'}]
        }
      },
      {
        type: 'turn_context',
        payload: {
          summary: 'auto'
        }
      },
      {
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'Add readable session cards to the TUI.'
        }
      }
    ]);

    const [session] = await scanSessions({codexHome: tmpRoot, now: NOW});

    expect(session.title).toBe('Add readable session cards to the TUI.');
    expect(session.summary).toBe('Add readable session cards to the TUI.');
  });

  it('marks only files older than the retention cutoff', async () => {
    const oldFile = await writeSession('sessions/old.jsonl', 31, 'old');
    await writeSession('sessions/exact-cutoff.jsonl', 30, 'exact');
    await writeSession('sessions/recent.jsonl', 2, 'recent');

    const sessions = await scanSessions({codexHome: tmpRoot, now: NOW});
    const plan = buildCleanPlan(tmpRoot, sessions, {retentionDays: 30, now: NOW});

    expect(plan.candidates.map((entry) => entry.path)).toEqual([oldFile]);
    expect(plan.kept).toHaveLength(2);
  });

  it('can exclude archived sessions from the clean plan', async () => {
    const oldActive = await writeSession('sessions/old-active.jsonl', 60, 'active');
    await writeSession('archived_sessions/old-archived.jsonl', 60, 'archived');

    const sessions = await scanSessions({codexHome: tmpRoot, now: NOW});
    const plan = buildCleanPlan(tmpRoot, sessions, {
      retentionDays: 30,
      includeArchived: false,
      now: NOW
    });

    expect(plan.candidates.map((entry) => entry.path)).toEqual([oldActive]);
  });
});

describe('clean execution', () => {
  it('dry-runs without removing files', async () => {
    const oldFile = await writeSession('sessions/old.jsonl', 60, 'old');
    const plan = await planFor(30);

    const result = await executeCleanPlan(plan, {dryRun: true, mode: 'delete'});

    expect(result.wouldRemove).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
    await expect(fs.stat(oldFile)).resolves.toBeTruthy();
  });

  it('deletes expired files when confirmed with delete mode', async () => {
    const oldFile = await writeSession('sessions/old.jsonl', 60, 'old');
    const recentFile = await writeSession('sessions/recent.jsonl', 1, 'recent');
    const plan = await planFor(30);

    const result = await executeCleanPlan(plan, {dryRun: false, mode: 'delete'});

    expect(result.failures).toHaveLength(0);
    expect(result.removed.map((entry) => entry.path)).toEqual([oldFile]);
    await expect(fs.stat(oldFile)).rejects.toThrow();
    await expect(fs.stat(recentFile)).resolves.toBeTruthy();
  });

  it('refuses candidates outside Codex session roots', async () => {
    const outside = path.join(tmpRoot, 'config.toml');
    await fs.writeFile(outside, 'model = "test"', 'utf8');
    const oldDate = new Date(NOW.getTime() - 90 * MS_PER_DAY);
    await fs.utimes(outside, oldDate, oldDate);

    const plan = buildCleanPlan(
      tmpRoot,
      [
        {
          id: 'config',
          area: 'active',
          path: outside,
          sizeBytes: 14,
          modifiedAt: oldDate,
          ageDays: 90
        }
      ],
      {retentionDays: 30, now: NOW}
    );

    const result = await executeCleanPlan(plan, {dryRun: false, mode: 'delete'});

    expect(result.removed).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    await expect(fs.stat(outside)).resolves.toBeTruthy();
  });
});

describe('startup cleanup', () => {
  it('runs when no marker exists and writes a marker', async () => {
    await writeSession('sessions/old.jsonl', 60, 'old');

    const result = await runStartupCleanup({
      codexHome: tmpRoot,
      retentionDays: 30,
      now: NOW,
      dryRun: true,
      mode: 'delete'
    });

    expect(result?.wouldRemove).toHaveLength(1);
    await expect(fs.readFile(startupMarkerPath(tmpRoot), 'utf8')).resolves.toContain('2026-06-16');
  });

  it('skips when startup cleanup already ran within the interval', async () => {
    await fs.writeFile(startupMarkerPath(tmpRoot), NOW.toISOString(), 'utf8');

    await expect(shouldRunStartupCleanup(tmpRoot, 24, new Date(NOW.getTime() + 2 * 60 * 60 * 1000))).resolves.toBe(false);
    const result = await runStartupCleanup({
      codexHome: tmpRoot,
      retentionDays: 30,
      now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
      dryRun: true
    });

    expect(result).toBeNull();
  });
});

async function planFor(retentionDays: number) {
  const sessions = await scanSessions({codexHome: tmpRoot, now: NOW});
  return buildCleanPlan(tmpRoot, sessions, {retentionDays, now: NOW});
}

async function writeSession(relativePath: string, ageDays: number, content: string): Promise<string> {
  const filePath = path.join(tmpRoot, relativePath);
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  await fs.writeFile(filePath, `${content}\n`, 'utf8');
  const modified = new Date(NOW.getTime() - ageDays * MS_PER_DAY);
  await fs.utimes(filePath, modified, modified);
  return filePath;
}

async function writeJsonlSession(relativePath: string, ageDays: number, records: unknown[]): Promise<string> {
  return writeSession(relativePath, ageDays, records.map((record) => JSON.stringify(record)).join('\n'));
}
