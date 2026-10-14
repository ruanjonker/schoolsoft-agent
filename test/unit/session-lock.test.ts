/**
 * The session file lock and a rejected refresh. No network: SchoolSoft is
 * the offline stand-in. Two managers share one state directory the way a
 * CLI command and a long-running MCP server do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileSessionStore,
  SessionExpiredError,
  accountKey,
  createSessionManager,
  resolveConfig,
} from "../../src/core/index.js";
import { SESSION_LOCK_FILE, withSessionFileLock } from "../../src/core/session/file-lock.js";
import { SchoolsoftSim, jwt } from "../helpers/schoolsoft-sim.js";
import type { PersistedSession } from "../../src/core/index.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "ssmcp-lock-"));
}

function expired(school: string, refresh: string): PersistedSession {
  return {
    provider: "schoolsoft",
    school,
    data: { accessToken: jwt(1), refreshToken: refresh, accessTokenExpiresAt: 1 },
    savedAt: 1,
    authMethod: "bankid-browser",
  };
}

test("the lock is exclusive, stolen when stale or unreadable, and released if the work throws", async () => {
  const root = dir();
  const path = join(root, SESSION_LOCK_FILE);
  const order: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withSessionFileLock(
    { dir: root, pid: 11, now: () => 1_000, staleMs: 50 },
    async () => {
      order.push("first");
      await held;
      order.push("first-done");
    },
  );
  const second = withSessionFileLock(
    {
      dir: root,
      pid: 12,
      now: () => 1_000,
      staleMs: 50,
      isAlive: () => true,
      sleep: async () => {
        order.push("wait");
        release();
        await first;
      },
    },
    async () => {
      order.push("second");
      return "ok";
    },
  );
  assert.equal(await second, "ok");
  await first;
  assert.deepEqual(order, ["first", "wait", "first-done", "second"]);
  assert.equal(existsSync(path), false);

  writeFileSync(path, "nope\n1000");
  await withSessionFileLock(
    { dir: root, pid: 1, now: () => 1000, isAlive: () => true },
    async () => {
      assert.match(readFileSync(path, "utf8"), /^1\n/);
    },
  );
  writeFileSync(path, "0\n1000");
  await withSessionFileLock(
    { dir: root, pid: 2, now: () => 1000, isAlive: () => true },
    async () => {},
  );
  writeFileSync(path, "8\n0");
  await withSessionFileLock(
    { dir: root, pid: 3, now: () => 10_000, isAlive: () => true, staleMs: 50 },
    async () => {},
  );
  writeFileSync(path, "8\nnope");
  await withSessionFileLock(
    { dir: root, pid: 4, now: () => 10_000, isAlive: () => true },
    async () => {},
  );
  writeFileSync(path, "99\n100000");
  await withSessionFileLock(
    { dir: root, pid: 5, now: () => 100_000, isAlive: () => false, staleMs: 10_000 },
    async () => {},
  );
  mkdirSync(path);
  await withSessionFileLock({ dir: root, pid: 6, now: () => 1 }, async () => {
    assert.equal(existsSync(path), true);
  });
  assert.equal(existsSync(path), false);

  writeFileSync(path, `${process.pid}\n${Date.now()}`);
  setTimeout(() => rmSync(path, { force: true }), 5);
  await withSessionFileLock({ dir: root, pid: 7 }, async () => "defaults");

  await assert.rejects(
    withSessionFileLock({ dir: root, pid: 8, now: () => 1 }, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(existsSync(path), false);
});

test("two runs share one refresh, and two schools keep both sessions", async () => {
  const root = dir();
  const sim = new SchoolsoftSim(() => Date.now());
  let refreshes = 0;
  const fetchImpl = async (
    url: string,
    school: string,
    request: { method?: string; headers?: Record<string, string> },
  ) => {
    if (url.includes("grantType=refresh_token")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 40));
    }
    return sim.fetch(url, school, request);
  };
  const config = resolveConfig(
    [{ school: "example", stateDir: root, configDir: root, cache: false }],
    { home: root, platform: "linux" },
  );
  new FileSessionStore(root, accountKey("schoolsoft", "example")).save(
    expired("example", "refresh-0"),
  );
  const a = createSessionManager(config, { fetchImpl });
  const b = createSessionManager(config, { fetchImpl });
  await Promise.all([a.ensureSession(), b.ensureSession()]);
  assert.equal(refreshes, 1);
  const saved = new FileSessionStore(root, accountKey("schoolsoft", "example")).load();
  assert.equal((saved!.data as { refreshToken: string }).refreshToken, "refresh-1");

  const other = resolveConfig(
    [{ school: "other", stateDir: root, configDir: root, cache: false }],
    { home: root, platform: "linux" },
  );
  new FileSessionStore(root, accountKey("schoolsoft", "other")).save(expired("other", "other-0"));
  await createSessionManager(other, { fetchImpl }).ensureSession();
  assert.equal(
    (
      new FileSessionStore(root, accountKey("schoolsoft", "example")).load()!.data as {
        refreshToken: string;
      }
    ).refreshToken,
    "refresh-1",
  );
  assert.match(
    String(
      (
        new FileSessionStore(root, accountKey("schoolsoft", "other")).load()!.data as {
          refreshToken: string;
        }
      ).refreshToken,
    ),
    /^refresh-/,
  );
});

test("a rejected refresh clears the saved session and is not tried again", async () => {
  const root = dir();
  const sim = new SchoolsoftSim(() => Date.now());
  sim.refreshStatus = 401;
  const config = resolveConfig(
    [{ school: "example", stateDir: root, configDir: root, cache: false }],
    { home: root, platform: "linux" },
  );
  new FileSessionStore(root, accountKey("schoolsoft", "example")).save(
    expired("example", "refresh-0"),
  );
  const manager = createSessionManager(config, { fetchImpl: sim.fetch, pid: 4242 });
  await assert.rejects(manager.ensureSession(), (e: unknown) => e instanceof SessionExpiredError);
  assert.equal(sim.refreshes, 0);
  assert.equal(sim.requests.filter((r) => r.includes("grantType=refresh_token")).length, 1);
  assert.equal(new FileSessionStore(root, accountKey("schoolsoft", "example")).load(), null);
  await assert.rejects(manager.ensureSession(), /no saved session/);
  assert.equal(sim.requests.filter((r) => r.includes("grantType=refresh_token")).length, 1);
});

test("a dead lock file is taken by the wired manager", async () => {
  const root = dir();
  writeFileSync(join(root, SESSION_LOCK_FILE), `999999\n${Date.now()}`);
  const config = resolveConfig(
    [{ school: "example", stateDir: root, configDir: root, cache: false }],
    { home: root, platform: "linux" },
  );
  const manager = createSessionManager(config, { pid: 50 });
  await assert.rejects(manager.ensureSession(), /no saved session/);
  assert.equal(existsSync(join(root, SESSION_LOCK_FILE)), false);

  writeFileSync(join(root, SESSION_LOCK_FILE), `${process.pid}\n${Date.now()}`);
  setTimeout(() => rmSync(join(root, SESSION_LOCK_FILE), { force: true }), 5);
  await assert.rejects(createSessionManager(config).ensureSession(), /no saved session/);
});
