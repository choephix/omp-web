import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCNSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("keeps subagents out of the left session sidebar", () => {
  assert.doesNotMatch(source, /SubagentRail|SubagentPanel|subagents/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});
test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});
test("manual and lifecycle refreshes bypass the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && !session\.transient && \(/);
});

test("treats a session as active unless it is explicitly archived", () => {
  assert.match(
    source,
    /function partitionArchivedSessions[\s\S]*?if \(session\.archived === true\) archived\.push\(session\);\s*else active\.push\(session\);/,
  );
  assert.match(
    source,
    /function partitionArchivedSessions[\s\S]*?archived\.sort\(\(a, b\) => b\.modified\.localeCompare\(a\.modified\)\);/,
  );
});

test("project grouping, recent projects and activity counts read only active sessions", () => {
  assert.match(source, /partitionArchivedSessions\(sessionsForDisplay\)/);
  assert.match(source, /getRecentProjects\(activeSessions\)/);
  assert.match(source, /getRecentProjects\(allSessions\.filter\(\(session\) => session\.archived !== true\)\)/);
  assert.match(
    source,
    /const sessionsByProject = new Map<string, SessionInfo\[\]>\(\);\s*for \(const session of activeSessions\)/,
  );
  assert.match(
    source,
    /const projectActivity = useMemo\(\(\) => \{[\s\S]*?for \(const session of activeSessions\)/,
  );
});

test("archives and restores through a single-flag PATCH of one session", () => {
  assert.match(
    source,
    /async function patchSessionArchived\(sessionId: string, archived: boolean\)[\s\S]*?fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`, \{\s*method: "PATCH",[\s\S]*?body: JSON\.stringify\(\{ archived \}\),/,
  );
  assert.match(source, /async function patchSessionArchived[\s\S]*?return res\.ok;/);
});

test("archiving needs no confirmation and never reports a deletion", () => {
  assert.match(
    sessionItemSource,
    /const handleArchiveClick[\s\S]*?const next = !isArchived;[\s\S]*?patchSessionArchived\(session\.id, next\)[\s\S]*?if \(ok\) onArchivedChange\?\.\(session\.id, next\)/,
  );
  const archiveHandler = sessionItemSource.slice(
    sessionItemSource.indexOf("const handleArchiveClick"),
    sessionItemSource.indexOf("const handleDeleteClick"),
  );
  assert.doesNotMatch(archiveHandler, /onDeleted|setConfirmDelete|"DELETE"/);
});

test("permanent deletion is available only after archiving", () => {
  assert.match(sessionItemSource, /onClick=\{handleArchiveClick\}/);
  assert.match(sessionItemSource, /\{isArchived && \(\s*<button\s*onClick=\{handleDeleteClick\}[\s\S]*?title=\{t\("sidebar\.deleteWithShiftClick"\)\}/);
  assert.match(sessionItemSource, /method: "DELETE"/);
});

test("archiving keeps the row listed locally without touching the open session", () => {
  assert.match(
    source,
    /const handleArchivedChange = useCallback\(\(sessionId: string, archived: boolean\) => \{[\s\S]*?\{ \.\.\.session, archived \}[\s\S]*?loadSessions\(\);/,
  );
  const handler = source.slice(
    source.indexOf("const handleArchivedChange"),
    source.indexOf("const handleNewSession"),
  );
  assert.doesNotMatch(handler, /onSessionDeleted|onSelectSession|abort|stop/i);
});

test("the archived section is collapsed by default and absent while empty", () => {
  assert.match(source, /const \[archivedCollapsed, setArchivedCollapsed\] = useState\(true\);/);
  assert.match(source, /\{!loading && !error && archivedRows\.length > 0 && \(/);
  assert.match(source, /aria-label=\{archivedCollapsed \? t\("sidebar\.expandArchived"\) : t\("sidebar\.collapseArchived"\)\}/);
  assert.match(source, /aria-expanded=\{!archivedCollapsed\}/);
});

test("archived rows keep selection, indicators, compact sizing and project context", () => {
  const archivedSection = source.slice(source.indexOf("archivedRows.map("));
  assert.match(archivedSection, /isSelected=\{session\.id === selectedSessionId\}/);
  assert.match(archivedSection, /isRunning=\{runningSessionIds\.has\(session\.id\)\}/);
  assert.match(archivedSection, /isUnread=\{unreadSessionIds\.has\(session\.id\)\}/);
  assert.match(archivedSection, /projectLabel=\{projectLabel\}/);
  assert.match(archivedSection, /projectPath=\{project\}/);
  assert.match(archivedSection, /onClick=\{\(\) => handleSelectSessionFromList\(session\)\}/);
  assert.match(sessionItemSource, /const ITEM_HEIGHT = 28;/);
  assert.match(sessionItemSource, /title=\{projectPath \? t\("sidebar\.projectPath", \{ path: projectPath \}\) : undefined\}/);
});

test("labels the archive and restore actions for assistive technology", () => {
  assert.match(
    sessionItemSource,
    /title=\{isArchived \? t\("sidebar\.restoreTitle"\) : t\("sidebar\.archiveTitle"\)\}\s*aria-label=\{isArchived \? t\("sidebar\.restoreTitle"\) : t\("sidebar\.archiveTitle"\)\}/,
  );
});

test("every new sidebar archive string is translated in all locales", () => {
  for (const key of [
    "sidebar.archived",
    "sidebar.archiveTitle",
    "sidebar.restoreTitle",
    "sidebar.expandArchived",
    "sidebar.collapseArchived",
    "sidebar.projectPath",
  ]) {
    assert.ok(enSource.includes(`"${key}":`), `missing en ${key}`);
    assert.ok(zhCNSource.includes(`"${key}":`), `missing zh-CN ${key}`);
  }
});
