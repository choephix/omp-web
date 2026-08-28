import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { annotateArchivedSessions, setSessionArchived } = await createJiti(import.meta.url)
  .import("./session-archive.ts");

const REGISTRY_FILE = "omp-web-archived-sessions.json";

function createAgentDir(t) {
  const root = mkdtempSync(join(tmpdir(), "omp-web-session-archive-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function session(id, extra = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/project",
    created: "2026-08-01T00:00:00.000Z",
    modified: "2026-08-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
    ...extra,
  };
}

test("archiving and restoring a session survive independent reads", (t) => {
  const agentDir = createAgentDir(t);
  const sessions = [session("a"), session("b")];

  setSessionArchived("a", true, agentDir);
  assert.deepEqual(
    annotateArchivedSessions(sessions, agentDir).map((entry) => entry.archived),
    [true, undefined],
  );

  setSessionArchived("a", false, agentDir);
  assert.deepEqual(
    annotateArchivedSessions(sessions, agentDir).map((entry) => entry.archived),
    [undefined, undefined],
  );
});

test("the registry records an ISO archive timestamp keyed by session id", (t) => {
  const agentDir = createAgentDir(t);

  setSessionArchived("a", true, agentDir);

  const registry = JSON.parse(readFileSync(join(agentDir, REGISTRY_FILE), "utf8"));
  assert.deepEqual(Object.keys(registry), ["a"]);
  assert.equal(registry.a, new Date(registry.a).toISOString());
});

test("restoring drops the entry instead of recording a negative one", (t) => {
  const agentDir = createAgentDir(t);

  setSessionArchived("a", true, agentDir);
  setSessionArchived("b", true, agentDir);
  setSessionArchived("a", false, agentDir);

  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(join(agentDir, REGISTRY_FILE), "utf8"))),
    ["b"],
  );

  setSessionArchived("b", false, agentDir);
  assert.deepEqual(JSON.parse(readFileSync(join(agentDir, REGISTRY_FILE), "utf8")), {});
});

// Permanent deletion clears archive state for every session, so the common case
// is a restore of something that was never archived. That must not create state.
test("a mutation the registry already agrees with writes nothing", (t) => {
  const agentDir = createAgentDir(t);
  const registryPath = join(agentDir, REGISTRY_FILE);

  setSessionArchived("never-archived", false, agentDir);
  assert.equal(existsSync(registryPath), false);

  setSessionArchived("a", true, agentDir);
  const firstWrite = readFileSync(registryPath, "utf8");
  setSessionArchived("a", true, agentDir);
  assert.equal(readFileSync(registryPath, "utf8"), firstWrite);
});

test("archive state is written privately and atomically, creating the agent dir", (t) => {
  const root = createAgentDir(t);
  const agentDir = join(root, "missing", "agent");

  setSessionArchived("a", true, agentDir);

  assert.deepEqual(readdirSync(agentDir), [REGISTRY_FILE]);
  if (process.platform !== "win32") {
    assert.equal(statSync(join(agentDir, REGISTRY_FILE)).mode & 0o777, 0o600);
  }
});

// A registry we cannot trust must never hide sessions: the user would have no
// way to reach the archive view and restore them.
test("malformed registry content fails closed as no archived sessions", (t) => {
  const agentDir = createAgentDir(t);
  const registryPath = join(agentDir, REGISTRY_FILE);
  const sessions = [session("a")];

  for (const content of [
    "not json at all",
    '["a"]',
    '"a"',
    "null",
    '{"a": true}',
    '{"a": 1754000000000}',
    '{"a": ""}',
    '{"": "2026-08-01T00:00:00.000Z"}',
  ]) {
    writeFileSync(registryPath, content);
    assert.deepEqual(
      annotateArchivedSessions(sessions, agentDir).map((entry) => entry.archived),
      [undefined],
      `expected no archived sessions for ${content}`,
    );
  }
});

test("a missing registry annotates nothing and returns the list untouched", (t) => {
  const agentDir = createAgentDir(t);
  const sessions = [session("a")];

  assert.equal(annotateArchivedSessions(sessions, agentDir), sessions);
});

// The session list mixes disk-scanned sessions with live registry snapshots, and
// the disk-scanned ones come from a shared cache: tagging them in place would
// leak archive state into later reads.
test("annotation copies archived sessions and leaves the inputs unchanged", (t) => {
  const agentDir = createAgentDir(t);
  const persisted = session("persisted", { transient: false });
  const runtime = session("runtime", { transient: true });
  const active = session("active");

  setSessionArchived("persisted", true, agentDir);
  setSessionArchived("runtime", true, agentDir);
  const annotated = annotateArchivedSessions([persisted, runtime, active], agentDir);

  assert.deepEqual(annotated.map((entry) => entry.archived), [true, true, undefined]);
  assert.deepEqual(annotated.map((entry) => entry.transient), [false, true, undefined]);
  assert.equal(annotated[2], active);
  assert.equal("archived" in persisted, false);
  assert.equal("archived" in runtime, false);
});
