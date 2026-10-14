/**
 * A web login on its own: SessionManager keeps web-only cookies, the
 * web-session strategy restores from them over the guardian header, and a
 * CDP web login closes only its own tab and never hangs on the disconnect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SessionManager,
  MemorySessionStore,
  WEB_SESSION_METHOD,
  SessionExpiredError,
} from "../../src/core/index.js";
import type { PersistedSession } from "../../src/core/session/store.js";
import { webLogin } from "../../src/core/browser/web-login.js";
import { webLoginSpec } from "../../src/providers/schoolsoft/web-login.js";
import type { PlaywrightLike } from "../../src/core/browser/playwright.js";
import {
  WebSessionStrategy,
  webCookieHeader,
} from "../../src/providers/schoolsoft/auth/web-session.js";
import { SchoolsoftSession } from "../../src/providers/schoolsoft/session.js";
import { UpstreamError } from "../../src/core/errors/index.js";
import { FakeAuth, fakeSession, serializeFake } from "../helpers/fakes.js";

const WEB = {
  savedAt: 5,
  landedOn: "https://sms.schoolsoft.se/testskola/jsp/student/right_student_startpage.jsp",
  cookies: [
    { name: "JSESSIONID", value: "w1", domain: "sms.schoolsoft.se", path: "/" },
    { name: "hash", value: "h1", domain: "sms.schoolsoft.se", path: "/" },
  ],
};

function saved(web: PersistedSession["web"] | null = WEB): PersistedSession {
  return {
    provider: "schoolsoft",
    school: "testskola",
    data: {},
    ...(web ? { web } : {}),
    savedAt: 5,
    authMethod: WEB_SESSION_METHOD,
  };
}

type Answer = { status: number; data: unknown };
function fakeFetch(answer: (path: string) => Answer) {
  const log: { path: string; cookie?: string }[] = [];
  const fetchImpl = async (
    url: string,
    _school: string,
    o: { headers?: Record<string, string> },
  ) => {
    const path = url.replace("https://sms.schoolsoft.se/testskola", "");
    log.push({ path, cookie: o.headers?.Cookie });
    return { ...answer(path), headers: {}, setCookies: [] };
  };
  return { fetchImpl, log };
}

const header = (): Answer => ({ status: 200, data: { currentChildId: 7, currentOrgId: 3 } });

test("webCookieHeader joins the saved portal cookies, null without any", () => {
  assert.equal(webCookieHeader(saved()), "JSESSIONID=w1; hash=h1");
  assert.equal(webCookieHeader(saved(null)), null);
  assert.equal(webCookieHeader(saved({ ...WEB, cookies: [] })), null);
});

test("restore sends the web cookies to the guardian header and keeps its child in focus", async () => {
  const { fetchImpl, log } = fakeFetch(header);
  const strategy = new WebSessionStrategy({ fetchImpl: fetchImpl as never });
  const session = new SchoolsoftSession("testskola", fetchImpl as never);
  await strategy.restore(session, saved());
  assert.deepEqual(log, [
    { path: "/rest-api/parent/header/parent", cookie: "JSESSIONID=w1; hash=h1" },
  ]);
  assert.equal(session.cookieHeader(), "JSESSIONID=w1; hash=h1");
  assert.equal(strategy.context?.childInFocus, 7);
  assert.equal(strategy.context?.children[0].schools[0].orgId, 3);
  assert.equal(session.tokens.accessToken, null, "a web session holds no app token");
  await strategy.focusChild(session, 7);
  await assert.rejects(strategy.focusChild(session, 8), /8/);
  assert.deepEqual(await strategy.renew(), { expiresAt: null });
});

test("restore: no cookies, a rejection or a non-header answer is an expired session", async () => {
  const ok = fakeFetch(header);
  const s = new WebSessionStrategy({ fetchImpl: ok.fetchImpl as never });
  await assert.rejects(
    s.restore(new SchoolsoftSession("testskola", ok.fetchImpl as never), saved(null)),
    SessionExpiredError,
  );
  for (const answer of [
    { status: 401, data: null },
    { status: 200, data: null },
    { status: 200, data: { currentChildId: "x" } },
  ]) {
    const f = fakeFetch(() => answer);
    const st = new WebSessionStrategy({ fetchImpl: f.fetchImpl as never });
    await assert.rejects(
      st.restore(new SchoolsoftSession("testskola", f.fetchImpl as never), saved()),
      SessionExpiredError,
    );
  }
  const down = fakeFetch(() => ({ status: 503, data: null }));
  const sd = new WebSessionStrategy({ fetchImpl: down.fetchImpl as never });
  await assert.rejects(
    sd.restore(new SchoolsoftSession("testskola", down.fetchImpl as never), saved()),
    (e: unknown) => e instanceof UpstreamError && !e.sessionRejected,
    "a transient failure says nothing about the session",
  );
});

test("the web-session strategy never logs in by itself", async () => {
  const s = new WebSessionStrategy({ fetchImpl: (async () => ({})) as never });
  await assert.rejects(s.login(), /web login/);
  await assert.rejects(s.focusChild({} as never, 1), /no guardian context/);
});

/** A strategy under the web-session id, for the manager's persistence. */
class FakeWeb extends FakeAuth {
  override readonly id = WEB_SESSION_METHOD as never;
}

function manager(store: MemorySessionStore, withWeb: boolean) {
  return new SessionManager({
    school: "testskola",
    provider: "schoolsoft",
    store,
    strategies: withWeb ? [new FakeAuth(), new FakeWeb()] : [new FakeAuth()],
    createSession: () => fakeSession(),
    serialize: serializeFake,
    now: () => 9,
    webLogin: async () => WEB,
  });
}

test("a web login without an app session is kept as a web-only session", async () => {
  const store = new MemorySessionStore();
  const m = manager(store, true);
  await m.webLogin();
  const s = store.load();
  assert.equal(s?.authMethod, WEB_SESSION_METHOD);
  assert.deepEqual(s?.data, {});
  assert.deepEqual(s?.web, WEB);
  assert.equal(s?.school, "testskola");
  m.clearWebSession();
  assert.equal(store.load(), null, "dropping the web cookies drops a web-only session");
  assert.equal(m.getWebSession(), null);
});

test("without a web-session strategy a lone web login is not persisted (as before)", async () => {
  const store = new MemorySessionStore();
  await manager(store, false).webLogin();
  assert.equal(store.load(), null);
});

function cdpPw(o: { hangClose?: boolean; contexts?: number; noPage?: boolean }) {
  const state = { newContexts: 0, pageClosed: 0, browserClosed: 0 };
  const page = {
    goto: async () => {},
    url: () => "https://sms.schoolsoft.se/taby/jsp/student/right_student_startpage.jsp",
    close: async () => {
      state.pageClosed++;
    },
  };
  const context = {
    newPage: async () => {
      if (o.noPage) throw new Error("tab refused");
      return page;
    },
    cookies: async () => [
      { name: "JSESSIONID", value: "w", domain: "sms.schoolsoft.se", path: "/", expires: -1 },
    ],
    pages: () => [page],
  };
  const browser = {
    contexts: () => Array.from({ length: o.contexts ?? 1 }, () => context),
    newContext: async () => {
      state.newContexts++;
      return context;
    },
    close: () => {
      state.browserClosed++;
      return o.hangClose ? new Promise<void>(() => {}) : Promise.resolve();
    },
  };
  const pw: PlaywrightLike = {
    chromium: {
      launch: async () => browser as never,
      executablePath: () => "/fake/chromium",
      connectOverCDP: async () => browser as never,
    },
  };
  return { pw, state };
}

test("over CDP the web login reuses the browser's own profile and closes only its tab", async () => {
  const { pw, state } = cdpPw({});
  const web = await webLogin({
    school: "taby",
    spec: webLoginSpec,
    engine: { kind: "cdp", endpoint: "http://127.0.0.1:9227" },
    loader: async () => pw,
    pollMs: 1,
  });
  assert.equal(web.cookies.length, 1);
  assert.equal(state.newContexts, 0, "the default context, not a fresh one");
  assert.equal(state.pageClosed, 1);
  assert.equal(state.browserClosed, 1, "disconnects");
});

test("over CDP a hanging disconnect does not hold the login; no default context opens a new one", async () => {
  const { pw, state } = cdpPw({ hangClose: true, contexts: 0 });
  const started = Date.now();
  const web = await webLogin({
    school: "taby",
    spec: webLoginSpec,
    engine: { kind: "cdp", endpoint: "http://127.0.0.1:9227" },
    loader: async () => pw,
    pollMs: 1,
  });
  assert.equal(web.cookies.length, 1);
  assert.equal(state.newContexts, 1);
  assert.ok(Date.now() - started < 10_000);
});

test("over CDP a tab that never opened still disconnects", async () => {
  const { pw, state } = cdpPw({ noPage: true });
  await assert.rejects(
    webLogin({
      school: "taby",
      spec: webLoginSpec,
      engine: { kind: "cdp", endpoint: "http://127.0.0.1:9227" },
      loader: async () => pw,
    }),
    /tab refused/,
  );
  assert.equal(state.pageClosed, 0);
  assert.equal(state.browserClosed, 1);
});
