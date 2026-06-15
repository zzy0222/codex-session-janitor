import fs from 'node:fs/promises';
import path from 'node:path';
import {sessionRoots} from './paths.js';
import type {ScanOptions, SessionEntry} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function scanSessions(options: ScanOptions): Promise<SessionEntry[]> {
  const now = options.now ?? new Date();
  const entries: SessionEntry[] = [];

  for (const {area, root} of sessionRoots(options.codexHome, options.includeArchived ?? true)) {
    if (!(await exists(root))) continue;

    for await (const file of walkFiles(root)) {
      const stat = await fs.stat(file);
      entries.push({
        id: sessionIdFromPath(file),
        area,
        path: file,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
        ageDays: Math.max(0, (now.getTime() - stat.mtime.getTime()) / MS_PER_DAY)
      });
    }
  }

  return entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const children = await fs.readdir(root, {withFileTypes: true});

  for (const child of children) {
    const childPath = path.join(root, child.name);
    if (child.isDirectory()) {
      yield* walkFiles(childPath);
    } else if (child.isFile()) {
      yield childPath;
    }
  }
}

function sessionIdFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.(jsonl|json|log|txt)$/i, '');
}
