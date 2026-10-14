/**
 * News and inbox from the legacy JSP pages (web-only session), on synthetic
 * pages shaped like the live ones (2026-10-14): ids, structure, no content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  htmlText,
  inboxDate,
  inboxFromPage,
  messageFromPage,
  newsFromPage,
} from "../../src/providers/schoolsoft/portal/domain/web-pages.js";
import {
  WebPagesApi,
  NEWS_PAGE,
  INBOX_PAGE,
} from "../../src/providers/schoolsoft/portal/api/web-pages-api.js";
import { SchoolsoftHttp } from "../../src/providers/schoolsoft/portal/api/transport.js";
import { ApiPortal } from "../../src/providers/schoolsoft/portal/api-portal.js";
import { UpstreamError } from "../../src/core/errors/index.js";
import { WebLoginRequiredError } from "../../src/core/portal/types.js";

const NOW = Date.parse("2026-10-14T19:00:00Z");

const news = (id: number, o: { attach?: boolean; date?: boolean } = {}) =>
  `<div class="accordion-group" id="g${id}"><span id='name${id}'>Rubrik &amp; nytt</span>` +
  `<span id='description${id}'><p class="tinymce-p">Rad ett</p><p class="tinymce-p">Rad <strong>två</strong>&nbsp;&#246;</p></span>` +
  (o.date === false
    ? ""
    : `<div class="hidden" id='fromDateDay${id}'>9</div><div class="hidden" id='fromDateMonth${id}'>10</div><div class="hidden" id='fromDateYear${id}'>2026</div>`) +
  (o.attach
    ? `<a href="right_student_file_download.jsp?id=1">Bilaga.pdf</a><a href="right_student_file_download.jsp?id=2"><img/></a>`
    : "") +
  `</div>`;

const mess = (id: number, o: { date?: string; read?: boolean; from?: string } = {}) =>
  `<div class="accordion-group" id="m${id}"><span id='messheader${id}'>Ämne</span>` +
  `<div class="statusicon"><img id="i${id}" src="../../grafics/${o.read === false ? "mail_new" : "mail_open"}.gif" alt="" /></div>` +
  `<span id='mess${id}'>Hej<br /><br />Text</span>` +
  `<span id='messfrom${id}'>${o.from ?? "Lärare"}</span><span id='messdate${id}'>${o.date ?? "9 Oct 21:30"}</span></div>`;

test("htmlText turns markup into plain text", () => {
  assert.equal(
    htmlText("<p>a</p><p>b<br/>c &amp; &lt;&gt; &bogus; &#65;</p>"),
    "a\nb\nc & <> &bogus; A",
  );
  assert.equal(htmlText("x\n\n\n\ny"), "x\n\ny");
});

test("inboxDate reads the inbox's date forms", () => {
  assert.equal(inboxDate("9 Oct 21:30", NOW), "2026-10-09T21:30:00+02:00");
  assert.equal(inboxDate("9 okt 21:30", NOW), "2026-10-09T21:30:00+02:00");
  assert.equal(
    inboxDate("20 Dec 08:00", NOW),
    "2025-12-20T08:00:00+01:00",
    "a future date is last year",
  );
  assert.equal(inboxDate("9 Oct 2025", NOW), "2025-10-09T00:00:00+02:00");
  assert.equal(inboxDate("2026-10-09 07:05", NOW), "2026-10-09T07:05:00+02:00");
  assert.equal(inboxDate("2026-10-09", NOW), "2026-10-09T00:00:00+02:00");
  assert.equal(inboxDate("9 Xyz 21:30", NOW), null);
  assert.equal(inboxDate("igår", NOW), null);
});

test("newsFromPage: title, body, date and attachments per item", () => {
  const items = newsFromPage(
    `<html>${news(11, { attach: true })}${news(12, { date: false })}</html>`,
  );
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    id: "news:11",
    title: "Rubrik & nytt",
    date: "2026-10-09",
    body: "Rad ett\nRad två ö",
    attachments: [{ name: "Bilaga.pdf" }, { name: "attachment" }],
    hasAttachment: true,
  });
  assert.equal(items[1].date, null);
  assert.equal(items[1].hasAttachment, false);
  assert.deepEqual(newsFromPage("<html></html>"), []);
});

test("inboxFromPage: subject, sender, date, read flag and body; undated rows are left out", () => {
  const page = mess(1) + mess(2, { read: false, from: "" }) + mess(3, { date: "okänt" });
  const list = inboxFromPage(page, NOW);
  assert.deepEqual(
    list.map((m) => m.id),
    [1, 2],
  );
  assert.equal(list[0].read, true);
  assert.equal(list[1].read, false);
  assert.deepEqual(list[0].sender, { name: "Lärare" });
  assert.equal(list[1].sender, null);
  assert.equal(list[0].body, "Hej\n\nText");
  assert.equal(list[0].hasAttachments, false);
  assert.equal(messageFromPage(page, 2, NOW)?.subject, "Ämne");
  assert.equal(messageFromPage(page, 9, NOW), null);
});

test("a span left open runs to the end of the page", () => {
  const list = newsFromPage("<div><span id='name5'>Öppen");
  assert.equal(list[0].title, "Öppen");
});

function pageFetch(pages: Record<string, { status: number; data: string }>) {
  const seen: { path: string; cookie?: string; redirect?: string }[] = [];
  const fetchImpl = async (
    url: string,
    _s: string,
    o: { headers?: Record<string, string>; redirect?: string },
  ) => {
    const path = url.replace("https://sms.schoolsoft.se/testskola", "");
    seen.push({ path, cookie: o.headers?.Cookie, redirect: o.redirect });
    return { ...(pages[path] ?? { status: 404, data: "" }), headers: {}, setCookies: [] };
  };
  return { fetchImpl, seen };
}

test("WebPagesApi reads the pages with that path's cookies and never follows a redirect", async () => {
  const { fetchImpl, seen } = pageFetch({
    [NEWS_PAGE]: { status: 200, data: news(1) },
    [INBOX_PAGE]: { status: 200, data: mess(4) },
  });
  const api = new WebPagesApi(
    new SchoolsoftHttp("testskola", fetchImpl as never),
    (p) => `c=${p.length}`,
    () => NOW,
  );
  assert.equal((await api.getNews()).length, 1);
  const inbox = await api.getInbox();
  assert.equal(inbox.length, 1);
  assert.equal("body" in inbox[0], false, "the list carries no bodies");
  assert.equal((await api.getMessage(4)).body, "Hej\n\nText");
  await assert.rejects(
    api.getMessage(5),
    (e: unknown) => e instanceof UpstreamError && e.status === 404,
  );
  assert.equal(seen[0].cookie, `c=${NEWS_PAGE.length}`);
  assert.ok(seen.every((s) => s.redirect === "manual"));
  const noCookie = new WebPagesApi(new SchoolsoftHttp("testskola", fetchImpl as never), () => null);
  await assert.rejects(noCookie.getNews(), WebLoginRequiredError);
});

test("a JSP redirect is a lost session; other statuses are upstream errors; a non-text body is empty", async () => {
  const http = (status: number, data: unknown) =>
    new SchoolsoftHttp("testskola", (async () => ({
      status,
      data,
      headers: {},
      setCookies: [],
    })) as never);
  await assert.rejects(
    http(302, "").getPage("/jsp/x.jsp", "c"),
    (e: unknown) => e instanceof UpstreamError && e.sessionRejected,
  );
  await assert.rejects(
    http(500, "").getPage("/jsp/x.jsp", "c"),
    (e: unknown) => e instanceof UpstreamError && !e.sessionRejected,
  );
  assert.equal(await http(200, null).getPage("/jsp/x.jsp", "c"), "");
});

test("ApiPortal: with no token but a web session, news and messages come from the JSP pages", async () => {
  const { fetchImpl, seen } = pageFetch({
    [NEWS_PAGE]: { status: 200, data: news(1) },
    [INBOX_PAGE]: { status: 200, data: mess(4) },
  });
  const portal = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => "w=1",
    webPageCookieHeader: () => "w=1",
    fetchImpl: fetchImpl as never,
  });
  assert.equal((await portal.getNews(0, 1, 2)).length, 1);
  assert.equal((await portal.getInbox(0, 1)).length >= 0, true);
  await portal.getMessage(0, 1, 4).catch(() => {});
  assert.ok(seen.some((s) => s.path === NEWS_PAGE));
  assert.ok(seen.some((s) => s.path === INBOX_PAGE));
  const app = pageFetch({});
  const withToken = new ApiPortal({
    school: "testskola",
    accessToken: () => "tok",
    cookieHeader: () => null,
    webPageCookieHeader: () => "w=1",
    fetchImpl: app.fetchImpl as never,
  });
  await withToken.getNews(1, 2, 3).catch(() => {});
  await withToken.getInbox(1, 2).catch(() => {});
  await withToken.getMessage(1, 2, 3).catch(() => {});
  assert.ok(
    app.seen.every((s) => s.path.startsWith("/eva/")),
    "a token keeps the app API",
  );
  const neither = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => null,
    fetchImpl: app.fetchImpl as never,
  });
  await neither.getNews(1, 2, 3).catch(() => {});
});

test("items missing parts still parse, with empty fields", () => {
  const n = newsFromPage("<span id='name20'>Bara rubrik</span>");
  assert.deepEqual(n[0], {
    id: "news:20",
    title: "Bara rubrik",
    date: null,
    body: "",
    attachments: [],
    hasAttachment: false,
  });
  const m = inboxFromPage(
    "<b id='messheader30'></b><span id='messdate30'>1 Oct 10:00</span><a href='right_student_file_download.jsp'>f</a>",
    NOW,
  );
  assert.deepEqual(
    { s: m[0].subject, b: m[0].body, from: m[0].sender, read: m[0].read, att: m[0].hasAttachments },
    { s: "", b: "", from: null, read: false, att: true },
  );
  assert.equal(inboxFromPage("<b id='messheader31'></b>", NOW).length, 0, "no date at all");
});

test("JSP reads tell the request budget first", async () => {
  let reads = 0;
  const http = new SchoolsoftHttp(
    "testskola",
    (async () => ({ status: 200, data: "<p/>", headers: {}, setCookies: [] })) as never,
    () => reads++,
  );
  await http.getPage("/jsp/x.jsp", "c");
  assert.equal(reads, 1);
});

test("ApiPortal: a web page cookie function that has no session keeps the app API", async () => {
  const app = pageFetch({});
  const p = new ApiPortal({
    school: "testskola",
    accessToken: () => null,
    cookieHeader: () => null,
    webPageCookieHeader: () => null,
    fetchImpl: app.fetchImpl as never,
  });
  await p.getNews(1, 2, 3).catch(() => {});
  assert.ok(app.seen.every((s) => s.path.startsWith("/eva/")));
});

test("nested spans stay inside their item; a marker on another tag gives an empty title", () => {
  assert.equal(newsFromPage("<span id='name41'>a <span>b</span> c</span>")[0].title, "a b c");
  assert.equal(newsFromPage("<b id='name40'>x</b>")[0].title, "");
});
