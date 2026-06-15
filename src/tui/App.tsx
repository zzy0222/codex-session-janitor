import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {
  buildCleanPlan,
  executeCleanPlan,
  formatAge,
  formatBytes,
  scanSessions
} from '../core/index.js';
import type {CleanPlan, CleanResult, SessionEntry} from '../core/index.js';

type Screen = 'scan' | 'select' | 'preview' | 'clean';

interface Props {
  codexHome: string;
}

export function App({codexHome}: Props) {
  const {exit} = useApp();
  const [screen, setScreen] = useState<Screen>('scan');
  const [retentionDays, setRetentionDays] = useState(30);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [status, setStatus] = useState('Scanning...');

  useEffect(() => {
    void refresh();
  }, [codexHome]);

  const plan = useMemo<CleanPlan>(() => {
    return buildCleanPlan(codexHome, sessions, {
      retentionDays,
      includeArchived
    });
  }, [codexHome, sessions, retentionDays, includeArchived]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (input === '1') setScreen('scan');
    if (input === '2') setScreen('select');
    if (input === '3') setScreen('preview');
    if (input === '4') setScreen('clean');
    if (input === 'r') void refresh();

    if (screen === 'select') {
      if (key.leftArrow) setRetentionDays((value) => Math.max(1, value - 1));
      if (key.rightArrow) setRetentionDays((value) => value + 1);
      if (input === 'a') setIncludeArchived((value) => !value);
      if (input === 'd') setDryRun((value) => !value);
    }

    if (screen === 'preview' && key.return) {
      setScreen('clean');
      void clean(plan, dryRun);
    }
  });

  async function refresh() {
    setStatus('Scanning...');
    setResult(null);
    const scanned = await scanSessions({codexHome, includeArchived: true});
    setSessions(scanned);
    setStatus(`Scanned ${scanned.length} session file(s).`);
  }

  async function clean(currentPlan: CleanPlan, currentDryRun: boolean) {
    setStatus(currentDryRun ? 'Running dry run...' : 'Cleaning...');
    const cleanResult = await executeCleanPlan(currentPlan, {
      dryRun: currentDryRun,
      mode: 'trash'
    });
    setResult(cleanResult);
    setStatus(currentDryRun ? 'Dry run complete.' : 'Clean complete.');
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Codex Session Janitor</Text>
      <Text color="gray">{codexHome}</Text>
      <Text>
        <Text color={screen === 'scan' ? 'cyan' : undefined}>1 Scan</Text>{'  '}
        <Text color={screen === 'select' ? 'cyan' : undefined}>2 Select</Text>{'  '}
        <Text color={screen === 'preview' ? 'cyan' : undefined}>3 Preview</Text>{'  '}
        <Text color={screen === 'clean' ? 'cyan' : undefined}>4 Clean</Text>
      </Text>
      <Text color="gray">q quit | r rescan | Enter runs Preview action</Text>
      <Text>{status}</Text>
      <Box marginTop={1} flexDirection="column">
        {screen === 'scan' && <ScanView sessions={sessions} plan={plan} />}
        {screen === 'select' && (
          <SelectView
            retentionDays={retentionDays}
            includeArchived={includeArchived}
            dryRun={dryRun}
            plan={plan}
          />
        )}
        {screen === 'preview' && <PreviewView plan={plan} dryRun={dryRun} />}
        {screen === 'clean' && <CleanView result={result} />}
      </Box>
    </Box>
  );
}

function ScanView({sessions, plan}: {sessions: SessionEntry[]; plan: CleanPlan}) {
  const active = sessions.filter((entry) => entry.area === 'active').length;
  const archived = sessions.filter((entry) => entry.area === 'archived').length;
  const latest = sessions.slice(0, 5);

  return (
    <Box flexDirection="column">
      <Text>Total: {sessions.length} file(s), active {active}, archived {archived}</Text>
      <Text>Expired under current settings: {plan.candidates.length}, {formatBytes(plan.totalBytes)}</Text>
      <Text bold>Recent files</Text>
      {latest.map((entry) => <SessionCard key={entry.path} entry={entry} />)}
    </Box>
  );
}

function SelectView({
  retentionDays,
  includeArchived,
  dryRun,
  plan
}: {
  retentionDays: number;
  includeArchived: boolean;
  dryRun: boolean;
  plan: CleanPlan;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <Text>Retention days: {retentionDays}  (Left/Right)</Text>
      <Text>Include archived: {includeArchived ? 'yes' : 'no'}  (a toggles)</Text>
      <Text>Dry run: {dryRun ? 'yes, simulate only' : 'no, move matched files to trash'}  (d toggles)</Text>
      <Text>Matched now: {plan.candidates.length} file(s), {formatBytes(plan.totalBytes)}</Text>
    </Box>
  );
}

function PreviewView({plan, dryRun}: {plan: CleanPlan; dryRun: boolean}) {
  return (
    <Box flexDirection="column">
      <Text bold>Preview</Text>
      <Text>Mode: {dryRun ? 'dry run, no files will be changed' : 'move matched files to trash'}</Text>
      <Text>Cutoff: files modified before {plan.cutoff.toISOString()}</Text>
      <Text>Will match {plan.candidates.length} file(s), {formatBytes(plan.totalBytes)}</Text>
      {plan.candidates.slice(0, 10).map((entry) => <SessionCard key={entry.path} entry={entry} showSummary />)}
      {plan.candidates.length > 10 && <Text color="gray">...and {plan.candidates.length - 10} more</Text>}
      <Text color="yellow">Press Enter to {dryRun ? 'simulate cleanup' : 'move these files to trash'}.</Text>
    </Box>
  );
}

function CleanView({result}: {result: CleanResult | null}) {
  if (!result) return <Text>Waiting for clean run...</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>{result.dryRun ? 'Dry run result' : 'Clean result'}</Text>
      <Text>
        {result.dryRun ? 'Would remove' : 'Removed'} {result.dryRun ? result.wouldRemove.length : result.removed.length}
        {' '}file(s), {formatBytes(result.freedBytes)}
      </Text>
      {result.failures.length > 0 && <Text color="red">Failures: {result.failures.length}</Text>}
    </Box>
  );
}

function SessionCard({entry, showSummary = false}: {entry: SessionEntry; showSummary?: boolean}) {
  const summary = displaySummary(entry);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={entry.area === 'active' ? 'green' : 'magenta'}>{entry.area.toUpperCase()}</Text>
        <Text color="gray">  age </Text>{formatAge(entry.ageDays)}
        <Text color="gray">  size </Text>{formatBytes(entry.sizeBytes)}
      </Text>
      <Text>
        <Text color="cyan">Title   </Text>{displayTitle(entry)}
      </Text>
      {showSummary && summary && (
        <Text>
          <Text color="cyan">Summary </Text>{summary}
        </Text>
      )}
      <Text color="gray">
        <Text>CWD     </Text>{shortenMiddle(entry.cwd ?? 'unknown', 96)}
      </Text>
      <Text color="gray">
        <Text>Started </Text>{entry.startedAt ? entry.startedAt.toISOString() : 'unknown'}
      </Text>
      <Text color="gray">
        <Text>File    </Text>{shortenMiddle(entry.path, 110)}
      </Text>
    </Box>
  );
}

function displayTitle(entry: SessionEntry): string {
  return entry.title ?? entry.id;
}

function displaySummary(entry: SessionEntry): string | undefined {
  if (!entry.summary || entry.summary === entry.title) return undefined;
  return entry.summary;
}

function shortenMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}
