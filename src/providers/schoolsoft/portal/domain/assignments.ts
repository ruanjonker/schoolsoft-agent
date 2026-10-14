/**
 * `GET /rest-api/parent/ps/assignments/start-page` (app cookies). Field names
 * are the ones recorded in docs/reference/schoolsoft-api.md. Extra keys are
 * ignored. A list that is not an array is drift; a thin item is kept with
 * nulls rather than dropped, because this shape has not been re-checked live.
 */
import { z } from "zod";
import { ResponseDriftError } from "../../../../core/errors/index.js";
import {
  instantToStockholm,
  toLocalDate,
  toStockholmDateTime,
} from "../../../../core/domain/time.js";

export interface AssignmentItem {
  id: string;
  title: string;
  subtitle: string | null;
  /** Due or sort date, YYYY-MM-DD or a Stockholm date-time; null when the portal omitted it. */
  date: string | null;
  submissionStatus: string | null;
  resultStatus: string | null;
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

export function toAssignments(data: unknown): AssignmentItem[] {
  const parsed = rawList.safeParse(data);
  if (!parsed.success) throw new ResponseDriftError("getAssignmentsWeek", "(root) invalid_type");
  return parsed.data.map((item) => ({
    id: text(item.id) ?? (typeof item.id === "number" ? String(item.id) : ""),
    title: text(item.title) ?? "",
    subtitle: text(item.subTitle) ?? text(item.subtitle),
    date: when(item.sortDate) ?? when(item.dueDate) ?? when(item.date),
    submissionStatus: text(item.submissionStatus),
    resultStatus: text(item.resultReportStatus) ?? text(item.resultStatus),
  }));
}
