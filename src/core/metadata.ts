import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';

export interface SessionMetadata {
  id?: string;
  title?: string;
  summary?: string;
  cwd?: string;
  startedAt?: Date;
}

const MAX_LINES = 200;
const TITLE_LENGTH = 80;
const SUMMARY_LENGTH = 220;

export async function readSessionMetadata(filePath: string): Promise<SessionMetadata> {
  const metadata: SessionMetadata = {};
  const rl = createInterface({
    input: createReadStream(filePath, {encoding: 'utf8'}),
    crlfDelay: Infinity
  });

  let lineCount = 0;
  try {
    for await (const line of rl) {
      lineCount += 1;
      if (line.trim() === '') continue;

      inspectRecord(safeJsonParse(line), metadata);
      if (hasEnoughMetadata(metadata) || lineCount >= MAX_LINES) {
        rl.close();
        break;
      }
    }
  } finally {
    rl.close();
  }

  return metadata;
}

function inspectRecord(record: unknown, metadata: SessionMetadata): void {
  if (!isObject(record)) return;

  const type = stringValue(record.type);
  const payload = isObject(record.payload) ? record.payload : undefined;

  if (type === 'session_meta' && payload) {
    metadata.id ??= stringValue(payload.id);
    metadata.cwd ??= stringValue(payload.cwd);
    metadata.startedAt ??= dateValue(payload.timestamp);
    metadata.title ??= cleanText(stringValue(payload.title), TITLE_LENGTH);
    metadata.summary ??= cleanText(stringValue(payload.summary), SUMMARY_LENGTH);
    return;
  }

  if (payload) {
    metadata.title ??= cleanText(stringValue(payload.title), TITLE_LENGTH);
    metadata.summary ??= cleanText(stringValue(payload.summary), SUMMARY_LENGTH);
  }

  const userText = userMessageText(payload ?? record);
  if (userText) {
    metadata.title ??= cleanText(firstLine(userText), TITLE_LENGTH);
    metadata.summary ??= cleanText(userText, SUMMARY_LENGTH);
  }
}

function userMessageText(record: unknown): string | undefined {
  if (!isObject(record)) return undefined;

  if (record.type === 'user_message') {
    return stringValue(record.message);
  }

  if (record.type === 'message' && record.role === 'user') {
    return contentText(record.content);
  }

  if (isObject(record.payload)) {
    return userMessageText(record.payload);
  }

  return undefined;
}

function contentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const parts = content
    .map((item) => {
      if (!isObject(item)) return undefined;
      return stringValue(item.text) ?? stringValue(item.content);
    })
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function hasEnoughMetadata(metadata: SessionMetadata): boolean {
  return Boolean(metadata.cwd && metadata.startedAt && metadata.title && metadata.summary);
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function cleanText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
