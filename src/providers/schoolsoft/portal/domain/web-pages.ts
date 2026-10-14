/**
 * News and inbox from the legacy JSP pages the web session serves
 * (`right_student_news.jsp`, `right_student_message.jsp`). Used when there is
 * no app token. Element ids recorded live 2026-10-14 (guardian, IES Täby):
 * every item is an `accordion-group`; news carries `name<id>`,
 * `description<id>` and `fromDate{Day,Month,Year}<id>`; messages carry
 * `messheader<id>`, `mess<id>`, `messfrom<id>`, `messdate<id>` and a status
 * icon (`mail_open.gif` = read). The page lists the bodies inline, so reading
 * never opens a message (nothing is marked as read).
 */
import type { Message } from "../../../../core/domain/schemas.js";
import { toStockholmDateTime } from "../../../../core/domain/time.js";
import type { NewsItem } from "./news.js";
import type { MessageDetail } from "./message.js";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aring: "å",
  auml: "ä",
  ouml: "ö",
  Aring: "Å",
  Auml: "Ä",
  Ouml: "Ö",
};

/** HTML fragment → plain text: block ends become newlines, tags go, entities decode. */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, n: string) => ENTITIES[n] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The inner HTML of the element with this id, up to its first closing tag of that kind. */
function byId(html: string, id: string, tag = "span"): string | null {
  const open = new RegExp(`<${tag}[^>]*id=['"]${id}['"][^>]*>`).exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  // Nested elements of the same kind: count opens and closes.
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

/** The item blocks of an accordion page, each with its numeric id. */
function items(html: string, marker: string): { id: number; html: string }[] {
  const out: { id: number; html: string }[] = [];
  const re = new RegExp(`id=['"]${marker}(\\d+)['"]`, "g");
  // Each item starts at the tag that carries the marker id.
  const starts = [...html.matchAll(re)].map((m) => ({
    id: Number(m[1]),
    at: html.lastIndexOf("<", m.index),
  }));
  starts.forEach((s, i) => {
    out.push({
      id: s.id,
      html: html.slice(s.at, starts[i + 1]?.at ?? html.length),
    });
  });
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  maj: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The inbox's dates: `9 Oct 21:30` (this year, or last year when that would
 * be in the future), `2026-10-09 21:30`, or `9 Oct 2025`.
 */
export function inboxDate(value: string, now: number): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(v);
  if (iso)
    return toStockholmDateTime(
      `${iso[1]}-${iso[2]}-${iso[3]} ${pad(Number(iso[4] ?? 0))}:${iso[5] ?? "00"}`,
    );
  const m = /^(\d{1,2})\s+([A-Za-zåäö]{3})[a-zåäö]*\.?\s+(?:(\d{4})|(\d{1,2}):(\d{2}))$/.exec(v);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const thisYear = new Date(now).getUTCFullYear();
  const at = (y: number) =>
    toStockholmDateTime(
      `${y}-${pad(month)}-${pad(Number(m[1]))} ${pad(Number(m[4] ?? 0))}:${m[5] ?? "00"}`,
    );
  if (m[3]) return at(Number(m[3]));
  const guess = at(thisYear);
  if (guess && Date.parse(guess) > now + 86_400_000) return at(thisYear - 1);
  return guess;
}

/** News items from right_student_news.jsp. */
export function newsFromPage(html: string): NewsItem[] {
  return items(html, "name").map(({ id, html: block }) => {
    const title = htmlText(byId(block, `name${id}`) ?? "");
    const body = htmlText(byId(block, `description${id}`) ?? "");
    const day = htmlText(byId(block, `fromDateDay${id}`, "div") ?? "");
    const month = htmlText(byId(block, `fromDateMonth${id}`, "div") ?? "");
    const year = htmlText(byId(block, `fromDateYear${id}`, "div") ?? "");
    const date =
      /^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) && /^\d{1,2}$/.test(day)
        ? `${year}-${pad(Number(month))}-${pad(Number(day))}`
        : null;
    const attachments = [
      ...block.matchAll(/<a[^>]*href=["'][^"']*file_download\.jsp[^"']*["'][^>]*>([\s\S]*?)<\/a>/g),
    ].map((a) => ({ name: htmlText(a[1]) || "attachment" }));
    return {
      id: `news:${id}`,
      title,
      date,
      body,
      attachments,
      hasAttachment: attachments.length > 0,
    };
  });
}

/** Inbox messages (with their bodies) from right_student_message.jsp. */
export function inboxFromPage(html: string, now: number): (Message & { body: string })[] {
  const out: (Message & { body: string })[] = [];
  for (const { id, html: block } of items(html, "messheader")) {
    const sentAt = inboxDate(htmlText(byId(block, `messdate${id}`) ?? ""), now);
    if (!sentAt) continue; // no date the schema accepts: leave the row out rather than invent one
    const body = htmlText(byId(block, `mess${id}`) ?? "");
    const from = htmlText(byId(block, `messfrom${id}`) ?? "");
    const icon = /class="statusicon"><img[^>]*src="([^"]*)"/.exec(block)?.[1] ?? "";
    out.push({
      id,
      subject: htmlText(byId(block, `messheader${id}`) ?? ""),
      preview: body.slice(0, 200),
      read: /mail_open/.test(icon),
      sender: from ? { name: from } : null,
      sentAt,
      hasAttachments: /file_download\.jsp/.test(block),
      body,
    });
  }
  return out;
}

/** One message from the inbox page, by id; null when it is not on the page. */
export function messageFromPage(html: string, id: number, now: number): MessageDetail | null {
  const m = inboxFromPage(html, now).find((x) => x.id === id);
  if (!m) return null;
  return {
    id: m.id,
    subject: m.subject,
    sender: m.sender,
    sentAt: m.sentAt,
    body: m.body,
    read: m.read,
    attachments: [],
  };
}
