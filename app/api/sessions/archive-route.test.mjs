import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});
const { PATCH, DELETE } = await jiti.import("./[id]/route.ts");
const { SessionManager } = await jiti.import("@oh-my-pi/pi-coding-agent");
const { getAgentDir, refreshDirsFromEnv } = await jiti.import("@oh-my-pi/pi-utils");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("@/lib/session-reader");

const REGISTRY_FILE = "omp-web-archived-sessions.json";
const SESSION_ID = "archive-route-session";

function resetSessionListState() {
  globalThis.__ompSessionListCache = undefined;
  globalThis.__ompSessionListPromise = undefined;
  globalThis.__ompSessionListPromiseGeneration = undefined;
  globalThis.__ompSessionListGeneration = 0;
}

/**
 * A persisted session with a running agent, an isolated agent dir for the
 * archive registry, and no access to the real session store.
 */
function createSession(t) {
  const root = mkdtempSync(join(tmpdir(), "omp-web-archive-route-"));
  const agentDir = join(root, "agent");
  const sessionFile = join(root, "sessions", `${SESSION_ID}.jsonl`);
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      id: SESSION_ID,
      cwd: root,
      timestamp: "2026-08-01T00:00:00.000Z",
    })}\n`,
  );

  const previousAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  refreshDirsFromEnv();
  assert.equal(getAgentDir(), agentDir, "agent dir override must isolate the archive registry");

  const previousListAll = SessionManager.listAll;
  const previousOpen = SessionManager.open;
  const previousRegistry = globalThis.__ompSessions;
  SessionManager.listAll = async () => [];
  resetSessionListState();
  cacheSessionPath(SESSION_ID, sessionFile);

  let shutdowns = 0;
  globalThis.__ompSessions = new Map([[SESSION_ID, {
    isAlive: () => true,
    isRunning: () => true,
    sessionFile,
    sessionId: SESSION_ID,
    cwd: root,
    shutdown: async () => {
      shutdowns += 1;
    },
  }]]);

  t.after(() => {
    if (previousAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDirEnv;
    refreshDirsFromEnv();
    SessionManager.listAll = previousListAll;
    SessionManager.open = previousOpen;
    globalThis.__ompSessions = previousRegistry;
    invalidateSessionPathCache(SESSION_ID);
    resetSessionListState();
    rmSync(root, { recursive: true, force: true });
  });

  return {
    agentDir,
    sessionFile,
    registryPath: join(agentDir, REGISTRY_FILE),
    shutdownCount: () => shutdowns,
  };
}

function patchRequest(body, { contentType = "application/json" } = {}) {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}`, {
    method: "PATCH",
    headers: { host: "localhost", "content-type": contentType },
    body: JSON.stringify(body),
  });
}

function routeContext(id = SESSION_ID) {
  return { params: Promise.resolve({ id }) };
}

function readRegistry(registryPath) {
  return existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
}

test("archiving a session leaves its file and its running agent alone", async (t) => {
  const fixture = createSession(t);
  const fileBefore = readFileSync(fixture.sessionFile, "utf8");

  const response = await PATCH(patchRequest({ archived: true }), routeContext());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, archived: true });
  assert.deepEqual(Object.keys(readRegistry(fixture.registryPath)), [SESSION_ID]);
  assert.equal(readFileSync(fixture.sessionFile, "utf8"), fileBefore);
  assert.equal(fixture.shutdownCount(), 0);
});

test("restoring a session removes its archive entry", async (t) => {
  const fixture = createSession(t);
  await PATCH(patchRequest({ archived: true }), routeContext());

  const response = await PATCH(patchRequest({ archived: false }), routeContext());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, archived: false });
  assert.deepEqual(readRegistry(fixture.registryPath), {});
});

test("archiving requires a session with a persisted file", async (t) => {
  const fixture = createSession(t);

  const response = await PATCH(
    new Request("http://localhost/api/sessions/transient-session", {
      method: "PATCH",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }),
    routeContext("transient-session"),
  );

  assert.equal(response.status, 404);
  assert.equal(readRegistry(fixture.registryPath), null);
});

test("PATCH refuses ambiguous, malformed, and unsupported bodies", async (t) => {
  const fixture = createSession(t);

  for (const body of [
    {},
    { name: "renamed", archived: true },
    { archived: "yes" },
    { archived: null },
    { name: 7 },
    { pinned: true },
    ["archived"],
  ]) {
    const response = await PATCH(patchRequest(body), routeContext());
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }

  assert.equal(readRegistry(fixture.registryPath), null);
});

test("PATCH still requires a JSON content type", async (t) => {
  const fixture = createSession(t);

  const response = await PATCH(
    patchRequest({ archived: true }, { contentType: "text/plain" }),
    routeContext(),
  );

  assert.equal(response.status, 415);
  assert.equal(readRegistry(fixture.registryPath), null);
});

test("renaming a session still reaches the session manager", async (t) => {
  const fixture = createSession(t);
  const renames = [];
  SessionManager.open = async (path) => ({
    setSessionName: async (name, source) => {
      renames.push({ path, name, source });
    },
  });

  const response = await PATCH(patchRequest({ name: "  Renamed session  " }), routeContext());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(renames, [
    { path: fixture.sessionFile, name: "Renamed session", source: "user" },
  ]);
  assert.equal(readRegistry(fixture.registryPath), null);
});

test("permanently deleting an archived session clears its archive metadata", async (t) => {
  const fixture = createSession(t);
  await PATCH(patchRequest({ archived: true }), routeContext());

  const response = await DELETE(
    new Request(`http://localhost/api/sessions/${SESSION_ID}`, {
      method: "DELETE",
      headers: { host: "localhost" },
    }),
    routeContext(),
  );

  assert.equal(response.status, 200);
  assert.equal(existsSync(fixture.sessionFile), false);
  assert.deepEqual(readRegistry(fixture.registryPath), {});
  assert.equal(fixture.shutdownCount(), 1);
});
