/**
 * Web-session strategy: a session that holds only the cookies of a web
 * login (`login --web`), no app token. It restores by sending those portal
 * cookies to the guardian `/rest-api/parent/*` endpoints, the same ones the
 * token → cookie exchange unlocks, and learns the child in focus from the
 * portal header. It never logs in by itself and never refreshes anything:
 * when SchoolSoft drops the cookies, the session is gone and the guardian
 * logs in again in the browser.
 *
 * The web bundle has no way to turn web cookies into an app token, so this
 * session has none; token-only capabilities stay unavailable on it.
 */
import type { AuthStrategy, LoginInfo } from "../../../core/auth/strategy.js";
import type { PersistedSession } from "../../../core/session/store.js";
import type { GuardianContext } from "../../../core/portal/guardian.js";
import type { GuardianChild } from "../../../core/portal/types.js";
import { cookieHeaderFor } from "../../../core/browser/web-login.js";
import { childOf } from "../../../core/portal/guardian.js";
import { WEB_SESSION_METHOD } from "../../../core/session/session-manager.js";
import { AgentError, SessionExpiredError, UpstreamError } from "../../../core/errors/index.js";
import { SchoolsoftHttp, type ApiFetch } from "../portal/api/transport.js";
import type { SchoolsoftSession } from "../session.js";

const HEADER_PATH = "/rest-api/parent/header/parent";

/** The parts of the portal header this strategy reads; anything else is ignored. */
interface HeaderSchool {
  orgId?: unknown;
  className?: unknown;
  schoolName?: unknown;
  studentActive?: unknown;
}
interface HeaderChild {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  schools?: HeaderSchool[];
}
interface Header {
  firstName?: unknown;
  lastName?: unknown;
  children?: HeaderChild[];
  currentChildId?: unknown;
  currentOrgId?: unknown;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The header's children (live 2026-10-14: `id`, names, `schools` with
 * `orgId`, `className`, `schoolName`, `studentActive`). A child whose every
 * school says `studentActive: false` (a former pupil) is left out.
 */
function childrenOf(header: Header): GuardianChild[] {
  const out: GuardianChild[] = [];
  for (const c of Array.isArray(header.children) ? header.children : []) {
    if (typeof c?.id !== "number") continue;
    const schools = (Array.isArray(c.schools) ? c.schools : [])
      .filter((s) => typeof s?.orgId === "number" && s.studentActive !== false)
      .map((s) => ({
        orgId: s.orgId as number,
        name: text(s.schoolName),
        className: text(s.className),
      }));
    if (schools.length === 0) continue;
    out.push({
      studentId: c.id,
      firstName: text(c.firstName),
      lastName: text(c.lastName),
      schools,
    });
  }
  return out;
}

export interface WebSessionOptions {
  /** The budgeted HTTP helper (net.ts) in production, a fake in tests. */
  fetchImpl: ApiFetch;
}

/** The portal cookies of a saved web login as one Cookie header, or null. */
export function webCookieHeader(saved: PersistedSession): string | null {
  return cookieHeaderFor(saved.web?.cookies ?? [], saved.school, "/rest-api/");
}

function oneChild(header: Header): GuardianChild {
  const studentId = header.currentChildId;
  const orgId = header.currentOrgId;
  if (typeof studentId !== "number" || typeof orgId !== "number") {
    // Not the guardian header: the cookies landed on a login page, or belong to another user type.
    throw new SessionExpiredError();
  }
  return { studentId, firstName: "", lastName: "", schools: [{ orgId, name: "", className: "" }] };
}

export class WebSessionStrategy implements AuthStrategy<SchoolsoftSession> {
  readonly id = WEB_SESSION_METHOD;
  context?: GuardianContext;

  constructor(private readonly options: WebSessionOptions) {}

  async login(): Promise<LoginInfo> {
    await Promise.resolve();
    throw new AgentError({
      kind: "not_authenticated",
      key: "not_authenticated",
      params: { reason: "a web session starts with the web login" },
      hint: "login_web",
    });
  }

  async restore(session: SchoolsoftSession, saved: PersistedSession): Promise<void> {
    const cookie = webCookieHeader(saved);
    if (!cookie) throw new SessionExpiredError();
    session.tokens.setCookieHeader(cookie);
    let header: Header | null;
    try {
      header = await new SchoolsoftHttp(session.school, this.options.fetchImpl).get<Header | null>(
        HEADER_PATH,
        { Cookie: cookie },
      );
    } catch (e) {
      if (e instanceof UpstreamError && e.sessionRejected) throw new SessionExpiredError();
      throw e;
    }
    const h = header ?? {};
    const current = oneChild(h);
    const listed = childrenOf(h);
    const children = listed.some((c) => c.studentId === current.studentId)
      ? listed
      : [current, ...listed];
    this.context = {
      userId: 0,
      parentName: `${text(h.firstName)} ${text(h.lastName)}`.trim(),
      children,
      childInFocus: current.studentId,
    };
  }

  /** Nothing to renew: web cookies cannot be refreshed, only kept warm by use. */
  async renew(): Promise<{ expiresAt: number | null }> {
    await Promise.resolve();
    return { expiresAt: null };
  }

  /**
   * Switch the web session to another child: the same PUT the portal's own
   * child menu sends. It changes only which child the session shows.
   */
  async focusChild(session: SchoolsoftSession, studentId: number): Promise<void> {
    await Promise.resolve();
    if (!this.context)
      throw new AgentError({
        kind: "not_authenticated",
        key: "not_authenticated",
        params: { reason: "no guardian context yet" },
        hint: "login",
      });
    const child = childOf(this.context, studentId); // validates: throws for any other child
    const cookie = session.cookieHeader();
    if (!cookie) throw new SessionExpiredError();
    const path = `${HEADER_PATH}?childId=${child.studentId}&orgId=${child.schools[0].orgId}`;
    const status = await new SchoolsoftHttp(session.school, this.options.fetchImpl).put(
      path,
      cookie,
    );
    if (status === 401 || status === 403) throw new SessionExpiredError();
    if (status < 200 || status >= 300)
      throw new UpstreamError(status, `selecting child ${child.studentId} in the web session`);
    this.context = { ...this.context, childInFocus: child.studentId };
  }
}
