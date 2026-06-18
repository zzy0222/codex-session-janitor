import path from 'node:path';
import os from 'node:os';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {
  buildSelectedCleanPlan,
  executeCleanPlan,
  scanSessions
} from '../core/index.js';
import type {CleanResult, SessionEntry} from '../core/index.js';

type FilterMode = 'cwd' | 'all';
type SortKey = 'updated' | 'created';
type ToolbarControl = 'filter' | 'sort';
type Density = 'comfortable' | 'dense';
type PreviewState =
  | {status: 'loading'}
  | {status: 'loaded'; lines: string[]}
  | {status: 'failed'; message: string};

interface Props {
  codexHome: string;
}

const CONFIRM_MS = 1000;
const FOOTER_COMPACT_BREAKPOINT = 120;
const MAX_PREVIEW_LINES = 6;
const ZEBRA_BACKGROUND = '#1b1b1b';
const SELECTED_BACKGROUND = '#2a2a2a';
const SELECTED_FOREGROUND = '#c19c00';

export function App({codexHome}: Props) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const currentCwd = process.cwd();
  const terminalRows = stdout.rows ?? 24;
  const terminalColumns = stdout.columns ?? 100;
  const [allRows, setAllRows] = useState<SessionEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('cwd');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [toolbarFocus, setToolbarFocus] = useState<ToolbarControl>('filter');
  const [density, setDensity] = useState<Density>('dense');
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(() => new Set());
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [previewByPath, setPreviewByPath] = useState<Map<string, PreviewState>>(() => new Map());
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteConfirmationDeadline, setDeleteConfirmationDeadline] = useState<number | null>(null);
  const [inlineMessageDeadline, setInlineMessageDeadline] = useState<number | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>('Loading older sessions...');

  useEffect(() => {
    void refresh();
  }, [codexHome]);

  useEffect(() => {
    if (deleteConfirmationDeadline === null) return;
    const delay = Math.max(0, deleteConfirmationDeadline - Date.now());
    const timer = setTimeout(() => setDeleteConfirmationDeadline(null), delay);
    return () => clearTimeout(timer);
  }, [deleteConfirmationDeadline]);

  useEffect(() => {
    if (inlineMessageDeadline === null) return;
    const delay = Math.max(0, inlineMessageDeadline - Date.now());
    const timer = setTimeout(() => {
      setInlineMessage(null);
      setInlineMessageDeadline(null);
    }, delay);
    return () => clearTimeout(timer);
  }, [inlineMessageDeadline]);

  const sortedRows = useMemo(() => {
    return [...allRows].sort((a, b) => compareRows(a, b, sortKey));
  }, [allRows, sortKey]);

  const filteredRows = useMemo(() => {
    const q = query.toLowerCase();
    return sortedRows
      .filter((row) => filterMode === 'all' || pathsMatch(row.cwd, currentCwd))
      .filter((row) => rowMatchesQuery(row, q));
  }, [currentCwd, filterMode, query, sortedRows]);

  const listHeight = Math.max(4, terminalRows - 8);
  const listWidth = Math.max(20, terminalColumns - 4);
  const effectiveScrollTop = useMemo(() => {
    return ensureVisible(scrollTop, selected, filteredRows, listHeight, density, expandedPath, previewByPath, listWidth);
  }, [density, expandedPath, filteredRows, listHeight, listWidth, previewByPath, scrollTop, selected]);
  const hasMoreAbove = effectiveScrollTop > 0;
  const listContentHeight = Math.max(1, listHeight - (hasMoreAbove ? 1 : 0));
  const visibleRows = useMemo(() => {
    return rowsForViewport(filteredRows, effectiveScrollTop, listContentHeight, density, selected, expandedPath, previewByPath, listWidth);
  }, [density, effectiveScrollTop, expandedPath, filteredRows, listContentHeight, listWidth, previewByPath, selected]);
  const hasPendingDeleteConfirmation =
    deleteConfirmationDeadline !== null && Date.now() < deleteConfirmationDeadline;

  useEffect(() => {
    setSelected((value) => clamp(value, 0, Math.max(0, filteredRows.length - 1)));
  }, [filteredRows.length]);

  useEffect(() => {
    if (effectiveScrollTop !== scrollTop) {
      setScrollTop(effectiveScrollTop);
    }
  }, [effectiveScrollTop, scrollTop]);

  useEffect(() => {
    if (!expandedPath) return;
    if (previewByPath.has(expandedPath)) return;

    setPreviewByPath((previews) => new Map(previews).set(expandedPath, {status: 'loading'}));
    void loadTranscriptPreview(expandedPath)
      .then((lines) => {
        setPreviewByPath((previews) => new Map(previews).set(expandedPath, {status: 'loaded', lines}));
      })
      .catch((error: unknown) => {
        setPreviewByPath((previews) =>
          new Map(previews).set(expandedPath, {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error)
          })
        );
      });
  }, [expandedPath, previewByPath]);

  useInput((input, key) => {
    if (deleteInProgress) return;

    if ((key.ctrl && input === 'c') || input === '\u0003') {
      quit();
      return;
    }

    if (hasPendingDeleteConfirmation && !key.return) {
      setDeleteConfirmationDeadline(null);
    }

    if (key.escape) {
      if (query.length === 0) {
        quit();
      } else {
        clearQueryPreservingSelection();
      }
      return;
    }

    if (key.return) {
      void acceptDelete();
      return;
    }

    if (input === ' ') {
      toggleSelectedForDelete();
      return;
    }

    if ((key.ctrl && input === 'e') || input === '\u0005') {
      toggleExpanded();
      return;
    }

    if ((key.ctrl && input === 'o') || input === '\u000f') {
      setDensity((value) => (value === 'comfortable' ? 'dense' : 'comfortable'));
      return;
    }

    if (key.tab || input === '\t') {
      setToolbarFocus((value) => (value === 'filter' ? 'sort' : 'filter'));
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      changeFocusedToolbarValue();
      return;
    }

    const allowPlainCharNavigation = !isSearchTextInput(input, key);
    if (allowPlainCharNavigation && (key.upArrow || input === 'k')) {
      moveSelected(-1);
      return;
    }

    if (allowPlainCharNavigation && (key.downArrow || input === 'j')) {
      moveSelected(1);
      return;
    }

    if (allowPlainCharNavigation && key.pageUp) {
      moveSelected(-Math.max(1, listHeight));
      return;
    }

    if (allowPlainCharNavigation && key.pageDown) {
      moveSelected(Math.max(1, listHeight));
      return;
    }

    if (allowPlainCharNavigation && input === 'g') {
      setSelected(0);
      return;
    }

    if (allowPlainCharNavigation && input === 'G') {
      setSelected(Math.max(0, filteredRows.length - 1));
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      setSelected(0);
      setScrollTop(0);
      return;
    }

    if (isSearchTextInput(input, key)) {
      setQuery((value) => value + normalizeSearchInput(input));
      setSelected(0);
      setScrollTop(0);
    }
  });

  async function refresh() {
    setInlineMessage('Loading older sessions...');
    setInlineMessageDeadline(null);
    setDeleteConfirmationDeadline(null);
    const scanned = await scanSessions({codexHome, includeArchived: false});
    setAllRows(scanned);
    setSelectedForDelete((paths) => new Set(scanned.filter((row) => paths.has(row.path)).map((row) => row.path)));
    setInlineMessage(null);
  }

  function quit() {
    exit();
  }

  function moveSelected(delta: number) {
    setSelected((value) => clamp(value + delta, 0, Math.max(0, filteredRows.length - 1)));
  }

  function changeFocusedToolbarValue() {
    if (toolbarFocus === 'filter') {
      setFilterMode((value) => (value === 'cwd' ? 'all' : 'cwd'));
      setSelected(0);
      setScrollTop(0);
    } else {
      setSortKey((value) => (value === 'updated' ? 'created' : 'updated'));
      setSelected(0);
      setScrollTop(0);
    }
  }

  function clearQueryPreservingSelection() {
    const selectedPath = filteredRows[selected]?.path;
    setQuery('');
    if (selectedPath) {
      const nextRows = sortedRows.filter((row) => filterMode === 'all' || pathsMatch(row.cwd, currentCwd));
      const nextIndex = nextRows.findIndex((row) => row.path === selectedPath);
      setSelected(Math.max(0, nextIndex));
    }
  }

  function toggleSelectedForDelete() {
    const row = filteredRows[selected];
    if (!row) {
      showTemporaryMessage('No session id available for this row');
      return;
    }
    setSelectedForDelete((paths) => {
      const next = new Set(paths);
      if (next.has(row.path)) {
        next.delete(row.path);
      } else {
        next.add(row.path);
      }
      return next;
    });
    setDeleteConfirmationDeadline(null);
  }

  function toggleExpanded() {
    const row = filteredRows[selected];
    if (!row) return;
    setExpandedPath((value) => (value === row.path ? null : row.path));
  }

  async function acceptDelete() {
    setInlineMessage(null);
    setInlineMessageDeadline(null);
    if (selectedForDelete.size === 0) {
      showTemporaryMessage('Press Space to select sessions to delete');
      return;
    }

    if (!hasPendingDeleteConfirmation) {
      setDeleteConfirmationDeadline(Date.now() + CONFIRM_MS);
      return;
    }

    setDeleteInProgress(true);
    setDeleteConfirmationDeadline(null);
    const rowsToDelete = allRows.filter((row) => selectedForDelete.has(row.path));
    const result = await executeCleanPlan(buildSelectedCleanPlan(codexHome, rowsToDelete), {
      dryRun: false,
      mode: 'trash'
    });
    applyDeleteResult(result);
    setDeleteInProgress(false);
  }

  function showTemporaryMessage(message: string) {
    setInlineMessage(message);
    setInlineMessageDeadline(Date.now() + CONFIRM_MS);
  }

  function applyDeleteResult(result: CleanResult) {
    const deleted = new Set(result.removed.map((row) => row.path));
    if (deleted.size > 0) {
      setAllRows((rows) => rows.filter((row) => !deleted.has(row.path)));
      setSelectedForDelete((paths) => new Set([...paths].filter((item) => !deleted.has(item))));
      setExpandedPath((value) => (value && deleted.has(value) ? null : value));
    }

    if (result.failures.length === 0) {
      setInlineMessage(deleted.size === 0 ? 'No sessions were deleted' : `Deleted ${deleted.size} session(s)`);
    } else {
      setInlineMessage(
        `Deleted ${deleted.size} session(s); ${result.failures.length} failed: ${result.failures
          .map((failure) => failure.error)
          .join('; ')}`
      );
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} height={terminalRows}>
      <Header selectedDeleteCount={selectedForDelete.size} width={terminalColumns - 2} />
      <Box height={1} />
      <SearchToolbar
        query={query}
        deleteInProgress={deleteInProgress}
        inlineMessage={inlineMessage}
        filterMode={filterMode}
        sortKey={sortKey}
        toolbarFocus={toolbarFocus}
        width={terminalColumns}
      />
      <Box height={1} />
      <Box height={listHeight} flexDirection="column">
        <SessionList
          rows={filteredRows}
          visibleRows={visibleRows}
          selected={selected}
          scrollTop={effectiveScrollTop}
          hasMoreAbove={hasMoreAbove}
          selectedForDelete={selectedForDelete}
          expandedPath={expandedPath}
          previewByPath={previewByPath}
          density={density}
          sortKey={sortKey}
          filterMode={filterMode}
          width={listWidth}
        />
      </Box>
      <PickerFooter
        selected={selected}
        total={filteredRows.length}
        listHeight={listHeight}
        density={density}
        hasPendingDeleteConfirmation={hasPendingDeleteConfirmation}
        terminalWidth={terminalColumns}
      />
    </Box>
  );
}

function Header({selectedDeleteCount, width}: {selectedDeleteCount: number; width: number}) {
  return (
    <Box width={width} justifyContent="space-between">
      <Text bold color="cyan">Session Janitor</Text>
      <Text color="cyan">
        selected <Text color="#c4a7ff">{selectedDeleteCount}</Text> session(s)
      </Text>
    </Box>
  );
}

function SearchToolbar({
  query,
  deleteInProgress,
  inlineMessage,
  filterMode,
  sortKey,
  toolbarFocus,
  width
}: {
  query: string;
  deleteInProgress: boolean;
  inlineMessage: string | null;
  filterMode: FilterMode;
  sortKey: SortKey;
  toolbarFocus: ToolbarControl;
  width: number;
}) {
  if (deleteInProgress) return <Text color="yellow">Deleting selected sessions...</Text>;
  if (inlineMessage) {
    return <Text color={inlineMessage.startsWith('Loading') ? 'gray' : 'red'}>{inlineMessage}</Text>;
  }

  const search = query.length === 0 ? 'Type to search' : `Search: ${query}`;
  const compact = width < 86;
  const toolbar = (
    <>
      <Text color="gray">Filter: </Text>
      {compact ? (
        <ToolbarValue label={filterLabel(filterMode)} active focused={toolbarFocus === 'filter'} />
      ) : (
        <>
          <ToolbarValue label="Cwd" active={filterMode === 'cwd'} focused={toolbarFocus === 'filter'} />
          <ToolbarValue label="All" active={filterMode === 'all'} focused={toolbarFocus === 'filter'} />
        </>
      )}
      <Text color="gray">   Sort: </Text>
      {compact ? (
        <ToolbarValue label={sortLabel(sortKey)} active focused={toolbarFocus === 'sort'} />
      ) : (
        <>
          <ToolbarValue label="Updated" active={sortKey === 'updated'} focused={toolbarFocus === 'sort'} />
          <ToolbarValue label="Created" active={sortKey === 'created'} focused={toolbarFocus === 'sort'} />
        </>
      )}
    </>
  );

  return (
    <Text>
      <Text color={query.length === 0 ? 'gray' : undefined}>{shortenEnd(search, compact ? 28 : 48)}</Text>
      <Text>{'  '}</Text>
      {toolbar}
    </Text>
  );
}

function ToolbarValue({label, active, focused}: {label: string; active: boolean; focused: boolean}) {
  if (active) {
    return <Text color={focused ? 'magenta' : undefined}>[{label}]</Text>;
  }
  return <Text color="gray"> {label} </Text>;
}

function SessionList({
  rows,
  visibleRows,
  selected,
  scrollTop,
  hasMoreAbove,
  selectedForDelete,
  expandedPath,
  previewByPath,
  density,
  sortKey,
  filterMode,
  width
}: {
  rows: SessionEntry[];
  visibleRows: VisibleRow[];
  selected: number;
  scrollTop: number;
  hasMoreAbove: boolean;
  selectedForDelete: Set<string>;
  expandedPath: string | null;
  previewByPath: Map<string, PreviewState>;
  density: Density;
  sortKey: SortKey;
  filterMode: FilterMode;
  width: number;
}) {
  if (rows.length === 0) {
    return <Text color="gray">{emptyStateLine(filterMode)}</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasMoreAbove && <Text color="gray">↑ more</Text>}
      {visibleRows.map((row) => {
        const rowIndex = rows.findIndex((candidate) => candidate.path === row.row.path);
        return (
          <SessionRow
            key={row.row.path}
            row={row.row}
            maxHeight={row.maxHeight}
            selected={rowIndex === selected}
            expanded={expandedPath === row.row.path && rowIndex === selected}
            preview={previewByPath.get(row.row.path)}
            marked={selectedForDelete.has(row.row.path)}
            zebra={rowIndex % 2 === 0}
            density={density}
            sortKey={sortKey}
            filterMode={filterMode}
            width={width}
          />
        );
      })}
    </Box>
  );
}

function SessionRow({
  row,
  maxHeight,
  selected,
  expanded,
  preview,
  marked,
  zebra,
  density,
  sortKey,
  filterMode,
  width
}: {
  row: SessionEntry;
  maxHeight: number;
  selected: boolean;
  expanded: boolean;
  preview: PreviewState | undefined;
  marked: boolean;
  zebra: boolean;
  density: Density;
  sortKey: SortKey;
  filterMode: FilterMode;
  width: number;
}) {
  const marker = selected ? (expanded ? '⌄ ' : '❯ ') : '  ';
  const mark = marked ? '●' : ' ';
  const titleColor = selected ? SELECTED_FOREGROUND : 'white';
  const markerColor = selected ? SELECTED_FOREGROUND : 'white';
  const rowBackground = selected ? SELECTED_BACKGROUND : zebra ? ZEBRA_BACKGROUND : undefined;
  const detailMaxLines = Math.max(0, maxHeight - 1);
  const markWidth = 1;
  const leftWidth = Math.max(1, width - markWidth);
  const markerWidth = displayWidth(marker);
  const date = fixedWidth(relativeDate(row, sortKey), 12);
  const denseTitleWidth = Math.max(1, leftWidth - markerWidth - displayWidth(date));
  const denseTitle = shortenEndDisplay(displayPreview(row), denseTitleWidth);
  const densePadding = paddingForDisplayWidth(`${marker}${date}${denseTitle}`, leftWidth);
  const comfortableTitleWidth = Math.max(1, leftWidth - markerWidth);
  const comfortableTitle = shortenEndDisplay(displayPreview(row), comfortableTitleWidth);
  const comfortablePadding = paddingForDisplayWidth(`${marker}${comfortableTitle}`, leftWidth);

  if (density === 'dense') {
    return (
      <Box flexDirection="column">
        <Box width={width} justifyContent="space-between" backgroundColor={rowBackground}>
          <Box backgroundColor={rowBackground}>
            <Text color={markerColor} bold={selected} backgroundColor={rowBackground}>{marker}</Text>
            <Text color="white" backgroundColor={rowBackground}>{date}</Text>
            <Text color={titleColor} backgroundColor={rowBackground}>{denseTitle}</Text>
            <Text backgroundColor={rowBackground}>{densePadding}</Text>
          </Box>
          <Text color={marked ? '#8fdcb1' : undefined} backgroundColor={rowBackground}>{mark}</Text>
        </Box>
        {expanded && detailMaxLines > 0 && <ExpandedDetails row={row} preview={preview} width={width} maxLines={detailMaxLines} />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box width={width} justifyContent="space-between" backgroundColor={rowBackground}>
        <Box backgroundColor={rowBackground}>
          <Text color={markerColor} bold={selected} backgroundColor={rowBackground}>{marker}</Text>
          <Text color={titleColor} backgroundColor={rowBackground}>{comfortableTitle}</Text>
          <Text backgroundColor={rowBackground}>{comfortablePadding}</Text>
        </Box>
        <Text color={marked ? '#8fdcb1' : undefined} backgroundColor={rowBackground}>{mark}</Text>
      </Box>
      {expanded ? (
        detailMaxLines > 0 && <ExpandedDetails row={row} preview={preview} width={width} maxLines={detailMaxLines} />
      ) : (
        <FooterLines row={row} sortKey={sortKey} showCwd={filterMode === 'all'} width={width} />
      )}
      {!expanded && <Text>{' '.repeat(width)}</Text>}
    </Box>
  );
}

function FooterLines({
  row,
  sortKey,
  showCwd,
  width
}: {
  row: SessionEntry;
  sortKey: SortKey;
  showCwd: boolean;
  width: number;
}) {
  const parts = [relativeDate(row, sortKey)];
  if (showCwd) parts.push(`⌁ ${shortDirectory(row.cwd)}`);
  parts.push(' no branch');
  const line = shortenEndDisplay(`  ${parts.join('  ')}`, width);
  return <Text color="gray">{padEndDisplay(line, width)}</Text>;
}

function ExpandedDetails({
  row,
  preview,
  width,
  maxLines
}: {
  row: SessionEntry;
  preview: PreviewState | undefined;
  width: number;
  maxLines: number;
}) {
  const session = row.id;
  const directory = displayDirectory(row.cwd);
  const previewLines = conversationPreviewLines(row, preview, width);
  const lines: React.ReactNode[] = [
    <ExpandedDetail key="session" label="Session:" value={session} width={width} />,
    <ExpandedDetail key="created" label="Created:" value={formatDetailTime(row.startedAt ?? row.modifiedAt)} width={width} />,
    <ExpandedDetail key="updated" label="Updated:" value={formatDetailTime(row.modifiedAt)} width={width} />,
    <ExpandedDetail key="directory" label="Directory:" value={directory} width={width} />,
    <ExpandedDetail key="branch" label="Branch:" value=" no branch" width={width} />,
    <Text key="blank" color="gray">{padEndDisplay('  │', width)}</Text>,
    <Text key="conversation">
      <Text color="gray">  │ Conversation:</Text>
      <Text>{paddingForDisplayWidth('  │ Conversation:', width)}</Text>
    </Text>,
    ...previewLines.map((line, index) => {
      const prefix = index + 1 === previewLines.length ? '  └ ' : '  │ ';
      return (
        <Text key={`preview-${index}-${line}`}>
          <Text color="gray">{prefix}</Text>
          <Text color="gray">{line}</Text>
          <Text>{paddingForDisplayWidth(`${prefix}${line}`, width)}</Text>
        </Text>
      );
    })
  ];

  return (
    <>
      {lines.slice(0, maxLines)}
    </>
  );
}

function ExpandedDetail({label, value, width}: {label: string; value: string; width: number}) {
  const prefix = `  │ ${label.padEnd(10)}  `;
  const valueWidth = Math.max(1, width - displayWidth(prefix));
  const clipped = shortenEndDisplay(value, valueWidth);
  return (
    <Text>
      <Text color="gray">{prefix}</Text>
      <Text color="white">{clipped}</Text>
      <Text>{paddingForDisplayWidth(`${prefix}${clipped}`, width)}</Text>
    </Text>
  );
}

function PickerFooter({
  selected,
  total,
  listHeight,
  density,
  hasPendingDeleteConfirmation,
  terminalWidth
}: {
  selected: number;
  total: number;
  listHeight: number;
  density: Density;
  hasPendingDeleteConfirmation: boolean;
  terminalWidth: number;
}) {
  const progress = footerProgressLabel(selected, total, listHeight, terminalWidth);
  const separatorWidth = Math.max(0, terminalWidth - progress.length - 2);

  if (hasPendingDeleteConfirmation) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">{'─'.repeat(Math.max(0, separatorWidth))}{progress}</Text>
        <Text color="yellow" bold> Press Enter again to delete</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">{'─'.repeat(Math.max(0, separatorWidth))}{progress}</Text>
      <Text>{hintLine(firstRowHints(), terminalWidth)}</Text>
      <Text>{hintLine(secondRowHints(density), terminalWidth)}</Text>
    </Box>
  );
}

function firstRowHints(): FooterHint[] {
  return [
    {key: 'enter', label: 'delete', compact: 'delete', priority: 0},
    {key: 'space', label: 'select', compact: 'select', priority: 0},
    {key: 'esc', label: 'exit', compact: 'exit', priority: 1},
    {key: 'ctrl+c', label: 'exit', compact: 'exit', priority: 2},
    {key: 'tab', label: 'focus sort/filter', compact: 'focus', priority: 7},
    {key: '←/→', label: 'change option', compact: 'option', priority: 8}
  ];
}

function secondRowHints(density: Density): FooterHint[] {
  return [
    {
      key: 'ctrl+o',
      label: density === 'comfortable' ? 'dense view' : 'comfortable view',
      compact: density === 'comfortable' ? 'dense' : 'comfy',
      priority: 3
    },
    {key: 'ctrl+e', label: 'expand', compact: 'exp', priority: 6},
    {key: '↑/↓', label: 'browse', compact: 'browse', priority: 5}
  ];
}

interface FooterHint {
  key: string;
  label: string;
  compact: string;
  priority: number;
}

function hintLine(hints: FooterHint[], width: number) {
  const labels = width >= FOOTER_COMPACT_BREAKPOINT ? 'label' : 'compact';
  const parts = hints.map((hint) => hintText(hint, labels));
  let text = ` ${parts.join('   ')}`;
  if (text.length <= width) return renderHints(hints, labels);

  const retained = [...hints].sort((a, b) => a.priority - b.priority);
  for (let count = retained.length; count >= 1; count -= 1) {
    const selectedHints = retained.slice(0, count).sort((a, b) => hints.indexOf(a) - hints.indexOf(b));
    text = ` ${selectedHints.map((hint) => hintText(hint, 'compact')).join('   ')}`;
    if (text.length <= width) return renderHints(selectedHints, 'compact');
  }
  return null;
}

function renderHints(hints: FooterHint[], labels: 'label' | 'compact') {
  return (
    <>
      <Text> </Text>
      {hints.map((hint, index) => (
        <React.Fragment key={hint.key}>
          {index > 0 && <Text color="gray">   </Text>}
          <Text>{hint.key}</Text>
          <Text color="gray"> {hint[labels]}</Text>
        </React.Fragment>
      ))}
    </>
  );
}

function hintText(hint: FooterHint, labels: 'label' | 'compact'): string {
  return `${hint.key} ${hint[labels]}`;
}

function compareRows(a: SessionEntry, b: SessionEntry, sortKey: SortKey): number {
  if (sortKey === 'created') {
    return dateValue(b.startedAt ?? b.modifiedAt) - dateValue(a.startedAt ?? a.modifiedAt);
  }
  return dateValue(b.modifiedAt) - dateValue(a.modifiedAt);
}

function rowMatchesQuery(row: SessionEntry, query: string): boolean {
  if (query.length === 0) return true;
  return [row.id, row.title, row.summary, row.cwd, row.path]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

interface VisibleRow {
  row: SessionEntry;
  maxHeight: number;
}

function rowsForViewport(
  rows: SessionEntry[],
  scrollTop: number,
  listHeight: number,
  density: Density,
  selected: number,
  expandedPath: string | null,
  previewByPath: Map<string, PreviewState>,
  width: number
) {
  const visible: VisibleRow[] = [];
  let used = 0;
  for (const row of rows.slice(scrollTop)) {
    const rowIndex = rows.findIndex((candidate) => candidate.path === row.path);
    const expanded = expandedPath === row.path && rowIndex === selected;
    const height = rowHeight(row, density, expanded, previewByPath.get(row.path), width);
    const minimumHeight = rowMinimumVisibleHeight(density, expanded);
    if (used + minimumHeight > listHeight && visible.length > 0) break;
    const remaining = Math.max(0, listHeight - used);
    if (remaining === 0) break;
    visible.push({row, maxHeight: Math.min(height, remaining)});
    used += Math.min(height, remaining);
  }
  return visible;
}

function ensureVisible(
  scrollTop: number,
  selected: number,
  rows: SessionEntry[],
  listHeight: number,
  density: Density,
  expandedPath: string | null,
  previewByPath: Map<string, PreviewState>,
  width: number
) {
  if (rows.length === 0) return 0;
  let next = clamp(scrollTop, 0, rows.length - 1);
  if (selected < next) next = selected;
  while (
    renderedHeightBetween(rows, next, selected, density, expandedPath, previewByPath, width) > listHeight &&
    next < selected
  ) {
    next += 1;
  }
  return next;
}

function renderedHeightBetween(
  rows: SessionEntry[],
  start: number,
  endInclusive: number,
  density: Density,
  expandedPath: string | null,
  previewByPath: Map<string, PreviewState>,
  width: number
): number {
  return rows.slice(start, endInclusive + 1).reduce((height, row, offset) => {
    const rowIndex = start + offset;
    const expanded = expandedPath === row.path && rowIndex === endInclusive;
    return height + rowHeight(row, density, expanded, previewByPath.get(row.path), width);
  }, 0);
}

function rowHeight(row: SessionEntry, density: Density, expanded: boolean, preview: PreviewState | undefined, width: number): number {
  if (expanded) return 8 + conversationPreviewLines(row, preview, width).length;
  return density === 'comfortable' ? 3 : 1;
}

function rowMinimumVisibleHeight(density: Density, expanded: boolean): number {
  if (expanded) return 1;
  return density === 'comfortable' ? 3 : 1;
}

function pathsMatch(candidate: string | undefined, cwd: string): boolean {
  if (!candidate) return false;
  return path.resolve(candidate).toLowerCase() === path.resolve(cwd).toLowerCase();
}

function isSearchTextInput(
  input: string,
  key: {
    ctrl?: boolean;
    meta?: boolean;
    tab?: boolean;
    return?: boolean;
    escape?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    pageUp?: boolean;
    pageDown?: boolean;
    backspace?: boolean;
    delete?: boolean;
    home?: boolean;
    end?: boolean;
  }
) {
  if (input.length === 0) return false;
  if (
    key.ctrl ||
    key.meta ||
    key.tab ||
    key.return ||
    key.escape ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.backspace ||
    key.delete ||
    key.home ||
    key.end
  ) {
    return false;
  }
  return [...input].every((char) => char >= ' ' && char !== '\u007f');
}

function normalizeSearchInput(input: string): string {
  return input.replace(/\s+/g, ' ');
}

async function loadTranscriptPreview(filePath: string): Promise<string[]> {
  const lines: string[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, {encoding: 'utf8'}),
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      const text = transcriptTextFromRecord(safeJsonParse(line));
      if (!text) continue;
      for (const candidate of text.split(/\r?\n/)) {
        const trimmed = candidate.trim();
        if (trimmed) lines.push(trimmed);
      }
    }
  } finally {
    rl.close();
  }

  return lines.slice(-MAX_PREVIEW_LINES);
}

function transcriptTextFromRecord(record: unknown): string | undefined {
  if (!isObject(record)) return undefined;

  if (record.type === 'event_msg' && isObject(record.payload)) {
    return transcriptTextFromRecord(record.payload);
  }

  if (record.type === 'response_item' && isObject(record.payload)) {
    return transcriptTextFromRecord(record.payload);
  }

  if (record.type === 'user_message') {
    return stringValue(record.message);
  }

  if (record.type === 'message' && (record.role === 'user' || record.role === 'assistant')) {
    return contentText(record.content);
  }

  if (isObject(record.payload)) {
    return transcriptTextFromRecord(record.payload);
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

function conversationPreviewLines(row: SessionEntry, preview: PreviewState | undefined, width: number): string[] {
  const contentWidth = Math.max(8, width - 4);
  if (!preview || preview.status === 'loading') {
    return ['Loading recent transcript...'];
  }
  if (preview.status === 'failed') {
    return [`Could not load transcript preview: ${preview.message}`];
  }

  const source = preview.lines.length > 0 ? preview.lines : [row.summary ?? 'No transcript preview available'];
  return source.flatMap((line) => wrapText(line, contentWidth));
}

function wrapText(value: string, width: number): string[] {
  if (displayWidth(value) <= width) return [value];

  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  const chars = [...value];
  for (const char of chars) {
    const charWidthValue = charWidth(char);
    if (currentWidth + charWidthValue > width && current.length > 0) {
      lines.push(current);
      current = char;
      currentWidth = charWidthValue;
    } else {
      current += char;
      currentWidth += charWidthValue;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function displayPreview(row: SessionEntry): string {
  return row.title ?? row.summary ?? '(no message yet)';
}

function filterLabel(filterMode: FilterMode): string {
  return filterMode === 'cwd' ? 'Cwd' : 'All';
}

function sortLabel(sortKey: SortKey): string {
  return sortKey === 'updated' ? 'Updated' : 'Created';
}

function emptyStateLine(filterMode: FilterMode): string {
  return filterMode === 'cwd' ? 'No sessions found for this working directory' : 'No sessions found';
}

function relativeDate(row: SessionEntry, sortKey: SortKey): string {
  const date = sortKey === 'created' ? row.startedAt ?? row.modifiedAt : row.modifiedAt;
  return formatRelative(date);
}

function formatRelative(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatAbsolute(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function formatDetailTime(date: Date): string {
  return `${formatRelativeLong(date)} · ${formatLocalTimestamp(date)}`;
}

function formatRelativeLong(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, 'day');
  const months = Math.floor(days / 30);
  if (months < 12) return plural(months, 'month');
  return plural(Math.floor(months / 12), 'year');
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}

function formatLocalTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

function displayDirectory(value: string | undefined): string {
  if (!value) return '-';
  const home = os.homedir();
  if (path.resolve(value).toLowerCase() === path.resolve(home).toLowerCase()) {
    return '~';
  }
  return value;
}

function shortDirectory(value: string | undefined): string {
  if (!value) return 'no cwd';
  return value;
}

function footerProgressLabel(selected: number, total: number, listHeight: number, width: number): string {
  const position = total === 0 ? 0 : selected + 1;
  const percent = total <= listHeight ? 100 : Math.round((selected / Math.max(1, total - 1)) * 100);
  const labels = [` ${position} / ${total} · ${percent}% `, ` ${position}/${total} · ${percent}% `, ` ${percent}% `];
  return labels.find((label) => label.length < width) ?? '';
}

function fixedWidth(value: string, width: number): string {
  const shortened = shortenEnd(value, width);
  return `${shortened}${' '.repeat(Math.max(0, width - shortened.length))}`;
}

function shortenEndDisplay(value: string, maxWidth: number): string {
  if (displayWidth(value) <= maxWidth) return value;
  if (maxWidth <= 1) return '…'.slice(0, maxWidth);

  let result = '';
  let used = 0;
  for (const char of [...value]) {
    const next = charWidth(char);
    if (used + next > maxWidth - 1) break;
    result += char;
    used += next;
  }
  return `${result}…`;
}

function shortenEnd(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

function padEndDisplay(value: string, width: number): string {
  return `${value}${paddingForDisplayWidth(value, width)}`;
}

function paddingForDisplayWidth(value: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(value)));
}

function displayWidth(value: string): number {
  return [...value].reduce((width, char) => width + charWidth(char), 0);
}

function charWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0) return 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  );
}

function dateValue(date: Date): number {
  return date.getTime();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
