import prettyBytes from 'pretty-bytes';

export function formatBytes(bytes: number): string {
  return prettyBytes(bytes, {binary: true});
}

export function formatAge(days: number): string {
  if (days < 1) return '<1d';
  return `${Math.floor(days)}d`;
}
