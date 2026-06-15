import os from 'node:os';
import path from 'node:path';

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
}

export function sessionRoots(codexHome: string, includeArchived = true): Array<{area: 'active' | 'archived'; root: string}> {
  const roots: Array<{area: 'active' | 'archived'; root: string}> = [
    {area: 'active', root: path.join(codexHome, 'sessions')}
  ];

  if (includeArchived) {
    roots.push({area: 'archived', root: path.join(codexHome, 'archived_sessions')});
  }

  return roots;
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function startupMarkerPath(codexHome: string): string {
  return path.join(codexHome, '.session-janitor-last-cleanup');
}
