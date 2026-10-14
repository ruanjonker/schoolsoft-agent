/**
 * `GET .../messages/<id>` (Bearer). The inbox list is a preview; this is the
 * body. The call is a GET. Nothing in this client posts a "mark as read".
 * If the portal marks the message read as a side effect of the GET, that was
 * not re-checked live — prefer the inbox list when the unread flag is enough.
 */
import { ResponseDriftError } from "../../../../core/errors/index.js";
import { instantToStockholm, toStockholmDateTime } from "../../../../core/domain/time.js";

export interface MessageAttachment {
  name: string;
}

export interface MessageDetail {
  id: number | null;
  subject: string;
  sender: { name: string } | null;
  sentAt: string | null;
  body: string;
  read: boolean;
  attachments: MessageAttachment[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function when(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return instantToStockholm(value);
  if (typeof value !== "string") return null;
  return toStockholmDateTime(value);
}

function senderName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (typeof s.name === "string" && s.name.trim() !== "") return s.name.trim();
  const name = [s.firstName, s.lastName]
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(" ")
    .trim();
  return name || null;
}

function attachmentsOf(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  const names: MessageAttachment[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      names.push({ name: entry.trim() });
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const name = text(record.name) ?? text(record.fileName) ?? text(record.filename);
      if (name) names.push({ name });
    }
  }
  return names;
}

export function toMessageDetail(data: unknown): MessageDetail {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ResponseDriftError("getMessage", "(root) invalid_type");
  const item = data as Record<string, unknown>;
  const sender = senderName(item.sender);
  const read = item.isRead === true || item.read === true;
  return {
    id: typeof item.id === "number" ? item.id : null,
    subject: text(item.subject) ?? "",
    sender: sender ? { name: sender } : null,
    sentAt: when(item.date) ?? when(item.sentAt),
    body: text(item.message) ?? text(item.body) ?? "",
    read,
    attachments: attachmentsOf(item.attachments ?? item.files),
  };
}
