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
import { childOf } from "../../../core/portal/guardian.js";
import { WEB_SESSION_METHOD } from "../../../core/session/session-manager.js";
import { AgentError, SessionExpiredError, UpstreamError } from "../../../core/errors/index.js";
import { SchoolsoftHttp, type ApiFetch } from "../portal/api/transport.js";
import type { SchoolsoftSession } from "../session.js";

const HEADER_PATH = "/rest-api/parent/header/parent";

/** The parts of the portal header this strategy reads; anything else is ignored. */
interface Header {
  currentChildId?: unknown;
  currentOrgId?: unknown;
}

export interface WebSessionOptions {
  /** The budgeted HTTP helper (net.ts) in production, a fake in tests. */
  fetchImpl: ApiFetch;
}

/** The portal cookies of a saved web login as one Cookie header, or null. */
export function webCookieHeader(saved: PersistedSession): string | null {
  const cookies = saved.web?.cookies ?? [];
  if (cookies.length === 0) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
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
    const child = oneChild(header ?? {});
    this.context = {
      userId: 0,
      parentName: "",
      children: [child],
      childInFocus: child.studentId,
    };
  }

  /** Nothing to renew: web cookies cannot be refreshed, only kept warm by use. */
  async renew(): Promise<{ expiresAt: number | null }> {
    await Promise.resolve();
    return { expiresAt: null };
  }

  /** Only the child the web session shows is known; switching is done in the portal itself. */
  async focusChild(_session: SchoolsoftSession, studentId: number): Promise<void> {
    await Promise.resolve();
    if (!this.context)
      throw new AgentError({
        kind: "not_authenticated",
        key: "not_authenticated",
        params: { reason: "no guardian context yet" },
        hint: "login",
      });
    childOf(this.context, studentId); // validates: throws for any other child
  }
}
