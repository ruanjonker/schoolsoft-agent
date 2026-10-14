/**
 * Parsers for the read-only shapes a daily check needs. HTTP is not involved;
 * the fixtures are invented and match the field names recorded for the app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseDriftError } from "../../src/core/errors/index.js";
import { toAssignments } from "../../src/providers/schoolsoft/portal/domain/assignments.js";
import { toNewsItems } from "../../src/providers/schoolsoft/portal/domain/news.js";
import { toMessageDetail } from "../../src/providers/schoolsoft/portal/domain/message.js";

test("assignments: dates and submission status, thin items kept, a non-array is drift", () => {
  const [full, thin] = toAssignments([
    {
      id: 9,
      title: "Prov",
      subTitle: "Kapitel 1",
      sortDate: "2026-09-08T08:00",
      submissionStatus: "not_submitted",
      resultReportStatus: "none",
    },
    { id: "x", title: "  ", subtitle: "Läxa", date: "2026-09-09", resultStatus: "done" },
    { dueDate: 1_757_000_000_000 },
    { sortDate: "nope" },
  ]);
  assert.equal(full.id, "9");
  assert.equal(full.title, "Prov");
  assert.equal(full.subtitle, "Kapitel 1");
  assert.match(full.date ?? "", /^2026-09-08T/);
  assert.equal(full.submissionStatus, "not_submitted");
  assert.equal(full.resultStatus, "none");
  assert.equal(thin.subtitle, "Läxa");
  assert.equal(thin.date, "2026-09-09");
  assert.equal(thin.resultStatus, "done");
  assert.equal(toAssignments([]).length, 0);
  assert.throws(() => toAssignments({ id: 1 }), ResponseDriftError);
});

test("news: title, date, body and whatever attachment names the portal sent", () => {
  const [named, flag, namedFile] = toNewsItems([
    {
      id: 3,
      title: "Utbildning",
      description: "Text",
      creDate: "2026-09-01",
      attachments: [
        "plan.pdf",
        { fileName: "bild.png" },
        { filename: "extra.txt" },
        { name: "" },
        4,
      ],
    },
    { id: "n", title: "Kort", hasAttachment: true, body: "Hej" },
    { title: "Fil", files: [{ name: "a.pdf" }], message: "ignored when body is set" },
  ]);
  assert.equal(named.title, "Utbildning");
  assert.equal(named.date, "2026-09-01");
  assert.equal(named.body, "Text");
  assert.deepEqual(named.attachments, [
    { name: "plan.pdf" },
    { name: "bild.png" },
    { name: "extra.txt" },
  ]);
  assert.equal(named.hasAttachment, true);
  assert.equal(flag.hasAttachment, true);
  assert.deepEqual(flag.attachments, []);
  assert.equal(flag.body, "Hej");
  assert.equal(namedFile.body, "ignored when body is set");
  assert.deepEqual(namedFile.attachments, [{ name: "a.pdf" }]);
  assert.equal(toNewsItems([{ creDate: 1_757_000_000_000, description: "" }])[0].date?.length, 25);
  assert.match(
    toNewsItems([{ creDate: "2026-09-01T08:00", title: "Tid" }])[0].date ?? "",
    /^2026-09-01T/,
  );
  assert.throws(() => toNewsItems("nope"), ResponseDriftError);
});

test("message detail: subject, sender, date, body, unread, attachments; GET shape only", () => {
  const full = toMessageDetail({
    id: 5,
    subject: "Möte",
    message: "Hej",
    isRead: false,
    sender: { firstName: "Ada", lastName: "Test" },
    date: "2026-09-01T10:00",
    attachments: [{ name: "kallelse.pdf" }],
  });
  assert.equal(full.subject, "Möte");
  assert.equal(full.body, "Hej");
  assert.equal(full.read, false);
  assert.deepEqual(full.sender, { name: "Ada Test" });
  assert.match(full.sentAt ?? "", /^2026-09-01T10:00:00/);
  assert.deepEqual(full.attachments, [{ name: "kallelse.pdf" }]);

  const named = toMessageDetail({
    sender: { name: "Skolan" },
    read: true,
    body: "Kort",
    sentAt: "2026-09-02T11:00",
    files: ["a.txt", { fileName: "b.txt" }, { filename: "c.txt" }, {}],
  });
  assert.equal(named.read, true);
  assert.equal(named.body, "Kort");
  assert.deepEqual(named.sender, { name: "Skolan" });
  assert.equal(named.attachments.length, 3);
  assert.equal(toMessageDetail({ sender: { firstName: " ", lastName: "" } }).sender, null);
  assert.equal(toMessageDetail({ date: "nope" }).sentAt, null);
  assert.match(toMessageDetail({ date: 1_757_000_000_000 }).sentAt ?? "", /T/);
  assert.equal(toMessageDetail({ date: Number.NaN }).sentAt, null);
  assert.throws(() => toMessageDetail([]), ResponseDriftError);
  assert.throws(() => toMessageDetail(null), ResponseDriftError);
});
