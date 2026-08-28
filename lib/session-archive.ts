import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { SessionInfo } from "./types";

/**
 * Session archiving for omp-web.
 *
 * Archiving is a web-only view decision, not a data operation: the session's
 * JSONL file is never moved, rewritten, or deleted, and a running session keeps
 * running. Archived sessions therefore stay fully readable, resumable, and
 * forkable — they just leave the active sidebar groups.
 *
 * The state lives in a sidecar registry beside omp-web's other agent-dir files
 * (`<agentDir>/omp-web-archived-sessions.json`), mapping session id to the ISO
 * timestamp of the archive action. An id that is absent from the registry is
 * active, so a session archived on one machine and read on another simply shows
 * up as active instead of vanishing.
 *
 * Unreadable or malformed registry content fails closed as "nothing archived".
 * Guessing at corrupt data could hide sessions the user can no longer see well
 * enough to restore; showing an archived session as active is recoverable.
 */

const ARCHIVE_FILE = "omp-web-archived-sessions.json";

/** Session id -> ISO timestamp of the archive action. Empty when unusable. */
function readArchiveRegistry(agentDir: string): Map<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(agentDir, ARCHIVE_FILE), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 && typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
  } catch {
    return new Map();
  }
}

function writeArchiveRegistry(agentDir: string, registry: Map<string, string>): void {
  mkdirSync(agentDir, { recursive: true });
  writePrivateFileAtomicSync(
    join(agentDir, ARCHIVE_FILE),
    `${JSON.stringify(Object.fromEntries(registry), null, 2)}\n`,
  );
}

/**
 * Return `sessions` with archived entries marked. Active sessions are returned
 * by reference and without an `archived` key, so `archived !== true` is the
 * active test.
 *
 * Callers hand us objects owned by the session-list cache, so an archived
 * session is copied rather than tagged in place — otherwise one annotated
 * response would leak its archive state into every later cached read.
 */
export function annotateArchivedSessions(sessions: SessionInfo[], agentDir: string): SessionInfo[] {
  const registry = readArchiveRegistry(agentDir);
  if (registry.size === 0) return sessions;
  return sessions.map((session) =>
    registry.has(session.id) ? { ...session, archived: true } : session,
  );
}

/**
 * Archive (`archived: true`) or restore (`archived: false`) a single session.
 * Restoring drops the entry entirely instead of recording a negative one, which
 * also makes this the cleanup path for a permanently deleted session.
 *
 * A no-op mutation writes nothing, so deleting a never-archived session does not
 * create a registry file.
 */
export function setSessionArchived(id: string, archived: boolean, agentDir: string): void {
  const registry = readArchiveRegistry(agentDir);
  if (registry.has(id) === archived) return;
  if (archived) registry.set(id, new Date().toISOString());
  else registry.delete(id);
  writeArchiveRegistry(agentDir, registry);
}
