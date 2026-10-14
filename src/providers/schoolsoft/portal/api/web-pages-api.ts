/**
 * News and messages from the legacy JSP pages, with the web session's
 * cookies: the path a web-only session (no app token) has to them. GETs
 * only; the inbox page lists the bodies, so no message is opened.
 */
import type { Message } from "../../../../core/domain/schemas.js";
import { WebLoginRequiredError } from "../../../../core/portal/types.js";
import type { SchoolsoftHttp } from "./transport.js";
import type { NewsItem } from "../domain/news.js";
import type { MessageDetail } from "../domain/message.js";
import { inboxFromPage, messageFromPage, newsFromPage } from "../domain/web-pages.js";
import { UpstreamError } from "../../../../core/errors/index.js";

export const NEWS_PAGE = "/jsp/student/right_student_news.jsp";
export const INBOX_PAGE = "/jsp/student/right_student_message.jsp";

export class WebPagesApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly cookieFor: (path: string) => string | null,
    private readonly now: () => number = Date.now,
  ) {}

  private page(capability: string, path: string): Promise<string> {
    const cookie = this.cookieFor(path);
    if (!cookie) return Promise.reject(new WebLoginRequiredError(capability));
    return this.http.getPage(path, cookie);
  }

  async getNews(): Promise<NewsItem[]> {
    return newsFromPage(await this.page("getNews", NEWS_PAGE));
  }

  async getInbox(): Promise<Message[]> {
    return inboxFromPage(await this.page("getInbox", INBOX_PAGE), this.now()).map(
      ({ body: _body, ...m }) => m,
    );
  }

  async getMessage(id: number): Promise<MessageDetail> {
    const m = messageFromPage(await this.page("getMessage", INBOX_PAGE), id, this.now());
    if (!m) throw new UpstreamError(404, `message ${id} on the inbox page`);
    return m;
  }
}
