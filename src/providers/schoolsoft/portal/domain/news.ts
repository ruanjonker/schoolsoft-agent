/**
 * `GET /eva/api/v2/parent/.../news` (Bearer). The list recorded live has a
 * boolean `hasAttachment`, not file names. An `attachments` array is mapped
 * when the portal sends one; otherwise the list is empty and `hasAttachment`
 * still says whether the portal claimed files. Not re-checked live.
 */
import { z } from "zod";
import { ResponseDriftError } from "../../../../core/errors/index.js";
import {
  instantToStockholm,
  toLocalDate,
  toStockholmDateTime,
} from "../../../../core/domain/time.js";

export interface NewsAttachment {
  name: string;
}

export interface NewsItem {
  id: string;
  title: string;
  date: string | null;
  body: string;
  attachments: NewsAttachment[];
  hasAttachment: boolean;
}

const rawList = z.array(z.record(z.string(), z.unknown()));

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function when(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return instantToStockholm(value);
  if (typeof value !== "string") return null;
  return toLocalDate(value) ?? toStockholmDateTime(value);
}

function attachmentsOf(value: unknown): NewsAttachment[] {
  if (!Array.isArray(value)) return [];
  const names: NewsAttachment[] = [];
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

export function toNewsItems(data: unknown): NewsItem[] {
  const parsed = rawList.safeParse(data);
  if (!parsed.success) throw new ResponseDriftError("getNews", "(root) invalid_type");
  return parsed.data.map((item) => {
    const attachments = attachmentsOf(item.attachments ?? item.files);
    return {
      id: text(item.id) ?? (typeof item.id === "number" ? String(item.id) : ""),
      title: text(item.title) ?? "",
      date: when(item.creDate) ?? when(item.date),
      body: text(item.description) ?? text(item.body) ?? text(item.message) ?? "",
      attachments,
      hasAttachment: item.hasAttachment === true || attachments.length > 0,
    };
  });
}
