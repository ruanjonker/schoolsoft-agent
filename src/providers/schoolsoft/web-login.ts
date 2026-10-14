/**
 * Where SchoolSoft lives (its origin and a tenant's URLs), and its half of the
 * headed-browser web login: where to open, what a landed portal page looks like.
 */
import type { WebLoginSpec } from "../../core/provider/types.js";

export const SCHOOLSOFT_ORIGIN = "https://sms.schoolsoft.se";

/** A URL on one tenant: `https://sms.schoolsoft.se/<slug><path>`, the path as given. */
export function portalUrl(school: string, path: string): string {
  return `${SCHOOLSOFT_ORIGIN}/${school}${path}`;
}

// `etjanst.` covers a municipality SAML login such as Täby's etjanst.taby.se.
// The browser follows that hop; a URL there is not the portal yet. The slug
// in the SchoolSoft host is the tenant (one guardian, several schools share
// it); the school inside the tenant is an org id, not a second slug.
const LOGIN_MARKERS =
  /\/jsp\/Login\.jsp|\/samlLogin\.jsp|\/rest-api\/login\/|\/react\/#\/login|etjanst\.|\/wa\/auth\//;

/** True when a URL on the tenant is a portal page rather than any login step. */
export function isPortalUrl(url: string, school: string, origin = SCHOOLSOFT_ORIGIN): boolean {
  if (!url.startsWith(`${origin}/${school}/`)) return false;
  if (LOGIN_MARKERS.test(url)) return false;
  return /\/jsp\/(student|parent|teacher)\/|\/react\/#\/(parent|student)\//.test(url);
}

export const webLoginSpec: WebLoginSpec = {
  origin: SCHOOLSOFT_ORIGIN,
  loginUrl: (school) => `${SCHOOLSOFT_ORIGIN}/${school}/`,
  isPortalUrl: (url, school) => isPortalUrl(url, school),
};
